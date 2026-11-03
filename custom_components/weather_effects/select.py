"""Native translated selects for persistent mode and manual effect."""
from homeassistant.components.select import SelectEntity

from .const import DOMAIN, SELECT_CONTROLS
from .entity import WeatherEffectsControl


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN]["entries"][entry.entry_id]
    async_add_entities([WeatherEffectsSelect(coordinator, entry, key) for key in SELECT_CONTROLS])


class WeatherEffectsSelect(WeatherEffectsControl, SelectEntity):
    """Always expose the configured option, including in automatic mode."""

    def __init__(self, coordinator, entry, key):
        super().__init__(coordinator, entry, key)
        self._attr_options = list(SELECT_CONTROLS[key])

    @property
    def current_option(self):
        return self.configured_value

    async def async_select_option(self, option):
        await self.coordinator.async_set_control(self.key, option)
