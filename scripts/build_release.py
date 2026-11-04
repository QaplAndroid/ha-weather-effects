"""Create translation files and a reproducible manual-install archive. No dependencies."""
import json
import runpy
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
        "cloud_top": "Top of cloud-center band (%)", "cloud_bottom": "Bottom of cloud-center band (%)", "cloud_spread": "Cloud spread (%)",
        "respect_reduced_motion": "Respect device reduced-motion preference", "max_fps": "Maximum frames per second",
        "settings_effect": "Component editing target (compatibility)", "adaptive_weather": "Adapt intensity to weather data",
        "heat_threshold": "Heat threshold (°C)", "lightning_enabled": "Enable lightning effects (photosensitivity warning)",
        "lightning_interval": "Minimum lightning interval (seconds)", "lightning_brightness": "Lightning wash brightness",
        "lightning_bolt_enabled": "Draw the growing lightning bolt", "lightning_flash_enabled": "Enable screen flash",
        "lightning_formation_time": "Bolt formation time (seconds; lower = faster)",
        "lightning_duration": "Bolt fade duration (seconds)", "lightning_branches": "Number of side branches",
        "lightning_thickness": "Bolt thickness (px)", "lightning_glow": "Bolt glow", "lightning_length": "Bolt length (fraction of screen height)",
    },
    "hr": {
        "name": "Naziv profila", "enabled": "Uključi efekte", "dashboards": "Odabrani dashboardi",
        "mode": "Način rada", "effect": "Efekt u ručnom načinu", "weather_entity": "Weather entitet",
        "enable_entity": "Neobavezni prekidač za uključivanje", "forecast_offset": "Pomak prognoze u budućnost",
        "speed": "Brzina (množitelj)", "size": "Veličina (množitelj)", "density": "Broj čestica / gustoća oblaka",
        "opacity": "Neprozirnost", "wind": "Vjetar (negativno = ulijevo)",
        "cloud_top": "Gornja granica središta oblaka (%)", "cloud_bottom": "Donja granica središta oblaka (%)", "cloud_spread": "Raspršenost oblaka (%)",
        "respect_reduced_motion": "Poštuj postavku smanjenog kretanja uređaja", "max_fps": "Najveći broj sličica u sekundi",
        "settings_effect": "Ciljna komponenta (kompatibilnost)", "adaptive_weather": "Prilagodi intenzitet vremenskim podacima",
        "heat_threshold": "Prag vrućine (°C)", "lightning_enabled": "Uključi efekte munja (upozorenje na fotosenzitivnost)",
        "lightning_interval": "Najkraći razmak munja (sekunde)", "lightning_brightness": "Svjetlina bljeska munje",
        "lightning_bolt_enabled": "Prikaži munju koja se grana", "lightning_flash_enabled": "Uključi bljesak zaslona",
        "lightning_formation_time": "Vrijeme nastajanja munje (sekunde; manje = brže)",
        "lightning_duration": "Trajanje nestajanja munje (sekunde)", "lightning_branches": "Broj bočnih grana",
        "lightning_thickness": "Debljina munje (px)", "lightning_glow": "Sjaj munje", "lightning_length": "Duljina munje (udio visine zaslona)",
    },
}
DESCRIPTIONS = {
    "en": {
        "dashboards": "Select dashboards or enter their URL path, e.g. lovelace or dashboard-home. No full URL, leading slash or view path. Effects never appear in settings.",
        "weather_entity": "Required only in automatic mode. Suggested entity: weather.forecast_work_work.",
        "enable_entity": "Optional: select input_boolean.christmasmode or another switch. Effects run only while it is on. Clear this field to stop using it.",
        "forecast_offset": "0 = current conditions; +1 to +72 = nearest hourly forecast. Outside forecast coverage or on errors, fall back to current conditions (see diagnostic sensor).",
        "effect": "Used in manual mode only. Automatic mode chooses effects from the weather entity.",
        "cloud_top": "Default cloud-center upper limit (0 = top of screen). Shared Clouds overrides are on the Clouds tab. Must not exceed the lower limit; sprites may extend beyond the center band.",
        "cloud_bottom": "Default cloud-center lower limit (100 = bottom of screen). Raise this first to allow clouds lower down. Must be at least the upper limit.",
        "cloud_spread": "Default spacing: 0 = random placement, 100 = stronger distribution and coherent drift. Very large/dense clouds can still overlap. Fog is separate.",
        "respect_reduced_motion": "Pause effects if your device requests reduced motion. Lightning is ALWAYS disabled by reduced motion, even if this switch is off.",
        "adaptive_weather": "Automatic mode only: adapt to available temperature, cloud coverage, rainfall and wind. Missing values keep the saved preset; rainfall may be an hourly forecast estimate.",
        "heat_threshold": "Above this Celsius temperature, sunny effects gain a warmer glow and subtle heat haze.",
        "lightning_enabled": "Warning: flashing light can affect photosensitive users. Off by default. Enable explicitly for storm effects; never active with reduced motion.",
        "lightning_interval": "One lightning event at most per interval across profiles. Minimum 5 seconds, extended if needed to finish the animation plus a pause; no repeated strobe bursts.",
        "lightning_brightness": "Maximum screen-wash alpha, capped at 0.25. Only used if screen flash is enabled. The bolt itself has separate glow/thickness.",
        "lightning_bolt_enabled": "Independent visible bolt switch; the master must also be enabled. Turning off screen flash still allows slow bolt formation.",
        "lightning_flash_enabled": "Photosensitivity warning: adds one brief screen-light pulse at the completed strike, not during leader formation. Master consent is still required.",
        "lightning_formation_time": "0.1–3 seconds for the main leader to form. Lower is faster; side branches appear only after the leader reaches them.",
        "lightning_duration": "0.3–2 seconds for the completed bolt to fade. Screen flash stays brief and does not follow this fade duration.",
        "lightning_branches": "0–8 bounded side branches. Zero leaves only the main bolt.",
        "lightning_thickness": "Width of the bright bolt core in CSS pixels, 0.5–4.",
        "lightning_glow": "Soft outer glow, 0–1; it does not change screen-flash brightness.",
        "lightning_length": "Main bolt reach as a fraction of screen height: 0.2–0.9, default 0.6.",
        **{key: "Legacy/default fallback for components without saved settings. Each card tab edits its shared component in every weather combination." for key in ("speed", "size", "density", "opacity", "wind")},
    },
    "hr": {
        "dashboards": "Odaberi dashboarde ili upiši njihov URL put, npr. lovelace ili dashboard-home. Bez pune adrese, početne kose crte i putanje prikaza. Efekti se ne prikazuju u postavkama.",
        "weather_entity": "Obavezno samo u automatskom načinu. Predloženi entitet: weather.forecast_work_work.",
        "enable_entity": "Neobavezno: odaberi input_boolean.christmasmode ili drugi prekidač. Efekti tada rade samo dok je uključen. Isprazni polje za uklanjanje uvjeta.",
        "forecast_offset": "0 = trenutačno vrijeme; +1 do +72 = najbliža satna prognoza. Izvan raspona prognoze ili kod greške koristi se trenutačno stanje (vidi dijagnostički senzor).",
        "effect": "Koristi se samo u ručnom načinu. Automatski način bira efekt prema vremenskom entitetu.",
        "cloud_top": "Početna gornja granica središta oblaka (0 = vrh zaslona). Zajedničke vrijednosti uređuju se na tabu Oblaci. Ne smije prijeći donju granicu; rubovi oblaka mogu izlaziti izvan pojasa središta.",
        "cloud_bottom": "Početna donja granica središta oblaka (100 = dno zaslona). Najprije povećaj ovu vrijednost za oblake niže na zaslonu. Mora biti barem kao gornja granica.",
        "cloud_spread": "Početni raspored: 0 = slučajno, 100 = jače raspoređivanje i usklađeno kretanje. Vrlo veliki/gusti oblaci i dalje se mogu preklapati. Magla je zasebna.",
        "respect_reduced_motion": "Zaustavi efekte ako uređaj traži smanjeno kretanje. Munje su UVIJEK isključene uz smanjeno kretanje, čak i ako je ovaj prekidač isključen.",
        "adaptive_weather": "Samo automatski način: koristi dostupnu temperaturu, naoblaku, oborinu i vjetar. Za nedostupne vrijednosti ostaje spremljeni profil; oborina može biti procjena satne prognoze.",
        "heat_threshold": "Iznad ove temperature u °C sunčani efekti dobivaju topliji sjaj i blago titranje vrućine.",
        "lightning_enabled": "Upozorenje: bljeskovi mogu smetati fotosenzitivnim osobama. Zadano isključeno. Izričito uključi za grmljavinu; ne rade uz smanjeno kretanje.",
        "lightning_interval": "Najviše jedna munja po razmaku kroz sve profile. Najmanje 5 sekundi; produljuje se ako treba završiti animaciju i stanku. Bez nizova brzih bljeskova.",
        "lightning_brightness": "Najveća neprozirnost bljeska, ograničena na 0,25. Koristi se samo ako je bljesak uključen. Munja ima zasebni sjaj i debljinu.",
        "lightning_bolt_enabled": "Zaseban prekidač vidljive munje; glavni prekidač mora biti uključen. Munja se može polako stvarati i bez bljeska zaslona.",
        "lightning_flash_enabled": "Upozorenje na fotosenzitivnost: jedan kratak svjetlosni puls na kraju formiranja, ne tijekom nastajanja. Potreban je i glavni pristanak.",
        "lightning_formation_time": "0,1–3 sekunde za nastajanje glavne munje. Manje znači brže; bočne grane rastu tek kad glavna munja dođe do njih.",
        "lightning_duration": "0,3–2 sekunde za nestajanje dovršene munje. Bljesak zaslona i dalje ostaje kratak i ne prati ovo trajanje.",
        "lightning_branches": "0–8 bočnih grana. Nula ostavlja samo glavnu munju.",
        "lightning_thickness": "Debljina svijetle jezgre munje u CSS pikselima, 0,5–4.",
        "lightning_glow": "Meki vanjski sjaj, 0–1; ne mijenja svjetlinu bljeska zaslona.",
        "lightning_length": "Doseg glavne munje kao udio visine zaslona: 0,2–0,9, zadano 0,6.",
        **{key: "Početna/zamjenska vrijednost za komponente bez posebnih postavki. Svaki tab kartice uređuje svoju zajedničku komponentu u svim kombinacijama." for key in ("speed", "size", "density", "opacity", "wind")},
    },
}
ERRORS = {
    "en": {"dashboard_required": "Select at least one dashboard.", "invalid_dashboard": "Enter a dashboard URL path, not a full URL, view path or settings panel.", "name_required": "Enter a profile name.", "weather_required": "Select a weather entity for automatic mode.", "entity_missing": "This entity does not exist or has the wrong domain.", "invalid_number": "Enter a finite number within the allowed range and step.", "invalid_boolean": "Choose an on/off value.", "invalid_cloud_bounds": "The top cloud-center limit must not exceed the bottom limit."},
    "hr": {"dashboard_required": "Odaberi barem jedan dashboard.", "invalid_dashboard": "Upiši URL put dashboarda, ne punu adresu, prikaz ili stranicu postavki.", "name_required": "Upiši naziv profila.", "weather_required": "Odaberi weather entitet za automatski način.", "entity_missing": "Entitet ne postoji ili nije odgovarajuće vrste.", "invalid_number": "Upiši konačan broj unutar dopuštenog raspona i koraka.", "invalid_boolean": "Odaberi uključeno ili isključeno.", "invalid_cloud_bounds": "Gornja granica središta oblaka ne smije prijeći donju granicu."},
}


