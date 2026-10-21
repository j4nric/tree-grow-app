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
> (8 Maßnahmen mit 1–3 Rängen, wirken bis zum Neuen Zyklus; Schritt 2.7, `DESIGN_V2.md` 8);
> Jahreszeiten (Jahr = 12 min Spielzeit des Zyklus) und Hauptbaum-Arten (Eiche, Buche,
> Kiefer; Wahl beim Neuen Zyklus; `DESIGN_V2.md` 16 und 17);
> Spielstand v7 (v1-Stände starten neu, ab „Junger Baum“ mit +5 Waldgedächtnis;
> v2-Stände behalten ihren Fortschritt, Samen werden auf 58 begrenzt; v3-Stände laufen
> verlustfrei als erster Zyklus weiter; v4-Stände bekommen leere Ereignis-Felder, v5-Stände ohne Pflege eine leere Pflege;
> v5-Stände beginnen beim Laden im Frühling und wachsen als Stieleiche weiter; v3- bis
> v6-Stände werden auf die neue Wegpunkt-Kurve umgerechnet – gleicher Wegpunkt, gleicher
> Anteil bis zum nächsten). Regeln und Zahlen stehen in `DESIGN_V2.md` (Simulation:
> Abschnitt 15.4) bzw. `src/content/`. Ablehnen bringt vorerst fest 5 🌰, Neu würfeln
> kostet 10 🌰 (verdoppelt sich je Wurf).
>
> Ab „Vision“ beschreibt dieses Dokument **v1** (Wasser/Licht/Energie, Upgrades,
> Klick-Button) und ist nur noch historisch. Simulator und Balancing laufen auf v2:
> `scripts/simulate.ts`, `tests/balance.test.ts`, `tests/balance-care.test.ts`,
> `tests/balance-cycles.test.ts` und `tests/seasons-balance.test.ts` (Einstellungen in
> `tests/balance-setup.ts`). Großer Lauf mit allen Tabellen: `npm run balance`.

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
| 🌱 Frühling | +10 % 🌿 | „Etwas keimt“ × 1,5 (nur bei freiem Pflanzring); Kraniche, Regenreicher Frühling, Bienenschwarm |
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
- **Wahl beim Neuen Zyklus**; sie gilt für den ganzen Zyklus (`cycle.mainTree`).

| Art | Frucht | Gewinn | Verzicht |
|---|---|---|---|
| 🌳 Stieleiche | Eichel (Nüsse ab Alter Baum) | +1 Platz Krone (ab Junger Baum); Insekten +10 % 😊 | – |
| 🍂 Rotbuche | Buchecker (Nüsse ab Alter Baum) | +1 Platz Wurzelraum (ab Alter Baum); Pilze +15 % 😊 | −2 ☀️ ab Alter Baum |
| 🌲 Waldkiefer | Kiefernsamen | +1 ☀️, +1 💧; winterfest (kein Winter-Abzug); Merkmal Nadeln | keine Nüsse |

**Simulation** (Balancing 2.10: echte Logik, alle Systeme, 300 Durchgänge, erster Zyklus
ohne Waldgedächtnis): Hain des Harmonie-Spielers mit Eiche 1:03:14 h (⚖️ 106,7), Buche
−0,8 % (108,5), Kiefer −2,5 % (105,6); Wachstums-Spieler Eiche 54:54 min, Buche +1,4 %,
Kiefer −4,4 %. Alle Arten innerhalb ±5 % der Eiche. Dafür bekommt die Buche ihren
Wurzelraum-Platz erst ab Alter Baum und die Kiefer +1 ☀️ statt +2 (`DESIGN_V2.md` 15.4).

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
| Zyklus 2 20–35 % schneller bis Hain | 44,3 % | 28,8 % |
| erster Stammgast nach 1–2 Zyklen | nach 1 | nach 1 (33 Punkte) |

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
