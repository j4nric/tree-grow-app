# Game Design – Vom Samen zum Wald

> **Stand des Codes: v2 mit Pflanzen.** Der Code setzt den Prototyp aus
> [`DESIGN_V2.md`](DESIGN_V2.md) (Roadmap-Schritte 1.1–1.4) und die Pflanzen aus
> Schritt 2.1 um: Wachstum, Samen und Harmonie; Begegnungen an Wegpunkten mit
> Kartenwahl („Tier zieht ein“ und „Etwas keimt“); 3 Gattungen × 3 Tiere; 14
> Begleitpflanzen mit Licht-/Wasser-Versorgung, Pflanzring und „Pflanze setzen“
> (20 · 1,9^n 🌰); Wegpunkte bei 3,5 · k^3,5 (seit dem Balancing 2.10, vorher 3,5 · k^3,4);
> Neuer Zyklus ab „Hain“ mit Naturtagebuch,
> Waldgedächtnis und Stammgästen (Schritt 2.8, siehe `DESIGN_V2.md` Abschnitt 10);
> Ereignisse mit Wahl und Durchreisende mit Zeit- und Zyklus-Boni, ab dem Hain mit
> Zwischenhalt (Schritt 2.4, `DESIGN_V2.md` 7.4–7.8); Pflegemaßnahmen als Samen-Senke
> (9 Maßnahmen mit 1–3 Rängen ab Setzling, wirken bis zum Neuen Zyklus; Schritt 2.7, `DESIGN_V2.md` 8);
> Jahreszeiten (Jahr = 12 min Spielzeit des Zyklus; 15 Ereignisse, davon je Jahreszeit ein
> eigenes: Spätfrost, Hitzewelle, Laubfall, Schneebruch; seit Welle 3 dazu vier Massenjahre,
> 19 insgesamt, gewichtet nach dem Wetter des Tages – `DESIGN_V2.md` 22) und Hauptbaum-Arten (Eiche, Buche,
> Kiefer; Wahl beim Neuen Zyklus; `DESIGN_V2.md` 16 und 17);
> Erweiterung Amphibien mit Waldtümpel (6. Gattung, 5 Arten seit dem Playtest, eigene Nische; unten);
> Lebensräume Waldwiese, Totholzhaufen und Trockenmauer (3 Nischen aus Pflege, 14 Arten,
> 7. Gattung Reptilien, 4 Lebensgemeinschaften, 11 Pflegemaßnahmen; `DESIGN_V2.md` 23);
> Spielstand v13 (v1-Stände starten neu, ab „Junger Baum“ mit +5 Waldgedächtnis;
> v2-Stände behalten ihren Fortschritt, Samen werden auf 58 begrenzt; v3-Stände laufen
> verlustfrei als erster Zyklus weiter; v4-Stände bekommen leere Ereignis-Felder, v5-Stände ohne Pflege eine leere Pflege;
> v5-Stände beginnen beim Laden im Frühling und wachsen als Stieleiche weiter; v3- bis
> v6-Stände werden auf die neue Wegpunkt-Kurve umgerechnet – gleicher Wegpunkt, gleicher
> Anteil bis zum nächsten; ihr Waldgedächtnis bleibt in Punkten gleich, wirkt aber mit +1 %
> je Punkt). Regeln und Zahlen stehen in `DESIGN_V2.md` (Simulation:
> Abschnitt 15.4) bzw. `src/content/`. Ablehnen bringt 10 Samen-Sekunden, mindestens 5 🌰 –
> von Hand wie beim Weiterziehen online und offline (`DESIGN_V2.md` 7.9), Neu würfeln
> kostet 10 🌰 (verdoppelt sich je Wurf). Seit Spielstand v8 gibt es eine
> Langzeit-Statistik über alle Zyklen (`DESIGN_V2.md` 12.5); bei v7-Ständen beginnt sie
> beim laufenden Zyklus, ab Zyklus 2 gilt die Stieleiche zusätzlich als gewachsen.
> Seit Spielstand v9 gibt es 25 Erfolge im Naturtagebuch (`DESIGN_V2.md` 18); v8-Stände
> bekommen beim Laden still nachgetragen, was sie schon erfüllen. Seit Spielstand v10
> merkt sich der Zyklus die beste Waldgedächtnis-Vorschau („Sperrklinke“, `DESIGN_V2.md`
> 10 und 12.7); v9-Stände starten mit ihrer aktuellen Vorschau. Seit Spielstand v11 gibt
> es die Nische Waldtümpel (`DESIGN_V2.md` 5.5 und 12.8); v10-Stände bekommen sie leer, ein
> im Zyklus gewählter „Waldtümpel“ aus dem Regenreichen Frühling seinen Platz nachgetragen.
> Seit Spielstand v12 gibt es Tagesziele mit Serie (`DESIGN_V2.md` 20 und 12.9, unten);
> v11-Stände bekommen einen eigenen Startwert und ihre ersten Ziele beim nächsten Start.
> Seit Spielstand v13 gibt es die Lebensräume (`DESIGN_V2.md` 23.6); v12-Stände bekommen die
> drei Nischen leer, ein gekaufter Totholzhaufen seine Plätze aus dem Rang, ein im Zyklus
> gewähltes „Das Holz vermodern lassen“ (Käferjahr) seinen Platz nachgetragen. Seit
> Spielstand v14 gibt es die Waldlandschaft (`DESIGN_V2.md` 24), seit v15 die Hauptbäume
> Weißtanne und Schwarzerle, die Wildwechsel-Markierung an offenen Begegnungen und den Zähler
> gewählter Wildwechsel-Karten sowie „Zuerst gesehen“ je Art und Pflanze (`DESIGN_V2.md`
> 25.5, 24.6, 25.10); v14-Stände laden unverändert, der Zähler beginnt bei 0, „Zuerst gesehen“
> leer. Ein gespeicherter Stand einer neueren Spielversion wird weder geladen
> noch überschrieben. Wildwechsel-Karten sind gemessen (`DESIGN_V2.md` 24.10, Phase 7 2c): Chance
> 10 % je Korridor am aktiven Wald, höchstens 30 %, unverändert – sie ändern kein Tempo, nur die
> Karten. Wetter je Waldtyp (Phase 7 3b, `DESIGN_V2.md` 24.14): Faktoren auf die Wetter-Gewichte
> je Standort (z. B. Kiefernheide Dürre × 2,5, Bergmischwald Neuschnee × 2) stehen als Daten in
> `src/content/landscape.ts` und wirken seit 3c im aktiven Wald. Gemessen mit der echten Logik
> (Phase 7 3d, `DESIGN_V2.md` 24.7 und 24.10 „Stand 3d“): Waldtypen ±3,4 % (Kiefernheide
> Wachstum −3,4 %), Landschaft vollständig nach 14,2 h (Harmonie) bzw. 13,3 h (Wachstum) wie
> ohne Standort-Wetter, Abstand 6,4 % – keine Zahl geändert. Die Kiefernheide bekommt das
> Käferjahr × 3 als Gewicht des Standorts (Daten und Logik: Aufgabe 3e). Seit Phase 9, 1a
> (`DESIGN_V2.md` 26.2) hat jeder Waldtyp sein Ereignis (`ForestSite.eventFactors`): Auwald
> Regenreicher Frühling × 2 und Schneckenjahr × 3, Erlenbruch Krötenwanderung × 3, Buchenhallen
> Mastjahr × 2 und Mäusejahr × 3, Kiefernheide Käferjahr × 3; dazu in der Kiefernheide ab Hain
> +1 Platz Trockenmauer (öffnet die Mauer ohne Pflege). Gemessen (24.7 und 24.10 „Stand 1a“):
> Waldtypen ±2,9 % (vorher ±3,6 %), Landschaft vollständig nach 14,0 h (Harmonie) bzw. 13,3 h
> (Wachstum), Abstand 5,6 %.
>
> **Geplant (Phase 10, `DESIGN_V2.md` 27, Spielstand v17):** Begegnungen nur noch mit Tieren
> (dazu Ereignisse und Gäste), Pflanzen über die **Aussaat** (Samen, `20 · 1,75^(n−1)` 🌰 je
> Kauf im Zyklus, erste gratis), die Pflege wird ein **Forschungsbaum** (6 Äste, 32 Knoten,
> 5 Gabeln) mit Kosten in **Harmonie** – die Harmonie wird zur Produktion in ⚖️/min (gleiche
> Zahl wie heute), die einen Vorrat füllt; der Bonus `1 + p/100` richtet sich nach der
> Produktion. Vorab-Messung und Ziele: `DESIGN_V2.md` 27.10/27.11. Bis zur Umsetzung gelten die
> Zahlen oben. Die Daten liegen seit Phase 10, 1a bereit (`src/content/research.ts`: 32 Knoten
> zu 80–2.500 ⚖️, ein ganzer Weg 21.260 ⚖️, davon 5.630 ⚖️ vor dem Hain; `src/content/sowing.ts`:
> `SOWING_BASE` 20, `SOWING_GROWTH` 1,75, ab Keimling, Frühling × 0,8, Rabatt höchstens −75 %,
> höchstens 4 Karten), sind aber noch nicht verdrahtet – es gilt weiter die Pflege aus `care.ts`.
>
> Ab „Vision“ beschreibt dieses Dokument **v1** (Wasser/Licht/Energie, Upgrades,
> Klick-Button) und ist nur noch historisch. Simulator und Balancing laufen auf v2:
> `scripts/simulate.ts`, `tests/balance.test.ts` (mit Pflege), `tests/balance-cycles.test.ts`
> (mit Neustart in Hain, Wald, Urwald), `tests/seasons-balance.test.ts` und
> `tests/daily-balance.test.ts` (Einstellungen in `tests/balance-setup.ts`, geteilte
> Durchgänge in `tests/balance-runs.ts`). Großer Lauf mit allen Tabellen: `npm run balance`.

