"""Check release structure and localization without importing Home Assistant."""
import json
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
component = ROOT / "custom_components" / "weather_effects"
manifest = json.loads((component / "manifest.json").read_text(encoding="utf-8"))
assert manifest["domain"] == "weather_effects" and manifest["config_flow"] is True
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
assert json.loads((component / "strings.json").read_text(encoding="utf-8")) == english
archive = ROOT / "dist" / f"weather-effects-{manifest['version']}.zip"
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    names = bundle.namelist()
    for required in ("manifest.json", "__init__.py", "config_flow.py", "coordinator.py", "sensor.py",
                     "logic.py", "compat.py", "const.py", "strings.json", "translations/hr.json",
                     "translations/en.json", "frontend/weather-effects.js"):
        assert f"custom_components/weather_effects/{required}" in names, required
    assert "README.md" in names and "LICENSE" in names
    assert not any("__pycache__" in name or name.endswith(".pyc") for name in names)
    for name in names:
        assert not name.startswith("/") and ".." not in Path(name).parts
        assert bundle.read(name) == (ROOT / name).read_bytes(), f"Stale release file: {name}"
print(f"Release OK: {len(names)} files, EN/HR keys match, ZIP matches source ({archive.stat().st_size} bytes).")
