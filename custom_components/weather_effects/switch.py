"""Native switches for persistent Weather Effects settings."""
from homeassistant.components.switch import SwitchEntity

from .const import DOMAIN, SWITCH_CONTROLS
from .entity import WeatherEffectsControl


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN]["entries"][entry.entry_id]
    async_add_entities([WeatherEffectsSwitch(coordinator, entry, key) for key in SWITCH_CONTROLS])


class WeatherEffectsSwitch(WeatherEffectsControl, SwitchEntity):
    """Switch the configured setting, not the runtime gate result."""

    @property
    def is_on(self):
        return self.configured_value

    async def async_turn_on(self, **kwargs):
        await self.coordinator.async_set_control(self.key, True)

    async def async_turn_off(self, **kwargs):
        await self.coordinator.async_set_control(self.key, False)
