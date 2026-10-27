# Playtest Phase 10 + 11 (Roadmap Phase 11, 5b)

> **Stand:** 2026-10-27, `main` nach Phase 11, 3a (Spielstand v18). Durchgeführt von `qa-tester`
> mit Playwright und Testuhr (`page.clock`). Screenshots in `docs/playtest/phase11/`.
> Fragen aus `docs/ROADMAP.md` (Phase 11, 5b) und offene Fragen aus `docs/DESIGN_V2.md` 27.13 / 28.12.

## Aufbau

- **Spieler-Bot „wie ein echter Spieler“:** Neues Spiel (fester Seed, Gedächtnis 0, Eiche), Testuhr
  angehalten, alle **30 s Spielzeit** ein Blick ins Spiel (Sprünge < 60 s zählen als „online“, 28.3).
  Bei jedem Blick: Zettelstapel abarbeiten (erste wählbare Karte, Gast bewirten, sonst ablehnen),
  dann **der Zielzeile folgen**, solange sie „Jetzt: …“ sagt (Tipp auf die Zeile → Tipp auf den
  aufleuchtenden Knopf), danach „🔍 N erforschbar ›“ → alles Bezahlbare erforschen (Gabel: Desktop
  die erste, Handy die letzte Seite). Kaufmenge immer ×1. Kein Säen außerhalb der Zielzeile.
  Der Bot spielt also *bewusst naiv*: Er tut, was die Oberfläche vorschlägt – genau das soll die
  Zielzeile leisten.
- **Läufe:** Desktop 1200 × 800 bis Wald + 10 min, dann Neuer Zyklus und 20 min Zyklus 2;
  Handy 390 × 844 bis Hain; 8 h offline (neuer Tab, `lastTick` −8 h) mit dem Alten Baum (1200 px)
  und dem Hain (390 px); Wald-Stand bei 360 px angesehen; künstlicher Stand mit Ausbaustufe 150
  bei 360/390 px (Funde aus 5a). Keine Konsolenfehler in allen Läufen.
- Der Treiber war ein Wegwerf-Spec (nicht eingecheckt); er nutzt dieselben Helfer wie
  `e2e/full-cycle.spec.ts`.

## Messwerte aus dem Spiel (Desktop, Zyklus 1)

| Stufe | erreicht nach | Blicke mit „Jetzt:“ | Käufe 🌰 (davon Säen) | Wartezeit laut Zielzeile, Median / max | 🌰-Bestand Median | ⚖️-Vorrat Median / max | Knoten |
|---|---|---|---|---|---|---|---|
| Setzling | 1:00 | 9 / 9 | 15 (1) | – | 19 | 49 / 76 | 2 |
| Junger Baum | 5:30 | 43 / 46 | 55 (1) | 5 / 10 s | 57 | 163 / 590 | 4 |
| Alter Baum | 28:30 | 76 / 99 | 80 (2) | 10 / 35 s | 210 | 351 / 1.042 | 5 |
| Hain | **1:18 h** | 70 / 115 | 72 (2) | 15 / 45 s | 577 | 419 / 966 | 8 |
| Wald | **2:15 h** | 14 / 21 | 15 (2) | 10 / 20 s | 1.171 | 593 / 1.091 | 1 |

- Längste Pause ohne irgendeinen Kauf: **90 s** (Alter Baum). Der Samenbestand lag immer unter
  ~1 min Produktion; die Zielzeile nannte nie mehr als 45 s Wartezeit.
- Handy 390 px: dieselbe Spur bis zum Alten Baum (28:30), Hain nach 1:19:30.
- Ende Wald: Baumteile je 25, Nischen 27 / 21 / 21 / 17 / 17 / 17 / 10 / 10 / 10 / 4 – davon
  **Waldsaum 21, Totholzhaufen 10 und Trockenmauer 4 ohne ein einziges Tier** (Fund F1).
- Kein Rang eines endlosen Knotens im ersten Zyklus (wie in 28.10 gemessen).
- Neuer Zyklus im Wald: **+41 Waldgedächtnis** (H 124, 21 neue Arten). Zyklus 2: Junger Baum nach
  4:00 statt 5:30, Kaufrausch wie gewollt (33 von 33 Blicken mit „Jetzt:“).