## Tagesziele (v2, umgesetzt)

Details, Pool, Regeln und Messungen: [`DESIGN_V2.md`](DESIGN_V2.md), Abschnitt 20
(Spielstand 12.9). Inhalte in `src/content/daily.ts`, Logik in `src/core/daily.ts`.

- **Drei Ziele je Kalendertag** aus einem Pool von 9 Arten (Begegnungen entscheiden,
  Arten einer Gattung in einer Jahreszeit beobachten, Zufriedenheit einer Gattung, eine
  Lebensgemeinschaft nach ihrem Rätselhinweis entdecken, Pflanze setzen, Pflege kaufen,
  Harmonie 5 min halten, Wachstum bzw. Samen sammeln) – nur, was auf der Stufe passt und in
  einem kurzen Besuch (5–15 min) sicher schaffbar ist. „Umbauen“ (Pflanze, Pflege,
  Lebensgemeinschaft) und „Halten“ (Zufriedenheit, Harmonie) nie am selben Tag.
- **Deterministisch** aus Tag + eigenem Startwert (`meta.daily.seed`), der Tag kommt aus
  `main.ts` (lokales Datum; mit Konto nach Serverzeit, sobald der Server geantwortet hat). Ein
  gespeicherter Tag mehr als einen Tag in der Zukunft wird auf heute zurückgesetzt (Serie 0).
  Die Ziele überdauern den Neuen Zyklus; offene passen sich dabei dem neuen Wald an.
- **Offline** zählen nur Zufriedenheit und Lebensgemeinschaft; Begegnungen (automatisches
  Ablehnen zählt nie), Beobachten, Harmonie halten, Wachstum und Samen brauchen aktives Spiel.
- **Belohnung** sofort mit Hinweis: 15 Samen-Sekunden je Ziel (mindestens 5 🌰), ab Junger
  Baum an 30 % der Tage bei einem Ziel stattdessen eine Begegnung mit Arten ab „selten“.
  **Serie** der Tage mit mindestens einem erfüllten Ziel; ein verpasster Tag setzt nur sie
  zurück. Naturtagebuch: erfüllte Ziele, perfekte Tage, längste Serie.
- **Anzeige:** Karte „Tagesziele“ in der Seitenleiste unter dem Naturtagebuch.

| Zahl (`src/content/daily.ts`) | Wert | Begründung |
|---|---|---|
| `DAILY_GOAL_COUNT` / `DAILY_MIN_GOALS` | 3 / 2 | „2–3 Ziele“; gemessen auf jeder Stufe 3 |
| `DAILY_VISIT_SECONDS` × `DAILY_RATE_MARGIN` | 600 s × 0,8 | Planungsfenster der Auswahl (Wegpunkte, Kaufziele) |
| `DAILY_PRODUCE_SECONDS` / `DAILY_HOLD_SECONDS` | 300 s / 300 s | Wachstum, Samen, Harmonie halten: 5 min |
| `DAILY_MAX_DECIDE` / `DAILY_MAX_OBSERVE` | 3 / 3 | |
| `DAILY_SATISFACTION_STEP` / `DAILY_MIN_HARMONY` | 5 % / 5 | |
| `DAILY_SEED_SECONDS` | **15** (geplant 20) | mit 20 lag die Obergrenze bei 5,1–5,8 % der ersten Stunde, mit 15 bei 3,5–4,6 % |
| `DAILY_RARE_CHANCE` / `DAILY_RARE_MIN_STAGE` | 30 % / Junger Baum | |

| Messung (`tests/daily-balance.test.ts`, erste Stunde) | Ergebnis |
|---|---|
| Anteil an den Samen der ersten Stunde (Median, 3 Strategien, 200 Durchgänge) | ein Tag 0,14–0,23 %; Mitternacht nach 30 min 1,32–1,46 % (höchstens 2,02 %) |
| Obergrenze: zweimal alle Ziele zur Samenrate am Ende der Stunde | 3,50–4,55 % (Grenze 5 %) |
| Hain des Harmonie-Spielers ohne / mit Tageszielen | 1:02:45 / 1:02:39 h |
| Schaffbarkeit: 6 Wälder × 30 Tage je Stufe 0–7 | nie ein offenes Ziel, längster Besuch 8:45 min |
| übrige Balancing-Tabellen (`npm run balance`) | unverändert – der Simulator spielt ohne Tagesziele |

## Erweiterung Amphibien mit Waldtümpel (v2, umgesetzt)

Details, Texte und offene Punkte: [`DESIGN_V2.md`](DESIGN_V2.md), Abschnitt 5.5 (Spielstand
12.8). Nur Daten in `src/content/` – keine neue Logik.

- **Neue Gattung 🐸 Amphibien** mit Erdkröte, Grasfrosch (gewöhnlich), Bergmolch und
  – seit dem Playtest unten – Laubfrosch (selten, ab Alter Baum) und Kammmolch (selten,
  ab Hain), alle im **Waldtümpel**. Der Feuersalamander bleibt Bodenleben.
- **Neue Nische 🪷 Waldtümpel** ohne Plätze aus der Stufe: Sie öffnet nur durch Pflege
  „Waldtümpel“ (+2, im Hain +2) oder die Ereignisse „Regenreicher Frühling“ und
  „Krötenwanderung“ (je +1). Erst dann kommen Amphibien-Karten.
- **Jahreszeit:** Frühling = Laichzeit, Amphibien +15 % 😊; neues Frühlings-Ereignis
  🐸 Krötenwanderung (Erdkröte lebt). Winter: Winterstarre und Eis nur in der Grafik.
- **Lebensgemeinschaften:** Tümpelleben (Erdkröte, Bergmolch, Wurmfarn oder Hirschzunge;
  +6 ⚖️, +2 💧) und Schneckenwacht (Erdkröte, Igel, Glühwürmchen oder Feuersalamander; +6 ⚖️).

| Zahl (`src/content/`) | vorher | jetzt |
|---|---|---|
| 💧 Waldtümpel, Rang 1 (`care.ts`) | Alter Baum, 5.500 🌰: Feuchte, +3 💧 | **7.500 🌰**: Feuchte, +3 💧, **+2 Plätze Waldtümpel** |
| 💧 Waldtümpel, Rang 2 | Hain, 22.000 🌰: +3 💧, +2 ⚖️ | **22.500 🌰**: +3 💧, +2 ⚖️, **+1 Platz** (seit dem Playtest **+2 Plätze**) |
| 🌧️ Regenreicher Frühling, „Waldtümpel“ (`events.ts`) | Feuchte, +3 💧 | Feuchte, +3 💧, **+1 Platz Waldtümpel** |
| 🌱 Frühling (`seasons.ts`) | +10 % 🌿 | +10 % 🌿, **Amphibien +15 % 😊** |
| Erdkröte / Grasfrosch / Bergmolch (`species.ts`) | – | Schnecken −40 %, +4 % 🌿 / Insekten −20 %, +5 % 🌰 / Insekten −25 %, +5 % 🌿, +2 ⚖️ |
| Gattungsbonus Amphibien (`traits.ts`) | – | 2: Schneckenschaden −25 % · 3: +2 💧, +5 % 🌿 · 5: +12 % 🌿 |

