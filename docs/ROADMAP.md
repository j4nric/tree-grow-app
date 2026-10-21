# Roadmap

Jede Aufgabe ist so geschnitten, dass ein Agent sie in **einem Branch / einem PR**
erledigen kann. In Klammern steht der zuständige Agent (siehe `.claude/agents/`).
Aufgaben derselben Phase ohne gemeinsame Dateien können parallel laufen.

## Phase 1 – Fundament ✅

- [x] Vite + TypeScript + Vitest aufsetzen
- [x] Core: GameState, tick, Photosynthese, Upgrades, Stufen
- [x] Speichern/Laden mit Offline-Fortschritt (max. 8 h)
- [x] Prozeduraler Baum-Renderer (Samen → Urwald)
- [x] Seitenleiste mit Ressourcen, Stufenfortschritt, Upgrades
- [x] CLAUDE.md, Game Design, Agent-Definitionen, CI

## Phase 2 – Spielbares MVP ✅

- [x] **Balancing-Simulator** – Skript, das eine Spielstrategie simuliert und die Zeit
      bis zu jeder Stufe ausgibt (`game-designer`)
- [x] **Upgrades bis „Hain“** ergänzen und auf die Zeitziele balancen (`game-designer`)
- [x] **Renderer aufwerten** – Baum in Offscreen-Canvas cachen, dichtere Krone,
      Wurzeln unter der Erde sichtbar, Himmel mit Wolken (`renderer`)
- [x] **Feedback beim Klicken** – schwebende „+1 💧“-Zahlen, Partikel, Kauf-Animation (`ui-dev`)
- [x] **Playwright-Smoke-Test** – Spiel starten, wachsen, kaufen, neu laden (`qa-tester`)

## Phase 2b – Nacharbeiten

- [x] Designentscheidungen: leerer Start, Start ohne Klick, Tempo im Mittelspiel (`game-designer`)
- ~~Wald und Urwald balancen, Samen-Formel an neue Schwellen anpassen~~ – mit v2 entfallen, Tempo jetzt in Schritt 2.11
- [x] Renderer: statische Kulisse getrennt cachen, Größenänderung entprellen (`renderer`) – für v2 geprüft:
      Kulisse, Erinnerungsbaum, Pflanzen und Stimmungslicht waren schon gecacht (Schlüssel jetzt als
      `sizeKey`/`seasonStepKey` getestet); neu: Canvas-Größe per ResizeObserver statt
      `getBoundingClientRect()` je Frame (mit `devicePixelContentBoxSize`, wo plausibel), Backing-Store
      ~100 ms entprellt (`CanvasSizer`); der Renderer übernimmt die schon entprellte Größe sofort
      (`sizeSettled`), Frame-Ersatzregel nur noch bei stehender Zeit
- [x] Renderer: Wind billiger (`renderer`) – Baum- und Pflanzen-Ebene nicht mehr schief kopiert,
      sondern in waagerechten Streifen verschoben (`src/render/wind.ts`): ab Pixeldichte 1,5
      ganzzahlig (reine Kopie ohne Filter), darunter in Viertelpixeln. Wind-Kosten im Software-Canvas
      von ~29–43 ms auf ~0 ms (Pixeldichte 2–3) bzw. von ~15 auf ~2,5 ms (Pixeldichte 1); reduzierte
      Bewegung pixelgleich
- ~~Seitenleiste: DOM-Referenzen einmal merken~~ – mit der v2-Seitenleiste entfallen
- ~~Schwebende Zahlen über dem Ressourcen-Label~~ – mit v2 entfallen

## Neuausrichtung v2 – Ökosystem

Design: [`DESIGN_V2.md`](DESIGN_V2.md) (Abschnitt 13). Tiere und Pflanzen kommen über
Begegnungen mit Kartenwahl; Wachstum, Zufriedenheit, Samen und Harmonie ersetzen
Wasser/Licht/Energie und Upgrades. Die offenen Punkte aus Phase 2b gelten für v1 und
entfallen weitgehend mit der Umstellung.

- [x] Designdokument v2 + Monte-Carlo-Prototyp `scripts/v2/` + `tests/design-v2.test.ts` (`game-designer`)
- [x] Offene Fragen entschieden (DESIGN_V2.md, Abschnitt 14) – Empfehlungen übernommen

### Schritt 1 – spielbarer Prototyp „nur Begegnungen + Kartenwahl“ (3 Gattungen × 3 Tiere)

