"""Validated, config-entry-only named visual snapshots; no transport settings.

Factory defaults are virtual: never a mutable item in the saved library. Runtime
consumers must use preset_summaries, not expose stored snapshot contents.
"""
from copy import deepcopy
import math
import re
import unicodedata
from uuid import uuid4

from .const import DEFAULTS, EFFECTS, LIGHTNING_CONTROLS, NUMBER_CONTROLS, SWITCH_CONTROLS
from .presets import APPEARANCE_KEYS, editing_effect

MAX_PRESETS = 20
VISUAL_KEYS = (*APPEARANCE_KEYS, "effect", "settings_effect", "adaptive_weather",
               "heat_threshold", "respect_reduced_motion", "max_fps",
               *(key for key in LIGHTNING_CONTROLS if key != "lightning_enabled"))
RESERVED_IDS = frozenset(("factory", "factory_defaults", "default", "defaults"))
_ID = re.compile(r"[0-9a-f]{32}\Z")


def validate_name(name):
    """Trim names, counting Unicode characters rather than encoded bytes."""
    if not isinstance(name, str):
        raise ValueError("Preset name must be text")
    # Reject controls even at the edges, rather than stripping them away.
    if any(unicodedata.category(char) in {"Cc", "Cf", "Cs"} for char in name):
        raise ValueError("Preset name must not contain control characters")
    name = name.strip()
    if not 1 <= len(name) <= 50:
        raise ValueError("Preset name must contain 1 to 50 characters")
    return name


def validate_cloud_bounds(settings):
    """Validate an already numerically validated appearance or resolved preset."""
    top = settings.get("cloud_top", DEFAULTS["cloud_top"])
    bottom = settings.get("cloud_bottom", DEFAULTS["cloud_bottom"])
    if (type(top) not in (int, float) or type(bottom) not in (int, float)
            or not 0 <= top <= bottom <= 100):
        raise ValueError("Cloud top must be less than or equal to cloud bottom")


def _validate_value(key, value):
    if key in ("effect", "settings_effect"):
        valid = isinstance(value, str) and value in EFFECTS
    elif key in SWITCH_CONTROLS:
        valid = type(value) is bool
    else:
        low, high, step = NUMBER_CONTROLS[key]
        valid = type(value) in (int, float) and low <= value <= high and math.isfinite(value)
        if valid:
            steps = (value - low) / step
            valid = math.isclose(steps, round(steps), rel_tol=0, abs_tol=1e-8)
    if not valid:
        raise ValueError(f"Invalid visual preset value: {key}")


def validate_snapshot(snapshot):
    """Reject malformed/unknown keys atomically; old missing fields get defaults."""
    if not isinstance(snapshot, dict) or set(snapshot) - set((*VISUAL_KEYS, "effect_settings")):
        raise ValueError("Invalid visual preset settings or unknown keys")
    result = {key: deepcopy(DEFAULTS[key]) for key in VISUAL_KEYS if key in DEFAULTS}
    result["settings_effect"] = snapshot.get("settings_effect", snapshot.get("effect", DEFAULTS["effect"]))
    for key, value in snapshot.items():
        if key == "effect_settings":
            continue
        _validate_value(key, value)
        result[key] = value
    validate_cloud_bounds(result)
    presets = snapshot.get("effect_settings", {})
    if not isinstance(presets, dict) or len(presets) > len(EFFECTS):
        raise ValueError("Invalid effect preset map")
    result["effect_settings"] = {}
    for effect, appearance in presets.items():
        if (not isinstance(effect, str) or effect not in EFFECTS or not isinstance(appearance, dict)
                or set(appearance) - set(APPEARANCE_KEYS)):
            raise ValueError("Invalid effect preset appearance or effect ID")
        for key, value in appearance.items():
            _validate_value(key, value)
        result["effect_settings"][effect] = deepcopy(appearance)
        # Validate the ORIGINAL legacy appearance against flat defaults. Resolving
        # through a canonical primary could hide invalid bounds in old combos.
        validate_cloud_bounds({**result, **appearance})
    result["settings_effect"] = editing_effect(result)
    return deepcopy(result)


