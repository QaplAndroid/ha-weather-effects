# Weather Effects — Home Assistant

Snijeg, kiša, sunce i oblaci kao animirani sloj preko **odabranih dashboarda**. Vlastita integracija (custom component), nije Supervisor add-on. Bez HTML kartice, card_mod-a, Lovelace resursa i ručnog uređivanja dashboard YAML-a.

**Verzija 0.6.0 — imenovani vizualni preseti, tvorničke postavke te položaj i raspršenost oblaka po efektu.** Kod i simulacije provjereni su lokalno; nije pokrenut stvarni Home Assistant niti provjerena instalacija na tvojoj instanci. Ciljane API mogućnosti: HA 2025.6+ (`async_register_static_paths`, options flow, `weather.get_forecasts`). Kompatibilnost svake HA verzije nije potvrđena.

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

1. Preuzmi `weather-effects-0.6.0.zip` sa stranice [Releases](https://github.com/QaplAndroid/ha-weather-effects/releases) i raspakiraj ga na računalu.
2. Kopiraj njegovu mapu `custom_components/weather_effects` u HA konfiguracijsku mapu, tako da dobiješ `/config/custom_components/weather_effects/manifest.json`. Ako `custom_components` već postoji, kopiraj samo podmapu `weather_effects` u njega. Nemoj prepisivati druge integracije.
   - Koristi npr. Samba share ili Studio Code Server. Konfiguracijska mapa je ista ona u kojoj se nalazi `configuration.yaml`; na Container/Core instalaciji može biti na drugoj host putanji.
3. **Ponovno pokreni Home Assistant**, ne samo ponovno učitaj YAML.
4. Otvori **Postavke → Uređaji i usluge → Dodaj integraciju → Weather Effects**.
5. Unesi postavke iz sljedećeg odjeljka i spremi.
6. Osvježi preglednik. U Companion aplikaciji po potrebi potpuno zatvori i ponovno otvori prikaz ili očisti frontend cache. Integracija sama registrira JS modul; nemoj ga dodatno dodavati među dashboard resurse.
7. Kad potvrdiš da nova integracija radi, ukloni staru conditional/html-card karticu s pahuljicama da se efekti ne udvostručuju. `html-card`/`card_mod` ne moraš uklanjati ako ih koristiš drugdje.

Opće postavke su u **Weather Effects → Konfiguriraj**, a zasebne postavke svakog efekta uređuju se kontrolnom karticom ili standardnim HA entitetima. Promjene se šalju otvorenim preglednicima bez ponovnog pokretanja HA-a.

## Kontrolni dashboard bez YAML-a (novo u 0.2.0)

Integracija sada daje **Weather Effects Control Card** koja se može dodati kroz standardni vizualni odabir kartica. Ne stvara i ne mijenja dashboarde automatski te ne dira tvoje postojeće kartice.

### Ako već imaš raniju verziju

U HACS-u ažuriraj **Weather Effects** na 0.6.0 (po potrebi provjeri nova izdanja ili ponovno preuzmi), restartaj HA i potpuno osvježi preglednik. Ne trebaš brisati integraciju ni ponovno stvarati profil. Novi `switch`, `select` i `number` entiteti dodaju se pri pokretanju. Kod ručne instalacije zamijeni mapu integracije sadržajem novog ZIP-a.

### Dodavanje posebnog dashboarda

1. **Postavke → Dashboardi → Dodaj dashboard** i napravi prazan dashboard, npr. **Vrijeme i efekti**. Nazivi opcija malo se razlikuju po HA verziji. Omogući prikaz u bočnoj traci ako ga želiš.
2. Otvori ga → **Uredi dashboard → Dodaj karticu**.
3. Pronađi **Weather Effects Control Card**.
4. U vizualnom editoru odaberi profil integracije i, po želji, naziv kartice. Ako postoji samo jedan profil, može se odabrati automatski.
5. Spremi. Nije potrebno ručno dodavati JS u dashboard resurse.

Kartica također može stajati na bilo kojem postojećem dashboardu; ne mora biti među dashboardima na kojima padaju pahuljice. Ako želiš vidjeti efekte dok ih podešavaš, dodaj i kontrolni dashboard na popis odabranih dashboarda u konfiguraciji profila.

### Što se podešava na kartici

- Uključeno/isključeno, ručni/automatski način i ručni efekt.
- **Uredi postavke za efekt**: zasebna brzina, veličina, gustoća, neprozirnost i vjetar za odabrani efekt, uz tri dodatna klizača položaja/raspršenosti ako efekt sadrži oblake.
- **Općenito → Upravitelj imenovanih vizualnih postavki**: spremanje, učitavanje, brisanje, preimenovanje i nepromjenjive tvorničke postavke.
- Prilagodba vremenskim podacima i prag prikaza vrućine.
- Na tabu **Grmljavina**: izričito uključivanje efekata munja, zasebna munja/bljesak, vrijeme nastajanja, trajanje nestajanja, grananje, debljina, sjaj, doseg, razmak i jačina bljeska.
- Pomak satne prognoze, najviše FPS i poštivanje smanjenog kretanja.
- Status trenutačno odabranog efekta, vremenski entitet, izvor podataka i vrijeme odabrane prognoze.

Promjene se spremaju u iste postavke profila kao kroz **Konfiguriraj**, vrijede na svim klijentima i ostaju nakon restarta. Klizači šalju promjenu pri završetku pomicanja, ne na svakom kadru. U automatskom načinu ručni odabir efekta je zaključan; prvo prebaci način na ručni. Automatski način traži prethodno odabran weather entitet.

Odabir dashboarda, weather entiteta i opcionalnog uvjetnog prekidača ostaje u **Uređaji i usluge → Weather Effects → Konfiguriraj**. Kartica ima poveznicu do integracije; za te administrativne postavke treba odgovarajuća HA dozvola.

Ako je glavni prekidač uključen, a `input_boolean.christmasmode` isključen, efekt se i dalje ne prikazuje. Kartica razlikuje spremljeno uključivanje od stvarno aktivnog efekta. Također poštuje nedostupne/isključene entitete i prikazuje greške HA poziva umjesto da prijavi lažno spremanje.

### Tabovi po vrsti vremena (novo u 0.5.0)

Kartica se otvara na **Općenito**: uključivanje, stvarno prikazani efekt/način, prilagodba vremenu, prognozni pomak, FPS i smanjeno kretanje. Tehničke vrijednosti i vremenski podaci su u sklopivom pregledu, ne zauzimaju stalno cijelu karticu.

Zasebni tabovi su **Sunce, Oblaci, Kiša, Snijeg, Magla, Vjetar, Noć, Tuča, Susnježica i Grmljavina**. Unutar vrste bira se točna kombinacija, npr. na Kiši: Kiša, Kiša i oblaci ili Pljusak; na Snijegu: Snijeg ili Snijeg i oblaci. Svaka kombinacija i dalje ima svoje spremljene vrijednosti. Prag vrućine je na Suncu, a sve postavke animacije munja na Grmljavini.

Odabir taba mijenja samo cilj uređivanja, **ne uključuje efekt, ne mijenja ručni/automatski način i ne uključuje munje**. Tab je lokalni prikaz te kartice; HA cilj uređivanja ostaje zajednički profil. Ako se cilj promijeni izvana, kartica neće dopustiti da klizač od vidljive vrste zapisuje u drugu vrstu.

Na uskom zaslonu tabovi su vodoravno pomični. Tipkovnica: strelice lijevo/desno, Home i End; aktivni tab i pripadajući panel imaju ARIA oznake. Postojeća konfiguracija kartice ostaje valjana, nema novog YAML-a ni resursa.

### Standardni HA entiteti i vlastiti raspored

Na uređaju profila pronaći ćeš šest `switch` entiteta (uključivanje, smanjeno kretanje, prilagodba vremenu, glavni prekidač munja, vidljiva munja i bljesak zaslona), tri `select` entiteta (način, ručni efekt i cilj uređivanja), devetnaest `number` entiteta (pet za osnovni izgled, tri za oblake, pomak, FPS, prag vrućine i osam parametara munje) te postojeći statusni senzor. HA dodjeljuje ID-eve; kartica ih pronalazi preko registra, pa radi i nakon preimenovanja.

Ako želiš vlastiti raspored, dodaj te entitete kroz standardnu HA **Entities** ili **Tile** karticu. Mogu se koristiti i u automatizacijama. Klizači i prekidači kontrolne kartice koriste standardne `switch`, `select` i `number` akcije, s redovnim HA dozvolama korisnika. Upravitelj imenovanih preseta koristi zaseban autentificirani WebSocket poziv i traži administratora; provjera dozvole provodi se i na poslužitelju.

Ako kartice nema u pretrazi, prvo provjeri da je integracija učitana, restartaj HA i potpuno osvježi/ponovno otvori klijent. Prikaz, editor i HACS ažuriranje još treba potvrditi na stvarnoj HA instanci.

## Zasebne postavke svakog efekta (novo u 0.4.0)

1. Na kartici odaberi tab **Snijeg** i željenu varijantu, npr. **Snijeg i oblaci**.
2. Podesi pet klizača. Vrijednosti se spremaju odmah po završetku pomicanja.
3. Otvori tab **Kiša**, odaberi varijantu i postavi drukčiju brzinu, gustoću itd. Povratak na Snijeg vraća njegove vrijednosti.

Automatski `rainy` koristi **Kiša i oblaci**, a `pouring` **Pljusak**: za taj prikaz uredi baš taj izbor, ne zasebni efekt Kiša bez oblaka.

Cilj uređivanja nije isto što i trenutačno prikazani efekt. U automatskom načinu možeš urediti Snijeg dok je trenutačno sunčano, bez promjene vremena na zaslonu. Ručni odabir efekta također odabire njegov profil uređivanja; promjena samo cilja uređivanja ne mijenja prikazani efekt.

Stare spremljene vrijednosti se ne brišu: služe kao početne vrijednosti za efekte/parametre bez vlastite postavke. U općoj formi **Konfiguriraj** pet starih klizača i dalje predstavlja te naslijeđene početne vrijednosti, ne uređuje odabrani posebni profil. Spremanje opće forme ne briše zasebne postavke efekata. Sve ostaje spremljeno nakon restarta.

Kartica odvojeno prikazuje spremljenu osnovu i trenutačno primijenjene vrijednosti. Automatska prilagodba nikad ne prepisuje spremljene profile.

**Više klijenata i automatizacije:** nativni cilj uređivanja je zajednički za cijeli profil, nije zaseban po pregledniku. Prvo postavi `select` cilja, zatim odgovarajući `number`. Kartica odbija završetak povlačenja ako je u međuvremenu primijetila promjenu cilja s drugog klijenta. To je provjera prije slanja, ne atomska transakcija između više HA servisnih poziva; izbjegni paralelno uređivanje istog profila iz više klijenata/automatizacija.

## Imenovani vizualni preseti i tvorničke postavke (novo u 0.6.0)

Automatsko spremanje klizača i dalje radi kao prije. Novi imenovani preseti dodatno spremaju **snimku svih spremljenih vizualnih postavki profila**: osam parametara izgleda za svaki efekt, ručni efekt/cilj uređivanja, prilagodbu vremenu, prag vrućine, FPS, smanjeno kretanje i parametre munje. Spremaju se osnovne postavke, ne trenutačni vremenski multiplikatori ili točne pozicije animiranih čestica.

Na tabu **Općenito**:

1. Za novi preset odaberi novu/praznu stavku u popisu, upiši naziv i klikni **Spremi**.
2. Za vraćanje odaberi spremljeni naziv → **Učitaj** → potvrdi.
3. Za nadogradnju postojećeg odaberi ga, podesi izgled i klikni **Spremi**; prepisivanje traži potvrdu.
4. Za promjenu naziva upiši novi naziv i klikni **Preimenuj**. Time se ne mijenja spremljeni izgled.
5. **Izbriši** traži potvrdu i briše samo spremljenu snimku, ne trenutačni izgled.
6. **Tvorničke postavke** traže potvrdu i vraćaju ugrađeni vizualni izgled za sve efekte. Ne mogu se preimenovati ni izbrisati i ne brišu tvoje imenovane presete.

Do 20 imenovanih preseta po profilu; nazivi imaju 1–50 znakova, bez kontrolnih znakova i duplikata neovisno o velikim/malim slovima. Sve se čuva u HA config-entry postavkama, **ne samo u memoriji preglednika**, pa ostaje nakon restarta. Odabir stavke popisa sam po sebi ništa ne učitava. Brisanje ili promjena naziva ne mijenja odabrane dashboarde ni trenutačni vizualni izgled.

**Učitavanje i tvornički reset ne mijenjaju** naziv/povezivanje integracije, weather entitet, dashboarde, uvjetni prekidač, ručni/automatski način, prognozni pomak ni glavni prekidač svih efekata. U ručnom načinu spremljeni ručni efekt može promijeniti prikazani efekt. Postojeća vremenska prilagodba i dalje utječe na rezultat u automatskom načinu.

**Glavni pristanak za munje nikad se ne sprema u preset. Učitavanje ili tvornički reset uvijek ga isključuju**, čak i ako je trenutačno uključen. Za ponovno prikazivanje moraš ga izričito uključiti na Grmljavini. Gašenje se objavljuje odmah, ne čeka završetak zahtjeva satne prognoze; zakašnjeli odgovor prognoze ne može ponovno uključiti stari pristanak.

Upravitelj traži HA administratorski račun. Bez njega su njegove akcije zaključane s objašnjenjem; redovne kontrole i dalje slijede HA dozvole. Poslužitelj provjerava ovlasti prije traženja profila. Preglednicima se šalju samo ID/naziv preseta, ne sadržaj spremljene snimke. Potvrde se traže za učitavanje, prepisivanje, brisanje i tvornički reset.

## Položaj i raspršenost oblaka (novo u 0.6.0)

Na tabu **Oblaci**, kao i kod svake kombinacije koja sadrži oblake, dostupni su:

| Postavka | Raspon · zadano | Značenje |
| --- | --- | --- |
| Gornja središta oblaka | 0–100% · 10% | Najviša dopuštena središta oblaka; 0 je vrh zaslona |
| Donja središta oblaka | 0–100% · 30% | Najniža dopuštena središta; 100 je dno zaslona |
| Razmak oblaka | 0–100% · 80% | 0 daje slučajan raspored, 100 snažnije raspoređuje i usklađuje kretanje |

Sve tri vrijednosti spremaju se **zasebno za točno odabrani efekt** i ulaze u imenovane presete. Primjer: Kiša i oblaci može ostati pri vrhu, a Oblaci se mogu protezati do 90% visine. Čista kiša/snijeg/sunce/vjetar/noć bez oblaka te magla nemaju taj odjeljak. Broj oblaka i dalje podešava **Gustoća**, a dimenzije **Veličina**.

Za oblake preko gotovo cijelog zaslona probaj **gornja granica 10%, donja 90%, razmak 90–100%**. Ako želiš cijeli pojas pri dnu, npr. **60–90%**, najprije povećaj donju granicu. Gornja ne može biti veća od donje; jednakost daje jedan vodoravni pojas.

Granice se odnose na **središta**, ne rubove sličica: tijelo oblaka može izlaziti iz pojasa ili preko ruba zaslona. Pri većem razmaku koristi se ograničena početna optimizacija rasporeda i usklađenije vodoravno kretanje, bez ponovnog kvadratnog računanja na svakom kadru. Oblaci se **manje preklapaju**, ali vrlo velika veličina/gustoća ili jako uzak pojas ne mogu jamčiti raspored bez preklapanja. Smanji veličinu/gustoću ili proširi pojas po potrebi. Izgled kumulusa, prilagodba naoblaci i ukupni budžet čestica ostaju sačuvani; magla ostaje zaseban efekt.

Stare verzije nemaju te ključeve pa se bez brisanja postojećih postavki primjenjuju početne vrijednosti 10/30/80. U općoj formi **Konfiguriraj** podešavaju se naslijeđene početne vrijednosti za efekte bez vlastitog zapisa, ne već spremljeni posebni izgled.

## Prilagodba intenziteta vremenu

U **automatskom načinu**, uz uključeno **Prilagodi intenzitet vremenu**, spremljena osnova se privremeno prilagođava dostupnim podacima:

| Podatak | Vizualni rezultat |
| --- | --- |
| Temperatura iznad praga (zadano 30 °C) uz sunčani efekt | Topliji/narančasti sjaj sunca i blage uzlazne linije vrućine |
| Veći postotak naoblake | Više oblaka; od 65% tamnija paleta |
| Veća oborina po satu | Gušća/brža oborina, uz ograničene multiplikatore |
| Jači vjetar | Jače zanošenje i kod vjetrovitog efekta nešto brže strujnice |

Prag vrućine podesiv je 25–45 °C. Puna vrućina postiže se na pragu +12 °C (npr. 42 °C za prag 30). Naoblaka je normalizirana 0–100%; multiplikator broja oblaka ide od 0,35 do 2. Oborinski intenzitet doseže maksimum na 12 mm/h; gustoća se množi s 0,45–2,55, brzina s 0,75–1,55 i neprozirnost s 0,8–1. Intenzitet vjetra raste od 8 do 70 km/h; znak spremljenog vjetra bira smjer, ne koristi se stvarni meteorološki smjer. Svi rezultati ostaju unutar granica kontrola i ukupnog ograničenja čestica.

Ako neki podatak nedostaje, **ne nagađa se**: zadržava se spremljena postavka tog parametra. Ručni način i isključena prilagodba koriste spremljene vrijednosti bez ovih multiplikatora.

### Izvori, jedinice i prognoza

- Temperatura se pretvara iz °C/°F/K; vjetar iz km/h, m/s, mph ili čvorova. Nepoznate jedinice i nevaljane/neograničene vrijednosti se ignoriraju.
- Trenutačna temperatura, naoblaka i vjetar čitaju se iz trenutačnih atributa weather entiteta.
- Trenutačna oborina koristi **izričitu stopu** `precipitation_rate` i jedinicu mm/h ili in/h. Generički `precipitation` može biti dnevni akumulirani iznos pa se ne tumači kao trenutačna jačina.
- Ako stopa nedostaje, prilagodba može dohvatiti satnu prognozu i uzeti najbližu točku unutar 90 minuta, čak i pri pomaku 0 h. Satna količina mm/in tretira se kao procjena po satu. To je **prognozna procjena, ne mjerenje kiše kod kuće**; kartica prikazuje izvor `hourly_forecast` odnosno „Procjena satne prognoze”.
- Za pozitivni pomak koriste se mjerenja **odabrane buduće točke**, nikad današnja temperatura/naoblaka/vjetar kao zamjena za nedostajuće buduće vrijednosti. Iz trenutačnog entiteta preuzimaju se samo metapodaci o jedinicama.
- Cache i povratak na trenutačno stanje ostaju kao prije. Ručni način i isključeni glavni/uvjetni prekidač ne pokreću nove zahtjeve prognoze. Dostupnost pojedinih atributa ovisi o pružatelju; Met.no ne mora pružati svaki podatak.

## Munje i bljeskovi — upozorenje

**Bljeskovi mogu izazvati napadaje ili nelagodu kod fotosenzitivnih osoba.** Munje su zadano **isključene**, uključuju se izričito zasebnim prekidačem. Uključi ih samo uzimajući u obzir sve gledatelje i uređaje odabranih dashboarda. Nijedno ograničenje ne jamči sigurnost za osjetljive osobe.

- Rade samo za **Grmljavinsko nevrijeme** i **Olujne oblake**, u ručnom ili automatskom načinu.
- Munja je sada proceduralna usporena animacija: glavna staza postupno raste, bočne grane počinju tek kad glavna munja dođe do njih, zatim se jednom pojača sjaj i cijela se munja ugasi. Nije video stvarne munje ni fizikalna simulacija.
- **Vidljiva munja** i **bljesak zaslona** imaju zasebne prekidače ispod glavnog pristanka. Za izgled usporene kamere možeš ostaviti samo munju, bez bljeska pozadine. Oba podprekidača zadano su uključena radi kompatibilnosti sa starim izričito uključenim profilima; glavni prekidač ostaje zadano isključen.
- Bljesak, ako je uključen, dolazi samo jednom nakon nastajanja, kratak je (najviše 220 ms), bez dvostrukih/trostrukih nizova i bez svjetlosnog pulsa tijekom rasta.
- Razmak je 5–60 s, zadano 12 s; najviše jedan događaj **ukupno kroz sve aktivne profile u jednom pregledniku**. Ne preklapaju se: razmak se produljuje na trajanje nastajanja + nestajanja + 0,5 s ako treba. Prvi događaj čeka cijeli razmak.
- Neprozirnost svjetlosnog pulsa je 0,05–0,25, zadano 0,10. Debljina i vanjski sjaj linije munje podešavaju se odvojeno od tog pulsa.
Na tabu **Grmljavina** podešavaš:

| Postavka | Raspon · zadano | Učinak |
| --- | --- | --- |
| Vrijeme nastajanja | 0,1–3 s · 0,8 s | Manje znači brže; veće daje usporeni rast |
| Trajanje nestajanja | 0,3–2 s · 0,7 s | Postupno gašenje nakon dovršene munje |
| Broj grana | 0–8 · 4 | Bočne grane; nula ostavlja samo glavnu stazu |
| Debljina | 0,5–4 px · 1,5 px | Svijetla jezgra munje |
| Sjaj | 0–1 · 0,6 | Plavičasti vanjski oreol |
| Duljina | 0,2–0,9 · 0,6 | Udio visine zaslona koji doseže munja |
| Razmak | 5–60 s · 12 s | Minimalni razmak događaja, ne brzina crtanja |
| Svjetlina bljeska | 0,05–0,25 · 0,10 | Samo kratki bljesak pozadine, ne linija munje |

Parametri animacije munje su opći za profil integracije i vrijede za obje grmljavinske varijante; pet klizača izgleda i dalje je zasebno po točno odabranom efektu. Ako se preklapa više uključenih profila, koristi se jedan zajednički događaj: sporije nastajanje i nestajanje, manje grana/sjaja/debljine/dosega i niža svjetlina. Vidljiva munja ili bljesak prikazuju se ako ih traži barem jedan izričito uključen profil. Promjene parametara ne pokreću aktivnu munju ispočetka i ne skraćuju već uspostavljeni razmak.

Geometrija se stvara jednom po događaju, s najviše osam bočnih grana i unaprijed ograničenim spremnicima. Tijekom rasta prikazuje se samo dovršeni dio staze; duljina grana raste nakon dolaska glavne munje. Nema niza brzih ponovnih udara. Ukupni budžet čestica uključuje i grane i bljesak.

- Postavka uređaja **smanjeno kretanje uvijek gasi munje**, čak i ako je opće poštivanje smanjenog kretanja isključeno.
- Ne rade u skrivenoj kartici, izvan odabranog dashboarda ili kad je efekt isključen. Nakon povratka čeka se novi razmak, nema trenutnog bljeska.

## Preporučene prve postavke

- **Naziv:** Weather Effects.
- **Uključi efekte:** uključeno.
- **Dashboardi:** odaberi stvarni dashboard iz popisa (npr. Overview). Nemoj pretpostaviti da se svaki zove `lovelace`.
- **Način rada:** prvo **Ručno**, efekt **Snijeg** za provjeru; poslije **Automatski**.
- **Weather entitet:** `weather.forecast_work_work`.
- **Neobavezni prekidač:** ostavi prazno za početak. Za postojeće ponašanje odaberi `input_boolean.christmasmode`; tada efekti rade samo kad je on uključen. To je glavni uvjet i u automatskom načinu, ne posebna božićna prečica.
- **Pomak:** 0 h za trenutačno stanje, npr. 3 h za prognozu.
- Brzina 1, veličina 1, gustoća 60, neprozirnost 0,65, vjetar 0,2, 30 FPS.
- **Prilagodi intenzitet vremenu:** zadano uključeno, primjenjuje se samo automatski. Isključi za točno spremljeni izgled bez vremenskih multiplikatora.
- **Munje:** zadano isključene; preporuka da tako ostanu dok ne pročitaš upozorenje i uzmeš u obzir sve gledatelje.

### Dashboardi

Popis se puni iz registriranih Lovelace dashboarda. Ako neki nije na popisu, možeš upisati njegov **URL put**, npr. `dashboard-tablet` za `https://ha.example/dashboard-tablet/prizemlje`. Ne upisuj domenu ni put prikaza. Efekti vrijede za sve prikaze odabranog dashboarda, na svim prijavljenim uređajima.

Sloj je proziran za klikove i dodire, nije zasebna kartica i ne zauzima mjesto u gridu. Ne prikazuje se u HA postavkama ni drugim sistemskim panelima. Skriva se i za URL s parametrom `edit`; detekcija svakog internog načina uređivanja kroz sve HA verzije nije zajamčena. Dialoge i menije HA obično prikazuje iznad sloja.

Moguće je dodati više instanci integracije za zasebne postavke različitih dashboarda. Ako dvije instance ciljaju isti dashboard, njihovi efekti se kombiniraju.

## Ručno i automatski

Ručno je dostupno **18 izbora**: Isključeno, Snijeg, Kiša, Sunce, Oblaci, Sunce i oblaci, Kiša i oblaci, Snijeg i oblaci, Magla, Vjetar, Vjetar i oblaci, Vedra noć, Mjesec i oblaci, Tuča, Susnježica, Pljusak, Grmljavinsko nevrijeme, Olujni oblaci. Stari spremljeni izbori ostaju valjani.

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
| lightning-rainy | Olujni oblaci, vjetar i kiša; munje samo uz izričit uključeni prekidač |
| lightning | Olujni oblaci i vjetar; munje samo uz izričit uključeni prekidač |
| snowy | Pahuljice s oblacima |
| snowy-rainy | Susnježica: zasebne čestice kiše i snijega |
| hail | Male ledene kuglice s oblacima |
| windy | Animirane strujnice i naleti vjetra |
| windy-variant | Vjetar i oblaci |
| exceptional, nepoznato stanje | Bez efekta; ne nagađa se opasno vrijeme |

Obuhvaćena su sva standardna HA vremenska stanja. Ovo su **dekorativni, stilizirani efekti**, ne meteorološka simulacija ili sigurnosni sustav. Mjesec ne predstavlja stvarnu fazu. Vremenska prilagodba koristi dostupne brojčane podatke i ograničene vizualne multiplikatore, ne fizikalnu simulaciju. Neobavezne munje imaju poseban upozoreni prekidač; nisu uključene samim odabirom grmljavine.

Trenutačni `sun.sun`, ako postoji, služi za razlikovanje dana/noći kod trenutačnog stanja. Buduća prognoza koristi vlastiti `is_daytime` ako ga pružatelj daje, nikad današnje stanje sunca za budući sat. Bez takvog podatka zadržava se simbol koji je dao pružatelj.

### Grafika u 0.3.1

- Prepoznatljiva silueta oblaka s oblim vrhovima, jasnim rubom i zasjenjenim donjim dijelom. Dvije varijante oblika, svjetlija dnevna i tamnija olujna paleta.
- Oblaci su kontrastniji od 0.3.0 i raspoređeni malo niže radi vidljivije siluete. Klizač neprozirnosti i dalje ih može učiniti diskretnijima. Magla ostaje zaseban mekan, razmazan efekt.
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

Atributi: `status` (`ok`, `forecast_fallback`, `weather_unavailable`, `enable_entity_unavailable`), `source` (`manual`, `current`, `forecast`, `fallback_current`), `forecast_time`, `condition`, odabrani dashboardi i vremenski entitet. Od 0.4.0 tu su i `settings_effect`, `preset`, `intensity`, `weather_metrics` te postavke prilagodbe i munja. `preset` je osnova stvarno odabranog efekta, ne nužno efekta koji trenutno uređuješ.

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

Demo kontrolne kartice je na `http://127.0.0.1:8000/demo/controls.html`; koristi izmišljeni profil i memorijske servise, ne stvarne HA postavke.

Ako imaš Chrome, Edge ili Chromium, opcionalni `node scripts/browser_smoke.mjs` provjerava svih 18 efekata u stvarnom headless pregledniku, prozirnost za klikove, mobilnu rezoluciju, vrućinu i naoblaku, izričito uključivanje/razmak munja, smanjeno kretanje i promjenu dashboarda. Testira i stvarnu karticu u pregledniku: zasebne spremljene postavke kroz testne servise i upozoreno uključivanje munja. Za provjeru razmaka munja koristi determinističko pomicanje testnog sata; ne čeka svaki stvarni razmak. Koristi novi privremeni profil, nikad postojeći korisnički profil. Put do preglednika možeš zadati varijablom `WEATHER_EFFECTS_BROWSER`. Slike i izvještaj spremaju se u `dist/visual-preview`; to nije test Home Assistant instalacije.

Python testovi vremenske logike koriste stvarne datetime vrijednosti, a testovi koordinatora koriste izričite HA simulacije. JS testovi koriste simulirani DOM/canvas/vezu. Ovo **nije** zamjena za test instalacije i prikaza na HA-u.

Prije korištenja potvrdi na svojoj instanci: instalaciju i formu, ručni snijeg, maglu/vjetar i ostale efekte, promjenu dashboarda → postavke, dodir kartica, `christmasmode` on/off, automatsko vrijeme, +3 h, nedostupnu prognozu, ponovno povezivanje te Companion prikaz.

Repozitorij: [QaplAndroid/ha-weather-effects](https://github.com/QaplAndroid/ha-weather-effects). Pripremljen je za dodavanje kao HACS custom repository, ne predstavlja službeno uvrštenje ili certifikaciju HACS-a. Izbornik i opis postavki dostupni su na hrvatskom i engleskom.
