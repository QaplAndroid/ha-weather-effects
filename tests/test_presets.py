"""Pure preset/adaptive tests plus explicitly MOCKED HA persistence/runtime tests."""
import asyncio
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
import unittest

from test_backend import backend, NOW, row, state, MockedHomeAssistantError

p = backend.presets
i = backend.intensity


class PresetResolutionTests(unittest.TestCase):
    def test_legacy_resolution_is_non_destructive_and_effect_independent(self):
        settings = {"effect": "rain", "speed": 2, "density": 90}
        before = deepcopy(settings)
        self.assertEqual(p.editing_effect(settings), "rain")
        for effect in backend.const.EFFECTS:
            self.assertEqual(p.effect_preset(settings, effect), {**{key: backend.const.DEFAULTS[key] for key in p.APPEARANCE_KEYS}, "speed": 2, "density": 90})
        self.assertEqual(settings, before)
        self.assertEqual(p.editing_effect({}), "snow")

    def test_partial_overrides_edit_selection_and_unknown_future_values_preserved(self):
        settings = {"effect": "rain", "settings_effect": "sun", "speed": 2,
                    "effect_settings": {"sun": {"size": 1.8}, "rain": {"speed": .6}}}
        self.assertEqual(p.configured_control_value(settings, "size"), 1.8)
        self.assertEqual(p.configured_control_value(settings, "speed"), 2)
        self.assertEqual(p.configured_control_value(settings, "effect"), "rain")
        self.assertEqual(p.effect_preset(settings, "rain")["speed"], .6)

    def test_options_authoritative_and_no_mutation(self):
        entry = SimpleNamespace(options={"effect": "hail"}, data={"speed": 2.5, "effect_settings": {"rain": {"speed": 2}}})
        settings = p.configured_settings(entry)
        self.assertNotIn("effect_settings", settings)
        self.assertEqual(settings["speed"], 1)
        self.assertEqual(p.editing_effect(settings), "hail")