def visual_snapshot(settings):
    """Capture recognized visuals only, never master lightning or infrastructure."""
    snapshot = {key: deepcopy(settings.get(key, DEFAULTS.get(key))) for key in VISUAL_KEYS
                if key != "settings_effect"}
    snapshot["settings_effect"] = editing_effect(settings)
    stored = settings.get("effect_settings", {})
    # Ignore future/transport keys when capturing, but validate all recognized data.
    if not isinstance(stored, dict):
        raise ValueError("Invalid effect preset map")
    if len(stored) > len(EFFECTS):
        raise ValueError("Invalid effect preset map")
    snapshot["effect_settings"] = {}
    for effect, appearance in stored.items():
        if not isinstance(appearance, dict):
            raise ValueError("Invalid effect preset appearance")
        snapshot["effect_settings"][effect] = {key: deepcopy(value) for key, value in appearance.items()
                                                if key in APPEARANCE_KEYS}
    return validate_snapshot(snapshot)


def _valid_id(preset_id):
    return isinstance(preset_id, str) and _ID.fullmatch(preset_id) is not None


def preset_summaries(settings):
    """Read malformed libraries defensively without ever exposing snapshots."""
    library = settings.get("saved_presets", {})
    if not isinstance(library, dict):
        return []
    result = []
    for preset_id, item in library.items():
        if not _valid_id(preset_id) or not isinstance(item, dict):
            continue
        try:
            name = validate_name(item.get("name"))
        except ValueError:
            continue
        result.append({"id": preset_id, "name": name})
        if len(result) == MAX_PRESETS:
            break
    return result


def _library(settings):
    library = settings.get("saved_presets", {})
    if not isinstance(library, dict) or len(library) > MAX_PRESETS:
        raise ValueError("Saved preset library is malformed")
    names = set()
    for preset_id, item in library.items():
        if not _valid_id(preset_id) or not isinstance(item, dict) or set(item) != {"name", "settings"}:
            raise ValueError("Saved preset library is malformed")
        name = validate_name(item["name"])
        if name.casefold() in names:
            raise ValueError("Saved preset library has duplicate names")
        names.add(name.casefold())
    return deepcopy(library)


def apply_preset_action(settings, action, preset_id=None, name=None, overwrite=False):
    """Return full authoritative options and a summary response, without mutation."""
    if not isinstance(action, str) or action not in {"save", "load", "delete", "rename", "factory_reset"}:
        raise ValueError("Unknown preset action")
    if type(overwrite) is not bool:
        raise ValueError("Preset overwrite must be a boolean")
    if preset_id is not None and not _valid_id(preset_id):
        raise ValueError("Invalid or reserved preset ID")
    options = deepcopy(settings)
    if action == "factory_reset":
        if preset_id is not None or name is not None or overwrite:
            raise ValueError("Factory reset does not accept preset metadata")
        # A malformed library must not prevent resetting visuals; retain it exactly.
        options.update(validate_snapshot({}))
        options["lightning_enabled"] = False
        return options, {"action": action, "preset_id": None, "name": None,
                         "saved_presets": preset_summaries(options)}
    library = _library(settings)
    if action != "save" and preset_id is None:
        raise ValueError("Preset ID is required")
    if preset_id is not None and preset_id not in library:
        raise ValueError("Saved preset does not exist")
    if action == "save":
        if preset_id is not None and not overwrite:
            raise ValueError("Overwriting a saved preset requires explicit overwrite")
        if preset_id is None and overwrite:
            raise ValueError("Overwrite requires an existing preset ID")
        name = validate_name(name if name is not None else library.get(preset_id, {}).get("name"))
    elif action == "rename":
        if overwrite:
            raise ValueError("Only save accepts overwrite")
        name = validate_name(name)
    elif name is not None or overwrite:
        raise ValueError("This preset action does not accept name or overwrite")
    if action in {"save", "rename"}:
        if any(item["name"].strip().casefold() == name.casefold() for key, item in library.items() if key != preset_id):
            raise ValueError("A saved preset with this name already exists")
    if action == "save":
        if preset_id is None:
            if len(library) >= MAX_PRESETS:
                raise ValueError("A profile can contain at most 20 saved presets")
            preset_id = uuid4().hex
        library[preset_id] = {"name": name, "settings": visual_snapshot(settings)}
    elif action == "load":
        options.update(validate_snapshot(library[preset_id]["settings"]))
        options["lightning_enabled"] = False
        name = library[preset_id]["name"]
    elif action == "rename":
        library[preset_id]["name"] = name
    elif action == "delete":
        name = library.pop(preset_id)["name"]
    options["saved_presets"] = library
    return options, {"action": action, "preset_id": preset_id, "name": name,
                     "saved_presets": preset_summaries(options)}
