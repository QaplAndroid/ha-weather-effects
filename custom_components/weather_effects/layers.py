"""Pure renderer composition contract; physical layers use canonical presets."""

COMPONENT_EFFECTS = ("sun", "clouds", "rain", "snow", "fog", "wind", "night", "hail")

EFFECT_LAYERS = {
    "off": [],
    "snow": ["snow"],
    "rain": ["rain"],
    "sun": ["sun"],
    "clouds": ["clouds"],
    "partlycloudy": ["sun", "clouds"],
    "rain_clouds": ["clouds", "rain"],
    "snow_clouds": ["clouds", "snow"],
    "fog": ["fog"],
    "wind": ["wind"],
    "wind_clouds": ["clouds", "wind"],
    "night": ["night"],
    "night_clouds": ["night", "clouds"],
    "hail": ["clouds", "hail"],
    "sleet": ["clouds", "rain", "snow"],
    "downpour": ["clouds", "downpour"],
    "storm": ["storm_clouds", "wind", "rain"],
    "storm_clouds": ["storm_clouds", "wind"],
}

LAYER_SOURCES = {
    "sun": "sun", "clouds": "clouds", "rain": "rain", "snow": "snow",
    "fog": "fog", "wind": "wind", "night": "night", "hail": "hail",
    "storm_clouds": "clouds", "downpour": "rain",
}

PRIMARY_COMPONENTS = {
    "partlycloudy": "sun", "rain_clouds": "rain", "downpour": "rain",
    "storm": "rain", "snow_clouds": "snow", "sleet": "snow",
    "wind_clouds": "wind", "night_clouds": "night", "storm_clouds": "clouds",
}


def primary_component(effect):
    """Compatibility flat/edit target; off and unknown retain snow fallback."""
    return effect if effect in COMPONENT_EFFECTS else PRIMARY_COMPONENTS.get(effect, "snow")
