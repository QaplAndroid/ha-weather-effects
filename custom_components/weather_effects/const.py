"""Constants for Weather Effects."""
DOMAIN = "weather_effects"
VERSION = "0.3.1"
SIGNAL_UPDATED = f"{DOMAIN}_updated"
FRONTEND_URL = f"/weather_effects_static/weather-effects.js?v={VERSION}"
DEFAULT_WEATHER = "weather.forecast_work_work"
EFFECTS = (
    "off", "snow", "rain", "sun", "clouds", "partlycloudy", "rain_clouds", "snow_clouds",
    "fog", "wind", "wind_clouds", "night", "night_clouds", "hail", "sleet", "downpour",
    "storm", "storm_clouds",
)
# Shared by native platforms, validation, and registry-ID lookup for the frontend.
SWITCH_CONTROLS = ("enabled", "respect_reduced_motion")
SELECT_CONTROLS = {"mode": ("manual", "automatic"), "effect": EFFECTS}
NUMBER_CONTROLS = {
    "forecast_offset": (0, 72, 1),
    "speed": (0.2, 3, 0.1),
    "size": (0.3, 3, 0.1),
    "density": (10, 200, 1),
    "opacity": (0.05, 1, 0.05),
    "wind": (-2, 2, 0.1),
    "max_fps": (15, 60, 1),
}
CONTROL_KEYS = {
    **dict.fromkeys(SWITCH_CONTROLS, "switch"),
    **dict.fromkeys(SELECT_CONTROLS, "select"),
    **dict.fromkeys(NUMBER_CONTROLS, "number"),
}
DEFAULTS = {
    "enabled": True,
    "dashboards": ["lovelace"],
    "mode": "manual",
    "effect": "snow",
    "forecast_offset": 0,
    "speed": 1.0,
    "size": 1.0,
    "density": 60,
    "opacity": 0.65,
    "wind": 0.2,
    "respect_reduced_motion": True,
    "max_fps": 30,
}
