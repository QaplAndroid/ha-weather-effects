"""MOCKED Home Assistant unit tests, not real-HA integration certification.

No HA package is installed or loaded. Services, config-entry persistence, entity
base classes, scheduling and events are explicit stubs; tests exercise real local
control/coordinator code. Run: python -m unittest discover -s tests -v
"""
import asyncio
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

# Reuse the dependency-free backend harness without importing integration setup.
_spec = importlib.util.spec_from_file_location("_controls_backend_harness", Path(__file__).with_name("test_backend.py"))
_harness = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_harness)
backend = _harness.backend


class MockedCoordinatorEntity:
    """MOCKED CoordinatorEntity; no actual HA lifecycle or state machine."""

    def __init__(self, coordinator):
        self.coordinator = coordinator


class MockedPlatformEntity:
    """MOCKED platform base entity."""


def load_entities():
    package = "_weather_effects_controls_unit_tests"
    stubs = {
        package: _harness.module(package, __path__=[str(_harness.BACKEND)]),
        package + ".const": backend.const,
        package + ".presets": backend.presets,
        "homeassistant": _harness.module("homeassistant", __path__=[]),
        "homeassistant.components": _harness.module("homeassistant.components", __path__=[]),
        "homeassistant.components.sensor": _harness.module("homeassistant.components.sensor", SensorEntity=MockedPlatformEntity),
        "homeassistant.helpers.entity": _harness.module("homeassistant.helpers.entity", EntityCategory=SimpleNamespace(DIAGNOSTIC="diagnostic")),
        "homeassistant.components.switch": _harness.module("homeassistant.components.switch", SwitchEntity=MockedPlatformEntity),
        "homeassistant.components.select": _harness.module("homeassistant.components.select", SelectEntity=MockedPlatformEntity),
        "homeassistant.components.number": _harness.module("homeassistant.components.number", NumberEntity=MockedPlatformEntity, NumberMode=SimpleNamespace(SLIDER="slider")),
        "homeassistant.helpers": _harness.module("homeassistant.helpers", __path__=[]),
        "homeassistant.helpers.update_coordinator": _harness.module("homeassistant.helpers.update_coordinator", CoordinatorEntity=MockedCoordinatorEntity),
    }
    loaded = {}
    with patch.dict(sys.modules, stubs):
        for name in ("entity", "switch", "select", "number", "sensor"):
            spec = importlib.util.spec_from_file_location(package + "." + name, _harness.BACKEND / (name + ".py"))
            value = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = value
            spec.loader.exec_module(value)
            loaded[name] = value
    return SimpleNamespace(**loaded)


entities = load_entities()