- Tempo: Der naive Zielzeilen-Spieler ist mit 1:18 h bis zum Hain ~35 % langsamer als der
  Harmonie-Spieler des Simulators (57 min) und schneller als der Zufallsspieler (1:25 h). Das ist
  plausibel (Karten ohne Nachdenken, nur ×1, Takt 30 s) und kein Fehler – aber ein Hinweis, dass
  die Zielzeile allein nicht zum *besten* Weg führt (F1).

## Antworten auf die Fragen der Roadmap

**Fühlt sich das Spiel noch ziellos an?** *Deutlich weniger.* Die Zielzeile ist immer da, nennt ein
Ziel mit Preis und Zeit („Nächstes: 🍄 Pilzgeflecht St. 24 · 1.988 🌰 · in 0:20“), der Sprung führt
sicher zum Knopf (0 Fehlsprünge in ~250 Käufen, Desktop und 390 px). Das *kurzfristige* Ziel ist
gelöst. Was bleibt: Die Zeile ist kurzsichtig – sie nennt fast immer „die nächste billigste Stufe“
und rotiert reihum durch alle Ziele (Jahresringe → Blattwerk → Pilzgeflecht → Wurzelraum → …).
Das fühlt sich nach Laufband an, nicht nach Plan; ein *mittelfristiges* Ziel („Wald in ~20 min“,
„Meilenstein 25: +1 Platz Höhlen“) steht nur klein im Abschnitt „Dein Baum“. Und sie schickt den
Spieler in Nischen ohne Tier (F1) – dort ist ein Kauf heute wirkungslos.

**Gibt es immer etwas zu kaufen, ohne Klick-Pflicht?** *Immer etwas zu kaufen: ja* (Takt 20–45 s,
längste Pause 90 s, Ziel 28.10 erfüllt). *Klick-Pflicht: nein* im strengen Sinn – wer nicht
klickt, verliert nichts, die Samen sammeln sich, ×10/Max und „Genug für N Ausbaustufen ›“ im
Rückkehr-Bericht holen es nach. Aber im aktiven Spiel ist alle 30 s *ein* Tipp-Paar fällig
(Zeile → Knopf); nach 8 h offline sind es 50–65 Stufen über 10–13 Zeilen mit Max. Für ein
Incremental Game angemessen; kein Handlungsbedarf vor Welle 6 (Vorschlag F7 optional).

**Ist 10 % offline fair?** *Ja.* 8 h am Hain: +6 Wegpunkte (Wald nicht erreicht), +57.492 🌰
(„Genug für 50 Ausbaustufen“), +4.562 ⚖️ – das entspricht etwa 40–45 min aktivem Spiel (online
brauchte der Bot für 8 Wegpunkte Hain → Wald 57 min). 8 h am Alten Baum: +7 Wegpunkte, *ein*
Wegpunkt vor dem Hain. Der Rückkehr-Bericht ist ehrlich („gemächlich (10 %)“, „mit einem Zehntel
der Kraft“, „Dein Wald wächst am schnellsten, während du zusiehst – im Hintergrund und offline mit
10 %“) und endet mit einem sofort einlösbaren Ziel. Die Nacht fühlt sich nach Belohnung an, nicht
nach Strafe. Kleinigkeit: Am Alten Baum fehlt nach 8 h genau ein Wegpunkt zum Hain – das wirkt
knapp verfehlt; kein Handlungsbedarf, aber als Beobachtung an `game-designer`.

**Fühlen sich die Forschungs-Gabeln wie Entscheidungen an?** *Ja, vom Text her:* Die Gabel ist als
Frage formuliert („Neue Arten im Totholz – oder zufriedene Pilze und kräftigere Bäume?“), beide
Seiten zeigen ihre Wirkung, nach der Wahl steht „anderer Weg gewählt“
(`phase11/desktop-forschung-gabel.jpg`). Die Seiten sind aber schwer vergleichbar (+1 Platz,
+1 Platz, +3 ⚖️ gegen Pilze +15 % 😊, Bäume +10 % 🌿, +2 ⚖️) – man wählt nach Geschmack, nicht
nach Rechnung. Das passt zum Spiel; die Gabel Saat (Samenbank 100 % im Simulator) blieb im
Playtest unauffällig – der Bot hat nie neu gewürfelt, eine Aussage zum Anzuchtbeet ist nicht
möglich. Empfehlung: wie 28.10 vorgeschlagen im Simulator messen (3b), nicht am Gefühl entscheiden.

