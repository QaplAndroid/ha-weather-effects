"""Constants for Weather Effects."""
DOMAIN = "weather_effects"
VERSION = "0.6.0"
SIGNAL_UPDATED = f"{DOMAIN}_updated"
FRONTEND_URL = f"/weather_effects_static/weather-effects.js?v={VERSION}"
DEFAULT_WEATHER = "weather.forecast_work_work"
EFFECTS = (
    "off", "snow", "rain", "sun", "clouds", "partlycloudy", "rain_clouds", "snow_clouds",
    "fog", "wind", "wind_clouds", "night", "night_clouds", "hail", "sleet", "downpour",
    "storm", "storm_clouds",
)
# Shared by native platforms, validation, and registry-ID lookup for the frontend.
SWITCH_CONTROLS = (
    "enabled", "respect_reduced_motion", "adaptive_weather", "lightning_enabled",
    "lightning_bolt_enabled", "lightning_flash_enabled",
)
SELECT_CONTROLS = {"mode": ("manual", "automatic"), "effect": EFFECTS, "settings_effect": EFFECTS}
NUMBER_CONTROLS = {
    "forecast_offset": (0, 72, 1),
    "speed": (0.2, 3, 0.1),
    "size": (0.3, 3, 0.1),
    "density": (10, 200, 1),
    "opacity": (0.05, 1, 0.05),
    "wind": (-2, 2, 0.1),
    "cloud_top": (0, 100, 5),
    "cloud_bottom": (0, 100, 5),
    "cloud_spread": (0, 100, 5),
    "max_fps": (15, 60, 1),
    "heat_threshold": (25, 45, 1),
    "lightning_interval": (5, 60, 1),
    "lightning_brightness": (0.05, 0.25, 0.05),
    "lightning_formation_time": (0.1, 3, 0.1),
    "lightning_duration": (0.3, 2, 0.1),
    "lightning_branches": (0, 8, 1),
    "lightning_thickness": (0.5, 4, 0.5),
    "lightning_glow": (0, 1, 0.1),
    "lightning_length": (0.2, 0.9, 0.1),
}
NUMBER_UNITS = {
    "forecast_offset": "h", "heat_threshold": "°C", "lightning_interval": "s",
    "lightning_formation_time": "s", "lightning_duration": "s",
    "cloud_top": "%", "cloud_bottom": "%", "cloud_spread": "%",
}
# Global profile controls, never copied into per-effect appearance presets.
LIGHTNING_CONTROLS = tuple(key for key in (*SWITCH_CONTROLS, *NUMBER_CONTROLS)
                           if key.startswith("lightning_"))
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
    "cloud_top": 10,
    "cloud_bottom": 30,
    "cloud_spread": 80,
    "respect_reduced_motion": True,
    "max_fps": 30,
    "adaptive_weather": True,
    "lightning_enabled": False,
    "heat_threshold": 30,
    "lightning_interval": 12,
    "lightning_brightness": 0.10,
    # Sub-switch defaults retain old enabled profiles without enabling the master.
    "lightning_bolt_enabled": True,
    "lightning_flash_enabled": True,
    "lightning_formation_time": 0.8,  # Seconds; smaller values form the bolt faster.
    "lightning_duration": 0.7,  # Seconds of fading after formation completes.
    "lightning_branches": 4,
    "lightning_thickness": 1.5,
    "lightning_glow": 0.6,
    "lightning_length": 0.6,  # Fraction of viewport height.
}