class ControlsTests(unittest.IsolatedAsyncioTestCase):
    """Persistence and coordinator behavior using MOCKED HA callbacks only."""

    def setUp(self):
        self.entry = SimpleNamespace(entry_id="profile", title="Wall", options={}, data={
            **backend.const.DEFAULTS, "weather_entity": "weather.home",
            "enable_entity": "input_boolean.effects", "dashboards": ["wall"],
            "name": "Wall", "custom_future_setting": "preserved",
        })
        self.hass = SimpleNamespace(
            states=SimpleNamespace(get=lambda key: _harness.state("sunny") if key in {"weather.home", "weather.other"} else (_harness.state("on") if key == "input_boolean.effects" else None)),
            services=SimpleNamespace(async_call=AsyncMock(return_value={"weather.home": {"forecast": [_harness.row("2026-01-15T13:00:00Z")]}})),
            config_entries=SimpleNamespace(async_update_entry=Mock(side_effect=self.persist)),
        )
        self.coordinator = backend.coordinator.WeatherEffectsCoordinator(self.hass, self.entry)
        self.hass.data = {backend.const.DOMAIN: {"entries": {self.entry.entry_id: self.coordinator}}}
        self.event_patch = patch.object(backend.coordinator, "async_track_state_change_event", return_value=Mock())
        self.event_patch.start()
        self.addCleanup(self.event_patch.stop)

    def persist(self, entry, *, options):
        # HA async_update_entry is a synchronous callback, not an async method.
        entry.options = options
        return True

    async def test_full_options_merge_and_sequential_controls(self):
        await self.coordinator.async_set_control("speed", 1.5)
        await self.coordinator.async_set_control("density", 100.0)
        self.assertEqual(self.entry.options, {**self.entry.data, "effect_settings": {"snow": {"speed": 1.5, "density": 100}}})
        self.assertEqual(self.entry.data["speed"], 1.0)
        self.hass.services.async_call.assert_not_awaited()
        self.assertEqual(self.coordinator.settings["speed"], 1.0)  # listener owns runtime updates
        await self.coordinator.reconfigure()
        self.assertEqual(backend.presets.effect_preset(self.coordinator.settings, "snow")["speed"], 1.5)

    async def test_options_are_authoritative_including_removed_optional_settings(self):
        self.entry.options = {**backend.const.DEFAULTS, "dashboards": ["different"]}
        await self.coordinator.async_set_control("opacity", 0.5)
        self.assertNotIn("weather_entity", self.entry.options)
        self.assertNotIn("enable_entity", self.entry.options)
        self.assertEqual(self.entry.options["dashboards"], ["different"])

    async def test_concurrent_controls_do_not_lose_settings(self):
        await asyncio.gather(*(self.coordinator.async_set_control(key, value) for key, value in (
            ("speed", 2.1), ("size", 1.7), ("enabled", False), ("wind", -0.4), ("effect", "rain"))))
        for key, expected in (("speed", 2.1), ("size", 1.7), ("enabled", False), ("wind", -0.4), ("effect", "rain")):
            actual = backend.presets.effect_preset(self.entry.options, "snow")[key] if key in backend.presets.APPEARANCE_KEYS else self.entry.options[key]
            self.assertEqual(actual, expected)
        self.assertEqual(self.entry.options["enable_entity"], "input_boolean.effects")

    async def test_invalid_keys_types_ranges_steps_and_nonfinite_rejected(self):
        cases = [("bad", 1), ([], 1), ("enabled", 1), ("enabled", "false"),
                 ("respect_reduced_motion", 0), ("mode", "auto"), ("mode", []),
                 ("effect", "invalid_effect"), ("effect", None)]
        for key in backend.const.SWITCH_CONTROLS:
            cases.extend((key, value) for value in (0, 1, "false", None, [], {}))
        for key, (low, high, step) in backend.const.NUMBER_CONTROLS.items():
            cases.extend((key, value) for value in (True, "1", None, [], {}, float("nan"), float("inf"), -float("inf"), low - step, high + step, low + step / 2, 10 ** 500))
        for key, value in cases:
            with self.subTest(key=key, value=value):
                with self.assertRaises(_harness.MockedHomeAssistantError):
                    await self.coordinator.async_set_control(key, value)
        self.hass.config_entries.async_update_entry.assert_not_called()

    async def test_all_numeric_boundaries_and_valid_steps(self):
        for key, (low, high, step) in backend.const.NUMBER_CONTROLS.items():
            for value in (low, high, low + step):
                await self.coordinator.async_set_control(key, value)
                self.assertAlmostEqual(backend.presets.configured_control_value(self.entry.options or self.entry.data, key), value)
        await self.coordinator.async_set_control("wind", 0.1 + 0.2)
        self.assertEqual(backend.presets.configured_control_value(self.entry.options, "wind"), 0.3)

    async def test_automatic_requires_configured_weather_not_available_weather(self):
        for weather in (None, "", "sensor.wrong", "weather."):
            self.entry.options = {**backend.const.DEFAULTS, "weather_entity": weather}
            with self.assertRaises(_harness.MockedHomeAssistantError):
                await self.coordinator.async_set_control("mode", "automatic")
        self.entry.options["weather_entity"] = "weather.unavailable"
        await self.coordinator.async_set_control("mode", "automatic")
        self.assertEqual(self.entry.options["mode"], "automatic")

    async def test_noop_does_not_persist_or_refresh(self):
        await self.coordinator.async_set_control("enabled", True)
        self.hass.config_entries.async_update_entry.assert_not_called()
        with patch.object(self.coordinator, "async_refresh", new_callable=AsyncMock) as refresh:
            await self.coordinator.reconfigure()
        refresh.assert_not_awaited()

    async def test_appearance_enable_gate_dashboard_changes_preserve_forecast(self):
        self.entry.options = {**self.entry.data, "mode": "automatic", "forecast_offset": 1}
        await self.coordinator.reconfigure()
        forecast, fetched = self.coordinator._forecast, self.coordinator._fetched_at
        for key, value in (("speed", 2), ("enabled", False), ("respect_reduced_motion", False), ("effect", "sun"), ("dashboards", ["other"]), ("enable_entity", "switch.other")):
            self.entry.options = {**self.entry.options, key: value}
            await self.coordinator.reconfigure()
            self.assertIs(self.coordinator._forecast, forecast)
            self.assertEqual(self.coordinator._fetched_at, fetched)
        self.assertEqual(self.hass.services.async_call.await_count, 1)

    async def test_relevant_changes_invalidate_cache(self):
        for key, value in (("forecast_offset", 2), ("weather_entity", "weather.other"), ("mode", "manual")):
            with self.subTest(key=key):
                self.entry.options = {**self.entry.data, "mode": "automatic", "forecast_offset": 1}
                await self.coordinator.reconfigure()
                self.coordinator._forecast_error = "old"
                previous_calls = self.hass.services.async_call.await_count
                self.entry.options = {**self.entry.options, key: value}
                await self.coordinator.reconfigure()
                if key == "mode":
                    self.assertEqual(self.coordinator._forecast, [])
                    self.assertIsNone(self.coordinator._fetched_at)
                else:
                    self.assertEqual(self.hass.services.async_call.await_count, previous_calls + 1)
                self.assertIsNone(self.coordinator._forecast_error)

    async def test_listener_applies_once_without_duplicate_provider_calls(self):
        self.entry.options = {**self.entry.data, "mode": "automatic", "forecast_offset": 1}
        await self.coordinator.reconfigure()
        await self.coordinator.async_set_control("forecast_offset", 2)
        self.assertEqual(self.hass.services.async_call.await_count, 1)
        with patch.object(self.coordinator, "async_refresh", wraps=self.coordinator.async_refresh) as refresh:
            await asyncio.gather(self.coordinator.reconfigure(), self.coordinator.reconfigure())
        self.assertEqual(refresh.await_count, 1)
        self.assertEqual(self.hass.services.async_call.await_count, 2)

    async def test_native_numbers_follow_edit_target_not_runtime_effect(self):
        added = []
        await entities.number.async_setup_entry(self.hass, self.entry, added.extend)
        controls = {entity.key: entity for entity in added}
        await self.coordinator.async_set_control("settings_effect", "rain")
        await self.coordinator.async_set_control("speed", 2.4)
        await self.coordinator.async_set_control("opacity", .4)
        self.coordinator.data = {"effect": "snow", "speed": 3, "opacity": 1}
        self.assertEqual(controls["speed"].native_value, 2.4)
        self.assertEqual(controls["opacity"].native_value, .4)
        await self.coordinator.async_set_control("settings_effect", "sun")
        self.assertEqual(controls["speed"].native_value, 1)
        await self.coordinator.async_set_control("speed", 1.8)
        self.assertEqual(controls["speed"].native_value, 1.8)
        await self.coordinator.async_set_control("settings_effect", "rain")
        self.assertEqual(controls["speed"].native_value, 2.4)
        self.assertEqual(self.entry.options["speed"], 1)
        self.assertEqual(self.entry.options["effect"], "snow")

    async def test_status_attributes_include_all_global_lightning_controls(self):
        self.coordinator.data = await self.coordinator._async_update_data()
        added = []
        await entities.sensor.async_setup_entry(self.hass, self.entry, added.extend)
        attributes = added[0].extra_state_attributes
        for key in backend.const.LIGHTNING_CONTROLS:
            self.assertEqual(attributes[key], backend.const.DEFAULTS[key])

    async def test_platform_entities_identity_metadata_configured_state_and_services(self):
        added = []
        for platform in (entities.switch, entities.select, entities.number):
            await platform.async_setup_entry(self.hass, self.entry, added.extend)
        self.assertEqual(len(added), len(backend.const.CONTROL_KEYS))
        self.assertEqual({entity.key for entity in added}, set(backend.const.CONTROL_KEYS))
        self.coordinator.data = {"enabled": False, "effect": "off"}
        controls = {entity.key: entity for entity in added}
        for key, entity in controls.items():
            self.assertEqual(entity._attr_unique_id, f"profile_control_{key}")
            self.assertNotEqual(entity._attr_unique_id, "profile_effect")
            self.assertEqual(entity._attr_device_info["identifiers"], {(backend.const.DOMAIN, "profile")})
            self.assertTrue(entity._attr_has_entity_name)
            self.assertEqual(entity._attr_translation_key, key)
            self.assertEqual(entity.configured_value, backend.presets.configured_control_value(self.entry.data, key))
        self.assertTrue(controls["enabled"].is_on)
        self.assertFalse(controls["lightning_enabled"].is_on)
        self.assertTrue(controls["lightning_bolt_enabled"].is_on)
        self.assertTrue(controls["lightning_flash_enabled"].is_on)
        for key, unit in backend.const.NUMBER_UNITS.items():
            self.assertEqual(controls[key]._attr_native_unit_of_measurement, unit)
        self.assertEqual(controls["effect"].current_option, "snow")
        self.assertEqual(controls["effect"]._attr_options, list(backend.const.EFFECTS))
        for key, (low, high, step) in backend.const.NUMBER_CONTROLS.items():
            control = controls[key]
            self.assertEqual((control._attr_native_min_value, control._attr_native_max_value, control._attr_native_step), (low, high, step))
            self.assertEqual(control.native_value, self.entry.data[key])
        self.coordinator.async_set_control = AsyncMock()
        await controls["enabled"].async_turn_on()
        await controls["enabled"].async_turn_off()
        await controls["mode"].async_select_option("automatic")
        await controls["speed"].async_set_native_value(2)
        self.assertEqual(self.coordinator.async_set_control.await_count, 4)
        self.coordinator.async_set_control.assert_any_await("enabled", True)
        self.coordinator.async_set_control.assert_any_await("enabled", False)
        self.coordinator.async_set_control.assert_any_await("mode", "automatic")
        self.coordinator.async_set_control.assert_any_await("speed", 2)


if __name__ == "__main__":
    unittest.main()