Ausführung in Wellen, damit `main` nach jedem Merge spielbar und grün bleibt:

- **Welle A (parallel):** Kern v2 = 1.1–1.4 inkl. einfacher Bedienung und angepasster
  e2e-Tests in einem PR (`core-engineer`) · Kartenwahl-Dialog und Ökosystem-Übersicht als
  eigenständige Komponenten mit View-Model (`ui-dev`) · Tier-Ebene im Renderer mit
  Ankerpunkten je Nische (`renderer`)
- **Welle B (parallel, nach A):** Komponenten und Tier-Ebene verdrahten (`ui-dev`) ·
  1.6 Simulator auf echte Logik (`game-designer`) · 1.7 e2e (`qa-tester`)
- **1.8 Playtest** übernimmt das Team selbst (Playwright-Durchläufe, Screenshots), danach
  Schritt 2.


- [x] 1.1 Inhalte v2 als Daten: Arten, Nischen, Gattungsboni, Wegpunkte + Inhaltstests (`game-designer`)
- [x] 1.2 GameState v2, `SAVE_VERSION = 2`, Migration „Neustart mit Andenken“, `rngState` (`core-engineer`)
- [x] 1.3 `evaluate(state)`, Wegpunkte, Begegnungs-Warteschlange (max. 3), Offline (`core-engineer`)
- [x] 1.4 Aktionen `chooseCard`, `declineEncounter`, `rerollEncounter` (`core-engineer`)
- [x] 1.5 Kartenwahl-Dialog, Nischen-Liste, Harmonie-Anzeige; Upgrade-Panel und Klick entfernen (`ui-dev`)
- [x] 1.6 Simulator und `balance.test.ts` auf die echte v2-Logik umstellen (`game-designer`)
- [x] 1.7 Playwright: Karte wählen, Neuladen, gleiche offene Karten (`qa-tester`)
- [x] 1.8 Playtest des Prototyps mit dem PO

### Schritt 2 – Ausbau

- [x] 2.1 Pflanzen, Licht/Wasser-Versorgung, Samen, „Etwas keimt“, Pflanzen setzen (`game-designer` + `core-engineer`)
- [x] 2.2 Alle 5 Gattungen, 32 Arten, Gattungsboni, Seltenheit, Fähigkeiten (`game-designer` + `core-engineer`)
- [x] 2.3 Lebensgemeinschaften, vollständige Harmonie (`game-designer`)
- [x] 2.4 Ereignisse mit Wahl, Durchreisende (`core-engineer` + `game-designer`)
  - [x] Inhalte: 10 Ereignisse (seit Phase 3: 14) (`src/content/events.ts`), 8 Durchreisende
    (`src/content/visitors.ts`), Gewichte und Zwischenhalt ab Hain (`encounters.ts`),
    grobes Modell im Simulator (`scripts/extras.ts`), DESIGN_V2.md 7.2/7.4/7.5 (`game-designer`)
  - [x] Logik nach Umsetzungsnotiz DESIGN_V2.md 7.8 (SAVE_VERSION 5), Simulator auf echte
    Logik umstellen (`core-engineer`)
- [x] 2.5 Gattungsleiste, Pflanzenring, Harmonie-Aufschlüsselung (`ui-dev`)
  - [x] Lebensgemeinschaften-Ansicht: aufklappbare Übersicht in der Seitenleiste (aktive mit
    Harmonie, fast fertige mit „fehlt: …“, unentdeckte als „???“ mit Fortschritt), Hinweis
    „✨ vervollständigt …“ auf Karten und in „Pflanze setzen“, Entdeckungs-Meldung (`ui-dev`)
- [x] 2.6 Tiere und Pflanzen im Bild: Ankerpunkte, gecachte Sprites (`renderer`)
- [x] 2.7 Pflegemaßnahmen (`game-designer` + `core-engineer` + `ui-dev`)
  - [x] Inhalte: 8 Maßnahmen mit Rängen (`src/content/care.ts`), DESIGN_V2.md 8 (`game-designer`)
  - [x] Logik nach Umsetzungsnotiz DESIGN_V2.md 8.2, Simulator auf echter Logik (`core-engineer`)
  - [x] Schlichte Pflege-Liste in der Seitenleiste (`src/ui/care-panel.ts`)
  - [x] UI-Feinschliff: aufklappbar (mobil zu, „N kaufbar“), sortiert kaufbar → zu wenig Samen →
    gesperrt → voll ausgebaut (steht still, solange Fokus/Zeiger in der Liste sind), Vorschau als
    kurze Zeile „+3 ⚖️ / +2 % 🌿“, Bestätigung „Nistkästen angebracht“ nach dem Kauf (`ui-dev`)