Warum der Tümpel teurer wurde: Mit 2 Plätzen kaufte der Harmonie-Spieler ihn in jedem
Durchgang vor dem Hain (vorher 83 %), und sein 🌰-Bestand beim Hain stieg im Check auf
10,3–11 Minuten Produktion (Ziel < 10). Mit 7.500 🌰 liegt er wieder darunter. Rang 2
bleibt ≥ 3 × Rang 1.

**Simulation** (`npm run balance`, 500 Durchgänge, alle Systeme, Eiche; Stand vor dem
Playtest – die aktuellen Zahlen stehen im nächsten Abschnitt):

| Kennzahl | vorher | jetzt | Ziel |
|---|---|---|---|
| Hain Harmonie / Wachstum / Zufall | 1:03:43 h / 54:30 min / 1:36:18 h | 1:03:51 h / 54:31 min / 1:35:33 h | 55–65 min (Harmonie) |
| Wald / Urwald (Harmonie) | 1:54:05 h / 2:47:28 h | 1:54:46 h / 2:47:38 h | ~1:40 h / ~2:20 h (±25 %) |
| ⚖️ beim Hain (Harmonie / Wachstum) | 106,7 / 101,1 | 107,2 / 101,3 | Harmonie vorn |
| 🌰-Bestand beim Hain (Harmonie, min Produktion) | 9,2 | 8,3 | < 10 |
| Amphibien beim Hain (Harmonie / Wachstum / Zufall) | – | 0,5 / 0,1 / 0,5 | – |
| „Amphibien stapeln“: Hain / ⚖️ | – | 1:07:50 h / 102,1 | nicht schneller und harmonischer als Harmonie |
| Hain Wachstum/Harmonie, Zyklus 1 / 2 / 3 | 0,870 / 0,977 / 1,022 | 0,869 / 0,996 / 1,003 | ≥ 0,85 / ≥ 0,97 / ≥ 1 (Prüfung im Test) |

### Playtest Amphibien und mittleres Spiel (umgesetzt)

Details, Messung und verworfene Hebel: [`DESIGN_V2.md`](DESIGN_V2.md), 5.5 und 15.4
(„Stand Playtest Amphibien“). Nur Daten, ein Hinweis-Knopf in der Seitenleiste und zwei
Zeichnungen – keine neue Logik, kein neues Spielstand-Feld.

**Befund:** Amphibien wurden nicht zu selten *gewählt*, sondern zu selten *angeboten*:
Der Harmonie-Spieler nahm in 56 % der Begegnungen mit Amphibien-Karte eine Amphibie (bester
Harmonie-Gewinn +2,7 ⚖️ gegen +2,2 ⚖️ der übrigen Karten), hatte bis zum Urwald aber nur 4,1
solcher Begegnungen (3 von 35 Arten im Pool, Tümpel erst nach ~51 min offen). Die Gattungsstufe 5 war unerreichbar.

| Zahl (`src/content/`) | vorher | jetzt |
|---|---|---|
| 🐸 Laubfrosch (`species.ts`, neu) | – | selten, ab Alter Baum, Waldtümpel; Feuchte, sonnig, 1× Sträucher; jagt Insekten (−20 %), +6 % 🌰, +2 ⚖️ |
| 🐸 Kammmolch (`species.ts`, neu) | – | selten, ab Hain, Waldtümpel; Feuchte, schattig, Totholz; jagt Schnecken (−30 %), +6 % 🌿, +2 ⚖️ |
| 💧 Waldtümpel, Rang 2 (`care.ts`) | +1 Platz Waldtümpel | **+2 Plätze** (Pflege zusammen 4) |
| 🐸 Krötenwanderung, „Laichplätze schaffen“ (`events.ts`) | nächste Begegnung Grasfrosch/Bergmolch | … oder Laubfrosch/Kammmolch |

Sonnenseite (Grasfrosch, Laubfrosch: 🌰) und Schattenseite (Erdkröte, Bergmolch, Kammmolch:
🌿) – ein Tümpel für alle verlangt einen lichten Wald. Stufe 5 (+12 % 🌿) braucht alle fünf
Arten und den fünften Platz aus „Regenreicher Frühling“ oder „Krötenwanderung“.

**Simulation** (`npm run balance`, 500 Durchgänge; Amphibien-Kennzahlen mit eigener Auswertung
der Simulator-Läufe, 500 Durchgänge bis Urwald):

| Kennzahl | vorher | jetzt | Ziel |
|---|---|---|---|
| Hain Harmonie / Wachstum / Zufall | 1:03:51 h / 54:31 min / 1:35:33 h | 1:03:51 h / 54:31 min / 1:35:36 h | 55–65 min (Harmonie) |
| Wald / Urwald (Harmonie) | 1:54:46 h / 2:47:38 h | 1:56:18 h / 2:49:39 h | ~1:40 h / ~2:20 h (±25 %) |
| ⚖️ beim Hain (Harmonie / Wachstum) | 107,2 / 101,3 | 107,4 / 101,3 | Harmonie vorn |
| 🌰-Bestand Hain / Wald (Harmonie, min Produktion) | 8,3 / 10,1 | 8,5 / 10,7 | < 10 / < 12 |
| Begegnungen mit Amphibien-Karte bis Urwald (Harmonie / Wachstum) | 4,1 / 3,9 | 6,3 / 6,4 | – |
| Amphibien beim Urwald (Harmonie / Wachstum / Zufall) | 2,2 / 1,9 / 2,0 | 3,2 / 2,6 / 2,8 | – |
| Gattungsstufe 3 / 5 beim Urwald (Harmonie) | 38 % / 0 % | 77 % / 5 % | 5 selten |
| „Amphibien stapeln“: Hain / ⚖️; Stufe 5 beim Urwald | 1:07:50 h / 102,1; 0 % | 1:07:41 h / 102,3; 24 % | nicht schneller und harmonischer als Harmonie |
| Hain Wachstum/Harmonie, Zyklus 1 / 2 / 3 | 0,869 / 0,996 / 1,003 | 0,872 / 1,003 / 1,009 | ≥ 0,85 / ≥ 0,97 / ≥ 1 |

**UX:** Die verschlossene Nische Waldtümpel zeigt ab „Alter Baum“ den Knopf „Zur Pflege“ – er
klappt die (auf dem Handy zugeklappte) Pflege auf und springt zur Maßnahme.

## Frühes Spiel (Playtest, v2, umgesetzt)

Details, verworfene Hebel und alle Tabellen: [`DESIGN_V2.md`](DESIGN_V2.md), Abschnitt 8,
15.4 („Stand Playtest frühes Spiel“) und 14 (Entscheidung 13). Kein neues Spielstand-Feld.

- **Befund:** Im ersten Spiel war 2:30–4:20 zäh – Pflanzring im Setzling voll, Pflege erst
  ab Junger Baum, Samen ohne Verwendung, Begegnungen 35 → 60 → 110 s auseinander.
- **Lösung:** Pflege beginnt im Setzling mit zwei kleinen Rängen; die Nistkästen werden
  günstiger. Wegpunktkurve, Pflanzring und Neu würfeln bleiben.
- **Neue Kennzahlen** im Simulator: längste Pause ohne Entscheidung (Begegnung, Pflanze,
  Pflege) in den ersten 6 bzw. 10 Minuten und der höchste Samenbestand vor dem Jungen Baum.

| Zahl (`src/content/care.ts`) | vorher | jetzt |
|---|---|---|
| 🪱 Kompost (neu) | – | ab Setzling, 200 🌰: Feuchte |
| 🍂 Laub liegen lassen, Rang 1 | Junger Baum, 750 🌰 | **Setzling, 200 🌰** |
| 🏠 Nistkästen, Rang 1 | 1.100 🌰 | **650 🌰** |

