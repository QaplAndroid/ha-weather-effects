"""Non-destructive preset resolution shared by controls, API and coordinator.

Flat appearance fields remain legacy/default fallbacks. Merely reading an old
entry never materializes presets or changes the stored edit target.
"""
from .const import DEFAULTS, EFFECTS

APPEARANCE_KEYS = ("speed", "size", "density", "opacity", "wind")


def configured_settings(entry):
    """Return defaults plus authoritative options (or data before first save)."""
    return {**DEFAULTS, **(entry.options or entry.data)}


def editing_effect(settings):
    """Return the persisted edit target, or configured effect, or snow."""
    effect = settings.get("settings_effect", settings.get("effect", "snow"))
    return effect if effect in EFFECTS else "snow"


def effect_preset(settings, effect):
    """Resolve five base values for effect, without changing settings."""
    presets = settings.get("effect_settings", {})
    preset = presets.get(effect, {}) if isinstance(presets, dict) else {}
    if not isinstance(preset, dict):
        preset = {}
    return {key: preset.get(key, settings.get(key, DEFAULTS[key])) for key in APPEARANCE_KEYS}


def configured_control_value(settings, key):
    """Resolve a native control, using edit-target preset for appearance."""
    if key == "settings_effect":
        return editing_effect(settings)
    if key in APPEARANCE_KEYS:
        return effect_preset(settings, editing_effect(settings))[key]
    return settings.get(key, DEFAULTS.get(key))
