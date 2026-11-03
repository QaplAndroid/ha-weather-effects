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

from .const import CONTROL_KEYS, DEFAULTS, DOMAIN, NUMBER_CONTROLS, SELECT_CONTROLS, SWITCH_CONTROLS
from .logic import select_weather

_LOGGER = logging.getLogger(__name__)


class WeatherEffectsCoordinator(DataUpdateCoordinator):
    """Cache hourly forecasts; never call the provider per browser or animation frame."""

    def __init__(self, hass, entry):
        super().__init__(hass, _LOGGER, name=f"{DOMAIN}_{entry.entry_id}",
                         update_interval=timedelta(minutes=5))
        self.entry = entry
        self.settings = {**DEFAULTS, **(entry.options or entry.data)}
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
            options = {**DEFAULTS, **(self.entry.options or self.entry.data)}
            if key == "mode" and value == "automatic":
                weather_entity = options.get("weather_entity")
                if not isinstance(weather_entity, str) or not weather_entity.startswith("weather.") or not weather_entity[8:]:
                    raise HomeAssistantError("Automatic mode requires a configured weather entity")
            if options.get(key) == value:
                return
            options[key] = value
            self.hass.config_entries.async_update_entry(self.entry, options=options)

    async def reconfigure(self):
        """Apply the latest options once, preserving unrelated forecast caches."""
        async with self._reconfigure_lock:
            settings = {**DEFAULTS, **(self.entry.options or self.entry.data)}
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
        if cfg["mode"] == "automatic":
            offset = cfg["forecast_offset"]
            if entity_id != self._forecast_entity:
                self._forecast, self._fetched_at = [], None
                self._forecast_entity = entity_id
            if offset and entity_id and (self._fetched_at is None or now - self._fetched_at >= timedelta(minutes=15)):
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
        if gate_id and (gate is None or gate.state in {"unknown", "unavailable"}):
            status = "enable_entity_unavailable"
        return {
            "id": self.entry.entry_id,
            "name": cfg.get("name", self.entry.title),
            "enabled": enabled,
            "dashboards": cfg["dashboards"],
            "effect": effect if enabled else "off",
            **{key: cfg[key] for key in ("speed", "size", "density", "opacity", "wind", "respect_reduced_motion", "max_fps")},
            "mode": cfg["mode"], "source": source, "condition": condition,
            "forecast_time": forecast_time, "forecast_offset": cfg["forecast_offset"],
            "status": status, "weather_entity": entity_id,
        }