| Kennzahl (500 Durchgänge, `npm run balance`) | vorher | jetzt | Ziel |
|---|---|---|---|
| Längste Pause erste 6 min, Median: Harmonie / Wachstum / Zufall | 1:41 / 1:34 / 2:15 min | **1:08 / 1:05 / 1:38 min** | ~30–60 s; Prüfung ≤ 75 s, jede Strategie < 105 s |
| Längste Pause erste 10 min, Median (Harmonie) | 2:05 min | 2:06 min | nicht zäher |
| Samen ungenutzt vor dem Jungen Baum, Harmonie / Zufall | 312 / 584 🌰 | **200 / 277 🌰** | < 250 🌰 |
| Setzling / Junger Baum (Harmonie) | 46 s / 4:11 min | 46 s / 4:11 min | ~45 s / ~4 min |
| Hain Harmonie / Wachstum | 1:04:08 h / 54:42 min | 1:03:48 h / 54:30 min | 55–65 min |
| Hain Wachstum / Harmonie, Zyklus 1 / 2 / 3 | 0,865 / 1,005 / 1,039 | 0,867 / 0,978 / 1,021 | ≥ 0,85 / ≥ 0,97 / ≥ 1 |
| 🌰-Bestand beim Hain (Harmonie, min Produktion) | 8,2 | 9,1 | < 10 |

Die Wegpunkte im Setzling liegen von Natur aus ~60 s auseinander – ohne die
Wegpunktkurve (Teil des Spielstands) anzufassen, bleibt der Median knapp über einer Minute.
Ein Wurzelraum-Platz für den Kompost (erste Fassung) machte alle ~5 % schneller und den
Wachstums-Spieler 15,4 % schneller als den Harmonie-Spieler – darum bringt der Kompost
Feuchte statt eines Platzes.

**Außerdem:** Die Harmoniestufe ab 120 heißt jetzt „Ursprüngliche Wildnis“ (vorher „Urwald“,
gleichnamig mit der Wachstumsstufe).

## Jahreszeiten (v2, umgesetzt)

Details, Begründung und Umsetzungsnotiz: [`DESIGN_V2.md`](DESIGN_V2.md), Abschnitt 16.

- **Ein Jahr = 12 Minuten Spielzeit** (4 × 3 min, `SEASON_SECONDS = 180`). Es zählt die
  Spielzeit des Zyklus (`cycle.elapsed`), nicht die Uhrzeit; offline läuft das Jahr mit.
  Jeder Zyklus beginnt im Frühling. Bis zum Hain vergehen gut 5 Jahre (seit 2.10).
- Wirkungen wechseln an der Grenze, die Grafik blendet stufenlos über
  (`SceneInput.season = (elapsed / 180 − 0,5) mod 4`).
- **Sanft, kein Warten:** Jede Jahreszeit bringt etwas; der einzige Abzug ist −10 % 🌿 im
  Winter. Kosten und Samen-Sekunden hängen nie von der Jahreszeit ab.

| Jahreszeit | Wirkungen (Faktor 1) | Begegnungen |
|---|---|---|
| 🌱 Frühling | +10 % 🌿; Amphibien +15 % 😊 | „Etwas keimt“ × 1,5 (nur bei freiem Pflanzring); Kraniche, Regenreicher Frühling, Bienenschwarm, Krötenwanderung |
| ☀️ Sommer | +2 ☀️; Insekten +10 % 😊 | Schwalben, Taubenschwänzchen, Hirschkäferflug, Mittsommer, Bienenschwarm |
| 🍂 Herbst | +20 % 🌰; Pilze +15 % 😊 | Kraniche, Schwalben, Bergfinken, Seidenschwänze, Pilzherbst, Mastjahr |
| ❄️ Winter | −10 % 🌿; Säugetiere +15 % 😊, Bodenleben +10 % 😊 | Zugvögel fort; Wintergäste Bergfinken und Seidenschwänze |

Ganzjährig: Wildschweine, Wanderfalke, Sturmnacht, Windwurf, Blitzschlag, Vogelsaat;
die Ameisenstraße ruht nur im Winter.

Im Spiel: Abzeichen „🍂 Herbst · noch 1:20 min“ in der Kopfzeile (Wirkungen als
Tooltip), kurzer Hinweis beim Wechsel, Abschnitt „Jahreszeiten“ in der Spielanleitung.

**Simulation** (echte Logik, Harmonie-Spieler, Stieleiche):

| | Junger Baum | Alter Baum | Hain | Wald | Urwald | ⚖️ beim Hain |
|---|---|---|---|---|---|---|
| ohne Jahreszeiten (Stand 2.4, ohne Pflege, 100 Durchgänge) | – | 16:56 min | 45:44 min | 1:18 h | 1:54 h | 100,1 |
| mit Jahreszeiten (ohne Pflege, 200 Durchgänge) | 3:26 min | 16:55 min | 45:46 min | 1:18 h | 1:53 h | 101,1 |
| **Balancing 2.10** (alle Systeme, 500 Durchgänge) | 4:11 min | 23:02 min | 1:03:45 h | 1:54:40 h | 2:47:31 h | 106,4 |

Der Frühling bringt den Setzling nach 46 s statt 50 s (Ziel ~45 s).

## Hauptbaum-Arten (v2, umgesetzt)

Details und Umsetzungsnotiz: [`DESIGN_V2.md`](DESIGN_V2.md), Abschnitt 17. Die Wahl
steht im Bereich „Neuer Zyklus“ (Radiogruppe, gesperrte Arten mit Hinweis).

- Der erste Zyklus beginnt immer mit der **Stieleiche**.
- **Buche und Kiefer** werden wählbar, sobald ihre Begleitpflanze (Rotbuche bzw.
  Waldkiefer) einmal im Pflanzring gewachsen ist – abgeleitet aus dem Naturtagebuch.
- **Weißtanne und Schwarzerle** (seit v15, `DESIGN_V2.md` 25) werden wählbar, sobald ihr
  Standort der Waldlandschaft gegründet ist (Bergmischwald bzw. Erlenbruch, dort Leitbaum und
  beim Gründen vorausgewählt); vor der Freischaltung der Landschaft erscheinen sie nicht.
- **Wahl beim Neuen Zyklus**; sie gilt für den ganzen Zyklus (`cycle.mainTree`).

| Art | Frucht | Gewinn | Verzicht |
|---|---|---|---|
| 🌳 Stieleiche | Eichel (Nüsse ab Alter Baum) | +1 Platz Krone (ab Junger Baum); Insekten +10 % 😊 | – |
| 🍂 Rotbuche | Buchecker (Nüsse ab Alter Baum) | +1 Platz Wurzelraum (ab Alter Baum); Pilze +15 % 😊 | −2 ☀️ ab Alter Baum |
| 🌲 Waldkiefer | Kiefernsamen | +1 ☀️, +1 💧; winterfest (kein Winter-Abzug); Merkmal Nadeln | keine Nüsse |
| 🎄 Weißtanne | Tannensamen | Vögel +10 % 😊; +1 Platz Stamm & Rinde (ab Junger Baum); winterfest; Merkmal Nadeln | −1 ☀️ ab Alter Baum; keine Nüsse |
| 🌿 Schwarzerle | Erlensamen | Amphibien +10 % 😊; Blumen +15 % 🌿; +1 Platz Waldtümpel ab Junger Baum (öffnet ihn ohne Pflege) | keine Nüsse; nicht winterfest |

**Simulation** (Balancing 2.10: echte Logik, alle Systeme, 300 Durchgänge, erster Zyklus
ohne Waldgedächtnis): Hain des Harmonie-Spielers mit Eiche 1:03:14 h (⚖️ 106,7), Buche
−0,8 % (108,5), Kiefer −2,5 % (105,6); Wachstums-Spieler Eiche 54:54 min, Buche +1,4 %,
Kiefer −4,4 %. Alle Arten innerhalb ±5 % der Eiche. Dafür bekommt die Buche ihren
Wurzelraum-Platz erst ab Alter Baum und die Kiefer +1 ☀️ statt +2 (`DESIGN_V2.md` 15.4).

## Schritt 2.11b: gleitende Harmonie-Schwelle beim Neuen Zyklus (v2, umgesetzt)

Details und Messungen: [`DESIGN_V2.md`](DESIGN_V2.md), Abschnitt 10, 15.4 („Stand Schritt
2.11b“) und 14 (Entscheidung 12). Kein neues Spielstand-Feld – der Wegpunkt ist `state.waypoint`.