class MeasurementsTests(unittest.TestCase):
    def test_temperature_units(self):
        for value, units in ((30, "°C"), (86, "°F"), (303.15, "K")):
            self.assertAlmostEqual(i.temperature(value, units), 30)
        for value, units in ((True, "°C"), (float("nan"), "°C"), (10, "unknown"), (None, "K"), (10 ** 500, "C")):
            self.assertIsNone(i.temperature(value, units))

    def test_extreme_measurements_are_json_safe_and_temperature_is_plausible(self):
        import json
        for units in ("°C", "°F", "K", "unknown"):
            for value in (1e308, -1e308, float("inf"), float("nan")):
                attrs = {"temperature": value, "temperature_unit": units,
                         "wind_speed": value, "wind_speed_unit": "m/s",
                         "precipitation_rate": value, "precipitation_rate_unit": "in/h"}
                metrics = i.weather_metrics(attrs, attrs)
                self.assertIsNone(metrics["temperature_c"])
                json.dumps(metrics, allow_nan=False)
        self.assertEqual(i.temperature(-100, "°C"), -100)
        self.assertEqual(i.temperature(70, "°C"), 70)
        self.assertIsNone(i.temperature(-100.1, "°C"))
        self.assertIsNone(i.temperature(70.1, "°C"))

    def test_wind_units(self):
        for value, units, expected in ((10, "km/h", 10), (10, "m/s", 36), (10, "mph", 16.09344), (10, "kn", 18.52), (10, "knots", 18.52)):
            self.assertAlmostEqual(i.wind_speed(value, units), expected)
        for value, units in ((-1, "mph"), (True, "mph"), (10, "invalid"), (float("inf"), "m/s")):
            self.assertIsNone(i.wind_speed(value, units))

    def test_current_precipitation_requires_explicit_rate_and_unit(self):
        for attrs in ({"precipitation": 200, "precipitation_unit": "mm"}, {"precipitation_rate": 12}, {"precipitation_rate": 12, "precipitation_rate_unit": "mm"}):
            metrics = i.weather_metrics(attrs, attrs)
            self.assertIsNone(metrics["precipitation_mm_h"])
            self.assertIsNone(metrics["precipitation_source"])
        attrs = {"precipitation_rate": .5, "precipitation_rate_unit": "in/h"}
        metrics = i.weather_metrics(attrs, attrs)
        self.assertAlmostEqual(metrics["precipitation_mm_h"], 12.7)
        self.assertEqual(metrics["precipitation_source"], "current_rate")

    def test_hourly_amount_units_and_no_current_measurement_fallback(self):
        metadata = {"temperature": 40, "temperature_unit": "°F", "cloud_coverage": 99,
                    "wind_speed": 100, "wind_speed_unit": "mph", "precipitation": 50,
                    "precipitation_unit": "in", "precipitation_rate": 10, "precipitation_rate_unit": "mm/h"}
        metrics = i.weather_metrics({"precipitation": .5}, metadata, hourly=True)
        self.assertAlmostEqual(metrics["precipitation_mm_h"], 12.7)
        self.assertEqual(metrics["precipitation_source"], "hourly_forecast")
        for key in ("temperature_c", "cloud_coverage", "wind_kmh"):
            self.assertIsNone(metrics[key])
        self.assertIsNone(i.weather_metrics({}, metadata, hourly=True)["precipitation_mm_h"])

    def test_cloud_clamping_missing_and_invalid_metrics(self):
        for value, expected in ((150, 100), (-1, 0), (25, 25), (True, None), ("50", None)):
            self.assertEqual(i.weather_metrics({"cloud_coverage": value}, {})["cloud_coverage"], expected)

    def test_nearest_hourly_90_minute_boundary_and_malformed_rows(self):
        rows = [None, {}, row("bad"), row((NOW + timedelta(minutes=90)).isoformat(), precipitation=2)]
        self.assertEqual(i.nearest_hourly(rows, NOW)["precipitation"], 2)
        self.assertIsNone(i.nearest_hourly(rows, NOW - timedelta(seconds=1)))

    def test_current_rain_estimate_does_not_replace_other_current_readings(self):
        attrs = {"temperature": 30, "temperature_unit": "°C", "cloud_coverage": 20, "wind_speed": 10, "wind_speed_unit": "km/h", "precipitation_unit": "mm"}
        metrics = i.weather_metrics(attrs, attrs, rain_row={"temperature": 0, "cloud_coverage": 90, "wind_speed": 100, "precipitation": 6})
        self.assertEqual(metrics, {"temperature_c": 30, "cloud_coverage": 20, "wind_kmh": 10, "precipitation_mm_h": 6, "precipitation_source": "hourly_forecast"})
        attrs.update(precipitation_rate=0, precipitation_rate_unit="mm/h")
        self.assertEqual(i.weather_metrics(attrs, attrs, rain_row={"precipitation": 6})["precipitation_source"], "current_rate")

    def test_adaptation_formulas_bounds_and_saved_preset_unchanged(self):
        preset = p.effect_preset({}, "rain")
        preset["wind"] = -.2
        before = dict(preset)
        for rain in (0, 6, 12, 100):
            metrics = {"temperature_c": 42, "cloud_coverage": 80, "precipitation_mm_h": rain, "wind_kmh": 70}
            effective, intensity = i.adapt(preset, "rain", metrics, True, 30)
            ratio = min(rain / 12, 1)
            self.assertEqual(intensity, {"heat": 0, "cloud": .8, "rain": ratio, "wind": 1})
            self.assertAlmostEqual(effective["density"], min(200, 60 * (.45 + 2.1 * ratio)))
            self.assertAlmostEqual(effective["speed"], .75 + .8 * ratio)
            self.assertAlmostEqual(effective["opacity"], .65 * (.8 + .2 * ratio))
            self.assertEqual(effective["wind"], -2)
        self.assertEqual(preset, before)
        extreme = {"speed": 3, "size": 3, "density": 200, "opacity": 1, "wind": -2}
        effective, _ = i.adapt(extreme, "rain", metrics, True, 30)
        self.assertEqual(effective, extreme)

    def test_manual_opt_out_missing_and_cloud_layers_preserve_preset(self):
        preset = p.effect_preset({}, "clouds")
        metrics = {"temperature_c": 50, "cloud_coverage": 100, "precipitation_mm_h": 12, "wind_kmh": None}
        for effect in ("clouds", "night_clouds", "storm_clouds", "partlycloudy", "fog"):
            effective, _ = i.adapt(preset, effect, metrics, True, 30)
            self.assertEqual(effective, preset)
        effective, intensity = i.adapt(preset, "rain", metrics, False, 30)
        self.assertEqual(effective, preset)
        self.assertEqual(intensity, {"heat": 0, "cloud": None, "rain": None, "wind": None})
        missing = dict.fromkeys(metrics)
        self.assertEqual(i.adapt(preset, "rain", missing, True, 30)[0], preset)

    def test_heat_threshold_and_wind_speed(self):
        preset = p.effect_preset({}, "sun")
        for temp, expected in ((29, 0), (30, 0), (36, .5), (42, 1), (50, 1)):
            metrics = {"temperature_c": temp, "cloud_coverage": None, "precipitation_mm_h": None, "wind_kmh": 70}
            for effect in ("sun", "partlycloudy"):
                self.assertEqual(i.adapt(preset, effect, metrics, True, 30)[1]["heat"], expected)
        effective, intensity = i.adapt(preset, "wind", metrics, True, 30)
        self.assertEqual(effective["wind"], 2)
        self.assertAlmostEqual(effective["speed"], 1.35)
        self.assertEqual(intensity["heat"], 0)


class PersistenceRuntimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.attrs = {"temperature": 86, "temperature_unit": "°F", "cloud_coverage": 20, "wind_speed": 10, "wind_speed_unit": "mph", "precipitation_unit": "mm"}
        self.states = {"weather.home": SimpleNamespace(state="rainy", attributes=self.attrs)}
        self.entry = SimpleNamespace(entry_id="test", title="Test", options={}, data={"weather_entity": "weather.home", "effect": "snow", "speed": 1.2, "effect_settings": {"rain_clouds": {"speed": 2}, "snow": {"size": 1.5}}, "custom": 42})
        self.hass = SimpleNamespace(states=SimpleNamespace(get=self.states.get), services=SimpleNamespace(async_call=AsyncMock(return_value={"weather.home": {"forecast": [row(NOW.isoformat(), precipitation=6)]}})), config_entries=SimpleNamespace(async_update_entry=Mock(side_effect=self.persist)))
        self.coordinator = backend.coordinator.WeatherEffectsCoordinator(self.hass, self.entry)

    def persist(self, entry, *, options):
        entry.options = options

    async def test_edit_target_independent_actual_runtime_and_restart(self):
        await self.coordinator.async_set_control("settings_effect", "rain")
        await self.coordinator.async_set_control("speed", 2.5)
        self.assertEqual(self.entry.options["effect"], "snow")
        self.assertEqual(self.entry.options["speed"], 1.2)
        self.assertEqual(self.entry.options["effect_settings"]["rain"], {"speed": 2.5})
        self.assertEqual(self.entry.data["effect_settings"]["snow"], {"size": 1.5})
        restarted = backend.coordinator.WeatherEffectsCoordinator(self.hass, self.entry)
        runtime = await restarted._async_update_data()
        self.assertEqual((runtime["effect"], runtime["settings_effect"]), ("snow", "rain"))
        self.assertEqual(runtime["speed"], 1.2)
        self.assertEqual(runtime["preset"]["size"], 1.5)
        self.assertEqual(runtime["intensity"], {"heat": 0, "cloud": None, "rain": None, "wind": None})
        self.hass.services.async_call.assert_not_awaited()
        await restarted.async_set_control("effect", "snow")
        self.assertEqual(self.entry.options["settings_effect"], "snow")
        await restarted.async_set_control("effect", "rain")
        self.assertEqual(self.entry.options["settings_effect"], "rain")

    async def test_malformed_preset_maps_do_not_break_valid_control_updates(self):
        for stored in (None, "invalid", [1], {"snow": None}, {"snow": "invalid", "rain": {"speed": 2}}):
            self.entry.options = {**self.entry.data, "effect_settings": stored}
            await self.coordinator.async_set_control("speed", 1.8)
            self.assertEqual(self.entry.options["effect_settings"]["snow"], {"speed": 1.8})
            if isinstance(stored, dict) and "rain" in stored:
                self.assertEqual(self.entry.options["effect_settings"]["rain"], {"speed": 2})
            self.assertEqual(self.entry.options["speed"], 1.2)

    async def test_concurrent_updates_across_effects_and_noop(self):
        async def edit(effect, key, value):
            await self.coordinator.async_set_control("settings_effect", effect)
            await self.coordinator.async_set_control(key, value)
        await asyncio.gather(edit("rain", "speed", 2), edit("sun", "opacity", .8), self.coordinator.async_set_control("max_fps", 45))
        self.assertEqual(self.entry.options["effect_settings"]["rain"]["speed"], 2)
        self.assertEqual(self.entry.options["effect_settings"]["sun"]["opacity"], .8)
        self.assertEqual(self.entry.options["max_fps"], 45)
        before = deepcopy(self.entry.options)
        self.hass.config_entries.async_update_entry.reset_mock()
        await self.coordinator.async_set_control("opacity", .8)
        self.assertEqual(self.entry.options, before)
        self.hass.config_entries.async_update_entry.assert_not_called()

    async def test_automatic_uses_actual_preset_and_current_estimated_rain_cache(self):
        self.coordinator.settings.update(mode="automatic", settings_effect="snow")
        result = await self.coordinator._async_update_data()
        self.assertEqual(result["effect"], "rain_clouds")
        self.assertEqual(result["settings_effect"], "snow")
        self.assertEqual(result["preset"]["speed"], 2)
        self.assertEqual(result["weather_metrics"]["precipitation_mm_h"], 6)
        self.assertEqual(result["weather_metrics"]["temperature_c"], 30)
        self.assertAlmostEqual(result["speed"], 2.3)
        self.assertEqual(result["intensity"]["rain"], .5)
        await self.coordinator._async_update_data()
        self.hass.services.async_call.assert_awaited_once()
        self.assertFalse(result["lightning_enabled"])
        self.assertEqual((result["lightning_interval"], result["lightning_brightness"]), (12, .1))

    async def test_current_explicit_rate_avoids_fetch_and_zero_is_a_reading(self):
        self.attrs.update(precipitation_rate=0, precipitation_rate_unit="mm/h")
        self.coordinator.settings.update(mode="automatic")
        result = await self.coordinator._async_update_data()
        self.assertEqual(result["weather_metrics"]["precipitation_source"], "current_rate")
        self.assertEqual(result["intensity"]["rain"], 0)
        self.hass.services.async_call.assert_not_awaited()

    async def test_future_uses_only_forecast_measurements_and_entity_unit_metadata(self):
        self.coordinator.settings.update(mode="automatic", forecast_offset=1)
        self.hass.services.async_call.return_value = {"weather.home": {"forecast": [row((NOW + timedelta(hours=1)).isoformat(), "sunny", temperature=104)]}}
        result = await self.coordinator._async_update_data()
        self.assertEqual(result["source"], "forecast")
        self.assertAlmostEqual(result["weather_metrics"]["temperature_c"], 40)
        self.assertAlmostEqual(result["intensity"]["heat"], 10 / 12)
        for key in ("cloud_coverage", "precipitation_mm_h", "wind_kmh", "precipitation_source"):
            self.assertIsNone(result["weather_metrics"][key])
        self.assertEqual(result["speed"], result["preset"]["speed"])

    async def test_automatic_ignores_stored_manual_off_for_forecast_fetching(self):
        self.coordinator.settings.update(mode="automatic", effect="off", forecast_offset=1)
        self.hass.services.async_call.return_value = {"weather.home": {"forecast": [row((NOW + timedelta(hours=1)).isoformat(), "snowy")]}}
        result = await self.coordinator._async_update_data()
        self.hass.services.async_call.assert_awaited_once()
        self.assertEqual((result["source"], result["effect"]), ("forecast", "snow_clouds"))

    async def test_current_estimate_cache_expiry_backoff_and_disabled_cache_retention(self):
        self.coordinator.settings.update(mode="automatic")
        clock = NOW
        with patch.object(backend.coordinator.dt_util, "utcnow", lambda: clock):
            await self.coordinator._async_update_data()
            cached = self.coordinator._forecast
            clock += timedelta(minutes=14, seconds=59)
            await self.coordinator._async_update_data()
            self.assertEqual(self.hass.services.async_call.await_count, 1)
            self.coordinator.settings["enabled"] = False
            clock += timedelta(seconds=1)
            await self.coordinator._async_update_data()
            self.assertIs(self.coordinator._forecast, cached)
            self.assertEqual(self.hass.services.async_call.await_count, 1)
            self.coordinator.settings["enabled"] = True
            self.hass.services.async_call.side_effect = MockedHomeAssistantError("offline")
            result = await self.coordinator._async_update_data()
            self.assertIsNone(result["weather_metrics"]["precipitation_mm_h"])
            self.assertEqual(result["source"], "current")
            self.assertEqual(self.coordinator._forecast, [])
            await self.coordinator._async_update_data()
            self.assertEqual(self.hass.services.async_call.await_count, 2)
            clock += timedelta(minutes=15)
            await self.coordinator._async_update_data()
            self.assertEqual(self.hass.services.async_call.await_count, 3)

    async def test_future_missing_falls_back_to_current_metrics(self):
        self.coordinator.settings.update(mode="automatic", forecast_offset=4)
        result = await self.coordinator._async_update_data()
        self.assertEqual(result["source"], "fallback_current")
        self.assertEqual(result["weather_metrics"]["temperature_c"], 30)
        self.assertEqual(result["weather_metrics"]["precipitation_mm_h"], 6)

    async def test_disabled_manual_and_opt_out_do_not_fetch_current_estimates(self):
        for change in ({"mode": "manual"}, {"mode": "automatic", "enabled": False}, {"mode": "automatic", "adaptive_weather": False}):
            self.coordinator.settings = {**p.configured_settings(self.entry), **change}
            await self.coordinator._async_update_data()
        self.hass.services.async_call.assert_not_awaited()

    async def test_options_form_preserves_presets_and_target_not_legacy_defaults(self):
        flow = backend.config_flow.WeatherEffectsOptionsFlow()
        flow.hass = self.hass
        self.entry.options = {**self.entry.data, "settings_effect": "rain", "enable_entity": "switch.old"}
        flow.config_entry = self.entry
        before = deepcopy(self.entry.options["effect_settings"])
        result = await flow.async_step_init({"name": "Changed", "dashboards": ["wall"], "mode": "manual", "effect": "sun", "speed": 2.8})
        self.assertEqual(result["data"]["effect_settings"], before)
        self.assertEqual(result["data"]["settings_effect"], "rain")
        self.assertEqual(result["data"]["speed"], 2.8)
        self.assertNotIn("enable_entity", result["data"])


if __name__ == "__main__":
    unittest.main()
