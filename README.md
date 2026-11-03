# Weather Effects — Home Assistant

Snijeg, kiša, sunce i oblaci kao animirani sloj preko **odabranih dashboarda**. Vlastita integracija (custom component), nije Supervisor add-on. Bez HTML kartice, card_mod-a, Lovelace resursa i ručnog uređivanja dashboard YAML-a.

**Verzija 0.1.0 — prva verzija za provjeru na stvarnom Home Assistantu.** Kod i simulacije provjereni su lokalno; nije pokrenut stvarni Home Assistant niti provjerena instalacija na tvojoj instanci. Ciljane API mogućnosti: HA 2025.6+ (`async_register_static_paths`, options flow, `weather.get_forecasts`). Kompatibilnost svake HA verzije nije potvrđena.

## Instalacija kroz HACS (custom repository)

Projekt nije u službenom HACS katalogu. Možeš ga dodati kao vlastiti repozitorij:

1. U HACS-u otvori izbornik (tri točke) → **Custom repositories**.
2. Dodaj `https://github.com/QaplAndroid/ha-weather-effects`, kategorija **Integration**.
3. Pronađi **Weather Effects** i odaberi **Download**.
4. Ponovno pokreni Home Assistant.
5. Otvori **Postavke → Uređaji i usluge → Dodaj integraciju → Weather Effects**.
6. Odaberi dashboarde i weather entitet te osvježi preglednik.

HACS instalaciju također treba potvrditi na stvarnoj instanci; lokalni testovi ne provjeravaju HACS ni Home Assistant runtime.

## Ručna instalacija (alternativa)