- [x] 2.8 Neuer Zyklus, Naturtagebuch, Waldgedächtnis, Stammgäste (`core-engineer` + `game-designer` + `ui-dev`)
  - [x] Naturtagebuch-Ansicht: Dialog „📖 Naturtagebuch“ mit Reitern Arten, Pflanzen,
    Lebensgemeinschaften, Andenken; Unentdecktes als Silhouette „???“ ohne Spoiler;
    Stammgäste direkt wählbar; Statuszeile für Screenreader (`ui-dev`)
- [x] 2.9 e2e: voller Zyklus mit festem Seed (`qa-tester`)
- [x] Begegnungs-Vielfalt messen und verbessern: Pflanzengewicht bei vollem Ring, Ring-Pflanzen seltener (Playtest-Befund, `game-designer`)
- [x] Bedienungs-Funde aus dem Playtest (UI, `ui-dev`)
  - [x] Wartende Begegnungen: Knopf „N Begegnungen warten“ in der Seitenleiste statt Countdown;
    mobil (einspaltig ≤ 760 px) schwebt der Stapel, sobald seine Stelle in der Szene weggescrollt ist
  - [x] Pflege-Rang „Rang 0/2“, Legende nur mit vorkommenden Symbolen, einheitliche Vorschau-Chips
  - [x] Gäste: Hinweis, warum die Vorschau vom Nennwert abweicht (nur bei echter Abweichung)
  - [x] Lange Namen mit geprüfter Trenntabelle (`src/ui/hyphenate.ts`), Erfolg im Stufen-Banner
  - [x] Willkommen-Meldung: erreichte Stufe vorn (dann kein zweites Stufen-Banner), Einträge mit 0
    entfallen; Naturtagebuch-Reiter mobil in einer scrollbaren Zeile
- [x] 2.10 Balancing aller Zahlen mit dem v2-Simulator, `scripts/v2/` aufräumen (`game-designer`)
  - [x] Wegpunkte 3,5 · k^3,5 (Spielstand v7, Migration v6 → v7 erhält den Wegpunkt-Fortschritt),
    🌿-Wirkungen der Arten ×0,75, Pflegekosten, Waldgedächtnis (+1 % je Punkt, H_max/5, 1 je Art),
    Zwischenhalt 70 %, Buche und Kiefer angeglichen (DESIGN_V2.md 15.4, Stand Schritt 2.10)
  - [x] Simulator über mehrere Zyklen (Waldgedächtnis, Stammgäste, Kartenpool), `npm run balance`
    als großer Lauf, schnellere Standardläufe; `scripts/v2/` und `tests/design-v2.test.ts` entfernt
  - [x] `npm run balance` in CLAUDE.md unter „Befehle“ eingetragen

- [x] 2.11 Harmonie als spürbarer Hebel (Multiplikator stärker als `1 + H/100`), Tempo
  Wald und Urwald auf 1,15–1,2 × Zeitziel, Simulator-Nachweis (`game-designer`)
  - [x] Untersuchung: Ziel G/H 0,95–1,05 im ersten Zyklus ist mit keinem Multiplikator
    erreichbar (Grenze ≈ 0,90), siehe DESIGN_V2.md 15.4 „Untersuchung Schritt 2.11“; Tempo
    Wald/Urwald liegt schon bei 1,15 / 1,20 × Ziel
  - [x] Entscheidung (Option 1): `1 + H/100` bleibt; Harmonie lohnt sich über die Zyklen –
    Waldgedächtnis `⌊H/5⌋ + min(45, 3 · max(0, H − 100)) + neue Arten` mit
    H = round(H_max) wie in der Anzeige, ab Zyklus 2 Harmonie gleichauf,
    Gelegenheitsspieler nahezu unverändert; Regel im Panel „Neuer Zyklus“
    (DESIGN_V2.md 15.4 „Stand Schritt 2.11“, Entscheidung 11)
  - [x] 2.11b gleitende Schwelle für den Harmonie-Bonus (`game-designer`): Hain (Wegpunkt
    20) 100 / 45 → linear → Urwald (36) 150 / 38 (`MEMORY_HARMONY_RULES`,
    `cycleMemoryGain(…, waypoint)`); ab Zyklus 2 Harmonie gleichauf auch bei Neustart im
    Wald (1,05) und Urwald (0,99); Urwald-Zyklus 88 statt 100 Punkte (1,46 × Hain); kein
    Sprung der Vorschau beim Stufenwechsel; Panel und Spielanleitung nennen die Schwelle;
    Simulator `restartTable`, `memoryPathTable`, `tests/balance-restart.test.ts`
    (DESIGN_V2.md 15.4 „Stand Schritt 2.11b“, Entscheidung 12)
  - [ ] offen (`core-engineer`): „Sperrklinke“ für die Vorschau (größte Vorschau des Zyklus
    im Spielstand), damit sie auch bei gleicher H_max nie kurz sinkt (DESIGN_V2.md 15.4)

