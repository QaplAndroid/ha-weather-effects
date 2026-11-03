"""Integration wiring unit tests using explicitly mocked Home Assistant APIs.

Does not load HA, register real entities, verify browser rendering, or establish
compatibility with HA's real schemas/lifecycle.
"""
import importlib.util
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest
from unittest.mock import AsyncMock, Mock, patch

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "_weather_effects_wiring_tests"


def module(name, **attrs):
    result = ModuleType(name)
    result.__dict__.update(attrs)
    return result


def load_integration():
    callbacks = []
    registry = SimpleNamespace(entries=[])
    er = module("homeassistant.helpers.entity_registry",
                EVENT_ENTITY_REGISTRY_UPDATED="entity_registry_updated",
                async_get=lambda hass: registry,
                async_entries_for_config_entry=lambda reg, entry_id: [
                    row for row in reg.entries if row.config_entry_id == entry_id])
    frontend = module("homeassistant.components.frontend", add_extra_js_url=Mock())
    dispatcher = module("homeassistant.helpers.dispatcher",
                        async_dispatcher_send=Mock(),
                        async_dispatcher_connect=Mock(side_effect=lambda hass, signal, cb: (
                            callbacks.append(cb) or Mock())))
    ws = module("homeassistant.components.websocket_api",
                websocket_command=lambda schema: lambda fn: fn,
                async_register_command=Mock())
    coordinator_type = Mock()
    stubs = {
        "homeassistant": module("homeassistant", __path__=[]),
        "homeassistant.components": module("homeassistant.components", __path__=[]),
        "homeassistant.components.frontend": frontend,
        "homeassistant.components.websocket_api": ws,
        "homeassistant.components.http": module("homeassistant.components.http", StaticPathConfig=lambda *args: args),
        "homeassistant.const": module("homeassistant.const", Platform=SimpleNamespace(
            SENSOR="sensor", SWITCH="switch", SELECT="select", NUMBER="number")),
        "homeassistant.core": module("homeassistant.core", callback=lambda fn: fn),
        "homeassistant.helpers": module("homeassistant.helpers", __path__=[]),
        "homeassistant.helpers.dispatcher": dispatcher,
        "homeassistant.helpers.entity_registry": er,
        PACKAGE + ".coordinator": module(PACKAGE + ".coordinator", WeatherEffectsCoordinator=coordinator_type),
    }
    spec = importlib.util.spec_from_file_location(PACKAGE, ROOT / "custom_components/weather_effects/__init__.py",
                                                submodule_search_locations=[str(ROOT / "custom_components/weather_effects")])
    result = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {**stubs, PACKAGE: result}):
        spec.loader.exec_module(result)
    return result, registry, frontend, dispatcher, ws, callbacks, coordinator_type


def registry_row(entity_id, unique_id, *, entry="profile", disabled=None):
    return SimpleNamespace(entity_id=entity_id, unique_id=unique_id,
                           domain=entity_id.split(".")[0], config_entry_id=entry, disabled_by=disabled)


class WiringTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        (self.integration, self.registry, self.frontend, self.dispatcher,
         self.ws, self.callbacks, self.coordinator_type) = load_integration()
        self.coordinator = SimpleNamespace(
            entry=SimpleNamespace(entry_id="profile"),
            settings={"enabled": True, "enable_entity": "input_boolean.gate"},
            data={"id": "profile", "name": "Example", "enabled": False, "effect": "off"})
        self.hass = SimpleNamespace(
            data={"weather_effects": {"entries": {"profile": self.coordinator}}},
            states=SimpleNamespace(get=lambda eid: SimpleNamespace(state="off")),
            http=SimpleNamespace(async_register_static_paths=AsyncMock()),
            bus=SimpleNamespace(async_listen=Mock()),
            config_entries=SimpleNamespace(async_forward_entry_setups=AsyncMock(),
                                           async_unload_platforms=AsyncMock(return_value=True)))

    def test_payload_uses_registry_ids_and_excludes_disabled_and_other_profiles(self):
        self.registry.entries = [
            registry_row("switch.custom_name", "profile_control_enabled"),
            registry_row("number.renamed_speed", "profile_control_speed"),
            registry_row("number.disabled", "profile_control_size", disabled="user"),
            registry_row("select.effect_control", "profile_control_effect"),
            registry_row("sensor.runtime_effect", "profile_effect"),
            registry_row("switch.other", "profile_control_enabled", entry="other"),
        ]
        data = self.integration.profile_payload(self.hass, self.coordinator)
        self.assertEqual(data["controls"], {"enabled": "switch.custom_name", "speed": "number.renamed_speed",
                                             "effect": "select.effect_control", "status": "sensor.runtime_effect"})
        self.assertTrue(data["configured_enabled"])
        self.assertFalse(data["effective_enabled"])
        self.assertFalse(data["gate_enabled"])
        self.assertEqual(data["gate_entity"], "input_boolean.gate")
        self.assertNotIn("controls", self.coordinator.data)

    def test_missing_gate_and_no_control_registry_entries_are_safe(self):
        self.hass.states.get = lambda eid: None
        result = self.integration.profile_payload(self.hass, self.coordinator)
        self.assertIsNone(result["gate_enabled"])
        self.assertEqual(result["controls"], {})
        self.coordinator.settings.pop("enable_entity")
        self.assertIsNone(self.integration.profile_payload(self.hass, self.coordinator)["gate_entity"])

    async def test_setup_registers_overlay_and_card_once_with_versioned_urls(self):
        self.assertTrue(await self.integration.async_setup(self.hass, {}))
        self.hass.http.async_register_static_paths.assert_awaited_once()
        urls = [call.args[1] for call in self.frontend.add_extra_js_url.call_args_list]
        self.assertEqual(len(urls), 2)
        self.assertTrue(any("weather-effects.js?v=" in value for value in urls))
        self.assertTrue(any("weather-effects-card.js?v=" in value for value in urls))
        self.ws.async_register_command.assert_called_once()
        self.hass.bus.async_listen.assert_called_once()
        self.hass.bus.async_listen.call_args.args[1](SimpleNamespace())
        self.dispatcher.async_dispatcher_send.assert_called_with(self.hass, self.integration.SIGNAL_UPDATED)

    def test_subscription_ack_initial_payload_and_followup_unload(self):
        connection = SimpleNamespace(subscriptions={}, send_result=Mock(), send_event=Mock())
        self.integration.websocket_subscribe(self.hass, connection, {"id": 23})
        connection.send_result.assert_called_once_with(23)
        connection.send_event.assert_called_once()
        self.assertEqual(connection.send_event.call_args.args[1][0]["id"], "profile")
        self.assertIn(23, connection.subscriptions)
        self.hass.data["weather_effects"]["entries"].clear()
        self.callbacks[0]()
        connection.send_event.assert_called_with(23, [])
        connection.subscriptions[23]()

    async def test_entry_setup_forwards_all_control_platforms_and_unloads(self):
        coordinator = SimpleNamespace(async_refresh=AsyncMock(), bind_states=Mock(), stop=Mock(),
                                      async_add_listener=Mock(return_value=Mock()))
        self.coordinator_type.return_value = coordinator
        entry = SimpleNamespace(entry_id="new", async_on_unload=Mock(), add_update_listener=Mock(return_value=Mock()))
        self.assertTrue(await self.integration.async_setup_entry(self.hass, entry))
        coordinator.async_refresh.assert_awaited_once()
        self.assertEqual(set(self.hass.config_entries.async_forward_entry_setups.call_args.args[1]),
                         {"sensor", "switch", "select", "number"})
        self.assertTrue(await self.integration.async_unload_entry(self.hass, entry))
        coordinator.stop.assert_called_once()
        self.assertNotIn("new", self.hass.data["weather_effects"]["entries"])


if __name__ == "__main__":
    unittest.main()