**Verlieren Samen ab dem Wald ihren Sinn?** *Nein.* Im Wald kostet eine Stufe ~2.000–2.900 🌰 bei
~46 🌰/s, alle 20–40 s ist etwas fällig, der Bestand liegt bei ~1.200 🌰 (< 30 s Produktion). Die
Senke trägt bis zum Ende des Laufs; „Säen (tauschen) · 645 🌰“ bleibt daneben billig.

**Versteht man Vorrat gegen Produktion (⚖️)?** Der Kopf der Forschung („⚖️ 48 · +81/min“) und die
Zahl „🔍 N erforschbar ›“ machen es klar. Der Vorrat stieg zwischen zwei Knoten auf 300–1.000 ⚖️
(etwa 5–7 min); im Wald blieben ~1.000 ⚖️ ohne Ziel (keine Ränge gekauft). Mobil ging das schief
(F2).

## Empfehlungen zu den offenen Fragen

| Frage | Empfehlung 5b | Begründung |
|---|---|---|
| 27.13 Ereignis-Option „+N ⚖️“ als Sofort-Harmonie | **nein, nicht einführen** | ⚖️ war nie knapp: Vorrat 300–1.000 ⚖️ zwischen den Knoten, im Wald ~1.000 ohne Ziel. Mehr ⚖️ beschleunigt nur die Forschung, die ohnehin vorne liegt. |
| 27.13 Urwald-Ebene im Baum (Krönung je Ast) | **nein, die Zeile „∞“ reicht** | Im ersten Zyklus wird kein Rang gekauft, ⚖️ bleibt übrig – aber genau dafür sind die endlosen Knoten da. Eine weitere Ebene erst, wenn 3b zeigt, dass Ränge auch in späten Zyklen liegen bleiben. |
| 28.12 Klick-Pflicht alle 20–40 s | **so lassen**, F7 optional | Gemessen alle 30 s ein Kauf; kein Verlust beim Nichtstun. Kein „Ausbau-Plan“ (28.13 bleibt). |
| 28.12 10 % offline als Strafe | **10 % bleibt** | 8 h ≈ 40–45 min aktives Spiel, ehrlicher Text, Ziel am Ende. |
| 28.12 Hintergrund-Tab = offline | **so lassen** | Satz im Rückkehr-Bericht ist da und verständlich. |
| 28.12 Aussaat verliert gegen Ausbau | **beobachten** | Der Zielzeilen-Spieler sät nur, solange der Ring Plätze hat (8 Aussaaten bis Wald). Tauschen schlägt die Zeile nie vor. Bewusst so (28.7), aber der Ring-Tausch wird so leicht vergessen. |
| 28.12 / 28.11 Stufen-Tore (6a) | **nicht nötig** | Der Ausbau trägt das Wachsen (Baumteile je 25, Nischen 10–27 im Wald) statt daneben herzulaufen; ein Tor wäre eine Pflicht ohne Gewinn. |
| 28.12 / 28.11 Aufträge der Tiere (6b) | **später, niedrige Priorität** | Würde das Laufband erzählerisch lenken (F1/F4), ist aber ein neues Spielstand-Feld (v19). Erst F1 (Zielzeile meidet leere Nischen) und F4 (mittelfristiges Ziel) umsetzen und danach neu bewerten. |

**Welle 6:** 6a streichen bzw. nicht beginnen. 6b als Idee behalten, aber erst nach F1 und F4 neu
entscheiden (eigene Konzeptrunde nur, wenn sich das Spiel danach noch nach Laufband anfühlt).

## Funde (priorisiert)

### F1 – Zielzeile schickt in Nischen ohne Tier (mittel · `game-designer`, dann `core-engineer`)

