"""Weather Effects: configurable overlays on explicitly selected dashboards."""
from pathlib import Path

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.const import Platform
from homeassistant.core import callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers import entity_registry as er

from .const import CONTROL_KEYS, DOMAIN, FRONTEND_URL, SIGNAL_UPDATED, VERSION
from .coordinator import WeatherEffectsCoordinator

PLATFORMS = [Platform.SENSOR, Platform.SWITCH, Platform.SELECT, Platform.NUMBER]


@callback
def profile_payload(hass, coordinator):
    """Resolve registry IDs instead of guessing generated or user-renamed entity IDs."""
    registry = er.async_get(hass)
    prefix = coordinator.entry.entry_id
    controls = {}
    for entity in er.async_entries_for_config_entry(registry, prefix):
        if entity.disabled_by is not None:
            continue
        for key in CONTROL_KEYS:
            if entity.domain == CONTROL_KEYS[key] and entity.unique_id == f"{prefix}_control_{key}":
                controls[key] = entity.entity_id
                break
        if entity.domain == "sensor" and entity.unique_id == f"{prefix}_effect":
            controls["status"] = entity.entity_id
    gate_id = coordinator.settings.get("enable_entity")
    gate = hass.states.get(gate_id) if gate_id else None
    return {
        **coordinator.data,
        "controls": controls,
        "configured_enabled": bool(coordinator.settings["enabled"]),
        "effective_enabled": coordinator.data["enabled"],
        "gate_entity": gate_id,
        "gate_enabled": gate.state == "on" if gate else None,
    }


async def async_setup(hass, config):
    """Register one static module and an authenticated live subscription endpoint."""
    hass.data[DOMAIN] = {"entries": {}}
    await hass.http.async_register_static_paths([
        StaticPathConfig("/weather_effects_static", str(Path(__file__).parent / "frontend"), False)
    ])
    frontend.add_extra_js_url(hass, FRONTEND_URL)
    frontend.add_extra_js_url(hass, f"/weather_effects_static/weather-effects-card.js?v={VERSION}")
    websocket_api.async_register_command(hass, websocket_subscribe)

    @callback
    def registry_changed(event):
        # Entity IDs can be renamed or disabled after a card has been configured.
        async_dispatcher_send(hass, SIGNAL_UPDATED)

    hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, registry_changed)
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
        configs = [profile_payload(hass, c) for c in hass.data[DOMAIN]["entries"].values() if c.data]
        connection.send_event(msg["id"], configs)

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_UPDATED, send)
    connection.send_result(msg["id"])
    send()