- **Problem:** Mit der Hain-Schwelle 100 für alle Stufen hatten bei einem Neustart im Wald
  oder Urwald beide Spielweisen H_max über 115 und bekamen den vollen Bonus: kein
  Harmonie-Vorsprung (Urwald Zyklus 2: Wachstum/Harmonie 0,89) und ~100 Punkte je
  Urwald-Zyklus.
- **Lösung:** Die Schwelle folgt der typischen Harmonie (knapp unter der des
  Wachstums-Spielers) und gleitet mit jedem Wegpunkt; die Obergrenze sinkt leicht, weil
  Sockel und neue Arten von selbst wachsen. Eine erste Fassung mit einer Schwelle je Stufe
  ließ die Vorschau beim Stufenwechsel fallen (bis 26 Punkte im Mittel) – Wachsen darf sich
  nie wie ein Verlust anfühlen. Das Panel „Neuer Zyklus“ nennt die erste ganze Harmonie
  mit Bonus („ab 101“ im Hain; an krummen Schwellen exakt nach Formel, z. B. Wegpunkt 27
  „ab 123“) und „etwa +3 je Punkt“ (einzelne Schritte 2–4 wegen gemeinsamer Abrundung), die Spielanleitung die Werte je Stufe.

| Zahl (`src/content/memory.ts`, `MEMORY_HARMONY_RULES`) | vorher | jetzt |
|---|---|---|
| Harmonie-Bonus am Hain (Wegpunkt 20) | 3 je Punkt über 100, höchstens 45 (ab 115) | unverändert |
| … je weiterem Wegpunkt | gleich | Schwelle +3,125, Obergrenze −0,4375 (krumm, Abrunden erst am Ende) |
| … im Wald (Wegpunkt 28) | wie Hain | über 125, höchstens 41,5 (ab 139) |
| … im Urwald (Wegpunkt 36) | wie Hain | **über 150, höchstens 38** (ab 163) |

| Kennzahl (100 Durchgänge, drei Zyklen, jeder bis zur Neustart-Stufe) | vorher | jetzt | Ziel |
|---|---|---|---|
| Wachstum / Harmonie Zyklus 2 / 3, Neustart Wald | 0,897 / 0,875 | **1,054 / 1,061** | ≥ 0,97 |
| … Neustart Urwald | 0,890 / 0,838 | **0,989 / 1,009** (200: 0,988 / 1,029) | ≥ 0,97 |
| … Neustart Hain | 0,982 / 1,006 | unverändert | ≥ 0,97 |
| Gedächtnis Zyklus 1 Wald, Harmonie / Wachstum / Zufall | 89,2 / 85,1 / 60,6 | 76,8 / 58,0 / 40,0 | mehr als Hain (60,6 / 48,8 / 30,0) |
| Gedächtnis Zyklus 1 Urwald, Harmonie / Wachstum / Zufall | 100,2 / 97,8 / 91,1 | 88,4 / 72,4 / 49,8 | Harmonie ≤ ~1,5 × Hain |
| Gewinn Urwald / Hain, Harmonie-Spieler | 1,65 | **1,46** | ≤ ~1,5 |
| Zyklus 2 schneller, Zufall: Wald / Urwald | 37,7 / 50,4 % | 28,7 / 35,3 % | ≥ 20 % |
| Vorschau sinkt beim Erreichen eines Wegpunkts (Harmonie / Wachstum / Zufall) | – | 26–38 / 44–48 / 10–16 %, im Mittel −1 bis −7, höchstens −10 | möglichst nie |

Der Gewinn sinkt nie, solange H_max je Wegpunkt um mindestens 3 steigt (typisch: +3,2 bis
+4,0). Bleibt H_max an einem Wegpunkt gleich, sank die Vorschau bis Spielstand v9 kurz um bis
zu 10 Punkte je Wegpunkt. Seit v10 gibt es dafür die Sperrklinke (unten).

### Sperrklinke für die Vorschau (Spielstand v10, umgesetzt)

Wachsen darf sich nie wie Verlust anfühlen: Der Zyklus merkt sich den besten Harmonie-Anteil
des Waldgedächtnis-Gewinns (`cycle.bestHarmonyMemory`, ohne neue Arten – die zählen ohnehin
nur nach oben). Angezeigt und gutgeschrieben wird `max(gemerkt, aktuell) + neue Arten`. Die
Vorschau im Panel „Neuer Zyklus“ sinkt damit nie, auch offline nicht. Das Panel bleibt in
der Form gleich; die Regel endet mit „– Erreichtes bleibt.“, die Spielanleitung sagt „Die
Vorschau sinkt nie“. v9-Stände starten mit ihrer aktuellen Vorschau. Details:
[`DESIGN_V2.md`](DESIGN_V2.md) 10, 12.7, 15.4 („Stand Sperrklinke“).

**Balancing-Folge:** Die Sperrklinke hielt beim Wachstums-Spieler die Spitzen fest, an
denen seine Harmonie gerade über der gleitenden Schwelle lag. Mit den Zahlen aus 2.11b
hielten zwei Ziele im großen Lauf nicht mehr (Wald/Urwald Zyklus 2 / 3 ≥ 0,97, Urwald ≤ 1,5
× Hain). Nachjustiert im Abschnitt unten.

### Abgleich mit der Sperrklinke (umgesetzt)

Details und Messungen: [`DESIGN_V2.md`](DESIGN_V2.md) 10, 14 (Entscheidung 12) und 15.4
(„Stand Abgleich Sperrklinke“). Neues Ziel (e) des Product Owners: Die Urwald-Schwelle liegt
~10 unter der typischen Harmonie des Harmonie-Spielers (174), und der Wachstums-Spieler
bekommt dort deutlich weniger Bonus. Kleine Formeländerung: Der **Sockel-Teiler gleitet**
mit (`divisor` in `MEMORY_HARMONY_RULES`, `memoryHarmonyBonus` in `core/formulas.ts`).

| Zahl (`src/content/memory.ts`, `MEMORY_HARMONY_RULES`) | 2.11b | jetzt |
|---|---|---|
| Hain (Wegpunkt 20): Teiler / Schwelle / Obergrenze | 5 / 100 / 45 (voll ab 115) | unverändert |
| Wald (Wegpunkt 28) | 5 / 125 / 41,5 (ab 139), linear dazwischen | **6 / 148 / 48** (ab 164), Stützstelle |
| Urwald (Wegpunkt 36) | 5 / 150 / 38 (ab 163) | **7 / 164 / 48** (ab 180) |
| je Wegpunkt Hain → Wald | Schwelle +3,125 | Teiler +0,125, Schwelle **+6**, Obergrenze +0,375 |
| je Wegpunkt Wald → Urwald | Schwelle +3,125 | Teiler +0,125, Schwelle **+2** |

| Kennzahl (großer Lauf, 100 Durchgänge) | vor dem Abgleich (Sperrklinke, 150 / 38) | jetzt | Ziel |
|---|---|---|---|
| Wachstum / Harmonie Zyklus 2 / 3, Neustart Wald | 0,947 / 0,951 | **1,026 / 1,072** | ≥ 0,97 |
| … Neustart Urwald | 0,912 / 0,926 | **0,993 / 1,031** | ≥ 0,97 |
| … Neustart Hain | 0,982 / 1,006 | unverändert | ≥ 0,97 |
| Gewinn Zyklus 1 Wald, Harmonie / Wachstum / Zufall | 82,9 / 69,2 / 43,7 | 77,7 / 60,1 / 39,1 | mehr als Hain (60,6 / 48,8 / 30,0) |
| Gewinn Zyklus 1 Urwald, Harmonie / Wachstum / Zufall | 92,5 / 83,7 / 57,6 | 87,9 / 68,0 / 44,7 | Harmonie ≤ ~1,5 × Hain |
| Gewinn Urwald / Hain, Harmonie-Spieler | 1,53 | **1,45** | ≤ ~1,5 |
| Zyklus 2 schneller, Zufall: Wald / Urwald | 29,2 / 36,9 % | 28,0 / 31,6 % | ≥ 20 % |
| Bonus über dem Sockel im Urwald bei typischer H_max (Harmonie 174 / Wachstum 155) | 38 / 15 | **30 / 0** | Harmonie spürbar, Wachstum deutlich weniger |
| Vorschau sinkt beim Erreichen eines Wegpunkts | nie | nie | nie |

