"""Weather Effects: configurable overlays on explicitly selected dashboards."""
from pathlib import Path

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.const import Platform
from homeassistant.core import callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send

from .const import DOMAIN, FRONTEND_URL, SIGNAL_UPDATED
from .coordinator import WeatherEffectsCoordinator

PLATFORMS = [Platform.SENSOR]


async def async_setup(hass, config):
    """Register one static module and an authenticated live subscription endpoint."""
    hass.data[DOMAIN] = {"entries": {}}
    await hass.http.async_register_static_paths([
        StaticPathConfig("/weather_effects_static", str(Path(__file__).parent / "frontend"), False)
    ])
    frontend.add_extra_js_url(hass, FRONTEND_URL)
    websocket_api.async_register_command(hass, websocket_subscribe)
    return True


async def async_setup_entry(hass, entry):
    coordinator = WeatherEffectsCoordinator(hass, entry)
    await coordinator.async_refresh()
    hass.data[DOMAIN]["entries"][entry.entry_id] = coordinator
    coordinator.bind_states()
    entry.async_on_unload(coordinator.stop)
    entry.async_on_unload(coordinator.async_add_listener(
        lambda: async_dispatcher_send(hass, SIGNAL_UPDATED)))
    entry.async_on_unload(entry.add_update_listener(async_update_options))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    async_dispatcher_send(hass, SIGNAL_UPDATED)
    return True


async def async_update_options(hass, entry):
    """Update profiles live, without re-registering static paths."""
    coordinator = hass.data[DOMAIN]["entries"][entry.entry_id]
    await coordinator.reconfigure()
    name = coordinator.settings.get("name", entry.title)
    if name != entry.title:
        hass.config_entries.async_update_entry(entry, title=name)


async def async_unload_entry(hass, entry):
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    coordinator = hass.data[DOMAIN]["entries"].pop(entry.entry_id)
    coordinator.stop()
    async_dispatcher_send(hass, SIGNAL_UPDATED)
    return True


@callback
@websocket_api.websocket_command({"type": "weather_effects/subscribe"})
def websocket_subscribe(hass, connection, msg):
    """Stream resolved settings; no tokens or external API calls in the browser."""
    @callback
    def send():
        configs = [c.data for c in hass.data[DOMAIN]["entries"].values() if c.data]
        connection.send_event(msg["id"], configs)

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_UPDATED, send)
    connection.send_result(msg["id"])
    send()