## Phase 3 – Tiefe

- ~~Nährstoffe + Pilznetzwerk als Automatisierung~~ – in v2 aufgegangen (Gattung Pilze,
  Hallimasch „Waldweites Netz“); Humus-Kreislauf als optionale Erweiterung (DESIGN_V2.md 2.6)
- [x] Jahreszeiten (Logik: `core-engineer`, Grafik: `renderer`) – nach v2, wirkt auf Zufriedenheit und Begegnungen
  - [x] Grafik (renderer): `SceneInput.season` 0–4 – Laubfarben, kahle Bäume, Blüten, Schnee, fallende Blätter
  - [x] Design (`game-designer`): Jahr = 12 min Spielzeit, Wirkungen je Jahreszeit,
    Ereignisse und Gäste je Jahreszeit (`src/content/seasons.ts`), DESIGN_V2.md Abschnitt 16
  - [x] Logik (core): Spielstand v6 mit `cycle.elapsed` (Migration v5 → v6), Jahreszeit in
    `evaluate` (Cache je Jahreszeit), Halt an der Grenze in `tick` (online = offline,
    Schnellvorlauf über ganze Jahre), neuer Wirkungstyp `happiness`, Ziehen nach
    Jahreszeit; Simulator auf echter Logik (`scripts/season-model.ts` entfernt,
    Kennzahlen DESIGN_V2.md 15.4)
  - [x] UI: Abzeichen der Jahreszeit mit Restzeit in der Kopfzeile, Hinweis beim Wechsel,
    `SceneInput.season` stufenlos aus der Spielzeit, Abschnitt in der Spielanleitung
- ~~Zufallsereignisse mit gespeichertem Seed~~ – in v2 aufgegangen (Begegnungen, `rngState`)
- [x] Statistik-Seite (Spielzeit, Gesamt-Wachstum, entdeckte Arten) (`ui-dev`) – Reiter „Statistik“ im Naturtagebuch
  - Zeigt nur, was der Spielstand schon hat (laufender Zyklus, Tagebuch). Eine
    Gesamtspielzeit über alle Zyklen bräuchte ein neues Spielstand-Feld – siehe
    „Langzeit-Statistik“ in Phase 4.
- [ ] Gattung Amphibien mit Waldtümpel (Erdkröte, Bergmolch) als Erweiterung (`game-designer`)
- [x] Winter-Ereignis „Schneebruch“ und weitere Ereignisse je Jahreszeit (`game-designer`) – 4 neue
  Ereignisse nur mit vorhandenen Wirkungstypen (keine Logik, kein neues Spielstand-Format):
  Spätfrost (Frühling), Hitzewelle (Sommer), Laubfall (Herbst), Schneebruch (Winter);
  DESIGN_V2.md 7.4 und 16.4
- [x] Ereignis-Karten: unentdeckte Arten nicht mit Namen nennen (wie Tagebuch „???“) (`ui-dev`) – „Pfifferling oder 3 unbekannte Arten (🍄)“

## Phase 4 – Prestige & Langzeitspiel

