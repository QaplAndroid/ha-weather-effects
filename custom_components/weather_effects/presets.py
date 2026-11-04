"""Non-destructive canonical component resolution shared by controls and runtime.

Explicit canonical dictionaries (including empty ones) win as a whole. Otherwise
use the first dictionary in LEGACY_COMPONENT_CANDIDATES, then flat defaults.
Reads never migrate data. First writes from a legacy candidate materialize all
resolved fields, retaining every original combo entry as a backup.
"""
from copy import deepcopy

from .const import DEFAULTS
from .layers import primary_component

APPEARANCE_KEYS = ("speed", "size", "density", "opacity", "wind", "cloud_top", "cloud_bottom", "cloud_spread")
CLOUD_KEYS = ("cloud_top", "cloud_bottom", "cloud_spread")
LEGACY_COMPONENT_CANDIDATES = {
    "rain": ("rain_clouds", "downpour", "storm", "sleet"),
    "snow": ("snow_clouds", "sleet"),
    "clouds": ("rain_clouds", "snow_clouds", "partlycloudy", "wind_clouds", "night_clouds", "hail", "downpour", "sleet", "storm", "storm_clouds"),
    "sun": ("partlycloudy",),
    "wind": ("wind_clouds", "storm", "storm_clouds"),
    "night": ("night_clouds",),
    "fog": (), "hail": (),
}


def configured_settings(entry):
    """Return defaults plus authoritative options (or data before first save)."""
    return deepcopy({**DEFAULTS, **(entry.options or entry.data)})


def editing_effect(settings):
    """Resolve persisted legacy edit targets to canonical components."""
    return primary_component(settings.get("settings_effect", settings.get("effect", "snow")))


def preset_source(settings, component):
    """Return selected stored source ID, or None for flat fallback."""
    component = primary_component(component)
    presets = settings.get("effect_settings", {})
    if not isinstance(presets, dict):
        return None
    if isinstance(presets.get(component), dict):
        return component
    return next((key for key in LEGACY_COMPONENT_CANDIDATES[component]
                 if isinstance(presets.get(key), dict)), None)


def effect_preset(settings, effect):
    """Resolve all eight base values for the primary canonical component."""
    source = preset_source(settings, effect)
    preset = settings["effect_settings"][source] if source is not None else {}
    return {key: preset.get(key, settings.get(key, DEFAULTS[key])) for key in APPEARANCE_KEYS}


def appearance_target(settings, key):
    """The three native cloud controls always edit Clouds, never rain combos."""
    return "clouds" if key in CLOUD_KEYS else editing_effect(settings)


def configured_control_value(settings, key):
    """Resolve native controls using canonical appearance targets."""
    if key == "settings_effect":
        return editing_effect(settings)
    if key in APPEARANCE_KEYS:
        return effect_preset(settings, appearance_target(settings, key))[key]
    return settings.get(key, DEFAULTS.get(key))
