"""UI-only setup and options for Weather Effects."""
from copy import deepcopy
import math

from homeassistant import config_entries
from homeassistant.components import frontend
from homeassistant.core import callback
from homeassistant.helpers import selector

from .compat import vol
from .const import DEFAULTS, DEFAULT_WEATHER, DOMAIN, EFFECTS, LIGHTNING_CONTROLS, NUMBER_CONTROLS, NUMBER_UNITS, SWITCH_CONTROLS
from .logic import normalize_dashboard
from .named_presets import validate_cloud_bounds
from .presets import effect_preset


def validate_stored_cloud_bounds(settings):
    """Check raw legacy entries too: canonical resolution must not hide errors."""
    stored = settings.get("effect_settings", {})
    if isinstance(stored, dict):
        for appearance in stored.values():
            if isinstance(appearance, dict):
                validate_cloud_bounds({**settings, **appearance})
    for effect in EFFECTS:
        validate_cloud_bounds(effect_preset(settings, effect))


def schema(hass, current):
    """Discover registered Lovelace dashboards, including custom URL paths."""
    panels = hass.data.get(frontend.DATA_PANELS, {})
    choices = [{"value": path, "label": f"{panel.sidebar_title or path} (/{path})"}
               for path, panel in panels.items() if panel.component_name == "lovelace"]
    if not choices:
        choices = [{"value": "lovelace", "label": "Overview (/lovelace)"}]
    values = {**DEFAULTS, **current}
    fields = {
        vol.Required("name", default=current.get("name", "Weather Effects")): selector.TextSelector(),
        vol.Required("enabled", default=values["enabled"]): selector.BooleanSelector(),
        vol.Required("dashboards", default=values["dashboards"]): selector.SelectSelector(
            selector.SelectSelectorConfig(options=choices, multiple=True, custom_value=True, mode="dropdown")),
        vol.Required("mode", default=values["mode"]): selector.SelectSelector(
            selector.SelectSelectorConfig(options=["manual", "automatic"], translation_key="mode")),
        vol.Required("effect", default=values["effect"]): selector.SelectSelector(
            selector.SelectSelectorConfig(options=list(EFFECTS), translation_key="effect")),
        vol.Optional("weather_entity", description={"suggested_value": current.get("weather_entity", DEFAULT_WEATHER)}):
            selector.EntitySelector(selector.EntitySelectorConfig(domain="weather")),
        vol.Optional("enable_entity", description={"suggested_value": current.get("enable_entity")}):
            selector.EntitySelector(selector.EntitySelectorConfig(domain=["input_boolean", "switch", "binary_sensor"])),
        vol.Required("forecast_offset", default=values["forecast_offset"]): number(0, 72, 1, "h"),
        vol.Required("speed", default=values["speed"]): number(0.2, 3, 0.1),
        vol.Required("size", default=values["size"]): number(0.3, 3, 0.1),
        vol.Required("density", default=values["density"]): number(10, 200, 1),
        vol.Required("opacity", default=values["opacity"]): number(0.05, 1, 0.05),
        vol.Required("wind", default=values["wind"]): number(-2, 2, 0.1),
        vol.Required("respect_reduced_motion", default=values["respect_reduced_motion"]): selector.BooleanSelector(),
        vol.Required("max_fps", default=values["max_fps"]): number(15, 60, 1),
        vol.Required("adaptive_weather", default=values["adaptive_weather"]): selector.BooleanSelector(),
        vol.Required("heat_threshold", default=values["heat_threshold"]): number(25, 45, 1, "°C"),
    }
    for key in ("cloud_top", "cloud_bottom", "cloud_spread"):
        fields[vol.Required(key, default=values[key])] = number(*NUMBER_CONTROLS[key], unit="%")
    for key in LIGHTNING_CONTROLS:
        fields[vol.Required(key, default=values[key])] = (
            selector.BooleanSelector() if key in SWITCH_CONTROLS
            else number(*NUMBER_CONTROLS[key], unit=NUMBER_UNITS.get(key))
        )
    return vol.Schema(fields)


def number(low, high, step, unit=None):
    config = {"min": low, "max": high, "step": step, "mode": "slider"}
    if unit:
        config["unit_of_measurement"] = unit
    return selector.NumberSelector(selector.NumberSelectorConfig(**config))


def validate(hass, data):
    errors = {}
    for key in SWITCH_CONTROLS:
        if key in data and type(data[key]) is not bool:
            errors[key] = "invalid_boolean"
    for key, (low, high, step) in NUMBER_CONTROLS.items():
        if key not in data:
            continue
        value = data[key]
        valid = type(value) in (int, float) and low <= value <= high and math.isfinite(value)
        if valid:
            steps = (value - low) / step
            valid = math.isclose(steps, round(steps), rel_tol=0, abs_tol=1e-8)
        if not valid:
            errors[key] = "invalid_number"
    if not any(key in errors for key in ("cloud_top", "cloud_bottom")):
        try:
            validate_cloud_bounds(data)
            # Flat fallback changes must also keep partial effect overrides valid.
            validate_stored_cloud_bounds(data)
        except ValueError:
            errors["cloud_top"] = "invalid_cloud_bounds"
    if not data.get("dashboards"):
        errors["dashboards"] = "dashboard_required"
    else:
        try:
            data["dashboards"] = list(dict.fromkeys(normalize_dashboard(v) for v in data["dashboards"]))
        except ValueError:
            errors["dashboards"] = "invalid_dashboard"
    if not data.get("name", "").strip():
        errors["name"] = "name_required"
    if data.get("mode") == "automatic" and not data.get("weather_entity"):
        errors["weather_entity"] = "weather_required"
    # Permit temporarily unavailable entities, but not nonexistent or wrong-domain IDs.
    for field, domains in (("weather_entity", {"weather"}),
                           ("enable_entity", {"input_boolean", "switch", "binary_sensor"})):
        entity_id = data.get(field)
        if entity_id and (entity_id.split(".")[0] not in domains or hass.states.get(entity_id) is None):
            errors[field] = "entity_missing"
    return errors


class WeatherEffectsConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create one or more independent effect profiles."""
    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            errors = validate(self.hass, user_input)
            if not errors:
                return self.async_create_entry(title=user_input["name"], data=user_input)
        return self.async_show_form(step_id="user", data_schema=schema(self.hass, user_input or {}), errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return WeatherEffectsOptionsFlow()


class WeatherEffectsOptionsFlow(config_entries.OptionsFlow):
    """Configure profiles without YAML or a Home Assistant restart."""
    async def async_step_init(self, user_input=None):
        errors = {}
        if user_input is not None:
            errors = validate(self.hass, user_input)
            if not errors:
                # This general form edits legacy defaults, not effect presets.
                # Preserve all hidden/future storage from the authoritative
                # settings, but let omitted optional entity fields be removed.
                current = self.config_entry.options or self.config_entry.data
                saved = deepcopy(current)
                for key in ("weather_entity", "enable_entity"):
                    if key not in user_input:
                        saved.pop(key, None)
                saved.update(user_input)
                for key in ("effect_settings", "settings_effect", "saved_presets"):
                    if key in current:
                        saved[key] = deepcopy(current[key])
                try:
                    validate_stored_cloud_bounds(saved)
                except ValueError:
                    errors["cloud_top"] = "invalid_cloud_bounds"
                if not errors:
                    return self.async_create_entry(title="", data=saved)
        current = self.config_entry.options or self.config_entry.data
        return self.async_show_form(step_id="init", data_schema=schema(self.hass, user_input or current), errors=errors)
