"""Resolve weather once on the server and push small runtime settings to clients."""
import asyncio
from datetime import timedelta
import logging
import math

from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.util import dt as dt_util

from .const import CONTROL_KEYS, DOMAIN, LIGHTNING_CONTROLS, NUMBER_CONTROLS, SELECT_CONTROLS, SWITCH_CONTROLS
from .logic import select_weather, parse_time
from .presets import APPEARANCE_KEYS, configured_settings, configured_control_value, editing_effect, effect_preset
from .intensity import adapt, weather_metrics, nearest_hourly
from .named_presets import apply_preset_action, preset_summaries, validate_cloud_bounds

_LOGGER = logging.getLogger(__name__)


class WeatherEffectsCoordinator(DataUpdateCoordinator):
    """Cache hourly forecasts; never call the provider per browser or animation frame."""

    def __init__(self, hass, entry):
        super().__init__(hass, _LOGGER, name=f"{DOMAIN}_{entry.entry_id}",
                         update_interval=timedelta(minutes=5))
        self.entry = entry
        self.settings = configured_settings(entry)
        self._forecast = []
        self._forecast_entity = None
        self._fetched_at = None
        self._unsub_states = None
        self._forecast_error = None
        self._control_lock = asyncio.Lock()
        self._reconfigure_lock = asyncio.Lock()

    @callback
    def bind_states(self):
        if self._unsub_states:
            self._unsub_states()
        entities = [value for key in ("weather_entity", "enable_entity")
                    if (value := self.settings.get(key))]
        entities.append("sun.sun")
        self._unsub_states = async_track_state_change_event(self.hass, entities, self._state_changed)

    @callback
    def _state_changed(self, event):
        self.hass.async_create_task(self.async_request_refresh())

    @callback
    def stop(self):
        if self._unsub_states:
            self._unsub_states()
            self._unsub_states = None

    async def async_set_control(self, key, value):
        """Persist one validated control; the options listener applies it once.

        HA's async_update_entry is a synchronous event-loop callback: reading,
        merging and writing options under this lock cannot lose another control's
        update. Never write a partial options dictionary (it replaces all options).
        """
        async with self._control_lock:
            if not isinstance(key, str) or key not in CONTROL_KEYS:
                raise HomeAssistantError("Unknown Weather Effects control")
            if key in SWITCH_CONTROLS:
                valid = type(value) is bool
            elif key in SELECT_CONTROLS:
                valid = isinstance(value, str) and value in SELECT_CONTROLS[key]
            else:
                minimum, maximum, step = NUMBER_CONTROLS[key]
                valid = (type(value) in (int, float) and minimum <= value <= maximum
                         and math.isfinite(value))
                if valid:
                    steps = (value - minimum) / step
                    valid = minimum <= value <= maximum and math.isclose(
                        steps, round(steps), rel_tol=0, abs_tol=1e-8)
                if valid:
                    # Normalize floating-point slider artifacts and integer steps.
                    value = round(minimum + round(steps) * step, 10)
                    if step == 1:
                        value = int(value)
            if not valid:
                raise HomeAssistantError(f"Invalid value for Weather Effects control: {key}")
            options = configured_settings(self.entry)
            if key == "mode" and value == "automatic":
                weather_entity = options.get("weather_entity")
                if not isinstance(weather_entity, str) or not weather_entity.startswith("weather.") or not weather_entity[8:]:
                    raise HomeAssistantError("Automatic mode requires a configured weather entity")
            if configured_control_value(options, key) == value and (
                key != "effect" or editing_effect(options) == value
            ):
                if key == "lightning_enabled" and value is False:
                    self._publish_lightning_off()
                return
            if key in APPEARANCE_KEYS:
                target = editing_effect(options)
                stored = options.get("effect_settings")
                presets = dict(stored) if isinstance(stored, dict) else {}
                previous = presets.get(target)
                presets[target] = {**(previous if isinstance(previous, dict) else {}), key: value}
                options["effect_settings"] = presets
                if key in ("cloud_top", "cloud_bottom"):
                    try:
                        validate_cloud_bounds(effect_preset(options, target))
                    except ValueError as err:
                        raise HomeAssistantError(str(err)) from err
            else:
                options[key] = value
                if key == "effect":
                    options["settings_effect"] = value
            self.hass.config_entries.async_update_entry(self.entry, options=options)
            if key == "lightning_enabled" and value is False:
                self._publish_lightning_off()

    @callback
    def _publish_lightning_off(self):
        """Stop flashes immediately, even if the options listener awaits weather."""
        if isinstance(self.data, dict) and self.data.get("lightning_enabled"):
            self.async_set_updated_data({**self.data, "lightning_enabled": False})

    async def async_preset_action(self, action, preset_id=None, name=None, overwrite=False):
        """Persist one atomic named-library operation; listener owns weather refresh."""
        async with self._control_lock:
            current = configured_settings(self.entry)
            options, response = apply_preset_action(current, action, preset_id, name, overwrite)
            if options != current:
                self.hass.config_entries.async_update_entry(self.entry, options=options)
            if action in ("load", "factory_reset"):
                self._publish_lightning_off()
            return response

    async def reconfigure(self):
        """Apply the latest options once, preserving unrelated forecast caches."""
        async with self._reconfigure_lock:
            settings = configured_settings(self.entry)
            if settings == self.settings:
                return
            if any(settings.get(key) != self.settings.get(key) for key in (
                "weather_entity", "mode", "forecast_offset"
            )):
                self._forecast = []
                self._forecast_entity = None
                self._fetched_at = None
                self._forecast_error = None
            self.settings = settings
            self.bind_states()
            await self.async_refresh()

    async def _async_update_data(self):
        cfg = dict(self.settings)
        now = dt_util.utcnow()
        entity_id = cfg.get("weather_entity")
        weather = self.hass.states.get(entity_id) if entity_id else None
        current = weather.state if weather else None
        gate_id = cfg.get("enable_entity")
        gate = self.hass.states.get(gate_id) if gate_id else None
        enabled = bool(cfg["enabled"]) and (not gate_id or (gate is not None and gate.state == "on"))
        source = "manual"
        condition = None
        forecast_time = None
        effect = cfg["effect"]
        status = "ok"
        attrs = getattr(weather, "attributes", {}) or {}
        metrics = weather_metrics(attrs, attrs)
        adaptive = cfg["mode"] == "automatic" and cfg["adaptive_weather"]
        if cfg["mode"] == "automatic":
            offset = cfg["forecast_offset"]
            if entity_id != self._forecast_entity:
                self._forecast, self._fetched_at = [], None
                self._forecast_entity = entity_id
            needs_forecast = offset or (adaptive and metrics["precipitation_mm_h"] is None)
            if enabled and needs_forecast and entity_id and (self._fetched_at is None or now - self._fetched_at >= timedelta(minutes=15)):
                self._fetched_at = now  # Back off on errors as well as successes.
                self._forecast_error = None
                try:
                    async with asyncio.timeout(20):
                        result = await self.hass.services.async_call(
                            "weather", "get_forecasts", {"entity_id": entity_id, "type": "hourly"},
                            blocking=True, return_response=True,
                        )
                    entity_result = result.get(entity_id) if isinstance(result, dict) else None
                    rows = entity_result.get("forecast") if isinstance(entity_result, dict) else None
                    self._forecast = rows if isinstance(rows, list) else []
                except (HomeAssistantError, TimeoutError, ValueError, TypeError) as err:
                    self._forecast = []  # Do not keep using stale forecasts after a failure.
                    self._forecast_error = type(err).__name__
                    _LOGGER.debug("Hourly forecast unavailable for %s: %s", entity_id, err)
            sun = self.hass.states.get("sun.sun")
            daytime = sun.state == "above_horizon" if sun and sun.state in {"above_horizon", "below_horizon"} else None
            effect, source, condition, forecast_time = select_weather(current, self._forecast, offset, now, daytime)
            if source == "fallback_current":
                status = "forecast_fallback"
            if current in (None, "unknown", "unavailable") and source != "forecast":
                effect, status = "off", "weather_unavailable"
            if source == "forecast":
                selected = next((row for row in self._forecast if isinstance(row, dict)
                                 and parse_time(row.get("datetime")) == parse_time(forecast_time)), {})
                metrics = weather_metrics(selected, attrs, hourly=True)
            else:
                metrics = weather_metrics(attrs, attrs, rain_row=nearest_hourly(self._forecast, now) if adaptive else None)
        preset = effect_preset(cfg, effect)
        effective, intensity = adapt(preset, effect, metrics, adaptive, cfg["heat_threshold"])
        if gate_id and (gate is None or gate.state in {"unknown", "unavailable"}):
            status = "enable_entity_unavailable"
        latest = configured_settings(self.entry)
        return {
            "id": self.entry.entry_id,
            "name": cfg.get("name", self.entry.title),
            "enabled": enabled,
            "dashboards": cfg["dashboards"],
            "effect": effect if enabled else "off",
            **effective,
            "settings_effect": editing_effect(cfg), "preset": preset,
            "saved_presets": preset_summaries(latest),
            "intensity": intensity, "weather_metrics": metrics,
            **{key: cfg[key] for key in ("respect_reduced_motion", "max_fps", "adaptive_weather", "heat_threshold", *LIGHTNING_CONTROLS)},
            # A forecast already in flight must not republish an old enabled master.
            "lightning_enabled": bool(cfg["lightning_enabled"] and latest["lightning_enabled"]),
            "mode": cfg["mode"], "source": source, "condition": condition,
            "forecast_time": forecast_time, "forecast_offset": cfg["forecast_offset"],
            "status": status, "weather_entity": entity_id,
        }
