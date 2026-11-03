"""Shared native control identity and configured (not weather-resolved) state."""
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DEFAULTS, DOMAIN


class WeatherEffectsControl(CoordinatorEntity):
    """A persistent profile setting on the same device as the status sensor."""

    _attr_has_entity_name = True

    def __init__(self, coordinator, entry, key):
        super().__init__(coordinator)
        self.key = key
        self.entry = entry
        self._attr_unique_id = f"{entry.entry_id}_control_{key}"
        self._attr_translation_key = key
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": entry.title,
            "manufacturer": "Weather Effects",
            "model": "Dashboard overlay",
        }

    @property
    def configured_value(self):
        """Read persisted options even before the scheduled listener runs."""
        return (self.entry.options or self.entry.data).get(self.key, DEFAULTS[self.key])
