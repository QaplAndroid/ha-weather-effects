"""Pure, testable weather selection; no Home Assistant imports."""
from datetime import datetime, timedelta, timezone
import re

CONDITIONS = {
    "sunny": "sun", "clear-night": "off", "partlycloudy": "partlycloudy",
    "cloudy": "clouds", "fog": "clouds", "rainy": "rain_clouds",
    "pouring": "rain_clouds", "lightning-rainy": "rain_clouds",
    "snowy": "snow_clouds", "snowy-rainy": "snow_clouds", "hail": "rain_clouds",
    "windy": "off", "windy-variant": "clouds", "lightning": "clouds",
    "exceptional": "off",
}
RESERVED_ROUTES = {"config", "profile", "developer-tools", "history", "logbook", "energy",
                   "map", "calendar", "todo", "media-browser", "auth", "onboarding", "settings",
                   "editor", "lovelace-editor"}


def normalize_dashboard(value):
    """Accept dashboard URL paths, not hostnames, nested views or system panels."""
    route = str(value).strip().strip("/")
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", route) or route in RESERVED_ROUTES:
        raise ValueError("invalid_dashboard")
    return route


def effect_for_condition(condition, is_daytime=None):
    """Never display sun for a known nighttime forecast."""
    effect = CONDITIONS.get(condition, "off")
    if is_daytime is False and effect in ("sun", "partlycloudy"):
        return "clouds" if effect == "partlycloudy" else "off"
    return effect


def parse_time(value):
    if not isinstance(value, str):
        return None
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return stamp.astimezone(timezone.utc) if stamp.tzinfo else None
    except ValueError:
        return None


def select_weather(current, forecasts, offset, now, current_is_daytime=None):
    """Pick nearest hourly point within 90 minutes; never extrapolate outside coverage.

    Returns (effect, source, condition, forecast_time). Missing/unknown forecast
    conditions cause an explicit current-state fallback, not arbitrary sunshine.
    """
    fallback = (effect_for_condition(current, current_is_daytime), "current", current, None)
    if not offset:
        return fallback
    points = []
    for item in forecasts or []:
        if not isinstance(item, dict):
            continue
        stamp = parse_time(item.get("datetime"))
        if stamp is not None:
            points.append((stamp, item))
    target = now + timedelta(hours=offset)
    if not points or target < min(p[0] for p in points) or target > max(p[0] for p in points):
        return (fallback[0], "fallback_current", current, None)
    stamp, item = min(points, key=lambda p: abs((p[0] - target).total_seconds()))
    condition = item.get("condition")
    if abs((stamp - target).total_seconds()) > 90 * 60 or condition not in CONDITIONS:
        return (fallback[0], "fallback_current", current, None)
    return (effect_for_condition(condition, item.get("is_daytime")), "forecast", condition, stamp.isoformat())
