"""Native numeric controls for persistent Weather Effects settings."""
from homeassistant.components.number import NumberEntity, NumberMode

from .const import DOMAIN, NUMBER_CONTROLS, NUMBER_UNITS
from .entity import WeatherEffectsControl


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN]["entries"][entry.entry_id]
    async_add_entities([WeatherEffectsNumber(coordinator, entry, key) for key in NUMBER_CONTROLS])


class WeatherEffectsNumber(WeatherEffectsControl, NumberEntity):
    """Bounded, stepped setting; backend validation also protects service calls."""

    _attr_mode = NumberMode.SLIDER

    def __init__(self, coordinator, entry, key):
        super().__init__(coordinator, entry, key)
        self._attr_native_min_value, self._attr_native_max_value, self._attr_native_step = NUMBER_CONTROLS[key]
        if key in NUMBER_UNITS:
            self._attr_native_unit_of_measurement = NUMBER_UNITS[key]

    @property
    def native_value(self):
        return self.configured_value

    async def async_set_native_value(self, value):
        await self.coordinator.async_set_control(self.key, value)
