"""Pure layer contract and MOCKED HA canonical component regression coverage."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import unittest

from test_backend import backend

layers = backend.layers
p = backend.presets


class LayerContractTests(unittest.TestCase):
    def test_exact_eighteen_compositions_and_sources(self):
        expected = {
            "off": [], "snow": ["snow"], "rain": ["rain"], "sun": ["sun"],
            "clouds": ["clouds"], "partlycloudy": ["sun", "clouds"],
            "rain_clouds": ["clouds", "rain"], "snow_clouds": ["clouds", "snow"],
            "fog": ["fog"], "wind": ["wind"], "wind_clouds": ["clouds", "wind"],
            "night": ["night"], "night_clouds": ["night", "clouds"],
            "hail": ["clouds", "hail"], "sleet": ["clouds", "rain", "snow"],
            "downpour": ["clouds", "downpour"],
            "storm": ["storm_clouds", "wind", "rain"],
            "storm_clouds": ["storm_clouds", "wind"],
        }
        self.assertEqual(layers.EFFECT_LAYERS, expected)
        self.assertEqual(set(expected), set(backend.const.EFFECTS))
        self.assertEqual(layers.COMPONENT_EFFECTS, ("sun", "clouds", "rain", "snow", "fog", "wind", "night", "hail"))
        self.assertEqual(layers.LAYER_SOURCES,
                         {**{key: key for key in layers.COMPONENT_EFFECTS},
                          "downpour": "rain", "storm_clouds": "clouds"})

    def test_primary_targets_for_all_effects(self):
        expected = ("snow", "snow", "rain", "sun", "clouds", "sun", "rain", "snow",
                    "fog", "wind", "wind", "night", "night", "hail", "snow", "rain", "rain", "clouds")
        for effect, target in zip(backend.const.EFFECTS, expected):
            self.assertEqual(p.editing_effect({"settings_effect": effect}), target)

    def test_legacy_priority_canonical_whole_entry_precedence_and_nonmutation(self):
        for component, candidates in p.LEGACY_COMPONENT_CANDIDATES.items():
            for index, candidate in enumerate(candidates):
                stored = {key: {"speed": 1 + number / 10} for number, key in enumerate(candidates[index:], index)}
                settings = {"speed": .7, "size": 2, "effect_settings": stored}
                before = deepcopy(settings)
                self.assertEqual(p.preset_source(settings, component), candidate)
                self.assertEqual(p.effect_preset(settings, component)["speed"], stored[candidate]["speed"])
                self.assertEqual(settings, before)
                for explicit in ({}, {"opacity": .4}):
                    settings["effect_settings"][component] = explicit
                    resolved = p.effect_preset(settings, component)
                    self.assertEqual(resolved["speed"], .7)
                    self.assertEqual(resolved["size"], 2)
                    self.assertEqual(resolved["opacity"], explicit.get("opacity", .65))


class ComponentRuntimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.attrs = {"temperature": 42, "temperature_unit": "°C", "precipitation_rate": 12,
                      "precipitation_rate_unit": "mm/h", "wind_speed": 70,
                      "wind_speed_unit": "km/h", "cloud_coverage": 80}
        self.states = {"weather.home": SimpleNamespace(state="rainy", attributes=self.attrs)}
        self.entry = SimpleNamespace(entry_id="layers", title="Layers", options={}, data={
            **deepcopy(backend.const.DEFAULTS), "weather_entity": "weather.home",
            "effect_settings": {component: {"speed": .5 + index / 10, "density": 20 + index * 10}
                                for index, component in enumerate(layers.COMPONENT_EFFECTS)}})
        self.hass = SimpleNamespace(states=SimpleNamespace(get=self.states.get),
            services=SimpleNamespace(async_call=AsyncMock()),
            config_entries=SimpleNamespace(async_update_entry=Mock(side_effect=self.persist)))
        self.coordinator = backend.coordinator.WeatherEffectsCoordinator(self.hass, self.entry)

    def persist(self, entry, *, options):
        entry.options = options

    async def runtime(self, effect, **changes):
        self.coordinator.settings = {**p.configured_settings(self.entry), "effect": effect, **changes}
        return await self.coordinator._async_update_data()

    async def test_all_eighteen_runtime_maps_and_compatibility_primary(self):
        for effect in backend.const.EFFECTS:
            with self.subTest(effect=effect):
                result = await self.runtime(effect)
                sources = {layer: layers.LAYER_SOURCES[layer] for layer in layers.EFFECT_LAYERS[effect]}
                self.assertEqual(result["appearance_model"], "components_v1")
                self.assertEqual(result["layer_sources"], sources)
                expected = {source: p.effect_preset(self.entry.data, source) for source in sources.values()}
                self.assertEqual(result["layer_presets"], expected)
                self.assertEqual(result["layer_settings"], expected)
                self.assertEqual(result["preset"], p.effect_preset(self.entry.data, effect))
                for key in p.APPEARANCE_KEYS:
                    self.assertEqual(result[key], result["preset"][key])
        disabled = await self.runtime("storm", enabled=False)
        for key in ("layer_sources", "layer_presets", "layer_settings"):
            self.assertEqual(disabled[key], {})
        self.assertEqual(disabled["effect"], "off")
        self.assertEqual(disabled["preset"], p.effect_preset(self.entry.data, "off"))

    async def test_each_component_edit_propagates_without_touching_other_layers(self):
        # Exercise each editable component against every composite/pure consumer.
        for component in layers.COMPONENT_EFFECTS:
            before = {effect: await self.runtime(effect) for effect in backend.const.EFFECTS}
            await self.coordinator.async_set_control("settings_effect", component)
            await self.coordinator.async_set_control("density", 190)
            for effect in backend.const.EFFECTS:
                after = await self.runtime(effect)
                for source, values in after["layer_presets"].items():
                    if source == component:
                        self.assertEqual(values["density"], 190)
                    else:
                        self.assertEqual(values, before[effect]["layer_presets"][source])
            self.entry.options = {}

    async def test_cloud_numeric_controls_always_clouds_for_every_edit_target(self):
        for target in backend.const.EFFECTS:
            await self.coordinator.async_set_control("settings_effect", target)
            await self.coordinator.async_set_control("cloud_spread", 55)
            self.assertEqual(p.configured_control_value(self.entry.options, "cloud_spread"), 55)
            self.assertEqual(self.entry.options["effect_settings"]["clouds"]["cloud_spread"], 55)
            result = await self.runtime("rain_clouds")
            self.assertEqual(result["layer_settings"]["clouds"]["cloud_spread"], 55)
            self.assertEqual(result["layer_settings"]["rain"]["cloud_spread"], 80)
            self.entry.options = {}

    async def test_independent_adaptation_and_downpour_no_intrinsic_backend_multiplier(self):
        for effect in backend.const.EFFECTS:
            result = await self.runtime(effect, mode="automatic")
            # Automatic rainy resolution produces rain_clouds, separately test all
            # compositions using a selected-weather stub below.
            self.assertEqual(result["effect"], "rain_clouds")
            self.assertEqual(result["layer_settings"]["clouds"]["density"], 30)
            self.assertAlmostEqual(result["layer_settings"]["rain"]["density"], 40 * 2.55)
        from unittest.mock import patch
        for effect in backend.const.EFFECTS:
            with patch.object(backend.coordinator, "select_weather", return_value=(effect, "current", "test", None)):
                result = await self.runtime(effect, mode="automatic")
            for source, base in result["layer_presets"].items():
                expected, _ = backend.intensity.adapt(base, source, result["weather_metrics"], True, 30)
                self.assertEqual(result["layer_settings"][source], expected)
            self.assertEqual(result["intensity"]["heat"], 1 if effect in {"sun", "partlycloudy"} else 0)
            if effect == "storm":
                self.assertEqual(set(result["layer_settings"]), {"clouds", "wind", "rain"})
                self.assertAlmostEqual(result["layer_settings"]["wind"]["speed"], 1.35)
                self.assertEqual(result["layer_settings"]["clouds"]["density"], 30)
            if effect == "downpour":
                self.assertEqual(result["layer_sources"]["downpour"], "rain")
                self.assertAlmostEqual(result["layer_settings"]["rain"]["density"], 102)

    async def test_first_write_materializes_legacy_and_keeps_combo_backup(self):
        old = {"rain_clouds": {"density": 110, "speed": 2, "cloud_top": 20},
               "storm": {"speed": .4}, "hail": {"opacity": .3, "cloud_spread": 50}}
        self.entry.data["effect_settings"] = deepcopy(old)
        self.entry.data["settings_effect"] = "storm"
        expected = p.effect_preset(self.entry.data, "rain")
        await self.coordinator.async_set_control("opacity", .8)
        self.assertEqual(self.entry.options["effect_settings"]["rain"], {**expected, "opacity": .8})
        for key, values in old.items():
            self.assertEqual(self.entry.options["effect_settings"][key], values)
        expected_clouds = p.effect_preset(self.entry.options, "clouds")
        await self.coordinator.async_set_control("cloud_spread", 95)
        self.assertEqual(self.entry.options["effect_settings"]["clouds"], {**expected_clouds, "cloud_spread": 95})
        # Hail remains its own canonical preset, and can seed Clouds only if absent.
        self.entry.options = {**self.entry.data, "effect_settings": {"hail": old["hail"]}}
        self.assertEqual(p.effect_preset(self.entry.options, "clouds")["opacity"], .3)
        await self.coordinator.async_set_control("cloud_top", 15)
        self.assertEqual(self.entry.options["effect_settings"]["hail"], old["hail"])
        self.assertEqual(self.entry.options["effect_settings"]["clouds"]["cloud_spread"], 50)

    async def test_fresh_hail_first_writes_never_change_clouds(self):
        changes = {"speed": 2, "size": 2, "density": 140, "opacity": .9, "wind": -1}
        for key, value in changes.items():
            with self.subTest(key=key):
                self.entry.options = {**deepcopy(backend.const.DEFAULTS),
                                      "effect_settings": {}, "settings_effect": "hail"}
                clouds_before = p.effect_preset(self.entry.options, "clouds")
                await self.coordinator.async_set_control(key, value)
                self.assertEqual(self.entry.options["effect_settings"]["clouds"], clouds_before)
                self.assertEqual(p.effect_preset(self.entry.options, "clouds"), clouds_before)
                self.assertEqual(self.entry.options["effect_settings"]["hail"], {key: value})
                result = await self.runtime("hail")
                self.assertEqual(result["layer_presets"]["clouds"], clouds_before)
                self.assertEqual(result["layer_presets"]["hail"][key], value)

    async def test_old_hail_only_edit_freezes_clouds_before_hail_mutation(self):
        legacy_hail = {"speed": 1.8, "density": 120, "opacity": .4,
                       "cloud_top": 20, "cloud_bottom": 40, "cloud_spread": 50}
        self.entry.options = {**deepcopy(backend.const.DEFAULTS), "settings_effect": "hail",
                              "effect_settings": {"hail": deepcopy(legacy_hail)}}
        clouds_before = p.effect_preset(self.entry.options, "clouds")
        before = deepcopy(self.entry.options)
        # Merely resolving legacy Hail as Clouds must remain non-destructive.
        self.assertEqual(self.entry.options, before)
        await self.coordinator.async_set_control("density", 160)
        self.assertEqual(self.entry.options["effect_settings"]["clouds"], clouds_before)
        self.assertEqual(self.entry.options["effect_settings"]["hail"], {**legacy_hail, "density": 160})
        await self.coordinator.async_set_control("opacity", .8)
        self.assertEqual(p.effect_preset(self.entry.options, "clouds"), clouds_before)
        self.assertEqual(p.effect_preset(self.entry.options, "hail")["opacity"], .8)

    async def test_new_hail_snapshot_roundtrip_preserves_cloud_independence(self):
        self.entry.options = {**deepcopy(backend.const.DEFAULTS),
                              "effect_settings": {}, "settings_effect": "hail"}
        clouds_before = p.effect_preset(self.entry.options, "clouds")
        await self.coordinator.async_set_control("density", 160)
        response = await self.coordinator.async_preset_action("save", name="Hail independent")
        preset_id = response["preset_id"]
        await self.coordinator.async_set_control("settings_effect", "clouds")
        await self.coordinator.async_set_control("density", 190)
        await self.coordinator.async_set_control("settings_effect", "hail")
        await self.coordinator.async_set_control("density", 180)
        await self.coordinator.async_preset_action("load", preset_id)
        self.assertEqual(p.effect_preset(self.entry.options, "clouds"), clouds_before)
        self.assertEqual(p.effect_preset(self.entry.options, "hail")["density"], 160)
        await self.coordinator.async_set_control("density", 170)
        self.assertEqual(p.effect_preset(self.entry.options, "clouds"), clouds_before)
        self.assertEqual(p.effect_preset(self.entry.options, "hail")["density"], 170)

    async def test_native_effect_selection_canonicalizes_without_losing_effect_ids(self):
        for effect in backend.const.EFFECTS:
            await self.coordinator.async_set_control("effect", effect)
            self.assertEqual(self.entry.options["effect"], effect)
            self.assertEqual(p.editing_effect(self.entry.options), layers.primary_component(effect))
            await self.coordinator.async_set_control("settings_effect", effect)
            self.assertEqual(p.configured_control_value(self.entry.options, "settings_effect"), layers.primary_component(effect))

    async def test_old_named_snapshot_load_retains_legacy_maps_and_canonical_sources(self):
        preset_id = "a" * 32
        legacy = {"rain_clouds": {"density": 130}, "snow_clouds": {"density": 80}, "hail": {"size": 2}}
        self.entry.data.update(mode="automatic", enable_entity="switch.gate", enabled=False,
            saved_presets={preset_id: {"name": "Old", "settings": {
                "effect": "sleet", "settings_effect": "rain_clouds", "effect_settings": legacy}}})
        await self.coordinator.async_preset_action("load", preset_id)
        self.assertEqual(self.entry.options["effect_settings"], legacy)
        self.assertEqual(self.entry.options["settings_effect"], "rain")
        self.assertEqual(self.entry.options["mode"], "automatic")
        self.assertEqual(self.entry.options["enable_entity"], "switch.gate")
        self.assertFalse(self.entry.options["enabled"])
        self.assertEqual(self.entry.options["weather_entity"], "weather.home")
        result = await self.runtime("sleet", enabled=True, enable_entity=None, mode="manual")
        self.assertEqual(result["layer_presets"]["rain"]["density"], 130)
        self.assertEqual(result["layer_presets"]["snow"]["density"], 80)

    async def test_raw_legacy_invalid_bounds_cannot_hide_behind_canonical(self):
        snapshot = {"effect_settings": {"rain": {}, "clouds": {},
                    "rain_clouds": {"cloud_top": 90, "cloud_bottom": 20}}}
        with self.assertRaisesRegex(ValueError, "less than or equal"):
            backend.named_presets.validate_snapshot(snapshot)
        with self.assertRaisesRegex(ValueError, "less than or equal"):
            backend.config_flow.validate_stored_cloud_bounds(snapshot)


if __name__ == "__main__":
    unittest.main()
