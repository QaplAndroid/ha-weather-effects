# Weather Effects — Home Assistant

Snijeg, kiša, sunce i oblaci kao animirani sloj preko **odabranih dashboarda**. Vlastita integracija (custom component), nije Supervisor add-on. Bez HTML kartice, card_mod-a, Lovelace resursa i ručnog uređivanja dashboard YAML-a.

**Verzija 0.3.0 — prirodniji efekti, magla, vjetar i cjelovitija vremenska stanja.** Kod i simulacije provjereni su lokalno; nije pokrenut stvarni Home Assistant niti provjerena instalacija na tvojoj instanci. Ciljane API mogućnosti: HA 2025.6+ (`async_register_static_paths`, options flow, `weather.get_forecasts`). Kompatibilnost svake HA verzije nije potvrđena.

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

1. Preuzmi `weather-effects-0.3.0.zip` sa stranice [Releases](https://github.com/QaplAndroid/ha-weather-effects/releases) i raspakiraj ga na računalu.
2. Kopiraj njegovu mapu `custom_components/weather_effects` u HA konfiguracijsku mapu, tako da dobiješ `/config/custom_components/weather_effects/manifest.json`. Ako `custom_components` već postoji, kopiraj samo podmapu `weather_effects` u njega. Nemoj prepisivati druge integracije.
   - Koristi npr. Samba share ili Studio Code Server. Konfiguracijska mapa je ista ona u kojoj se nalazi `configuration.yaml`; na Container/Core instalaciji može biti na drugoj host putanji.
3. **Ponovno pokreni Home Assistant**, ne samo ponovno učitaj YAML.
4. Otvori **Postavke → Uređaji i usluge → Dodaj integraciju → Weather Effects**.
5. Unesi postavke iz sljedećeg odjeljka i spremi.
6. Osvježi preglednik. U Companion aplikaciji po potrebi potpuno zatvori i ponovno otvori prikaz ili očisti frontend cache. Integracija sama registrira JS modul; nemoj ga dodatno dodavati među dashboard resurse.
7. Kad potvrdiš da nova integracija radi, ukloni staru conditional/html-card karticu s pahuljicama da se efekti ne udvostručuju. `html-card`/`card_mod` ne moraš uklanjati ako ih koristiš drugdje.

Nakon instalacije sve je podesivo kroz **Weather Effects → Konfiguriraj**. Promjene se šalju otvorenim preglednicima bez ponovnog pokretanja HA-a.

## Kontrolni dashboard bez YAML-a (novo u 0.2.0)

Integracija sada daje **Weather Effects Control Card** koja se može dodati kroz standardni vizualni odabir kartica. Ne stvara i ne mijenja dashboarde automatski te ne dira tvoje postojeće kartice.

### Ako već imaš 0.1.0 ili 0.2.0

U HACS-u ažuriraj **Weather Effects** na 0.3.0 (po potrebi provjeri nova izdanja ili ponovno preuzmi), restartaj HA i potpuno osvježi preglednik. Ne trebaš brisati integraciju ni ponovno stvarati profil. Novi `switch`, `select` i `number` entiteti dodaju se pri pokretanju. Kod ručne instalacije zamijeni mapu integracije sadržajem novog ZIP-a.

### Dodavanje posebnog dashboarda

1. **Postavke → Dashboardi → Dodaj dashboard** i napravi prazan dashboard, npr. **Vrijeme i efekti**. Nazivi opcija malo se razlikuju po HA verziji. Omogući prikaz u bočnoj traci ako ga želiš.
2. Otvori ga → **Uredi dashboard → Dodaj karticu**.
3. Pronađi **Weather Effects Control Card**.
4. U vizualnom editoru odaberi profil integracije i, po želji, naziv kartice. Ako postoji samo jedan profil, može se odabrati automatski.
5. Spremi. Nije potrebno ručno dodavati JS u dashboard resurse.

Kartica također može stajati na bilo kojem postojećem dashboardu; ne mora biti među dashboardima na kojima padaju pahuljice. Ako želiš vidjeti efekte dok ih podešavaš, dodaj i kontrolni dashboard na popis odabranih dashboarda u konfiguraciji profila.

### Što se podešava na kartici

- Uključeno/isključeno, ručni/automatski način i ručni efekt.
- Brzina, veličina, gustoća, neprozirnost i vjetar.
- Pomak satne prognoze, najviše FPS i poštivanje smanjenog kretanja.
- Status trenutačno odabranog efekta, vremenski entitet, izvor podataka i vrijeme odabrane prognoze.

Promjene se spremaju u iste postavke profila kao kroz **Konfiguriraj**, vrijede na svim klijentima i ostaju nakon restarta. Klizači šalju promjenu pri završetku pomicanja, ne na svakom kadru. U automatskom načinu ručni odabir efekta je zaključan; prvo prebaci način na ručni. Automatski način traži prethodno odabran weather entitet.

Odabir dashboarda, weather entiteta i opcionalnog uvjetnog prekidača ostaje u **Uređaji i usluge → Weather Effects → Konfiguriraj**. Kartica ima poveznicu do integracije; za te administrativne postavke treba odgovarajuća HA dozvola.

Ako je glavni prekidač uključen, a `input_boolean.christmasmode` isključen, efekt se i dalje ne prikazuje. Kartica razlikuje spremljeno uključivanje od stvarno aktivnog efekta. Također poštuje nedostupne/isključene entitete i prikazuje greške HA poziva umjesto da prijavi lažno spremanje.

### Standardni HA entiteti i vlastiti raspored

Na uređaju profila pronaći ćeš dva `switch` entiteta (uključivanje i smanjeno kretanje), dva `select` entiteta (način i efekt), sedam `number` entiteta (pomak, brzina, veličina, gustoća, neprozirnost, vjetar, FPS) te postojeći statusni senzor. HA dodjeljuje ID-eve; kartica ih pronalazi preko registra, pa radi i nakon preimenovanja.

Ako želiš vlastiti raspored, dodaj te entitete kroz standardnu HA **Entities** ili **Tile** karticu. Mogu se koristiti i u automatizacijama. Kontrolna kartica koristi standardne `switch`, `select` i `number` akcije, s redovnim HA dozvolama korisnika.

Ako kartice nema u pretrazi, prvo provjeri da je integracija učitana, restartaj HA i potpuno osvježi/ponovno otvori klijent. Prikaz, editor i HACS ažuriranje još treba potvrditi na stvarnoj HA instanci.

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

Ručno je dostupno **18 izbora**: Isključeno, Snijeg, Kiša, Sunce, Oblaci, Sunce i oblaci, Kiša i oblaci, Snijeg i oblaci, Magla, Vjetar, Vjetar i oblaci, Vedra noć, Mjesec i oblaci, Tuča, Susnježica, Pljusak, Grmljavinsko nevrijeme (bez bljeskanja), Olujni oblaci. Stari spremljeni izbori ostaju valjani.

Automatski:

| HA vremensko stanje | Prikaz |
| --- | --- |
| sunny | Sunce; vedra noć ako je izričito poznato da je noć |
| clear-night | Dekorativni mjesec i rijetke zvijezde |
| partlycloudy | Sunce i oblaci; mjesec i oblaci kada je poznato da je noć |
| cloudy | Mekani slojeviti oblaci |
| fog | Niski, prozirni slojevi magle |
| rainy | Kiša i oblaci |
| pouring | Gušći i brži pljusak s oblacima |
| lightning-rainy | Olujni oblaci, vjetar i kiša, bez bljeskova |
| lightning | Olujni oblaci i vjetar, bez bljeskova |
| snowy | Pahuljice s oblacima |
| snowy-rainy | Susnježica: zasebne čestice kiše i snijega |
| hail | Male ledene kuglice s oblacima |
| windy | Animirane strujnice i naleti vjetra |
| windy-variant | Vjetar i oblaci |
| exceptional, nepoznato stanje | Bez efekta; ne nagađa se opasno vrijeme |

Obuhvaćena su sva standardna HA vremenska stanja. Ovo su **dekorativni, stilizirani efekti**, ne meteorološka simulacija ili sigurnosni sustav. Mjesec ne predstavlja stvarnu fazu, a vjetar nije fizički izračunat iz prognozirane brzine/smjera; koristi podesivi klizač vjetra. Za grmljavinu namjerno nema bljeskova ni zatamnjenja cijelog zaslona.

Trenutačni `sun.sun`, ako postoji, služi za razlikovanje dana/noći kod trenutačnog stanja. Buduća prognoza koristi vlastiti `is_daytime` ako ga pružatelj daje, nikad današnje stanje sunca za budući sat. Bez takvog podatka zadržava se simbol koji je dao pružatelj.

### Grafika u 0.3.0

- Mekši oblaci s teksturom i dubinom umjesto tvrdih kružnih rubova.
- Više dubinskih slojeva kiše, različite pahuljice i nježni sunčevi oreoli.
- Posebni efekti za maglu i nalete vjetra, bez neprozirnog pokrivanja kartica.
- Predmemorirane grafičke teksture, ograničen broj čestica, pauza u pozadini i poštivanje smanjenog kretanja i dalje vrijede.
- Jednaki primljeni vizualni parametri više ne pokreću animaciju ispočetka.

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
5. U automatskom načinu nepoznato ili `exceptional` stanje namjerno nema efekt. Vedra noć od 0.3.0 ima mjesec i zvijezde.
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
node --test --test-isolation=none tests/frontend.test.mjs tests/card.test.mjs
python -m compileall -q custom_components scripts tests
python scripts/build_release.py
```

### Lokalni grafički demo (bez Home Assistanta)

Iz korijena repozitorija možeš pokrenuti `python -m http.server 8000 --bind 127.0.0.1` i u pregledniku otvoriti `http://127.0.0.1:8000/demo/`. Demo prikazuje stvarni canvas renderer preko **statičnih oglednih kartica**, ne tvoj Home Assistant i ne stvarne podatke doma. Nema prijave, tokena ni vanjskih servisa. Poslužitelj zaustavi s Ctrl+C.

Ako imaš Chrome, Edge ili Chromium, opcionalni `node scripts/browser_smoke.mjs` provjerava svih 18 efekata u stvarnom headless pregledniku, prozirnost za klikove, mobilnu rezoluciju i smanjeno kretanje. Koristi novi privremeni profil, nikad postojeći korisnički profil. Put do preglednika možeš zadati varijablom `WEATHER_EFFECTS_BROWSER`. Slike i izvještaj spremaju se u `dist/visual-preview`; to nije test Home Assistant instalacije.

Python testovi vremenske logike koriste stvarne datetime vrijednosti, a testovi koordinatora koriste izričite HA simulacije. JS testovi koriste simulirani DOM/canvas/vezu. Ovo **nije** zamjena za test instalacije i prikaza na HA-u.

Prije korištenja potvrdi na svojoj instanci: instalaciju i formu, ručni snijeg, maglu/vjetar i ostale efekte, promjenu dashboarda → postavke, dodir kartica, `christmasmode` on/off, automatsko vrijeme, +3 h, nedostupnu prognozu, ponovno povezivanje te Companion prikaz.

Repozitorij: [QaplAndroid/ha-weather-effects](https://github.com/QaplAndroid/ha-weather-effects). Pripremljen je za dodavanje kao HACS custom repository, ne predstavlja službeno uvrštenje ili certifikaciju HACS-a. Izbornik i opis postavki dostupni su na hrvatskom i engleskom.