- **Beobachtung:** Der Zielzeile folgend baut der Spieler Waldsaum auf Stufe 21, Totholzhaufen auf
  10 und Trockenmauer auf 4 aus, obwohl dort bis zum Wald kein Tier wohnt (Fußzeile „0/4 belegt“,
  „je Tier +1,3 %“). Die Wirkung ist 0 – nur der Meilenstein 10 („öfter in den Karten“) hilft
  später. `phase11/m360-wald-leere-nische.jpg`, `phase11/desktop-wald.jpg`.
- **Erwartet:** „Das nächste *lohnende* Ziel“ (28.7) – leere Nischen höchstens bis zum Meilenstein
  10 oder gar nicht vorschlagen.
- **Vorschlag:** In `goalCandidates`/`nextGoal` (`src/core/goal.ts`) Nischen ohne Tier überspringen,
  außer der nächste Kauf erreicht einen Meilenstein mit Wirkung; in der Fußzeile leerer Nischen
  „wirkt ab dem ersten Tier“ statt nur „je Tier +x %“ (`ui-dev`). Braucht eine Zahlprüfung, weil es
  das Tempo des Zielzeilen-Spielers verändert (Simulator-Strategie „folgt der Zielzeile“ wäre ein
  guter vierter Spieler für 3b).

### F2 – Mobil: „🔍 N erforschbar ›“ landet bei zugeklappten Ästen (mittel · `ui-dev`)

- **Beobachtung (390 px):** Beim ersten Öffnen der Forschung im Setzling ist nur „Boden“
  erforschbar; alle anderen Äste klappen zu (`research-tree.ts`, `initialOpenDone`). Später werden
  Wasser, Krone, Saum, Offenland, Saat erforschbar – sie bleiben zu. Der Sprung „🔍 5 erforschbar ›“
  öffnet die Seite oben beim (leeren) Boden-Ast. Der Bot kaufte darum vom Jungen Baum bis zum Hain
  keinen Knoten, der Vorrat stieg auf 4.661 ⚖️. Ein Mensch findet die Äste über „· 2 erforschbar“
  im Ast-Kopf und die Zahl am Register, aber nur mit Suchen. `phase11/m390-forschung-aeste-zu.jpg`.
- **Erwartet:** Der Sprung zeigt einen erforschbaren Knoten.
- **Vorschlag:** „erforschbar ›“ ruft `reveal(id)` des ersten bezahlbaren Knotens (Ast aufklappen,
  hinscrollen, Fokus) – wie die Zielzeile bei Nischen; zusätzlich einen Ast automatisch öffnen,
  sobald er *neu* erforschbar wird, solange der Spieler ihn nicht selbst zugeklappt hat.

### F3 – „N erforschbar“ zählt Knoten, die einzeln bezahlbar sind (niedrig · `ui-dev`)

- **Beobachtung:** Bei Ankunft im Hain „🔍 10 erforschbar ›“ mit 655 ⚖️; nach einem Kauf (Humusschicht)
  ist keiner mehr bezahlbar. Die Zahl verspricht mehr, als der Vorrat hergibt.
- **Vorschlag:** Text „10 erforschbar“ → „erforschbar (10 zur Wahl)“ oder die Zahl der
  nacheinander bezahlbaren Knoten (billigste zuerst, wie `affordableUpgradeSteps`).

### F4 – Kein mittelfristiges Ziel sichtbar (niedrig–mittel · `ui-dev`, Text `game-designer`)

- **Beobachtung:** Die Zielzeile ist kurzfristig (nächste Stufe eines Ausbaus) und rotiert reihum.
  Wie lange es bis zur nächsten Wachstumsstufe dauert, steht nirgends; mobil ist die Zielzeile
  weggescrollt, sobald man in R:Nischen nach unten geht (`phase11/m390-hain.jpg`).
- **Vorschlag:** In der Stufenleiste die Restzeit zur nächsten Stufe („Wald in ~22 min“); mobil die
  Zielzeile in die klebende Vorratsleiste (🌰 🌿 ⚖️) übernehmen oder dort ein „🎯“ zum Ziel.

### F5 – Zahl und „%“ trennen sich bei 360 px (niedrig · `ui-dev`)

