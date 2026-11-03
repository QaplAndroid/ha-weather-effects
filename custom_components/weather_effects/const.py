"""Constants for Weather Effects."""
DOMAIN = "weather_effects"
VERSION = "0.1.0"
SIGNAL_UPDATED = f"{DOMAIN}_updated"
FRONTEND_URL = f"/weather_effects_static/weather-effects.js?v={VERSION}"
DEFAULT_WEATHER = "weather.forecast_work_work"
EFFECTS = ("off", "snow", "rain", "sun", "clouds", "partlycloudy", "rain_clouds", "snow_clouds")
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