- ~~Samen + Prestige „Neuer Zyklus“~~ – Teil von v2 (Schritt 2.8)
- ~~Samen-Shop mit dauerhaften Boni~~ – ersetzt durch Waldgedächtnis und Stammgäste (v2)
- [x] Hauptbaum-Arten (Buche, Kiefer als Startbaum) mit eigener Grafik (`renderer` + `game-designer`)
  - [x] Grafik (renderer): `SceneInput.mainTree` 'oak' | 'beech' | 'pine'
  - [x] Design (`game-designer`): Freischaltung über die Begleitpflanze im Naturtagebuch,
    Wahl beim Neuen Zyklus, Eigenheiten je Art (`src/content/trees.ts`), DESIGN_V2.md 17
  - [x] Logik (core): `cycle.mainTree` (v6), `unlockedTrees`, `startNewCycle(…, mainTree)`
    mit Fehler `'tree-locked'`, Merkmale und Eigenheiten in `evaluate` und
    `appearsContext`, Platz-Boni über `slotBonuses`
  - [x] UI: Radiogruppe in „Neuer Zyklus“ (gesperrte Arten mit Hinweis), Frucht der Art
    in Toast und Spielanleitung, `SceneInput.mainTree` und `cycleTransition.fromTree`
  - [x] Optional: Naturtagebuch, Reiter Andenken – gewachsene Hauptbaum-Arten (`ui-dev`)
- [ ] Umstieg auf `break_infinity.js`, falls Zahlen > 1e300 (`core-engineer`)
- [x] Langzeit-Statistik `meta.stats` (`core-engineer`, danach `ui-dev`): Gesamtspielzeit,
  Gesamt-Wachstum, beste Harmonie, Begegnungen, bewirtete Gäste, gewachsene
  Hauptbaum-Arten über alle Zyklen (neue Spielstand-Version mit Migration); Anzeige im
  Reiter „Statistik“, Grundlage für Erfolge
  - [x] Logik (core): Spielstand v8, Migration v7 → v8 (Startwerte aus dem laufenden
    Zyklus), Zähler in den Aktionen, Spielzeit in `tick` (online = offline), Gesamt-Wachstum
    exakt aus abgeschlossenen Zyklen + `totalGrowth`, DESIGN_V2.md 12.5
  - [x] UI: Abschnitt „Über alle Zyklen“ im Reiter „Statistik“, „schon gewachsen“ bei den
    Hauptbaum-Arten im Reiter „Andenken“
- [x] Erfolge / Achievements, verknüpft mit dem Naturtagebuch (`ui-dev`, `core-engineer`)
  - [x] Inhalt: 25 Erfolge als Daten (`src/content/achievements.ts`), deklarative
    Bedingungen (Stufe, Tagebuch, Gattungen, Statistik, Zyklen, Baumarten, Spielzeit des Zyklus)
  - [x] Logik (core): Spielstand v9 mit `meta.achievements`, Migration v8 → v9 schaltet still
    frei, `checkAchievements` (online = offline), Prüfung vor dem Neuen Zyklus, DESIGN_V2.md 12.6 und 18
  - [x] UI: Reiter „Erfolge“ im Naturtagebuch mit Zähler und Fortschritt, leiser Hinweis
    „🏅 Erfolg: …“, Sammelhinweis „N Erfolge nachgetragen“

## Phase 5 – Veröffentlichung

- [x] Deployment auf GitHub Pages (Workflow `.github/workflows/pages.yml`, Quelle „GitHub Actions“ in den Repo-Einstellungen)
- [x] Spielstand exportieren/importieren (Text-Code „VSZW1:…“ mit Prüfsumme, Bestätigung per zweitem Klick)
- [x] Spielanleitung „❓“ (Zahlen aus content/core, Platzhalter für Ereignisse, Gäste, Pflege)
  und Hinweis „Neu hier?“ beim ersten Start (`ui-dev`)
- [x] Einstellungen „⚙️“ in localStorage: Bewegung reduzieren (Automatisch/An/Aus),
  Zahlenformat (kurz/ausgeschrieben), Hinweise länger anzeigen (`ui-dev`)
- [x] Sound & Musik (optional): prozedurale Klangkulisse per Web Audio (`src/ui/sound.ts`,
  Planung rein in `src/ui/sound-plan.ts`) – Wind je Jahreszeit, Vogelrufe im Frühling/Sommer,
  Pad je Harmoniestufe, leise Ereignis-Klänge; Einstellung „Klang“ (Aus/Leise/Normal, Standard aus),
  Start erst nach Interaktion, Pause bei verborgenem Tab; Spitze ≤ −12 dBFS über Pegel-Haushalt
  der Stimmen (kein Kompressor, nur Sicherheits-Clipper), Leise 10 dB darunter (`ui-dev`)