Mit 200 Durchgängen in vier Seed-Fenstern streut Zyklus 2 je Fenster um ±0,04; ≥ 0,97 gilt
im Mittel der Fenster, nicht in jedem einzelnen (`DESIGN_V2.md` 15.4).

**Nachtrag nach dem frühen Spiel (#52):** Mit 100 Durchgängen fiel Wald Zyklus 2 auf 0,967.
Keine Regelvariante verschiebt das um mehr als ~0,005 (der Wald-Gewinn hängt fast nur am
gemerkten Hain-Wert); es war Streuung (200 Durchgänge im selben Fenster: 0,984). Die Zahlen
bleiben, der große Lauf rechnet den Neustart jetzt mit 200 Durchgängen: Wald 0,984 / 1,057,
Urwald 0,987 / 1,036, Urwald 1,44 × Hain, Zufall Zyklus 2 29 / 32 % schneller.

**Prüfung Phase 6 (Urwald-Gewinn 93,5 gegen die Grenze < 95):** Die Zahlen bleiben. Der Bonus
im Urwald ist beim Harmonie-Spieler meist voll (48); gestiegen ist der Gewinn durch höhere
H_max und neue Arten. Eine Obergrenze 46 brächte nur −0,8 Punkte Puffer, senkte Wachstum ÷
Harmonie im Urwald um ~0,01 (Grenze 0,95) und kostete in der Landschaft −2 Punkte je
Urwald-Zyklus (`DESIGN_V2.md` 15.4, „Stand Balancing Phase 6“).

## Schritt 2.11: Harmonie lohnt sich über die Zyklen (v2, umgesetzt)

Details und Messungen: [`DESIGN_V2.md`](DESIGN_V2.md), Abschnitt 15.4 („Stand Schritt
2.11“ und „Untersuchung Schritt 2.11“) und 14 (Entscheidung 11).

- **Untersucht:** 14 Formeln für einen stärkeren Harmonie-Multiplikator (linear,
  quadratisch, exponentiell, Stimmungsstufen, nur auf Samen). Keine bringt den
  Harmonie-Spieler im ersten Zyklus über ~0,90 × Tempo des Wachstums-Spielers, weil
  dieser die echte Rate samt Multiplikator maximiert und Harmonie fast von selbst mitnimmt.
- **Entschieden:** Multiplikator bleibt `1 + H/100`, Wegpunkt-Kurve und Spielstand v7
  bleiben. Harmonie wirkt über das Waldgedächtnis beim Neuen Zyklus: zum Sockel wie
  bisher kommt ein Bonus für Harmonie über 100. Das Panel „Neuer Zyklus“ und die
  Spielanleitung nennen die Regel.
- **Ziele:** Zyklus 1: Wachstum höchstens ~15 % schneller; ab Zyklus 2: Harmonie-Spielweise
  mindestens gleichauf; ruhige Gelegenheitsspieler nicht schlechter als vorher (Zyklus 2
  ≥ 20 % schneller); Zyklus 2 schneller bis Hain je Spielweise: Wachstum 18–37 %,
  Harmonie 30–45 %.

| Zahl (`src/content/memory.ts`) | vorher | jetzt |
|---|---|---|
| Waldgedächtnis aus Harmonie | ⌊H_max / 5⌋ | ⌊H / 5⌋ **+ 3 je Punkt über 100, höchstens 45** (ab 115); H = H_max gerundet wie in der Anzeige |
| je neu entdeckter Art | 1 | 1 |

| Kennzahl (200 Durchgänge, jeder Zyklus bis Hain) | vorher | jetzt |
|---|---|---|
| Hain Wachstum / Harmonie, Zyklus 1 / 2 / 3 | 0,858 / 0,857 / 0,873 | 0,859 / **0,973** / **1,044** |
| Zyklus 2 schneller bis Hain, Harmonie / Wachstum / Zufall | 28,8 / 28,9 / 22,9 % | 41,6 / 33,8 / 22,9 % |
| Waldgedächtnis Zyklus 1, Harmonie / Wachstum / Zufall | 33,4 / 33,2 / 29,1 | 59,4 / 47,3 / 30,0 |
| Summe bis Hain über drei Zyklen, Harmonie / Wachstum | 2:26:07 h / 2:05:55 h | 2:06:26 h / 1:57:35 h |
| Stammgäste gewählt in Zyklus 3, Harmonie / Wachstum | 2,0 / 2,0 | 4,5 / 3,3 |

Neustart erst im Wald oder Urwald: gleitende Schwelle seit Schritt 2.11b (oben).

## Erfolge (v2, umgesetzt)

Details, Katalog und Regeln: [`DESIGN_V2.md`](DESIGN_V2.md), Abschnitt 18 (Spielstand: 12.6).

- **25 leise Meilensteine** (`src/content/achievements.ts`): Stufen (Setzling, Hain,
  Urwald), Tagebuch (Arten 5/16/alle, alle Gattungen, Pflanzen 5/alle, Lebensgemeinschaften
  1/5/alle), beste Harmonie 30/60/150, Gäste 1/10, Ereignisse 5, Pflege-Ränge 10, Zyklen
  1/3/10, drei Hauptbaum-Arten, ein volles Jahr in einem Zyklus, 10 Stunden Spielzeit.
- **7 Erfolge der Waldlandschaft** (`DESIGN_V2.md` 24.12), verborgen bis zu ihrer
  Freischaltung (danach 32): zweiter Wald, zweiter Urwald, Wildwechsel (eine gewählte
  Wildwechsel-Karte, seit v15), gekaufter Korridor, jede Hauptbaum-Art (alle fünf, seit v15),
  Urwald überall, alle Korridore.
- Keine Belohnung in Zahlen, keine Zeitlimits, keine Namen von Unentdecktem.
- Anzeige: Naturtagebuch, Reiter „Erfolge“ (erreichte mit Beschreibung, offene gedämpft
  mit Fortschritt „3/5“); leiser Hinweis „🏅 Erfolg: …“ beim Freischalten.

## Balancing 2.10 (v2, umgesetzt)

Details, Vorher/Nachher-Tabellen und Begründungen: [`DESIGN_V2.md`](DESIGN_V2.md),
Abschnitt 15.4 („Stand Schritt 2.10“) und 14 (Entscheidung 10). Gemessen mit allen
Systemen (Pflege, Ereignisse, Gäste, Jahreszeiten), 500 Durchgänge, `npm run balance`.

| Zahl | vorher | jetzt |
|---|---|---|
| Wegpunkt k | 3,5 · k^3,4 | **3,5 · k^3,5** (Spielstand v7, alte Stände werden umgerechnet) |
| 🌿-Wirkungen der Arten | Prototyp | **×0,75** |
| 🌿-Gattungsboni | Vögel 20, Säuger/Boden 12 / 25, Pilze Bäume 10 / 30 % | **12, 7 / 15, 6 / 18 %** |
| Waldgedächtnis | +2 % je Punkt; H_max / 10 + 2 je neue Art | **+1 % je Punkt; H_max / 5 + 1 je neue Art** |
| Pflege-Kosten | 600 – 30.000 🌰 | **750 – 45.000 🌰** |
| Zwischenhalt ab Hain | 50 % | **70 %** |
| Rotbuche: +1 Wurzelraum | ab Keimling | **ab Alter Baum** |
| Waldkiefer | +2 ☀️ | **+1 ☀️** |

| Ziel | vorher | jetzt |
|---|---|---|
| Setzling ~45 s | 41 s | 46 s |
| Junger Baum ~4 min | 3:26 min | 4:11 min |
| Alter Baum ~20 min | 17:02 min | 23:02 min |
| Hain 55–65 min | 43:41 min | 1:03:45 h |
| Wald ~1:40 h / Urwald ~2:20 h | 1:13:55 h / 1:42:45 h | 1:54:40 h / 2:47:31 h |
| Wachstums-Spieler höchstens ~15 % schneller | 17,4 % | 14,8 % (5,7 Punkte weniger ⚖️) |
| Buche / Kiefer ±5 % der Eiche (Harmonie / Wachstum) | −4,7 / −3,8 %; −2,8 / −4,1 % | −0,8 / +1,4 %; −2,5 / −4,4 % |
| 🌰-Bestand beim Hain < 10 min Produktion | 4,9 min | 8,4 min |
| Zyklus 2 20–35 % schneller bis Hain (seit 2.11: Wachstum 18–37 %, Harmonie 30–45 %) | 44,3 % | 28,8 % |
| erster Stammgast nach 1–2 Zyklen | nach 1 | nach 1 (33 Punkte) |

**Bewusste Entscheidung Waldgedächtnis:** Gespeicherte Punkte werden beim Laden alter
Stände (v2–v6) **nicht** umgerechnet – 40 Punkte bleiben 40 Punkte und bringen jetzt +40 %
statt +80 %. Eine Verdopplung wäre falsch: Ein Zyklus bringt mit der neuen Formel ungefähr
gleich viele Punkte wie mit der alten, und die Stammgast-Plätze (je 25 Punkte) würden sich
verdoppeln. Wer Waldgedächtnis oder ein Andenken hat, sieht beim ersten Laden einmal den
Hinweis „Das Waldgedächtnis wurde neu gewichtet: +1 % je Punkt.“ (`DESIGN_V2.md` 14).

**Tests:** Die Balancing-Tests prüfen im normalen Check (wenige Durchgänge, feste Seeds)
weitere Grenzen (Hain 52–68 min, Wachstums-Spieler ≥ 0,80 × Harmonie, Baumarten ±8 %),
die Ziele oben nur im großen Lauf (`npm run balance`). Formeln und Zahlen hält
`tests/golden.test.ts` fest (gezielte Regeln und eine Golden-Tabelle
`tests/__snapshots__/golden.json`); gewollte Zahlenänderungen dort mit `-u` übernehmen.

## Vision

Ein ruhiges, grafisches Incremental Game. Du bist ein Samen und wächst – sichtbar –
über einen Baum bis zu einem riesigen Urwald. Jede Entscheidung soll sich im Bild
zeigen: mehr Wurzeln, mehr Blätter, mehr Bäume.

**Gefühl:** entspannt, organisch, belohnend. Keine Hektik, keine Bestrafung.

## Kernschleife

```
Wurzeln ──► 💧 Wasser ─┐
                       ├─► Photosynthese ──► 🍬 Energie ──► Upgrades kaufen
Blätter ──► ☀️ Licht  ─┘    (begrenzt durch                       │
                             Kapazität)                            ▼
                                               Gesamtenergie ──► nächste Stufe
```

- Wasser und Licht werden produziert und gesammelt. **Der Samen wächst von selbst:**
  Grundproduktion 1 Wasser/s und 1 Licht/s (`BASE_WATER`, `BASE_LIGHT`), Photosynthese
  1/s (`BASE_PHOTOSYNTHESIS`). Das Spiel läuft also komplett ohne Klicks.
- **Photosynthese** wandelt pro Sekunde bis zu *Kapazität* Einheiten Wasser + Licht
  in Energie um (1 Wasser + 1 Licht → 1 Energie).
- Energie im Gleichgewicht = `min(Wasser/s, Licht/s, Kapazität)`.
  → Der Spieler muss Wurzeln, Blätter und Photosynthese **ausbalancieren**. Das ist
  die zentrale Entscheidung des frühen Spiels.
- Der Button „Wachsen“ ist ein **optionaler Schub**: Ein Klick bringt sofort
  *eine Sekunde* der eigenen Wasser- und Lichtproduktion, mindestens aber +1 Wasser und
  +1 Licht (`CLICK_SECONDS = 1`, `CLICK_AMOUNT = 1`; Formel je Ressource:
  `max(1, 1 s · Rate)`). Klicken ist nie nötig.

### Entscheidung: Klicken (Playtest 1)

- **Problem:** Ohne Klicks passierte nichts – ständiges Klicken war Pflicht und nervig.
- **Lösung:** Passive Grundproduktion. Alle Zielzeiten gelten für einen Spieler, der
  **gar nicht klickt** und nur kauft.
- **Klick-Ertrag wächst mit:** Ein fester Ertrag (+1) wäre ab dem Setzling bedeutungslos
  (bei 50 Wasser/s brächte ein Klick 2 % einer Sekunde). „1 Klick = 1 Sekunde
  Wachstum“ ist leicht zu verstehen und bleibt das ganze Spiel über gleich wertvoll.
- **Warum moderat:** Der Klick bringt nur Wasser und Licht, keine Energie. Er läuft
  also durch den Photosynthese-Engpass – wer viel klickt, muss trotzdem in
  Photosynthese investieren, und mehr Klicks pro Sekunde haben abnehmenden Ertrag.
  Simuliert: wer am Anfang eifrig klickt, ist bis zum jungen Baum ~27 % schneller;
  wer das ganze Spiel 1×/s klickt, erreicht den Hain ~29 % früher (Tabellen unten).
  Mit `CLICK_SECONDS = 2` wären es ~34 %, mit 0,5 ~15 % – 1 ist der Mittelweg.
- **Der leere Start** (die ersten ~30 s ohne wirklich sinnvollen Kauf) bleibt bewusst
  so (Entscheidung Product Owner).

## Wachstumsstufen (MVP, implementiert)

| # | Stufe | Gesamtenergie | Grafik |
|---|---|---|---|
| 0 | Samen | 0 | Samen im Boden, Keim schiebt sich heraus |
| 1 | Keimling | 10 | Erste Verzweigung |
| 2 | Setzling | 300 | Dünner Stamm, erste Blätter |
| 3 | Junger Baum | 3.000 | Krone verzweigt sich |
| 4 | Alter Baum | 40.000 | Dicker Stamm, volle Krone |
| 5 | Hain | 300.000 | Weitere Bäume erscheinen |
| 6 | Wald | 3.000.000 | Viele Bäume |
| 7 | Urwald | 30.000.000 | Dichter Wald |

Die Schwellen bis „Hain“ sind per Simulation gebalanced (siehe „Balancing-Ziele“).
„Wald“ und „Urwald“ sind nur grob mit Faktor 10 fortgeschrieben.

Die Stufe richtet sich nach der **in diesem Durchgang insgesamt erzeugten Energie**,
nicht nach dem aktuellen Vorrat – Ausgeben wird also nie bestraft.

## Upgrades (MVP, implementiert)

Kosten: `baseCost · costGrowth^Stufe`

| ID | Name | ab Stufe | Basis | Wachstum | Effekt pro Stufe |
|---|---|---|---|---|---|
| root-hairs | Wurzelhaare | Samen | 12 | 1,30 | +0,5 Wasser/s |
| cotyledon | Keimblatt | Samen | 12 | 1,30 | +0,5 Licht/s |
| chlorophyll | Chlorophyll | Keimling | 30 | 1,22 | +1 Photosynthese/s |
| taproot | Pfahlwurzel | Setzling | 120 | 1,17 | +3 Wasser/s |
| canopy | Blätterkrone | Setzling | 120 | 1,17 | +3 Licht/s |
| chloroplasts | Chloroplasten | Junger Baum | 700 | 1,11 | +4 Photosynthese/s |
| root-network | Wurzelgeflecht | Alter Baum | 2.000 | 1,15 | +10 Wasser/s |
| leader-shoot | Wipfeltrieb | Alter Baum | 2.000 | 1,15 | +10 Licht/s |
| stomata | Spaltöffnungen | Alter Baum | 3.000 | 1,14 | +20 Photosynthese/s |
| root-grafts | Wurzelverwachsung | Hain | 7.500 | 1,14 | +30 Wasser/s |
| shade-leaves | Schattenblätter | Hain | 7.500 | 1,14 | +30 Licht/s |
| young-growth | Jungwuchs | Hain | 12.500 | 1,14 | +75 Photosynthese/s |

Wasser- und Licht-Upgrades einer Stufe sind bewusst symmetrisch, damit die
Entscheidung „Wurzeln, Blätter oder Photosynthese?“ allein vom aktuellen Engpass abhängt.

**Feine Stufen ab „Junger Baum“ (Takt):** Die teuren Upgrades ab Chloroplasten haben
halbe Kosten und halben Effekt pro Stufe, dafür ein Kostenwachstum von etwa der Wurzel
des alten Faktors (1,24 → 1,11; 1,33 → 1,15; 1,30 → 1,14). Zwei neue Stufen kosten
damit ungefähr so viel wie früher eine (insgesamt ~7 % teurer), aber kein einzelner
Kauf kostet mehr als ~1 Minute Produktion. Vorher kosteten z. B. Spaltöffnungen beim
Erreichen des alten Baums (~57 Energie/s) über 2 Minuten Produktion.
Die Hain-Upgrades kosten beim Erreichen des Hains (~215 Energie/s) etwa 35–60 Sekunden
Produktion, damit es direkt etwas Neues zu kaufen gibt.

## Geplante Systeme (noch nicht implementiert)

### Nährstoffe & Pilznetzwerk (Mykorrhiza)
- Neue Ressource 🌱 Nährstoffe, benötigt für größere Upgrades.
- Pilznetzwerk = **Automatisierung**: Sammelt Nährstoffe, später kauft es automatisch
  günstige Upgrades.

### Jahreszeiten
- In v2 umgesetzt: siehe Abschnitt „Jahreszeiten (v2, umgesetzt)“ oben.
  Die halbierte Winter-Produktion aus diesem v1-Entwurf ist verworfen (zwingt zum Warten);
  stattdessen −10 % 🌿 im Winter und +10 % im Frühling.

### Samen & Prestige („Neuer Zyklus“)
- Ab „Alter Baum“ produziert der Baum 🌰 Samen.
- **Prestige:** Ein Waldbrand oder das natürliche Ende eines Zyklus setzt Energie,
  Upgrades und Stufe zurück. Gesammelte Samen bleiben und geben dauerhafte Boni
  („Aus der Asche wächst ein stärkerer Wald“).
- Samen-Formel (Vorschlag): `floor((totalEnergy / 1e5)^0.5)`.
- Samen-Shop: dauerhafte Upgrades (Startboni, schnellere Stufen, neue Baumarten).

### Ereignisse
- Zufällige Ereignisse alle paar Minuten: Regenschauer (+Wasser), Sonnentag (+Licht),
  Dürre, Schädlinge (abwehrbar per Klick), Sturm.
- Zufall nur über einen gespeicherten Seed im GameState (Determinismus!).

### Tiere & Helfer
- Eichhörnchen verteilen Samen (mehr Bäume im Hain), Vögel bringen Dünger,
  Bienen bestäuben (Bonus auf Samen).

### Baumarten (späteres Spiel)
- In v2 umgesetzt: siehe Abschnitt „Hauptbaum-Arten (v2, umgesetzt)“
  oben. Nach dem ersten Neuen Zyklus: Eiche (ausgewogen), Buche (schattig, Pilze),
  Kiefer (Licht, winterfest) –
  jede Art mit eigener Grafik und eigenen Boni. Die Grafik ist fertig
  (`SceneInput.mainTree`: 'oak' | 'beech' | 'pine'): Eiche wie bisher; Buche mit glattem
  grauem Stamm und dichter ovaler Krone; Waldkiefer mit schlankem, astfreiem Schaft,
  durchgehendem Leittrieb und Nadelbüscheln in Etagen – jung kegelig, alt schirmartig.

## Balancing-Ziele

Alle Ziele gelten für einen Spieler, der **nie klickt** und nur kauft.

| Meilenstein | Ziel-Spielzeit (ohne Klicks) |
|---|---|
| Keimling | < 30 Sekunden |
| Setzling | ~ 2 Minuten |
| Junger Baum | ~ 8 Minuten |
| Alter Baum | ~ 25 Minuten |
| Hain | ~ 1 Stunde |
| Erstes Prestige sinnvoll | 1–2 Stunden |

**Takt:** Zwischen zwei Käufen sollen bis einschließlich Hain etwa 45 Sekunden
vergehen, früh gern weniger, aber nirgends deutlich mehr als ~60 Sekunden.
Die Zielzeiten pro Stufe mussten dafür nicht angepasst werden.

### Simulation

`scripts/simulate.ts` spielt das Spiel mit der echten Logik (`tick`, `clickGrow`,
`buyUpgrade`) in 0,1-s-Schritten durch. `tests/balance.test.ts` prüft die Zielzeiten
für den Nicht-Klicker mit Toleranz Faktor 2, den Takt (je Abschnitt Keimling bis Alter
Baum: Median ≤ 60 s, längste Wartezeit ≤ 90 s) und dass Klicken spürbar, aber nicht
mehr als doppelt so schnell macht. Die Tabellen landen im Testprotokoll:

```bash
npx vitest run tests/balance.test.ts --silent=false
```

**Strategie (alle Spielertypen):** Kauft das Upgrade, das min(Wasser/s, Licht/s,
Photosynthese) erhöht (Klicks zählen als Wasser/Licht mit) und dabei die kürzeste Summe
aus „Wartezeit bis bezahlbar“ und „Amortisationszeit“ hat. Hilft kein Upgrade direkt,
verbessert er das knappste freigeschaltete Glied.

**Spielertypen:**
- **Nicht-Klicker** (Standard, für ihn gelten die Ziele): klickt nie.
- **Aktiver Spieler:** klickt 2 Minuten lang 3×/s, bis Minute 10 noch 1×/s, danach
  nicht mehr (das frühere Standardprofil).
- **Dauerklicker:** 3×/s in den ersten 2 Minuten, danach das ganze Spiel 1×/s
  (Obergrenze für den Nutzen von Klicks).

**Takt:** Eine Zeile gilt für den Abschnitt *ab* dieser Stufe bis zur nächsten. Gezählt
werden Kaufmomente (mehrere Käufe im selben Schritt zählen einmal); die Wartezeit ist
die Zeit seit dem vorigen Kauf (bzw. seit Spielstart).

#### Nicht-Klicker

| Stufe | Ziel | Zeit vorher | Zeit jetzt | Energie/s | Käufe im Abschnitt | Takt Median | Takt max |
|---|---|---|---|---|---|---|---|
| Keimling | < 30 s | nie (ohne Klick keine Produktion) | 10 s | 1 | 12 | 11 s | 30 s |
| Setzling | ~ 2 min | nie | 2:34 min | 3 | 20 | 16 s | 30 s |
| Junger Baum | ~ 8 min | nie | 8:20 min | 13 | 61 | 14 s | 54 s |
| Alter Baum | ~ 25 min | nie | 25:17 min | 57 | 69 | 24 s | 58 s |
| Hain | ~ 60 min | nie | 55:28 min | 216 | 124 | 29 s | 1:52 min |
| Wald | – | nie | 125:36 min | 965 | – | – | – |

#### Aktiver Spieler

| Stufe | Zeit vorher | Takt vorher (Median / max) | Zeit jetzt | Takt jetzt (Median / max) |
|---|---|---|---|---|
| Keimling | 10 s | 5 s / 30 s | 10 s | 13 s / 30 s |
| Setzling | 1:51 min | 16 s / 24 s | 1:43 min | 15 s / 28 s |
| Junger Baum | 7:26 min | 16 s / 1:14 min | 6:03 min | 11 s / 47 s |
| Alter Baum | 26:18 min | 19 s / 1:53 min | 21:48 min | 24 s / 57 s |
| Hain | 59:30 min | 40 s / 3:50 min | 51:58 min | – |

„Vorher“ = Stand vor Playtest 1 (keine Grundproduktion, Klick = +1, grobe Upgrades).
Der **Dauerklicker** erreicht jetzt Setzling 1:43 min, Junger Baum 6:03 min, Alter Baum
19:12 min, Hain 39:25 min (Takt max 47 s).

**Bewertung Takt:** Die längste Wartezeit bis zum Hain liegt jetzt bei 58 s (vorher bis
zu 2 Minuten, ab Hain fast 4 Minuten). Der Median liegt mit 11–24 s unter den angepeilten
45 s, weil zwischen den großen Käufen günstige „Nachkäufe“ liegen (z. B. Wurzelhaare
für ein paar hundert Energie). Gröbere Upgrades würden den Median kaum heben
(vorher 16–19 s), aber die Maxima wieder verdoppeln.

**Offen:** Im Abschnitt Hain → Wald wachsen die Wartezeiten nach ~35 Minuten wieder über
60 s (bis ~2 min), weil es nach den Hain-Upgrades nichts Neues mehr gibt. Das gehört
zur Aufgabe „Wald und Urwald balancen“.