def translations():
    definitions = runpy.run_path(str(COMPONENT / "const.py"))
    for lang, labels in LABELS.items():
        form = {"title": "Weather Effects", "data": labels, "data_description": DESCRIPTIONS[lang]}
        form["description"] = ("Choose where and how weather effects appear. All options can be changed later."
                               if lang == "en" else "Odaberi gdje i kako se prikazuju vremenski efekti. Sve postavke možeš kasnije promijeniti.")
        effects = dict(zip(("off", "snow", "rain", "sun", "clouds", "partlycloudy", "rain_clouds", "snow_clouds",
                            "fog", "wind", "wind_clouds", "night", "night_clouds", "hail", "sleet", "downpour", "storm", "storm_clouds"),
                           ("Off", "Snow", "Rain", "Sun", "Clouds", "Sun and clouds", "Rain and clouds", "Snow and clouds",
                            "Fog", "Wind", "Wind and clouds", "Clear night", "Moon and clouds", "Hail", "Sleet", "Heavy rain",
                            "Thunderstorm", "Storm clouds") if lang == "en" else
                           ("Isključeno", "Snijeg", "Kiša", "Sunce", "Oblaci", "Sunce i oblaci", "Kiša i oblaci", "Snijeg i oblaci",
                            "Magla", "Vjetar", "Vjetar i oblaci", "Vedra noć", "Mjesec i oblaci", "Tuča", "Susnježica", "Pljusak",
                            "Grmljavinsko nevrijeme", "Olujni oblaci")))
        content = {"title": "Weather Effects", "config": {"step": {"user": form}, "error": ERRORS[lang]},
                   "options": {"step": {"init": form}, "error": ERRORS[lang]},
                   "selector": {"mode": {"options": {"manual": "Manual" if lang == "en" else "Ručno", "automatic": "Automatic" if lang == "en" else "Automatski"}},
                                "effect": {"options": effects}, "settings_effect": {"options": effects}}}
        content["entity"] = {
            "switch": {key: {"name": labels[key]} for key in definitions["SWITCH_CONTROLS"]},
            "select": {
                "mode": {"name": labels["mode"], "state": content["selector"]["mode"]["options"]},
                "effect": {"name": labels["effect"], "state": effects},
                "settings_effect": {"name": labels["settings_effect"], "state": effects},
            },
            "number": {key: {"name": labels[key]} for key in definitions["NUMBER_CONTROLS"]},
        }
        target = COMPONENT / "translations" / f"{lang}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(content, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        if lang == "en":
            (COMPONENT / "strings.json").write_text(json.dumps(content, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def archive():
    version = json.loads((COMPONENT / "manifest.json").read_text(encoding="utf-8"))["version"]
    output = ROOT / "dist" / f"weather-effects-{version}.zip"
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
