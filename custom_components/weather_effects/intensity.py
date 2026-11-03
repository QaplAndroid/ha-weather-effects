"""Pure measurement normalization and conservative weather adaptation."""
import math
from .const import NUMBER_CONTROLS
from .logic import parse_time

PRECIP_EFFECTS = {"rain", "rain_clouds", "snow", "snow_clouds", "hail", "sleet", "downpour", "storm"}
WIND_EFFECTS = {"wind", "wind_clouds"}


def numeric(value):
    if type(value) not in (int, float):
        return None
    try:
        return float(value) if math.isfinite(value) else None
    except OverflowError:
        return None


def clamp(value, low=0, high=1):
    return max(low, min(high, value))


def unit(value):
    return str(value or "").lower().replace("°", "").replace(" ", "")


def temperature(value, units):
    value = numeric(value)
    if value is None:
        return None
    units = unit(units)
    if units in {"c", "celsius"}:
        converted = value
    elif units in {"f", "fahrenheit"}:
        converted = numeric((value - 32) / 1.8)
    elif units in {"k", "kelvin"}:
        converted = numeric(value - 273.15)
    else:
        return None
    # Reject provider corruption and physically nonsensical outdoor readings.
    return converted if converted is not None and -100 <= converted <= 70 else None


def wind_speed(value, units):
    value = numeric(value)
    factor = {"km/h": 1, "kmh": 1, "kph": 1, "m/s": 3.6, "mph": 1.609344,
              "kn": 1.852, "kt": 1.852, "kts": 1.852, "knots": 1.852}.get(unit(units))
    return numeric(value * factor) if value is not None and value >= 0 and factor else None


def precipitation(value, units, hourly=False):
    value = numeric(value)
    factors = {"mm/h": 1, "mm/hr": 1, "in/h": 25.4, "in/hr": 25.4}
    if hourly:
        factors.update({"mm": 1, "in": 25.4, "inch": 25.4, "inches": 25.4})
    factor = factors.get(unit(units))
    return numeric(value * factor) if value is not None and value >= 0 and factor else None


def nearest_hourly(rows, now):
    """Nearest valid timestamp within 90 minutes, for current rain estimate only."""
    points = [(parse_time(row.get("datetime")), row) for row in rows if isinstance(row, dict)]
    points = [(stamp, row) for stamp, row in points if stamp is not None]
    if not points:
        return None
    stamp, row = min(points, key=lambda pair: abs((pair[0] - now).total_seconds()))
    return row if abs((stamp - now).total_seconds()) <= 5400 else None


def weather_metrics(measurements, metadata, *, hourly=False, rain_row=None):
    """Read only selected measurements; metadata supplies units, never readings.

    Current generic precipitation is deliberately NOT interpreted as an hourly
    rate. Hourly forecast precipitation is an amount for its one-hour interval.
    """
    measurements = measurements or {}
    metadata = metadata or {}
    units = {**metadata, **{key: value for key, value in measurements.items() if key.endswith("_unit")}}
    cloud = numeric(measurements.get("cloud_coverage"))
    rain = precipitation(measurements.get("precipitation_rate"), units.get("precipitation_rate_unit"))
    source = "hourly_forecast" if hourly else "current_rate"
    if rain is None and hourly:
        rain = precipitation(measurements.get("precipitation"), units.get("precipitation_unit"), True)
    if rain is None and not hourly and rain_row is not None:
        rain_units = rain_row.get("precipitation_unit", metadata.get("precipitation_unit"))
        rain = precipitation(rain_row.get("precipitation"), rain_units, True)
        if rain is None:
            rain = precipitation(rain_row.get("precipitation_rate"), rain_row.get("precipitation_rate_unit", metadata.get("precipitation_rate_unit")))
        source = "hourly_forecast"
    return {
        "temperature_c": temperature(measurements.get("temperature"), units.get("temperature_unit")),
        "cloud_coverage": clamp(cloud, 0, 100) if cloud is not None else None,
        "precipitation_mm_h": rain,
        "wind_kmh": wind_speed(measurements.get("wind_speed"), units.get("wind_speed_unit")),
        "precipitation_source": source if rain is not None else None,
    }


def adapt(preset, effect, metrics, enabled, heat_threshold):
    """Return effective flat values and intensities; never mutate the base preset."""
    result = dict(preset)
    intensity = {"heat": 0, "cloud": None, "rain": None, "wind": None}
    if not enabled:
        return result, intensity
    temp, cloud, rain, wind = (metrics[key] for key in ("temperature_c", "cloud_coverage", "precipitation_mm_h", "wind_kmh"))
    if temp is not None and effect in {"sun", "partlycloudy"}:
        intensity["heat"] = clamp((temp - heat_threshold) / 12)
    if cloud is not None:
        intensity["cloud"] = clamp(cloud / 100)
    if rain is not None:
        ratio = intensity["rain"] = clamp(rain / 12)
        if effect in PRECIP_EFFECTS:
            result["density"] *= .45 + 2.1 * ratio
            result["speed"] *= .75 + .8 * ratio
            result["opacity"] *= .8 + .2 * ratio
    if wind is not None:
        ratio = intensity["wind"] = clamp((wind - 8) / 62)
        result["wind"] = (-1 if preset["wind"] < 0 else 1) * max(abs(preset["wind"]), 2 * ratio)
        if effect in WIND_EFFECTS:
            result["speed"] *= 1 + .35 * ratio
    for key, value in result.items():
        low, high, _ = NUMBER_CONTROLS[key]
        result[key] = clamp(value, low, high)
    return result, intensity