1. Preuzmi `weather-effects-0.1.0.zip` sa stranice [Releases](https://github.com/QaplAndroid/ha-weather-effects/releases) i raspakiraj ga na računalu.
2. Kopiraj njegovu mapu `custom_components/weather_effects` u HA konfiguracijsku mapu, tako da dobiješ `/config/custom_components/weather_effects/manifest.json`. Ako `custom_components` već postoji, kopiraj samo podmapu `weather_effects` u njega. Nemoj prepisivati druge integracije.
   - Koristi npr. Samba share ili Studio Code Server. Konfiguracijska mapa je ista ona u kojoj se nalazi `configuration.yaml`; na Container/Core instalaciji može biti na drugoj host putanji.
3. **Ponovno pokreni Home Assistant**, ne samo ponovno učitaj YAML.
4. Otvori **Postavke → Uređaji i usluge → Dodaj integraciju → Weather Effects**.
5. Unesi postavke iz sljedećeg odjeljka i spremi.
6. Osvježi preglednik. U Companion aplikaciji po potrebi potpuno zatvori i ponovno otvori prikaz ili očisti frontend cache. Integracija sama registrira JS modul; nemoj ga dodatno dodavati među dashboard resurse.
7. Kad potvrdiš da nova integracija radi, ukloni staru conditional/html-card karticu s pahuljicama da se efekti ne udvostručuju. `html-card`/`card_mod` ne moraš uklanjati ako ih koristiš drugdje.

Nakon instalacije sve je podesivo kroz **Weather Effects → Konfiguriraj**. Promjene se šalju otvorenim preglednicima bez ponovnog pokretanja HA-a.

## Preporučene prve postavke

- **Naziv:** Weather Effects.
- **Uključi efekte:** uključeno.
- **Dashboardi:** odaberi stvarni dashboard iz popisa (npr. Overview). Nemoj pretpostaviti da se svaki zove `lovelace`.
- **Način rada:** prvo **Ručno**, efekt **Snijeg** za provjeru; poslije **Automatski**.
- **Weather entitet:** `weather.forecast_work_work`.
- **Neobavezni prekidač:** ostavi prazno za početak. Za postojeće ponašanje odaberi `input_boolean.christmasmode`; tada efekti rade samo kad je on uključen. To je glavni uvjet i u automatskom načinu, ne posebna božićna prečica.
- **Pomak:** 0 h za trenutačno stanje, npr. 3 h za prognozu.
- Brzina 1, veličina 1, gustoća 60, neprozirnost 0,65, vjetar 0,2, 30 FPS.

### Dashboardi

Popis se puni iz registriranih Lovelace dashboarda. Ako neki nije na popisu, možeš upisati njegov **URL put**, npr. `dashboard-tablet` za `https://ha.example/dashboard-tablet/prizemlje`. Ne upisuj domenu ni put prikaza. Efekti vrijede za sve prikaze odabranog dashboarda, na svim prijavljenim uređajima.

Sloj je proziran za klikove i dodire, nije zasebna kartica i ne zauzima mjesto u gridu. Ne prikazuje se u HA postavkama ni drugim sistemskim panelima. Skriva se i za URL s parametrom `edit`; detekcija svakog internog načina uređivanja kroz sve HA verzije nije zajamčena. Dialoge i menije HA obično prikazuje iznad sloja.

Moguće je dodati više instanci integracije za zasebne postavke različitih dashboarda. Ako dvije instance ciljaju isti dashboard, njihovi efekti se kombiniraju.

## Ručno i automatski

Ručno: Isključeno, Snijeg, Kiša, Sunce, Oblaci, Sunce i oblaci, Kiša i oblaci, Snijeg i oblaci.

Automatski:

| HA vremensko stanje | Prikaz |
| --- | --- |
| sunny | Sunce |
| clear-night | Bez efekta |
| partlycloudy | Sunce i oblaci; samo oblaci kada je poznato da je noć |
| cloudy, fog, windy-variant, lightning | Oblaci |
| rainy, pouring, lightning-rainy, hail | Kiša i oblaci |
| snowy, snowy-rainy | Snijeg i oblaci |
| windy, exceptional, nepoznato stanje | Bez efekta |

Ovo su stilizirani efekti, ne meteorološka simulacija: magla je predstavljena oblacima, tuča kišom, a susnježica snijegom. Nema bljeskanja munja. Trenutačni `sun.sun`, ako postoji, služi samo za izbjegavanje sunca noću kod trenutačnog stanja. Buduća prognoza koristi vlastiti `is_daytime` ako ga pružatelj daje, nikad današnje stanje sunca za budući sat.

### Vremenski pomak i nedostupni podaci

- **0 h:** koristi stanje `weather` entiteta. To nije nužno stvarno mjerenje ispred kuće.
- **1–72 h:** traži satnu prognozu preko `weather.get_forecasts`. Bira vremenski najbližu točku, bez interpoliranja kategorija vremena; maksimalna razlika je 90 minuta i cilj mora biti unutar raspona prognoze.
- Ako nema satne prognoze, cilj je izvan raspona, odgovor je neispravan ili zahtjev ne uspije: vraća se na trenutačno stanje, sa statusom `forecast_fallback`.
- Ako su i trenutačni podaci nedostupni, efekti se isključuju. Ne koristi se nasumično vrijeme.
- Prognoza se dohvaća najviše svakih 15 minuta po profilu (i pri promjeni postavki). Ponovni izračun radi svakih 5 minuta te nakon promjene vremenskog entiteta/prekidača. Izvor vremena ima svoj zaseban interval osvježavanja.
- Vremena se uspoređuju kao vremenski osviješteni UTC trenuci; pomak znači protekle sate, uključujući promjenu ljetnog/zimskog računanja vremena.

## Status i rješavanje problema

Integracija stvara dijagnostički senzor **Effect** pod svojim uređajem. ID određuje HA; pogledaj ga na stranici uređaja. Vrijednost je efekt koji integracija šalje preglednicima (ne potvrda da je trenutno vidljiv na ovom uređaju).

Atributi: `status` (`ok`, `forecast_fallback`, `weather_unavailable`, `enable_entity_unavailable`), `source` (`manual`, `current`, `forecast`, `fallback_current`), `forecast_time`, `condition`, odabrani dashboardi i vremenski entitet.

Ako se ništa ne vidi:

1. Provjeri da si na odabranom dashboardu i osvježi preglednik nakon prve instalacije.
2. Provjeri glavni prekidač i opcionalni `input_boolean`. Nepostojeći/nedostupan prekidač sigurno isključuje efekte.
3. Za provjeru odaberi ručni snijeg, bez uvjetnog prekidača.
4. Uređaji s postavkom **smanjenog kretanja** po zadanim postavkama nemaju animacije. Ako ih želiš, svjesno isključi opciju „Poštuj postavku smanjenog kretanja”.
5. U automatskom načinu vedra noć i određena druga stanja namjerno nemaju efekt.
6. Ako integracija nije na popisu, provjeri putanju, restart i **Postavke → Sustav → Zapisi**, pretraga `weather_effects`.
7. Ako prognoza pada na trenutačno stanje, provjeri podržava li odabrani weather entitet satnu prognozu. Met.no to podržava.

Animacije se zaustavljaju u skrivenoj kartici preglednika i na neodabranim stranicama. Pixel ratio ograničen je na 2, broj čestica na 800 ukupno, s podesivih 15–60 FPS. Za tablet preporuka 30 FPS i umjerena gustoća. Podaci ne idu na dodatni vanjski servis: integracija čita postojeći HA entitet. Pristup postavkama u frontend modulu koristi autentificiranu HA WebSocket vezu.

## Ažuriranje i uklanjanje

Ažuriranje: zamijeni samo mapu integracije, restartaj HA i osvježi preglednik. Pri promjeni JS-a podigni verziju u `const.py` i `manifest.json` (URL uključuje verziju radi cachea).

Uklanjanje: prvo ukloni sve instance kroz Uređaje i usluge. Efekti se gase u otvorenim preglednicima. Zatim obriši samo mapu integracije, restartaj HA i osvježi klijente. Dormantni modul u već otvorenom klijentu ostaje do osvježenja, bez aktivne animacije.

## Lokalna provjera i izrada paketa

Bez instalacije HA-a, vanjskih Python paketa ili npm ovisnosti:

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
node --test --test-isolation=none tests/frontend.test.mjs
python -m compileall -q custom_components scripts tests
python scripts/build_release.py
```

Python testovi vremenske logike koriste stvarne datetime vrijednosti, a testovi koordinatora koriste izričite HA simulacije. JS testovi koriste simulirani DOM/canvas/vezu. Ovo **nije** zamjena za test instalacije i prikaza na HA-u.

Prije korištenja potvrdi na svojoj instanci: instalaciju i formu, ručni snijeg, sva četiri efekta, promjenu dashboarda → postavke, dodir kartica, `christmasmode` on/off, automatsko vrijeme, +3 h, nedostupnu prognozu, ponovno povezivanje te Companion prikaz.

Repozitorij: [QaplAndroid/ha-weather-effects](https://github.com/QaplAndroid/ha-weather-effects). Pripremljen je za dodavanje kao HACS custom repository, ne predstavlja službeno uvrštenje ili certifikaciju HACS-a. Izbornik i opis postavki dostupni su na hrvatskom i engleskom.
