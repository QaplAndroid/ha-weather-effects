"""Check release structure and localization without importing Home Assistant."""
import ast
import json
import re
import runpy
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
definitions = runpy.run_path(str(component / "const.py"))
for platform, controls in {
    "switch": definitions["SWITCH_CONTROLS"],
    "select": definitions["SELECT_CONTROLS"],
    "number": definitions["NUMBER_CONTROLS"],
}.items():
    for key in controls:
        assert english["entity"][platform][key]["name"], f"Missing entity translation: {key}"
assert json.loads((component / "strings.json").read_text(encoding="utf-8")) == english

# Check the complete backend/frontend composition contract, not only effect IDs.
layers = runpy.run_path(str(component / "layers.py"))
renderer = (component / "frontend/weather-effects.js").read_text(encoding="utf-8")

def js_literal(name):
    match = re.search(r"export const " + re.escape(name) + r"\s*=\s*Object\.freeze\((\{.*?\})\);", renderer, re.S)
    assert match, f"Missing renderer composition constant: {name}"
    literal = re.sub(r"([,{\s])([a-z][a-z0-9_]*)\s*:", r'\1"\2":', match.group(1))
    literal = re.sub(r",\s*([}\]])", r"\1", literal)
    return json.loads(literal)

assert set(layers["EFFECT_LAYERS"]) == set(effects), "Missing backend effect composition"
assert js_literal("EFFECTS") == layers["EFFECT_LAYERS"], "Backend/frontend effect composition mismatch"
assert js_literal("COMPONENT_SOURCES") == layers["LAYER_SOURCES"], "Backend/frontend component source mismatch"
assert set(layers["LAYER_SOURCES"].values()) == set(layers["COMPONENT_EFFECTS"]), "Invalid canonical component source"
archive = ROOT / "dist" / f"weather-effects-{manifest['version']}.zip"
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    names = bundle.namelist()
    for required in ("manifest.json", "__init__.py", "config_flow.py", "coordinator.py", "sensor.py",
                     "logic.py", "compat.py", "const.py", "strings.json", "translations/hr.json",
                     "translations/en.json", "frontend/weather-effects.js", "frontend/weather-effects-card.js",
                     "entity.py", "switch.py", "select.py", "number.py", "presets.py", "intensity.py", "named_presets.py", "layers.py"):
        assert f"custom_components/weather_effects/{required}" in names, required
    assert "README.md" in names and "LICENSE" in names
    assert not any("__pycache__" in name or name.endswith(".pyc") for name in names)
    for name in names:
        assert not name.startswith("/") and ".." not in Path(name).parts
        assert bundle.read(name) == (ROOT / name).read_bytes(), f"Stale release file: {name}"
print(f"Release OK: {len(names)} files, EN/HR keys match, ZIP matches source ({archive.stat().st_size} bytes).")
