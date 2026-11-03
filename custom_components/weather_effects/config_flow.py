"""UI-only setup and options for Weather Effects."""
from homeassistant import config_entries
from homeassistant.components import frontend
from homeassistant.core import callback
from homeassistant.helpers import selector

from .compat import vol
from .const import DEFAULTS, DEFAULT_WEATHER, DOMAIN, EFFECTS
from .logic import normalize_dashboard


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
        vol.Required("lightning_enabled", default=values["lightning_enabled"]): selector.BooleanSelector(),
        vol.Required("lightning_interval", default=values["lightning_interval"]): number(5, 60, 1, "s"),
        vol.Required("lightning_brightness", default=values["lightning_brightness"]): number(0.05, 0.25, 0.05),
    }
    return vol.Schema(fields)


def number(low, high, step, unit=None):
    config = {"min": low, "max": high, "step": step, "mode": "slider"}
    if unit:
        config["unit_of_measurement"] = unit
    return selector.NumberSelector(selector.NumberSelectorConfig(**config))


def validate(hass, data):
    errors = {}
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
                # Preserve hidden per-effect storage, while allowing optional
                # entity fields omitted from this submission to be removed.
                current = self.config_entry.options or self.config_entry.data
                saved = dict(user_input)
                for key in ("effect_settings", "settings_effect"):
                    if key in current:
                        saved[key] = current[key]
                return self.async_create_entry(title="", data=saved)
        current = self.config_entry.options or self.config_entry.data
        return self.async_show_form(step_id="init", data_schema=schema(self.hass, user_input or current), errors=errors)