- **Beobachtung:** Pilzgeflecht im Wald: „Pflanzen +11,5“ / Zeilenumbruch / „% 🌿 🌰“
  (`phase11/m360-wald-leere-nische.jpg`, oben). Ähnlich bricht „Lebensgemeinschaften 0 von 15
  aktiv ›“ den Pfeil in eine eigene Zeile.
- **Vorschlag:** `keepNumberWithIcon` um „%“ erweitern (geschütztes Leerzeichen bzw.
  `white-space: nowrap` für „+11,5 %“).

### F6 – „alle Meilensteine“ zerfällt neben langem Preis (niedrig, bestätigt aus 5a · `ui-dev`)

- **Beobachtung:** Ab Nischen-Stufe 50 steht „alle Meilensteine“ neben „Ausbauen · 37,68 Bio. 🌰“.
  390 px: „alle Meilens / teine“; 360 px: Buchstabe für Buchstabe („al / le / M / eil / en …“),
  ebenso „Abze / ichen / Gold“ (`phase11/m360-alle-meilensteine.jpg`, `phase11/m390-grosse-zahlen.jpg`).
  Ursache: `.upgrade-progress-label { overflow-wrap: anywhere }` in einer schmalen Spalte.
- **Einordnung:** Im normalen Spiel nicht erreichbar (Nischen im Wald bei 10–27, Urwald ~30);
  sichtbar erst mit sehr hohen Stufen. Niedrig.
- **Vorschlag:** Silbentrennung (`hyphens: auto`, das Album nutzt sie schon über `hyphenate.ts`)
  statt `anywhere`, Mindestbreite der Spalte, bei Platzmangel Text unter den Balken.

### F7 – Viele Einzelkäufe nach der Rückkehr (niedrig, optional · `game-designer`)

- **Beobachtung:** Nach 8 h „🎯 Genug für 50/65 Ausbaustufen ›“ – der Sprung führt zu *einer*
  Zeile; danach 10–13 Zeilen mit Max nacheinander.
- **Vorschlag (optional):** Am Rückkehr-Zettel ein bewusster Knopf „N Stufen ausbauen (billigste
  zuerst)“ – manueller Griff, kein Automat (28.13 bleibt). Nur, wenn sich Spieler beschweren.

### F8 – formatNumber ab ~1e15 unlesbar (niedrig, bestätigt aus 5a · `ui-dev`)

- **Beobachtung:** `Intl` kürzt höchstens auf „Bio.“: 1,234e15 → „1234 Bio.“, 5,6e18 →
  „5.600.000 Bio.“, 1e30 → „1.000.000.000.000.000.000 Bio.“. Bei Stufe 150 („37,68 Bio.“) noch
  lesbar.
- **Einordnung:** Erst ab Ausbaustufe ~190 bzw. Samen ≥ 1e15 – im Spiel praktisch nicht
  erreichbar (Wald: Preise ~2.000 🌰). Niedrig, aber billig zu beheben.
- **Vorschlag:** ab 1e15 eigene Kürzel („Brd.“, „Trio.“) oder wissenschaftlich („1,23 · 10¹⁵“), mit
  Test in `tests/settings.test.ts`.

### F9 – „+1 Stufe“ schwebt über der Forschung (niedrig · `ui-dev`)

- **Beobachtung:** Wer direkt nach einem Ausbau-Kauf „🔍 erforschbar ›“ tippt, sieht die Schwebe-Notiz
  „+1 Stufe“ des Kaufs auf der Forschungsseite über einer Gabel-Karte
  (`phase11/desktop-forschung-gabel.jpg`, unten rechts).
- **Vorschlag:** Schwebe-Notizen beim Reiterwechsel entfernen oder an die Seite binden.

### Ohne Befund

Neuer Zyklus (Vorschau „+41 Waldgedächtnis“, Bestätigung, Stempel „Zyklus 2 beginnt“,
`phase11/desktop-neuer-zyklus.jpg`, `phase11/desktop-zyklus2-start.jpg`); Rückkehr-Bericht auf
390 und 1200 px (`phase11/m390-offline-8h-hain.jpg`, `phase11/desktop-offline-8h-alter-baum.jpg`);
Zielzeilen-Sprung mobil und am Desktop; keine Konsolenfehler.
