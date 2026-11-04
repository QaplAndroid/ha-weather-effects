"""Named visual library tests with explicitly mocked Home Assistant persistence."""
import asyncio
from copy import deepcopy
import json
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from test_backend import backend, MockedHomeAssistantError, row, NOW

n = backend.named_presets
p = backend.presets


class NamedPresetsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.entry = SimpleNamespace(entry_id="library", title="Infrastructure title", options={}, data={
            **deepcopy(backend.const.DEFAULTS), "name": "Wall", "weather_entity": "weather.home",
            "enable_entity": "switch.wall", "dashboards": ["wall"], "mode": "automatic",
            "forecast_offset": 2, "enabled": False, "transport_future": {"private": [1]},
            "effect": "rain", "settings_effect": "clouds", "lightning_enabled": True,
            "effect_settings": {"clouds": {"cloud_top": 20, "cloud_bottom": 40, "cloud_spread": 60}},
        })
        self.hass = SimpleNamespace(
            states=SimpleNamespace(get=lambda key: SimpleNamespace(state="on" if key == "switch.wall" else "rainy", attributes={}) if key != "sun.sun" else None),
            services=SimpleNamespace(async_call=AsyncMock(return_value={"weather.home": {"forecast": [row(NOW.isoformat())]}})),
            config_entries=SimpleNamespace(async_update_entry=Mock(side_effect=self.persist)),
        )
        self.coordinator = backend.coordinator.WeatherEffectsCoordinator(self.hass, self.entry)

    def persist(self, entry, *, options):
        entry.options = options

    async def action(self, action, **kwargs):
        return await self.coordinator.async_preset_action(action, **kwargs)

    async def save(self, name="Cloud view"):
        return (await self.action("save", name=name))["preset_id"]

    async def test_crud_restart_explicit_overwrite_and_summaries_only(self):
        result = await self.action("save", name="  Oblaci ☁  ")
        preset_id = result["preset_id"]
        self.assertRegex(preset_id, r"^[0-9a-f]{32}$")
        self.assertEqual(result, {"action": "save", "preset_id": preset_id, "name": "Oblaci ☁", "saved_presets": [{"id": preset_id, "name": "Oblaci ☁"}]})
        snapshot = deepcopy(self.entry.options["saved_presets"][preset_id]["settings"])
        self.coordinator = backend.coordinator.WeatherEffectsCoordinator(self.hass, self.entry)
        self.assertEqual(n.preset_summaries(self.coordinator.settings), result["saved_presets"])
        runtime = await self.coordinator._async_update_data()
        self.assertEqual(runtime["saved_presets"], result["saved_presets"])
        self.assertNotIn('"settings":', json.dumps(runtime))
        await self.coordinator.async_set_control("cloud_top", 25)
        with self.assertRaisesRegex(ValueError, "explicit overwrite"):
            await self.action("save", preset_id=preset_id)
        await self.action("save", preset_id=preset_id, overwrite=True)
        self.assertEqual(self.entry.options["saved_presets"][preset_id]["settings"]["effect_settings"]["clouds"]["cloud_top"], 25)
        visuals = {key: deepcopy(value) for key, value in self.entry.options.items() if key != "saved_presets"}
        await self.action("rename", preset_id=preset_id, name="New name")
        self.assertEqual({key: value for key, value in self.entry.options.items() if key != "saved_presets"}, visuals)
        response = await self.action("delete", preset_id=preset_id)
        self.assertEqual(response["saved_presets"], [])
        self.assertEqual({key: value for key, value in self.entry.options.items() if key != "saved_presets"}, visuals)
        self.assertEqual(snapshot["effect_settings"]["clouds"]["cloud_top"], 20)
        self.hass.services.async_call.assert_not_awaited()

    async def test_snapshots_are_deep_copied_and_capture_visual_allowlist_only(self):
        preset_id = await self.save()
        snapshot = self.entry.options["saved_presets"][preset_id]["settings"]
        self.assertEqual(set(snapshot), set(n.VISUAL_KEYS) | {"effect_settings"})
        self.assertNotIn("lightning_enabled", snapshot)
        for key in ("weather_entity", "dashboards", "enable_entity", "mode", "forecast_offset", "enabled", "name", "saved_presets", "transport_future"):
            self.assertNotIn(key, snapshot)
        old = deepcopy(snapshot)
        await self.coordinator.async_set_control("cloud_spread", 90)
        self.assertEqual(self.entry.options["saved_presets"][preset_id]["settings"], old)
        self.entry.options["effect_settings"]["clouds"]["cloud_top"] = 30
        self.assertEqual(snapshot, old)
        await self.action("load", preset_id=preset_id)
        self.entry.options["effect_settings"]["clouds"]["cloud_spread"] = 100
        self.assertEqual(self.entry.options["saved_presets"][preset_id]["settings"], old)

    async def test_load_factory_preserve_infrastructure_unknown_library_and_force_safety_off(self):
        preset_id = await self.save()
        infrastructure = {key: deepcopy(self.entry.options[key]) for key in ("weather_entity", "enable_entity", "dashboards", "mode", "forecast_offset", "enabled", "name", "transport_future")}
        library = deepcopy(self.entry.options["saved_presets"])
        await self.coordinator.async_set_control("effect", "sun")
        await self.coordinator.async_set_control("cloud_top", 0)
        await self.action("load", preset_id=preset_id)
        self.assertFalse(self.entry.options["lightning_enabled"])
        self.assertEqual(self.entry.options["effect"], "rain")
        self.assertEqual(self.entry.options["settings_effect"], "clouds")
        self.assertEqual(self.entry.options["effect_settings"]["clouds"]["cloud_top"], 20)
        await self.coordinator.async_set_control("lightning_enabled", True)
        await self.action("factory_reset")
        for key in n.VISUAL_KEYS:
            self.assertEqual(self.entry.options[key], backend.const.DEFAULTS.get(key, "snow"))
        self.assertEqual(self.entry.options["effect_settings"], {})
        self.assertFalse(self.entry.options["lightning_enabled"])
        self.assertEqual(self.entry.options["saved_presets"], library)
        self.assertEqual({key: self.entry.options[key] for key in infrastructure}, infrastructure)
        self.hass.config_entries.async_update_entry.reset_mock()
        await self.action("factory_reset")
        self.hass.config_entries.async_update_entry.assert_not_called()
        self.hass.services.async_call.assert_not_awaited()

    async def test_names_limits_uniqueness_and_reserved_factory_ids(self):
        first = await self.save("Straße")
        for name in (None, "", "   ", "x" * 51, "bad\nname", "\tname", "bad\x00name", "hidden\u200bname", 42):
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    await self.action("save", name=name)
        with self.assertRaisesRegex(ValueError, "already exists"):
            await self.save("STRASSE")
        second = await self.save("第二 " + "☁" * 47)
        for action in ("rename", "save"):
            with self.assertRaisesRegex(ValueError, "already exists"):
                await self.action(action, preset_id=second, name=" strasse ", overwrite=action == "save")
        for index in range(18):
            await self.save(f"Preset {index}")
        with self.assertRaisesRegex(ValueError, "at most 20"):
            await self.save("One too many")
        await self.action("save", preset_id=first, overwrite=True)
        for preset_id in (*n.RESERVED_IDS, "../file", "not-an-id", 42, []):
            for action in ("save", "load", "delete", "rename"):
                with self.assertRaisesRegex(ValueError, "reserved preset ID"):
                    await self.action(action, preset_id=preset_id, name="Valid")
        self.assertEqual(len(self.entry.options["saved_presets"]), 20)

    async def test_unknown_actions_ids_and_bad_arguments_are_atomic(self):
        preset_id = await self.save()
        cases = [("unknown", {}), (None, {}), ([], {}), ("load", {}), ("delete", {}),
                 ("rename", {"preset_id": preset_id}), ("save", {"overwrite": True, "name": "New"}),
                 ("load", {"preset_id": "f" * 32}), ("load", {"preset_id": preset_id, "overwrite": True}),
                 ("save", {"name": "Bad", "overwrite": 1}), ("factory_reset", {"name": "Bad"})]
        before = deepcopy(self.entry.options)
        self.hass.config_entries.async_update_entry.reset_mock()
        for action, kwargs in cases:
            with self.subTest(action=action, kwargs=kwargs):
                with self.assertRaises(ValueError):
                    await self.action(action, **kwargs)
                self.assertEqual(self.entry.options, before)
        self.hass.config_entries.async_update_entry.assert_not_called()

    async def test_malformed_loaded_snapshots_reject_all_keys_types_ranges_steps_bounds_and_nested_limits(self):
        preset_id = await self.save()
        original = deepcopy(self.entry.options)
        snapshots = [None, [], "bad", {"weather_entity": "weather.hijacked"}, {"lightning_enabled": True},
                     {"effect": "invalid"}, {"settings_effect": []}, {"speed": True}, {"density": 10.5},
                     {"cloud_top": 35}, {"cloud_top": 25, "cloud_bottom": 20},
                     {"effect_settings": []}, {"effect_settings": {"unknown": {}}},
                     {"effect_settings": {"snow": {"unknown": 1}}},
                     {"effect_settings": {"snow": None}}, {"effect_settings": {"snow": {"cloud_top": 35}}},
                     {"effect_settings": {"snow": {"speed": float("inf")}}}]
        for key in n.VISUAL_KEYS:
            if key in backend.const.NUMBER_CONTROLS:
                low, high, step = backend.const.NUMBER_CONTROLS[key]
                snapshots.extend({key: value} for value in (low - step, high + step, low + step / 2, float("nan"), 10 ** 500))
        self.hass.config_entries.async_update_entry.reset_mock()
        for snapshot in snapshots:
            self.entry.options = deepcopy(original)
            self.entry.options["saved_presets"][preset_id]["settings"] = snapshot
            before = deepcopy(self.entry.options)
            with self.subTest(snapshot=snapshot):
                with self.assertRaises(ValueError):
                    await self.action("load", preset_id=preset_id)
                # NaN does not compare equal, so use serialization for this assertion.
                self.assertEqual(repr(self.entry.options), repr(before))
        self.hass.config_entries.async_update_entry.assert_not_called()

    async def test_legacy_snapshots_fill_missing_clouds_and_allow_equal_bounds(self):
        preset_id = await self.save()
        self.entry.options["saved_presets"][preset_id]["settings"] = {"effect": "snow", "speed": 2,
            "effect_settings": {"clouds": {"cloud_top": 30, "cloud_bottom": 30}}}
        await self.action("load", preset_id=preset_id)
        self.assertEqual((self.entry.options["cloud_top"], self.entry.options["cloud_bottom"], self.entry.options["cloud_spread"]), (10, 30, 80))
        self.assertEqual(p.effect_preset(self.entry.options, "clouds")["cloud_top"], 30)
        self.assertEqual(self.entry.options["settings_effect"], "snow")

    async def test_malformed_library_fails_gracefully_summaries_never_expose_snapshot(self):
        for library in (None, [], "bad", {"bad-id": {"name": "Test", "settings": {}}},
                        {"a" * 32: None}, {"b" * 32: {"name": "", "settings": {}}}):
            self.entry.options = {**deepcopy(self.entry.data), "saved_presets": library}
            self.assertEqual(n.preset_summaries(self.entry.options), [])
            with self.assertRaises(ValueError):
                await self.save()
            await self.action("factory_reset")
            self.assertEqual(self.entry.options["saved_presets"], library)
        library = {"c" * 32: {"name": "Visible", "settings": {"private": "must not leak"}}}
        self.assertEqual(n.preset_summaries({"saved_presets": library}), [{"id": "c" * 32, "name": "Visible"}])

    async def test_native_and_preset_safety_off_publication_requires_no_weather_await(self):
        preset_id = await self.save()
        for action in ("native", "load", "factory_reset"):
            self.entry.options["lightning_enabled"] = True
            self.coordinator.data = {"effect": "storm", "lightning_enabled": True, "opaque": "retained"}
            with patch.object(self.coordinator, "async_set_updated_data", wraps=self.coordinator.async_set_updated_data) as publish:
                if action == "native":
                    await self.coordinator.async_set_control("lightning_enabled", False)
                else:
                    await self.action(action, **({"preset_id": preset_id} if action == "load" else {}))
            publish.assert_called_once_with({"effect": "storm", "lightning_enabled": False, "opaque": "retained"})
            self.assertFalse(self.entry.options["lightning_enabled"])
            self.hass.services.async_call.assert_not_awaited()

    async def test_inflight_weather_result_cannot_reenable_disabled_master(self):
        self.coordinator.settings.update(enabled=True, enable_entity=None, forecast_offset=1)
        started, release = asyncio.Event(), asyncio.Event()
        async def fetch(*args, **kwargs):
            started.set()
            await release.wait()
            return {"weather.home": {"forecast": [row(NOW.isoformat())]}}
        self.hass.services.async_call.side_effect = fetch
        task = asyncio.create_task(self.coordinator._async_update_data())
        await started.wait()
        await self.action("factory_reset")
        release.set()
        result = await task
        self.assertFalse(result["lightning_enabled"])

    async def test_inflight_weather_result_uses_latest_library_summaries(self):
        self.coordinator.settings.update(enabled=True, enable_entity=None, forecast_offset=1)
        started, release = asyncio.Event(), asyncio.Event()
        async def fetch(*args, **kwargs):
            started.set()
            await release.wait()
            return {}
        self.hass.services.async_call.side_effect = fetch
        task = asyncio.create_task(self.coordinator._async_update_data())
        await started.wait()
        preset_id = await self.save()
        await self.action("rename", preset_id=preset_id, name="Latest")
        release.set()
        result = await task
        self.assertEqual(result["saved_presets"], [{"id": preset_id, "name": "Latest"}])

    async def test_options_listener_refreshes_once_without_duplicate_provider_fetch(self):
        self.entry.data.update(enabled=True, enable_entity=None)
        self.coordinator = backend.coordinator.WeatherEffectsCoordinator(self.hass, self.entry)
        self.coordinator.data = await self.coordinator._async_update_data()
        self.assertEqual(self.hass.services.async_call.await_count, 1)
        preset_id = await self.save()
        self.assertEqual(self.hass.services.async_call.await_count, 1)
        with patch.object(backend.coordinator, "async_track_state_change_event", return_value=Mock()):
            with patch.object(self.coordinator, "async_refresh", wraps=self.coordinator.async_refresh) as refresh:
                await asyncio.gather(self.coordinator.reconfigure(), self.coordinator.reconfigure())
        self.assertEqual(refresh.await_count, 1)
        self.assertEqual(self.hass.services.async_call.await_count, 1)
        self.assertEqual(self.coordinator.data["saved_presets"], [{"id": preset_id, "name": "Cloud view"}])

    async def test_actions_share_control_lock_and_preserve_authoritative_options(self):
        self.entry.options = {**deepcopy(backend.const.DEFAULTS), "only_options": {"x": [1]}}
        await asyncio.gather(self.save("One"), self.save("Two"), self.coordinator.async_set_control("cloud_spread", 95))
        self.assertEqual(len(self.entry.options["saved_presets"]), 2)
        self.assertEqual(self.entry.options["effect_settings"]["snow"]["cloud_spread"], 95)
        self.assertEqual(self.entry.options["only_options"], {"x": [1]})
        self.assertNotIn("weather_entity", self.entry.options)
        self.assertNotIn("transport_future", self.entry.options)


if __name__ == "__main__":
    unittest.main()
