"""Dependency-free backend unit tests; all Home Assistant interfaces are MOCKED.

Run: python -m unittest discover -s tests -p test_backend.py -v
These tests do NOT load Home Assistant, validate actual selector/schema behavior,
or establish compatibility with a real HA installation. Import a private package
alias to bypass the integration's __init__ and isolate minimal HA API stubs.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
from datetime import datetime, timedelta, timezone
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "custom_components" / "weather_effects"
NOW = datetime(2026, 1, 15, 12, tzinfo=timezone.utc)
PACKAGE = "_weather_effects_backend_unit_tests"


class MockedHomeAssistantError(Exception):
    """MOCKED homeassistant.exceptions.HomeAssistantError."""


class MockedCoordinator:
    """MOCKED scheduler: explicitly invoke refresh; no HA scheduling occurs."""

    def __init__(self, hass, logger, *, name, update_interval):
        self.hass = hass
        self.name = name
        self.update_interval = update_interval
        self.data = None

    async def async_refresh(self):
        self.data = await self._async_update_data()

    async def async_request_refresh(self):
        await self.async_refresh()


class MockedFlow:
    """MOCKED flow plumbing, not HA flow-manager integration."""

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__()

    def async_create_entry(self, **kwargs):
        return {"type": "create_entry", **kwargs}

    def async_show_form(self, **kwargs):
        return {"type": "form", **kwargs}


class MockedSelector:
    def __init__(self, config=None):
        self.config = config


class MockedMarker:
    def __init__(self, key, **kwargs):
        self.key, self.kwargs = key, kwargs


def module(name, **attributes):
    value = ModuleType(name)
    value.__dict__.update(attributes)
    return value


def load_backend():
    """Load real backend source, replacing ONLY its external HA/schema imports."""
    stubs = {
        "homeassistant": module("homeassistant", __path__=[]),
        "homeassistant.core": module("homeassistant.core", callback=lambda fn: fn),
        "homeassistant.exceptions": module("homeassistant.exceptions", HomeAssistantError=MockedHomeAssistantError),
        "homeassistant.helpers": module("homeassistant.helpers", __path__=[]),
        "homeassistant.helpers.event": module("homeassistant.helpers.event", async_track_state_change_event=Mock()),
        "homeassistant.helpers.update_coordinator": module("homeassistant.helpers.update_coordinator", DataUpdateCoordinator=MockedCoordinator),
        "homeassistant.util": module("homeassistant.util", __path__=[]),
        "homeassistant.util.dt": module("homeassistant.util.dt", utcnow=lambda: NOW),
        "homeassistant.config_entries": module("homeassistant.config_entries", ConfigFlow=MockedFlow, OptionsFlow=MockedFlow),
        "homeassistant.components": module("homeassistant.components", __path__=[]),
        "homeassistant.components.frontend": module("homeassistant.components.frontend", DATA_PANELS="panels"),
        "homeassistant.helpers.selector": module("homeassistant.helpers.selector"),
    }
    selectors = stubs["homeassistant.helpers.selector"]
    for name in ("TextSelector", "BooleanSelector", "SelectSelector", "EntitySelector", "NumberSelector"):
        setattr(selectors, name, MockedSelector)
        setattr(selectors, name + "Config", lambda **kwargs: kwargs)
    stubs[PACKAGE] = module(PACKAGE, __path__=[str(BACKEND)])
    # Stub compat directly: no probatio/voluptuous dependency or schema validation.
    stubs[PACKAGE + ".compat"] = module(PACKAGE + ".compat", vol=SimpleNamespace(
        Required=MockedMarker, Optional=MockedMarker, Schema=lambda fields: fields))
    loaded = {}
    with patch.dict(sys.modules, stubs):
        for name in ("const", "logic", "coordinator", "config_flow"):
            full_name = PACKAGE + "." + name
            spec = importlib.util.spec_from_file_location(full_name, BACKEND / (name + ".py"))
            value = importlib.util.module_from_spec(spec)
            sys.modules[full_name] = value
            spec.loader.exec_module(value)
            loaded[name] = value
    return SimpleNamespace(**loaded)


backend = load_backend()
logic = backend.logic


def state(value):
    return SimpleNamespace(state=value)


def row(stamp, condition="rainy", **kwargs):
    return {"datetime": stamp, "condition": condition, **kwargs}


class LogicTests(unittest.TestCase):
    def test_all_condition_mappings_and_unknown(self):
        expected = {
            "sunny": "sun", "clear-night": "off", "partlycloudy": "partlycloudy",
            "cloudy": "clouds", "fog": "clouds", "rainy": "rain_clouds",
            "pouring": "rain_clouds", "lightning-rainy": "rain_clouds",
            "snowy": "snow_clouds", "snowy-rainy": "snow_clouds", "hail": "rain_clouds",
            "windy": "off", "windy-variant": "clouds", "lightning": "clouds", "exceptional": "off",
            None: "off", "unknown": "off", "unavailable": "off", "invalid": "off",
        }
        for condition, effect in expected.items():
            with self.subTest(condition=condition):
                self.assertEqual(logic.effect_for_condition(condition), effect)

    def test_night_does_not_show_sun(self):
        for condition, effect in (("sunny", "off"), ("partlycloudy", "clouds"), ("rainy", "rain_clouds")):
            self.assertEqual(logic.effect_for_condition(condition, False), effect)
        self.assertEqual(logic.effect_for_condition("sunny", True), "sun")

    def test_parse_z_and_explicit_offsets(self):
        for stamp in ("2026-01-15T12:00:00Z", "2026-01-15T13:00:00+01:00", "2026-01-15T07:00:00-05:00"):
            with self.subTest(stamp=stamp):
                self.assertEqual(logic.parse_time(stamp), NOW)

    def test_parse_rejects_naive_and_malformed_times(self):
        for value in (None, 123, {}, "", "not-a-date", "2026-02-30T12:00:00Z", "2026-01-15", "2026-01-15T12:00:00"):
            with self.subTest(value=value):
                self.assertIsNone(logic.parse_time(value))

    def test_zero_offset_uses_current_without_reading_forecasts(self):
        self.assertEqual(logic.select_weather("sunny", [None], 0, NOW, False), ("off", "current", "sunny", None))

    def test_offsets_cross_midnight(self):
        now = datetime(2026, 1, 15, 23, 30, tzinfo=timezone.utc)
        result = logic.select_weather("sunny", [row("2026-01-16T01:30:00+01:00", "snowy")], 1, now)
        self.assertEqual(result, ("snow_clouds", "forecast", "snowy", "2026-01-16T00:30:00+00:00"))

    def test_dst_spring_and_fall_explicit_offsets(self):
        cases = [
            # Spring: 01:30 CET -> 03:30 CEST is one real hour.
            ("2026-03-29T01:30:00+01:00", "2026-03-29T03:30:00+02:00", "2026-03-29T01:30:00+00:00"),
            # Fall: repeated 02:30, different offsets, one real hour apart.
            ("2026-10-25T02:30:00+02:00", "2026-10-25T02:30:00+01:00", "2026-10-25T01:30:00+00:00"),
        ]
        for start, forecast, expected in cases:
            with self.subTest(start=start):
                result = logic.select_weather("sunny", [row(forecast)], 1, logic.parse_time(start))
                self.assertEqual(result[1:], ("forecast", "rainy", expected))

    def test_unsorted_forecast_selects_nearest(self):
        points = [row("2026-01-15T15:00:00Z", "snowy"), row("2026-01-15T13:00:00Z"), row("bad")]
        self.assertEqual(logic.select_weather("sunny", points, 1, NOW)[2], "rainy")

    def test_missing_unknown_condition_and_naive_rows_fallback(self):
        for rows in ([], None, [None, "junk", 1], [row("bad")], [row("2026-01-15T13:00:00")],
                     [{"datetime": "2026-01-15T13:00:00Z"}], [row("2026-01-15T13:00:00Z", "unknown")]):
            with self.subTest(rows=rows):
                self.assertEqual(logic.select_weather("sunny", rows, 1, NOW, False), ("off", "fallback_current", "sunny", None))

    def test_no_extrapolation_before_or_after_forecast_coverage(self):
        points = [row("2026-01-15T13:00:00Z"), row("2026-01-15T14:00:00Z")]
        for offset in (0.5, 2.5, 72):
            self.assertEqual(logic.select_weather("cloudy", points, offset, NOW), ("clouds", "fallback_current", "cloudy", None))
        self.assertEqual(logic.select_weather("cloudy", points, 1, NOW)[1], "forecast")
        self.assertEqual(logic.select_weather("cloudy", points, 2, NOW)[1], "forecast")

    def test_gap_tolerance_is_inclusive_at_90_minutes(self):
        points = [row("2026-01-15T13:00:00Z"), row("2026-01-15T17:00:00Z")]
        self.assertEqual(logic.select_weather("sunny", points, 2.5, NOW)[1], "forecast")
        self.assertEqual(logic.select_weather("sunny", points, 3, NOW)[1], "fallback_current")

    def test_forecast_night_flag(self):
        for condition, expected in (("sunny", "off"), ("partlycloudy", "clouds")):
            result = logic.select_weather("rainy", [row("2026-01-15T13:00:00Z", condition, is_daytime=False)], 1, NOW)
            self.assertEqual(result[:2], (expected, "forecast"))

    def test_dashboard_normalization_and_blocked_routes(self):
        for value, expected in ((" /lovelace/ ", "lovelace"), ("/weather-wall", "weather-wall"), ("my_dashboard", "my_dashboard")):
            self.assertEqual(logic.normalize_dashboard(value), expected)
        for value in (*logic.RESERVED_ROUTES, "settings", "editor", "lovelace-editor", "", "/", "https://example.org", "dashboard/view", "a?x=1", "a#view", "..", "a b", "a\\b"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "invalid_dashboard"):
                    logic.normalize_dashboard(value)


class CoordinatorTests(unittest.IsolatedAsyncioTestCase):
    """Coordinator behavior using explicitly MOCKED HA services/states/events."""

    def setUp(self):
        self.clock = NOW
        self.entities = {"weather.home": state("sunny"), "sun.sun": state("above_horizon")}
        self.hass = SimpleNamespace(states=SimpleNamespace(get=self.entities.get), services=SimpleNamespace(async_call=AsyncMock()), async_create_task=Mock())
        self.entry = SimpleNamespace(entry_id="unit-profile", title="Unit profile", data={"mode": "automatic", "weather_entity": "weather.home", "forecast_offset": 1}, options={})
        self.coordinator = backend.coordinator.WeatherEffectsCoordinator(self.hass, self.entry)
        self.hass.services.async_call.return_value = {"weather.home": {"forecast": [row("2026-01-15T13:00:00Z", "snowy")]}}
        self.time_patch = patch.object(backend.coordinator.dt_util, "utcnow", lambda: self.clock)
        self.time_patch.start()
        self.addCleanup(self.time_patch.stop)

    async def update(self):
        return await self.coordinator._async_update_data()

    async def test_forecast_service_contract_and_cache_expiry(self):
        first = await self.update()
        self.assertEqual((first["source"], first["effect"], first["status"]), ("forecast", "snow_clouds", "ok"))
        self.hass.services.async_call.assert_awaited_once_with("weather", "get_forecasts", {"entity_id": "weather.home", "type": "hourly"}, blocking=True, return_response=True)
        self.clock += timedelta(minutes=14, seconds=59)
        await self.update()
        self.assertEqual(self.hass.services.async_call.await_count, 1)
        self.clock += timedelta(seconds=1)
        await self.update()
        self.assertEqual(self.hass.services.async_call.await_count, 2)

    async def test_manual_and_zero_offset_do_not_call_service(self):
        self.coordinator.settings.update(mode="manual", effect="rain")
        result = await self.update()
        self.assertEqual((result["source"], result["effect"]), ("manual", "rain"))
        self.coordinator.settings.update(mode="automatic", forecast_offset=0)
        self.entities["sun.sun"] = state("below_horizon")
        result = await self.update()
        self.assertEqual((result["source"], result["effect"]), ("current", "off"))
        self.hass.services.async_call.assert_not_awaited()

    async def test_errors_clear_stale_cache_and_back_off(self):
        for error in (MockedHomeAssistantError("provider"), TimeoutError(), ValueError("provider"), TypeError("provider")):
            with self.subTest(error=type(error).__name__):
                self.coordinator._forecast = [row("2026-01-15T13:00:00Z", "snowy")]
                self.coordinator._fetched_at = None
                self.hass.services.async_call.reset_mock()
                self.hass.services.async_call.side_effect = error
                result = await self.update()
                self.assertEqual((result["source"], result["status"], result["effect"]), ("fallback_current", "forecast_fallback", "sun"))
                self.assertEqual(self.coordinator._forecast, [])
                self.assertEqual(self.coordinator._forecast_error, type(error).__name__)
                await self.update()
                self.assertEqual(self.hass.services.async_call.await_count, 1)

    async def test_error_backoff_expires_and_success_recovers(self):
        self.hass.services.async_call.side_effect = MockedHomeAssistantError("offline")
        self.assertEqual((await self.update())["status"], "forecast_fallback")
        self.hass.services.async_call.side_effect = None
        self.clock += timedelta(minutes=14)
        self.assertEqual((await self.update())["status"], "forecast_fallback")
        self.assertEqual(self.hass.services.async_call.await_count, 1)
        self.clock += timedelta(minutes=1)
        # Target remains covered by refreshed forecasts at the new time.
        self.hass.services.async_call.return_value = {"weather.home": {"forecast": [row("2026-01-15T13:15:00Z", "rainy")]}}
        result = await self.update()
        self.assertEqual((result["source"], result["status"]), ("forecast", "ok"))
        self.assertIsNone(self.coordinator._forecast_error)
        self.assertEqual(self.hass.services.async_call.await_count, 2)

    async def test_empty_or_non_list_rows_fall_back(self):
        for response in (None, {}, {"weather.home": {}}, {"weather.home": {"forecast": None}}, {"weather.home": {"forecast": "bad"}}):
            with self.subTest(response=response):
                self.coordinator._fetched_at = None
                self.hass.services.async_call.return_value = response
                result = await self.update()
                self.assertEqual((result["source"], result["status"]), ("fallback_current", "forecast_fallback"))

    async def test_malformed_response_shapes_fall_back(self):
        # Regression: provider response objects must not crash update processing.
        for response in ([{"unexpected": True}], "bad", {"weather.home": None}, {"weather.home": []}):
            with self.subTest(response=response):
                self.coordinator._fetched_at = None
                self.hass.services.async_call.return_value = response
                result = await self.update()
                self.assertEqual((result["source"], result["status"]), ("fallback_current", "forecast_fallback"))

    async def test_gate_global_enable_and_missing_gate(self):
        self.coordinator.settings.update(mode="manual", enable_entity="input_boolean.effects")
        for gate_value, enabled, status in (("on", True, "ok"), ("off", False, "ok"), ("unknown", False, "enable_entity_unavailable"), ("unavailable", False, "enable_entity_unavailable"), (None, False, "enable_entity_unavailable")):
            with self.subTest(gate_value=gate_value):
                if gate_value is None:
                    self.entities.pop("input_boolean.effects", None)
                else:
                    self.entities["input_boolean.effects"] = state(gate_value)
                result = await self.update()
                self.assertEqual((result["enabled"], result["status"]), (enabled, status))
                self.assertEqual(result["effect"], "snow" if enabled else "off")
        self.entities["input_boolean.effects"] = state("on")
        self.coordinator.settings["enabled"] = False
        self.assertEqual((await self.update())["effect"], "off")

    async def test_unavailable_current_without_forecast_is_off(self):
        self.coordinator.settings["forecast_offset"] = 0
        for value in (None, "unknown", "unavailable"):
            if value is None:
                self.entities.pop("weather.home", None)
            else:
                self.entities["weather.home"] = state(value)
            result = await self.update()
            self.assertEqual((result["effect"], result["status"]), ("off", "weather_unavailable"))

    async def test_valid_forecast_can_replace_unavailable_current(self):
        self.entities["weather.home"] = state("unavailable")
        result = await self.update()
        self.assertEqual((result["effect"], result["status"]), ("snow_clouds", "ok"))

    async def test_entity_change_invalidates_cache(self):
        await self.update()
        self.coordinator.settings["weather_entity"] = "weather.other"
        self.entities["weather.other"] = state("rainy")
        self.hass.services.async_call.return_value = {"weather.other": {"forecast": [row("2026-01-15T13:00:00Z", "cloudy")]}}
        result = await self.update()
        self.assertEqual(self.hass.services.async_call.await_count, 2)
        self.assertEqual((result["effect"], result["weather_entity"]), ("clouds", "weather.other"))

    async def test_reconfigure_applies_options_and_resets_forecast_cache(self):
        await self.update()
        self.entry.options = {"mode": "manual", "effect": "rain", "name": "Changed", "dashboards": ["wall"]}
        unsubscribe = Mock()
        with patch.object(backend.coordinator, "async_track_state_change_event", return_value=unsubscribe) as track:
            await self.coordinator.reconfigure()
            self.assertEqual((self.coordinator.data["effect"], self.coordinator.data["name"]), ("rain", "Changed"))
            self.assertEqual(self.coordinator.data["dashboards"], ["wall"])
            self.assertIsNone(self.coordinator._fetched_at)
            self.assertEqual(track.call_args.args[1], ["sun.sun"])
            self.entry.options = {"mode": "automatic", "weather_entity": "weather.home", "forecast_offset": 1}
            await self.coordinator.reconfigure()
            self.assertEqual(self.coordinator.data["source"], "forecast")
            self.assertEqual(self.hass.services.async_call.await_count, 2)
            unsubscribe.assert_called_once()

    async def test_options_forecast_offset_change_refetches_immediately(self):
        await self.update()
        self.entry.options = {"mode": "automatic", "weather_entity": "weather.home", "forecast_offset": 2}
        self.hass.services.async_call.return_value = {"weather.home": {"forecast": [row("2026-01-15T14:00:00Z", "rainy")]}}
        with patch.object(backend.coordinator, "async_track_state_change_event", return_value=Mock()):
            await self.coordinator.reconfigure()
        self.assertEqual(self.hass.services.async_call.await_count, 2)
        self.assertEqual((self.coordinator.data["forecast_offset"], self.coordinator.data["condition"]), (2, "rainy"))

    async def test_state_binding_refresh_and_stop(self):
        unsubscribe = Mock()
        self.coordinator.settings["enable_entity"] = "switch.effects"
        with patch.object(backend.coordinator, "async_track_state_change_event", return_value=unsubscribe) as track:
            self.coordinator.bind_states()
            self.assertEqual(track.call_args.args[1], ["weather.home", "switch.effects", "sun.sun"])
            self.coordinator.bind_states()
            unsubscribe.assert_called_once()
            self.coordinator._state_changed(SimpleNamespace())
            coroutine = self.hass.async_create_task.call_args.args[0]
            await coroutine  # Explicitly run MOCKED scheduled task; do not leak coroutine.
            self.assertEqual(self.hass.services.async_call.await_count, 1)
            self.coordinator.stop()
            self.coordinator.stop()
            self.assertEqual(unsubscribe.call_count, 2)


class ConfigFlowTests(unittest.IsolatedAsyncioTestCase):
    """Real flow logic with MOCKED selectors, schema and flow-manager machinery."""

    def setUp(self):
        self.entities = {"weather.home": state("unavailable"), "switch.effects": state("unknown"), "sensor.wrong": state("on")}
        self.hass = SimpleNamespace(states=SimpleNamespace(get=self.entities.get), data={})

    def data(self, **kwargs):
        return {"name": "Wall", "dashboards": [" /wall/ ", "wall"], "mode": "automatic", "weather_entity": "weather.home", **kwargs}

    def test_validation_normalizes_deduplicates_and_allows_unavailable_entity(self):
        data = self.data(enable_entity="switch.effects")
        self.assertEqual(backend.config_flow.validate(self.hass, data), {})
        self.assertEqual(data["dashboards"], ["wall"])

    def test_validation_required_fields_and_wrong_entities(self):
        cases = [({"name": " "}, "name", "name_required"), ({"dashboards": []}, "dashboards", "dashboard_required"),
                 ({"dashboards": ["config"]}, "dashboards", "invalid_dashboard"),
                 ({"weather_entity": ""}, "weather_entity", "weather_required"),
                 ({"weather_entity": "weather.missing"}, "weather_entity", "entity_missing"),
                 ({"weather_entity": "sensor.wrong"}, "weather_entity", "entity_missing"),
                 ({"enable_entity": "sensor.wrong"}, "enable_entity", "entity_missing"),
                 ({"enable_entity": "switch.missing"}, "enable_entity", "entity_missing")]
        for change, field, message in cases:
            with self.subTest(change=change):
                self.assertEqual(backend.config_flow.validate(self.hass, self.data(**change))[field], message)
        self.assertEqual(backend.config_flow.validate(self.hass, self.data(mode="manual", weather_entity="")), {})

    def test_schema_lists_only_registered_lovelace_panels_or_default(self):
        def choices():
            fields = backend.config_flow.schema(self.hass, {})
            return next(value.config["options"] for key, value in fields.items() if key.key == "dashboards")
        self.assertEqual(choices(), [{"value": "lovelace", "label": "Overview (/lovelace)"}])
        self.hass.data["panels"] = {"wall": SimpleNamespace(component_name="lovelace", sidebar_title="Wall"), "config": SimpleNamespace(component_name="config", sidebar_title="Settings")}
        self.assertEqual(choices(), [{"value": "wall", "label": "Wall (/wall)"}])

    async def test_user_flow_form_error_and_create(self):
        flow = backend.config_flow.WeatherEffectsConfigFlow()
        flow.hass = self.hass
        self.assertEqual((await flow.async_step_user())["type"], "form")
        bad = await flow.async_step_user(self.data(weather_entity=""))
        self.assertEqual(bad["errors"], {"weather_entity": "weather_required"})
        result = await flow.async_step_user(self.data())
        self.assertEqual((result["type"], result["title"], result["data"]["dashboards"]), ("create_entry", "Wall", ["wall"]))

    async def test_options_flow_uses_runtime_config_entry_property(self):
        flow = backend.config_flow.WeatherEffectsConfigFlow.async_get_options_flow(SimpleNamespace())
        flow.hass = self.hass
        flow.config_entry = SimpleNamespace(options={}, data=self.data())
        self.assertEqual((await flow.async_step_init())["type"], "form")
        self.assertEqual((await flow.async_step_init(self.data(name="")))["errors"], {"name": "name_required"})
        result = await flow.async_step_init(self.data(name="New"))
        self.assertEqual((result["type"], result["title"], result["data"]["name"]), ("create_entry", "", "New"))


if __name__ == "__main__":
    unittest.main()
