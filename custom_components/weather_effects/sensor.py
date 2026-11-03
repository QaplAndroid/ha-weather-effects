"""Diagnostic status for the selected effect and forecast fallback."""
from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([WeatherEffectsStatus(hass.data[DOMAIN]["entries"][entry.entry_id], entry)])


class WeatherEffectsStatus(CoordinatorEntity, SensorEntity):
    _attr_has_entity_name = True
    _attr_name = "Effect"
    _attr_icon = "mdi:weather-partly-snowy-rainy"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator, entry):
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_effect"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": entry.title,
            "manufacturer": "Weather Effects",
            "model": "Dashboard overlay",
        }

    @property
    def native_value(self):
        return self.coordinator.data["effect"]

    @property
    def extra_state_attributes(self):
        return {key: self.coordinator.data.get(key) for key in (
            "enabled", "mode", "source", "condition", "forecast_offset", "forecast_time",
            "status", "weather_entity", "dashboards", "settings_effect", "preset", "intensity",
            "weather_metrics", "adaptive_weather", "lightning_enabled", "lightning_interval", "lightning_brightness")}
