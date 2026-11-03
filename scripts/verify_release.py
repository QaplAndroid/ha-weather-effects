"""Check release structure and localization without importing Home Assistant."""
import ast
import json
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
component = ROOT / "custom_components" / "weather_effects"
manifest = json.loads((component / "manifest.json").read_text(encoding="utf-8"))
assert manifest["domain"] == "weather_effects" and manifest["config_flow"] is True
constants = ast.parse((component / "const.py").read_text(encoding="utf-8"))
version = next(ast.literal_eval(node.value) for node in constants.body
               if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "VERSION"
                                                       for target in node.targets))
assert version == manifest["version"], "Frontend cache version does not match manifest"
for path in component.rglob("*.json"):
    json.loads(path.read_text(encoding="utf-8"))
english = json.loads((component / "translations/en.json").read_text(encoding="utf-8"))
croatian = json.loads((component / "translations/hr.json").read_text(encoding="utf-8"))


def keys(obj, prefix=""):
    result = set()
    if isinstance(obj, dict):
        for key, value in obj.items():
            name = f"{prefix}.{key}"
            result.add(name)
            result.update(keys(value, name))
    return result


assert keys(english) == keys(croatian), "Translation key mismatch"
effects = next(ast.literal_eval(node.value) for node in constants.body
               if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "EFFECTS"
                                                       for target in node.targets))
assert set(effects) == set(english["selector"]["effect"]["options"]), "Effect selector translation mismatch"
assert set(effects) == set(english["selector"]["settings_effect"]["options"]), "Preset selector translation mismatch"
assert set(effects) == set(english["entity"]["select"]["settings_effect"]["state"]), "Native preset translation mismatch"
assert set(effects) == set(english["entity"]["select"]["effect"]["state"]), "Native effect translation mismatch"
for platform, controls in {
    "switch": ("enabled", "respect_reduced_motion", "adaptive_weather", "lightning_enabled"),
    "select": ("mode", "effect", "settings_effect"),
    "number": ("forecast_offset", "speed", "size", "density", "opacity", "wind", "max_fps",
               "heat_threshold", "lightning_interval", "lightning_brightness"),
}.items():
    for key in controls:
        assert english["entity"][platform][key]["name"], f"Missing entity translation: {key}"
assert json.loads((component / "strings.json").read_text(encoding="utf-8")) == english
archive = ROOT / "dist" / f"weather-effects-{manifest['version']}.zip"
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    names = bundle.namelist()
    for required in ("manifest.json", "__init__.py", "config_flow.py", "coordinator.py", "sensor.py",
                     "logic.py", "compat.py", "const.py", "strings.json", "translations/hr.json",
                     "translations/en.json", "frontend/weather-effects.js", "frontend/weather-effects-card.js",
                     "entity.py", "switch.py", "select.py", "number.py", "presets.py", "intensity.py"):
        assert f"custom_components/weather_effects/{required}" in names, required
    assert "README.md" in names and "LICENSE" in names
    assert not any("__pycache__" in name or name.endswith(".pyc") for name in names)
    for name in names:
        assert not name.startswith("/") and ".." not in Path(name).parts
        assert bundle.read(name) == (ROOT / name).read_bytes(), f"Stale release file: {name}"
print(f"Release OK: {len(names)} files, EN/HR keys match, ZIP matches source ({archive.stat().st_size} bytes).")
