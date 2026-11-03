"""Create translation files and a reproducible manual-install archive. No dependencies."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "weather_effects"

LABELS = {
    "en": {
        "name": "Profile name", "enabled": "Enable effects", "dashboards": "Selected dashboards",
        "mode": "Mode", "effect": "Manual effect", "weather_entity": "Weather entity",
        "enable_entity": "Optional enable switch", "forecast_offset": "Forecast offset",
        "speed": "Speed multiplier", "size": "Size multiplier", "density": "Particle count / cloud density",
        "opacity": "Opacity", "wind": "Wind (negative = left)",
        "respect_reduced_motion": "Respect device reduced-motion preference", "max_fps": "Maximum frames per second",
    },
    "hr": {
        "name": "Naziv profila", "enabled": "Uključi efekte", "dashboards": "Odabrani dashboardi",
        "mode": "Način rada", "effect": "Efekt u ručnom načinu", "weather_entity": "Weather entitet",
        "enable_entity": "Neobavezni prekidač za uključivanje", "forecast_offset": "Pomak prognoze u budućnost",
        "speed": "Brzina (množitelj)", "size": "Veličina (množitelj)", "density": "Broj čestica / gustoća oblaka",
        "opacity": "Neprozirnost", "wind": "Vjetar (negativno = ulijevo)",
        "respect_reduced_motion": "Poštuj postavku smanjenog kretanja uređaja", "max_fps": "Najveći broj sličica u sekundi",
    },
}
DESCRIPTIONS = {
    "en": {
        "dashboards": "Select dashboards or enter their URL path, e.g. lovelace or dashboard-home. No full URL, leading slash or view path. Effects never appear in settings.",
        "weather_entity": "Required only in automatic mode. Suggested entity: weather.forecast_work_work.",
        "enable_entity": "Optional: select input_boolean.christmasmode or another switch. Effects run only while it is on. Clear this field to stop using it.",
        "forecast_offset": "0 = current conditions; +1 to +72 = nearest hourly forecast. Outside forecast coverage or on errors, fall back to current conditions (see diagnostic sensor).",
        "effect": "Used in manual mode only. Automatic mode chooses effects from the weather entity.",
        "respect_reduced_motion": "Pause effects if your browser or operating system requests reduced motion. Turn off only if you want to override that preference.",
    },
    "hr": {
        "dashboards": "Odaberi dashboarde ili upiši njihov URL put, npr. lovelace ili dashboard-home. Bez pune adrese, početne kose crte i putanje prikaza. Efekti se ne prikazuju u postavkama.",
        "weather_entity": "Obavezno samo u automatskom načinu. Predloženi entitet: weather.forecast_work_work.",
        "enable_entity": "Neobavezno: odaberi input_boolean.christmasmode ili drugi prekidač. Efekti tada rade samo dok je uključen. Isprazni polje za uklanjanje uvjeta.",
        "forecast_offset": "0 = trenutačno vrijeme; +1 do +72 = najbliža satna prognoza. Izvan raspona prognoze ili kod greške koristi se trenutačno stanje (vidi dijagnostički senzor).",
        "effect": "Koristi se samo u ručnom načinu. Automatski način bira efekt prema vremenskom entitetu.",
        "respect_reduced_motion": "Zaustavi efekte ako uređaj ili preglednik traži smanjeno kretanje. Isključi samo ako želiš zanemariti tu postavku.",
    },
}
ERRORS = {
    "en": {"dashboard_required": "Select at least one dashboard.", "invalid_dashboard": "Enter a dashboard URL path, not a full URL, view path or settings panel.", "name_required": "Enter a profile name.", "weather_required": "Select a weather entity for automatic mode.", "entity_missing": "This entity does not exist or has the wrong domain."},
    "hr": {"dashboard_required": "Odaberi barem jedan dashboard.", "invalid_dashboard": "Upiši URL put dashboarda, ne punu adresu, prikaz ili stranicu postavki.", "name_required": "Upiši naziv profila.", "weather_required": "Odaberi weather entitet za automatski način.", "entity_missing": "Entitet ne postoji ili nije odgovarajuće vrste."},
}


def translations():
    for lang, labels in LABELS.items():
        form = {"title": "Weather Effects", "data": labels, "data_description": DESCRIPTIONS[lang]}
        form["description"] = ("Choose where and how weather effects appear. All options can be changed later."
                               if lang == "en" else "Odaberi gdje i kako se prikazuju vremenski efekti. Sve postavke možeš kasnije promijeniti.")
        effects = dict(zip(("off", "snow", "rain", "sun", "clouds", "partlycloudy", "rain_clouds", "snow_clouds"),
                           ("Off", "Snow", "Rain", "Sun", "Clouds", "Sun and clouds", "Rain and clouds", "Snow and clouds") if lang == "en" else
                           ("Isključeno", "Snijeg", "Kiša", "Sunce", "Oblaci", "Sunce i oblaci", "Kiša i oblaci", "Snijeg i oblaci")))
        content = {"title": "Weather Effects", "config": {"step": {"user": form}, "error": ERRORS[lang]},
                   "options": {"step": {"init": form}, "error": ERRORS[lang]},
                   "selector": {"mode": {"options": {"manual": "Manual" if lang == "en" else "Ručno", "automatic": "Automatic" if lang == "en" else "Automatski"}},
                                "effect": {"options": effects}}}
        target = COMPONENT / "translations" / f"{lang}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(content, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        if lang == "en":
            (COMPONENT / "strings.json").write_text(json.dumps(content, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def archive():
    output = ROOT / "dist" / "weather-effects-0.1.0.zip"
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED) as bundle:
        for path in sorted(COMPONENT.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
                bundle.write(path, path.relative_to(ROOT).as_posix())
        for name in ("README.md", "LICENSE"):
            path = ROOT / name
            if path.exists():
                bundle.write(path, name)
    print(output)


if __name__ == "__main__":
    translations()
    archive()
