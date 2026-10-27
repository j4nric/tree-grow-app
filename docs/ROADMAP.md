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
- [x] 404-Seite für GitHub Pages (`public/404.html`, „Dieser Pfad ist zugewachsen“, Link auf
      `/tree-grow-app/`); nicht im Cache des Service Workers, Build-Test `tests/pages-404.test.ts`

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
  - [x] „Sperrklinke“ für die Vorschau (`core-engineer`): Spielstand v10 mit
    `cycle.bestHarmonyMemory` (bester Harmonie-Anteil des Zyklus), angezeigt und
    gutgeschrieben wird `max(gemerkt, aktuell) + neue Arten`; Migration v9 → v10 mit der
    aktuellen Vorschau; Vorschau sinkt an keinem Wegpunkt (DESIGN_V2.md 10, 12.7, 15.4
    „Stand Sperrklinke“)
  - [x] `MEMORY_HARMONY_RULES` nach der Sperrklinke nachjustiert (`game-designer`): Hain
    5 / 100 / 45 → Wald 6 / 148 / 48 → Urwald 7 / 164 / 48 (Sockel-Teiler / Schwelle /
    Obergrenze, Teiler gleitet als kleine Formeländerung mit); großer Lauf Wald 1,03 / 1,07,
    Urwald 0,99 / 1,03, Urwald 1,45 × Hain; Urwald-Schwelle 10 unter dem typischen
    Harmonie-Spieler, Wachstums-Spieler dort ohne Bonus (DESIGN_V2.md 15.4 „Stand Abgleich
    Sperrklinke“, Entscheidung 12); nach dem frühen Spiel (#52) Regeln unverändert, großer
    Lauf für den Neustart mit 200 Durchgängen (Wald 0,98 / 1,06, Urwald 0,99 / 1,04)
- [x] Playtest „frühes Spiel“ (`game-designer`): Pflege ab Setzling (Kompost 200 🌰 neu,
  Laub liegen lassen 200 statt 750 🌰), Nistkästen 650 statt 1.100 🌰; Simulator-Kennzahlen
  „längste Pause ohne Entscheidung“ und „Samen ungenutzt“ mit Prüfungen; längste Pause in
  den ersten 6 min 1:41 → 1:08 min bei gleichem Tempo; Harmoniestufe „Urwald“ heißt jetzt
  „Ursprüngliche Wildnis“ (DESIGN_V2.md 15.4 „Stand Playtest frühes Spiel“, Entscheidung 13)
  - [x] Ablehnen nach Samen-Sekunden (`core-engineer`): 10 s, mindestens 5 🌰, von Hand und
    beim Weiterziehen online/offline (`declineReward(state)`, `TickReport.declinedSeeds`);
    Meldungen nennen die echte Summe; kein neues Spielstand-Feld (DESIGN_V2.md 7.9)
- [x] Tierdetails (`ui-developer`): Tier-Kacheln der Nischen öffnen per Klick/Tippen/Enter
  einen Dialog mit Zufriedenheit und Gründen, Beitrag (Chips wie bei der Auswahl),
  Wirkungen, Fähigkeiten, Lebensgemeinschaften (ohne Spoiler), Stammgast-Status und
  Tagebuch-Text; live gedrosselt, Esc gibt den Fokus an die Kachel zurück; Einstieg
  `openAnimalDetail()` auch für Klicks in der Szene (DESIGN_V2.md 11.2)

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
- [x] Gattung Amphibien mit Waldtümpel (Erdkröte, Bergmolch) als Erweiterung (`game-designer`) –
  6. Gattung mit Erdkröte, Grasfrosch, Bergmolch in der neuen Nische Waldtümpel (öffnet nur
  durch Pflege „Waldtümpel“ bzw. Regenreicher Frühling/Krötenwanderung), Frühling = Laichzeit,
  Ereignis Krötenwanderung, Lebensgemeinschaften Tümpelleben und Schneckenwacht, Tümpel und
  Sprites im Renderer; Spielstand v11 (`DESIGN_V2.md` 5.5, 12.8)
  - [x] Playtest Amphibien und mittleres Spiel (`game-designer`): Amphibien wurden nicht zu
    selten gewählt (56 %), sondern zu selten angeboten (4,1 Begegnungen bis Urwald) → Laubfrosch
    und Kammmolch (selten) im Waldtümpel, Pflege „Waldtümpel“ Rang 2 +2 Plätze, Gattungsstufe 5
    als seltenes Spätziel (5 % Harmonie, 24 % Stapler); Ringelnatter verworfen; Knopf „Zur
    Pflege“ an der verschlossenen Nische; Zeichnungen für Laubfrosch und Kammmolch; kein neues
    Spielstand-Feld (`DESIGN_V2.md` 5.5 und 15.4 „Stand Playtest Amphibien“)
  - [x] Tümpel-Darstellung mit 4–5 Bewohnern entzerren, Amphibien auf schmalen Bildschirmen
    größer (`renderer`, `DESIGN_V2.md` 15.4 „Stand Playtest Amphibien“, Offen 1) – Senke für
    fünf Bewohner verbreitert, Watende an den Rändern, Molche in eigenen Streifen; Demo `?pondn=`
  - [x] Stammgast-Wahl: Hinweis, dass Amphibien erst mit dem Waldtümpel einziehen (`ui-dev`) –
    Hinweis an Amphibien in der Auswahl, Warte-Status gewählter Stammgäste (Waldtümpel, Stufe,
    voller Platz), Tierdetails; `ui/regular-wait.ts`
- [x] Winter-Ereignis „Schneebruch“ und weitere Ereignisse je Jahreszeit (`game-designer`) – 4 neue
  Ereignisse nur mit vorhandenen Wirkungstypen (keine Logik, kein neues Spielstand-Format):
  Spätfrost (Frühling), Hitzewelle (Sommer), Laubfall (Herbst), Schneebruch (Winter);
  DESIGN_V2.md 7.4 und 16.4
- [x] Ereignis-Karten: unentdeckte Arten nicht mit Namen nennen (wie Tagebuch „???“) (`ui-dev`) – „Pfifferling oder 3 unbekannte Arten (🍄)“
- [x] Kamera der Szene (`renderer`): Zoom 1–4× zum Zeiger/Pinch-Mittelpunkt, Verschieben
  mit harten Grenzen und weichem Ausgleiten, Bedienleiste (+, −, Zurücksetzen), Tastatur,
  scharfer Neuaufbau des Ausschnitts nach Ruhe; Treffer-Test `hitTestAnimal` für die
  Tier-Detailansicht (Tippen auf ein Tier in der Szene öffnet sie, `onAnimalTap` in main.ts) – DESIGN_V2.md 11.4

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
- [ ] Umstieg auf `break_infinity.js`, falls Zahlen > 1e300 (`core-engineer`) – derzeit nicht
  absehbar: auch mit der Waldlandschaft < 1e5 🌿/s (`DESIGN_V2.md` 24.9, dort der Plan für den
  Fall der Fälle)
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
- [x] Konto und Gerätesync (`core-engineer`): Benutzername + Passwort, eigener Sync-Server
  (`server/`, Node 22, SQLite, Server-Sent Events), optimistische Versionierung, sofortiger
  Push nach Aktionen, Übernahme fremder Aktionen, Sicherung vor dem ersten Abgleich,
  Offline-Retry; Abschnitt „Konto“ in ⚙️ nur mit `VITE_SYNC_URL`; Betrieb per Docker
  Compose (eigener Caddy oder vorhandener Proxy), Anleitung `docs/KONTO.md`
- [x] Spielanleitung „❓“ (Zahlen aus content/core, Platzhalter für Ereignisse, Gäste, Pflege)
  und Hinweis „Neu hier?“ beim ersten Start (`ui-dev`)
- [x] Einstellungen „⚙️“ in localStorage: Bewegung reduzieren (Automatisch/An/Aus),
  Zahlenformat (kurz/ausgeschrieben), Hinweise länger anzeigen (`ui-dev`)
- [x] Sound & Musik (optional): prozedurale Klangkulisse per Web Audio (`src/ui/sound.ts`,
  Planung rein in `src/ui/sound-plan.ts`) – Wind je Jahreszeit, Vogelrufe im Frühling/Sommer,
  Pad je Harmoniestufe, leise Ereignis-Klänge; Einstellung „Klang“ (Aus/Leise/Normal, Standard aus),
  Start erst nach Interaktion, Pause bei verborgenem Tab; Spitze ≤ −12 dBFS über Pegel-Haushalt
  der Stimmen (kein Kompressor, nur Sicherheits-Clipper), Leise 10 dB darunter (`ui-dev`)

## Phase 6 – Lebendiger Wald & Betrieb

Reihenfolge in Wellen; Zustandsänderungen (`SAVE_VERSION`) nacheinander, nie parallel.

**Welle 1 – Betrieb & kurze Besuche**

- [x] Sicherung außerhalb des Servers (`core-engineer`, Server/Deploy): tägliches,
  verschlüsseltes Backup des Sync-Servers als GitHub-Actions-Artefakt (Abruf über
  geschützten Admin-Endpunkt), Wiederherstellung dokumentiert in `docs/KONTO.md`
- [x] Überwachung (`core-engineer`): stündlicher Workflow prüft `sync…/api/health` und die
  Spielseite, meldet Ausfälle als GitHub-Issue (schließt es wieder, wenn alles läuft)
- [x] Installierbare App / PWA (`ui-dev`): Manifest, Icons, Service Worker mit Offline-Start,
  Update-Hinweis bei neuer Version; Sync bleibt online-only – `public/manifest.webmanifest`,
  Icons aus `scripts/generate-icons.ts`, Service Worker von Hand in `src/pwa/service-worker.ts`
  (beim Bauen als `dist/sw.js` mit Dateiliste und Inhalts-Version), Anmeldung und Hinweis
  „Neue Version verfügbar – neu laden“ in `src/ui/pwa.ts`; e2e in `e2e/pwa.spec.ts`
- [x] Tagesziele (Design `game-designer`, Logik `core-engineer`, Anzeige `ui-dev`): 2–3
  Aufgaben pro Tag aus dem Naturtagebuch, Belohnung Samen bzw. seltene Begegnung;
  deterministisch aus Datum + Seed, Tageswechsel bei aktivem Konto nach Serverzeit
  (Spielstand v12, `DESIGN_V2.md` 20)

**Welle 2 – Lebendiger Alltag**

- [x] Tag und Nacht (Grafik `renderer`, Wirkung `game-designer`): kurzer Tag-Nacht-Wechsel
  in der Szene, nachtaktive Arten (Fledermaus, Waldkauz, Glühwürmchen, Igel) mit
  Sichtbarkeit bzw. Effekten nur nachts
  - [x] Grafik (renderer): `SceneInput.dayPhase` 0–1 aus `dayPhaseAt(cycle.elapsed)`
    (`DAY_SECONDS` = 180 s = eine Jahreszeit, jede Jahreszeit ein ganzer Tag), Dämmerung, Nacht mit Sternen und Mond,
    Glühwürmchen leuchten nachts stärker, Einstellung „Tageszeit“ (Wechsel / Immer Tag),
    Demo `?phase=` – DESIGN_V2.md 19
  - [x] Wirkung, Design (game-designer): Waldkauz, Langohr, Igel, Glühwürmchen nachts +6 … +12 %
    🌿/🌰 (`NOCTURNAL` in `src/content/daytime.ts`, Spielstand unverändert) – DESIGN_V2.md 21.6
  - [x] Wirkung, Logik (core-engineer): Nacht-Halte, Nachtwirkung in `evaluate`, Mittel offline –
    `src/core/weather.ts`, DESIGN_V2.md 21.9
- [x] Wetterlagen (Design `game-designer`, Logik `core-engineer`, Grafik `renderer`):
  seltene, mehrminütige Zustände (Dürresommer, Sturm, Spätfrost, Borkenkäferjahr) mit
  Gegenmaßnahmen; ein vielfältiges Ökosystem dämpft die Folgen
  - [x] Design (game-designer): 8 Wetterlagen je Tag (= Jahreszeit), deterministisch aus
    Zyklus + Tag, Dämpfung durch Vielfalt und Pflege, Mittel offline, kein neues Feld –
    `src/content/weather.ts`, DESIGN_V2.md 21
  - [x] Logik (core-engineer): `src/core/weather.ts`, Wetter in `evaluate`, `TickReport.weather`,
    Mittelwetter offline (`simulateOffline` ab 180 s), Messung mit der echten Logik – 21.9/21.10
  - [x] Grafik (renderer): `SceneInput.weather`/`weatherPrevious`/`weatherBlend`, Bilder je Wetter,
    Nachtverhalten von Kauz, Langohr, Igel, Glühwürmchen, Demo `?weather=` – `src/render/weather.ts`,
    `src/render/nocturnal.ts`, 21.8
  - [x] Anzeige (ui-dev): Wetter-Abzeichen mit Erklärung und Vorhersage, ein Hinweis für
    Jahreszeit + Wetter, 🌙 an Nachtarten und an der Rate, Schutz-Hinweise der Pflege,
    „Wetter gemittelt“, Spielanleitung – `src/ui/weather-view.ts`, `weather-badge.ts` (21.8)
  - [x] Borkenkäferjahr: kein Wetter, sondern das Ereignis „Käferjahr“ (Räuber und Beute,
    #75) – bei Dürre dreifach gewichtet (`WEATHER_EVENT_FACTORS`, DESIGN_V2.md 21.11, 22.6)
  - [x] Balancing-Folgeaufgabe (game-designer): Samenreserve im Wald (balance-care 14,6 vs.
    Grenze 15 min, vorher 11,1 vs. 12) – erledigt ohne Änderung der Wald-Ränge: seit den
    Lebensräumen 7,5 min (großer Lauf), im Check 7,2–8,3 min in drei Seed-Fenstern; die
    Grenze ist wieder < 12 min (DESIGN_V2.md 15.4, „Stand Balancing Phase 6“)

**Welle 3 – Tiefe & Langzeitspiel**

- [x] Räuber und Beute (`game-designer`, `core-engineer`): Waldkauz, Fuchs, Ringelnatter
  regulieren Bestände statt zu strafen (z. B. viele Mäuse locken den Kauz an → Harmonie)
  - [x] Design (`game-designer`): Bestand (abgeleitet aus der Zufriedenheit der Beute),
    Überjagung statt Räuberdruck, vier Massenjahre mit Bedingung „ungejagt“, Wetter →
    Ereignis-Gewichte; Daten in `src/content/predation.ts` – DESIGN_V2.md 22
  - [x] Logik ohne Spielstand-Änderung (`core-engineer`, 22.8 Schritt A): Bestand,
    Überjagung, Bedingung `unhunted`, vier Massenjahre (ohne Lebensraum-Arten),
    `Evaluation.foodWeb`; `tests/predation.test.ts`, Messung 22.9
  - [x] Wetter → Ereignis-Gewichte (`core-engineer`, 22.8 Schritt C): `eventWeight`,
    Wetter des Tages auch offline
  - [x] Nahrungsnetz und Bestand in Übersicht und Tierdetails (`ui-dev`, 22.7): Nahrungsnetz
    (aufklappbar) in der Übersicht, Bestand an Kacheln und Karten, Abschnitt „Räuber und
    Beute“ in den Tierdetails, Spielanleitung; `src/ui/food-web-view.ts`,
    `tests/food-web-view.test.ts`, `e2e/food-web.spec.ts`
  - [x] Balancing prüfen (`game-designer`): Urwald-Gewinn des Harmonie-Spielers liegt mit
    Räuber und Beute bei 94,9 (Grenze < 95, vorher 87–88), seit den Lebensräumen 93,5 –
    geprüft, `MEMORY_HARMONY_RULES` bleiben: Der Bonus ist gedeckelt, der Anstieg kommt aus
    H_max und neuen Arten; Obergrenze 48 → 46 brächte nur −0,8 Puffer, kostete ~0,01 beim
    Verhältnis Wachstum/Harmonie im Urwald (Grenze 0,95) und −2 Punkte je Urwald-Zyklus in der
    Landschaft (DESIGN_V2.md 15.4, „Stand Balancing Phase 6“)
  - [x] Laufzeit der Balancing-Tests (`game-designer`): geteilte Durchgänge über Checkpoints
    im Simulator (`runStages`, `branchCycles`, `tests/balance-runs.ts`); Pflege jetzt in
    `balance.test.ts`, Neustart in `balance-cycles.test.ts`; CPU im Check −20 % bei gleichen
    Ergebnissen und Grenzen (DESIGN_V2.md 15.4, „Stand Balancing Phase 6“)
- [x] Weitere Lebensräume nach dem Muster Waldtümpel (`game-designer`, `renderer`):
  Totholzhaufen, Trockenmauer, Waldwiese – je 3–5 Arten und eine Lebensgemeinschaft
  - [x] Design (`game-designer`): Waldwiese (Junger Baum), Totholzhaufen (Alter Baum),
    Trockenmauer (Hain), 14 Arten, Gattung Reptilien, 4 Lebensgemeinschaften; Daten in
    `src/content/habitats.ts` – DESIGN_V2.md 23
  - [x] Spielstand v13 und Verdrahtung (`core-engineer`, 23.7 Schritt B): Nischen, Arten,
    Reptilien, Pflege, neue Jagdpaare, Massenjahre vollständig, Migration v12 → v13, Schutz
    vor älteren Clients (gespeicherter Stand „neuer“) – `tests/habitats-core.test.ts`
  - [x] Szene und 14 Zeichnungen (`renderer`, 23.7 Nr. 4, 23.8): Totholzhaufen im Erdschnitt
    rechts, Waldwiese und Trockenmauer im Mittelgrund, Reptilien mit Winterstarre –
    `tests/render-habitats.test.ts`, `e2e/habitats-scene.spec.ts`
  - [x] Oberfläche (`ui-dev`, 23.7 Punkt 5): verschlossene Lebensräume mit Hinweis und
    „Zur Pflege“, Pflegekarten „Öffnet Lebensraum …“, Gattung Reptilien (Farbe, Tagebuch,
    Tagesziele, Stammgast-Hinweise), Spielanleitung „Lebensräume“ –
    `tests/habitats-ui.test.ts`, `e2e/habitats.spec.ts`
- [x] Prestige-Stufe 2 „Waldlandschaft“ (`game-designer`, `core-engineer`, `renderer`):
  mehrere Wälder nebeneinander mit eigenem Hauptbaum, Wildwechsel über Korridore;
  `break_infinity.js` ist dafür **nicht** nötig (gemessen, `DESIGN_V2.md` 24.9). Spielbar und
  ausgeliefert; Wildwechsel, Erfolge und der Rest e2e folgten in Phase 7 (1a, 2a/2b, 4a)
  - [x] Design (`game-designer`): sechs Standorte mit Waldtyp, Währung Hähersaat, Korridore
    mit Zufluss, Spielstand v14 nach den Lebensräumen (v13) – `DESIGN_V2.md` 24, Daten
    `src/content/landscape.ts`, Modell `scripts/landscape.ts`
  - [x] Schritt A (`core-engineer`, v14): `meta.landscape`, Migration v13 → v14 mit robustem
    Laden und Kosten-Prüfung, `src/core/landscape.ts` (wirksames Gedächtnis, Hähersaat,
    Freischaltung, Eigenheiten und Gaben), `startNewCycle(…, site)` und `buildCorridor` in
    `tick.ts`; Simulation `scripts/landscape.ts` auf der echten Logik, gemessen (24.10) –
    `tests/landscape-core.test.ts`
  - [x] Karte (`ui-dev`) und Kulisse je Waldtyp (`renderer`) – 24.11 Nr. 2 und 3
    - [x] Kulisse je Waldtyp (`renderer`): `SceneInput.site` (Horizont, Hintergrund-Bäume,
      Bodenfarben je Standort in der gecachten Kulisse, `src/render/site-scenery.ts`; Wechsel
      blendet über), Häherflug beim Gründen (`SceneInput.jayFlight`, `src/render/jay-flight.ts`),
      `?site=<id>` in Spiel und Demo – `tests/render-landscape.test.ts`, `e2e/landscape-scene.spec.ts`
    - [x] Karte der Landschaft (`ui-dev`): sechs Standorte als Knöpfe über SVG-Korridoren im
      Bereich „Neuer Zyklus“, Angaben je Standort (Gedächtnis eigen/wirksam, Leitbaum,
      Eigenheit mit Gewinn/Verzicht, Gabe), Gründen und Wechseln über den Zyklus-Knopf,
      Korridor-Liste mit Kaufknöpfen, 🪶-Zeile, Spielanleitung „Waldlandschaft“ (vorher nur
      Andeutung) – `src/ui/landscape-view.ts`, `src/ui/landscape-map.ts`,
      `tests/landscape-view.test.ts`, `e2e/landscape.spec.ts`
    - [x] Naturtagebuch-Reiter „Landschaft“ (`ui-dev`): erst nach der Freischaltung sichtbar
      (vorher verborgen, Pfeiltasten überspringen ihn), Zähler gegründete Wälder; je Wald Name,
      Waldtyp, Gedächtnis eigen/wirksam, Urwald ja/nein, Leitbaum, Hauptbaum (jetzt bzw. zuletzt),
      Stammgäste, Tiere (aktiv: laufender Bestand, ruhend: `fauna`, nur entdeckte, seltenste
      zuerst); gebaute Korridore (gratis/gekauft); Hähersaat verdient/ausgegeben/verfügbar –
      `src/ui/journal-landscape-view.ts`, `tests/journal-landscape.test.ts`,
      `e2e/journal-landscape.spec.ts`
    - [x] UI rechnet mit dem **wirksamen** Gedächtnis (`ui-dev`): `regularSlotsOf(state)` statt
      `regularSlots(meta.forestMemory)` (adapters, cycle-view, animal-detail-view), Anzeige
      des Gedächtnis-Bonus mit `effectiveForestMemory`, `environmentEffects` mit Standort und
      Gaben (Tierdetails)
    - [x] Meldung zur Freischaltung (`ui-dev`): zeigen, solange `landscapeAnnouncementDue(state)`,
      danach `markLandscapeAnnounced(state)` (24.8)
  - [x] Schritt B Wildwechsel (`core-engineer`, 24.11 Nr. 4) – erledigt in Phase 7, 1a. Ursprünglich fehlte: das Ziehen der
    Wildwechsel-Karte aus `fauna` eines Nachbarn und das Gewicht der `featured`-Gattungen;
    bisher gibt es nur die Konstanten (`WILDWECHSEL_CHANCE`, `FEATURED_GENUS_WEIGHT` in
    `src/content/landscape.ts`) und das Schreiben von `fauna` beim Verlassen (`tick.ts`)
  - [x] Erfolge und Messung (`game-designer`, 24.11 Nr. 5; Bedingungen `core-engineer`, Nr. 6) –
    erledigt in Phase 7 (1b, 2a, 2b; Messung 2c). Ursprünglich fehlten:
    die fünf Erfolge aus 24.12 als Daten, die Bedingungsarten `forests`, `corridors`,
    `ancientForests` in `core/achievements.ts` und die Messung des Wildwechsels (Vielfalt 7.7);
    die Messung der Landschaft ohne Wildwechsel ist da (24.7/24.10, #81, #85)
  - [x] e2e (`qa-tester`, 24.11 Nr. 7) – Rest erledigt in Phase 7, 4a (`e2e/landscape-trees.spec.ts`); vorher teilweise: Gründen, Neuladen und Wechsel zurück mit
    Gedächtnis prüft `e2e/landscape.spec.ts`; fehlt: Stammgäste nach Hin- und Rückweg und der
    Sync zweier Geräte mit einem v14-Stand samt ruhender Wälder
- [x] Playtest Phase 6 – Funde behoben (`ui-dev`, `renderer`): Hinweise, Stapel und
  Nahrungsnetz (#86), UI-Unstimmigkeiten und Lage des Toasts (#87, `src/ui/toast-place.ts`),
  Grafik (#88), Rückkehr-Bericht (#89): mobil nur die Kurzfassung im Toast, alle Einzelheiten
  in einer schließbaren Karte oben in der Seitenleiste – `src/ui/return-report-view.ts`,
  `src/ui/return-report.ts`, `tests/return-report-view.test.ts`, `e2e/return-report.spec.ts`

## Phase 7 – Waldtypen mit Charakter

Ziel: Die Landschaft fertigstellen und den Waldtypen mehr Eigenart geben – ohne neuen
Multiplikator (24.1, 24.9). Reihenfolge in Wellen; Zustandsänderungen (`SAVE_VERSION`)
nacheinander, nie parallel. **Einzige Spielstand-Änderung der Phase: v15** (Hauptbäume, Welle 2).

**Bewusst kein eigener Punkt: Borkenkäfer-Ereignis.** Es gibt es schon als „Käferjahr“ (#75,
`src/content/predation.ts`): Massenjahr, wenn Käfer ungejagt sind, bei Dürre dreifach gewichtet
(DESIGN_V2.md 21.11, 22.5/22.6). Ein zweites Borkenkäfer-Ereignis wäre eine Dopplung; in
Punkt 3 wird das Käferjahr über das häufigere Dürrewetter der Kiefernheide von selbst häufiger.

**Welle 1 – Landschaft vollenden** (ohne Spielstand-Änderung; Rest aus Phase 6)

- [x] **1a** Schritt B Wildwechsel (`core-engineer`, DESIGN_V2.md 24.6, 24.11 Nr. 4): beim Ziehen
  der Tierkarten je Korridor am aktiven Wald 10 % (höchstens 30 %) eine Karte aus `fauna` eines
  Nachbarn (Regeln 24.6, Weg in der Karte), `featured`-Gattungen × 1,5 in ihrer Seltenheit;
  `rngState`, online = offline; `scripts/landscape.ts` zieht mit. Abhängig: nichts
- [x] **1b** Erfolge der Landschaft festlegen (`game-designer`, 24.12): Texte und Bedingungen
  für `forest-2`, `ancient-2`, `corridor-1`, `corridors-all`, `ancient-everywhere` (statt
  `forests-all`, fiele fast mit `ancient-everywhere` zusammen), `wildwechsel-1` (mit v15), dazu
  `trees-all` und der neue Erfolg für die Hauptbäume der Landschaft (25.7). Nur Doku: Die neuen
  Bedingungsarten brauchen Logik, die Daten kommen darum mit 2a. Abhängig: nichts
- [x] **1c** Wildwechsel-Karte anzeigen (`ui-dev`): „🦌 kommt über die Schlehenhecke“ auf der
  Karte, Hinweis in der Spielanleitung. Abhängig: 1a – umgesetzt in `ui/wildwechsel-view.ts`:
  Markierung nur in der Oberfläche (nach dem Neuladen kein Hinweis), Chance und hervorgehobene
  Korridore auf der Karte der Landschaft, Zahl im Rückkehr-Bericht
- [x] **1d** Zeichnungen Weißtanne und Schwarzerle (`renderer`, 25.6 Nr. 1): Wuchsformen je Stufe
  in `src/render/plant.ts`, zunächst nur in der Demo (`?tree=fir|alder`); `TREE_SPECIES` bleibt bis
  2b unverändert. Abhängig: nichts – frühe Welle, weil die Grafik der größte Brocken ist

**Welle 2 – Hauptbäume je Waldtyp und Erfolge verdrahten**

- [x] **2a** Bedingungsarten `forests`, `corridors`, `ancientForests` (`core-engineer`, 24.11
  Nr. 6) samt den fünf Erfolgen aus 1b als Daten: monoton, Nachtrag beim Laden wie 12.6.
  Sichtbarkeit `requires: 'landscape'` (24.12, kleiner Eingriff in `achievement-view.ts`).
  Abhängig: 1b. `landscape-trees` (25.7) und `wildwechsel-1` folgen mit 2b
- [x] **2b** Hauptbäume je Waldtyp, Spielstand v15 (`core-engineer`, DESIGN_V2.md 25.5/25.6):
  `MainTreeId` um `fir`, `alder`, Freischaltung `unlockSite`, Leitbäume Bergmischwald → Weißtanne,
  Erlenbruch → Schwarzerle, Migration v14 → v15 (nur Versionssprung), Laden in der richtigen
  Reihenfolge, `TREE_SPECIES` = `MAIN_TREE_IDS`. Abhängig: 1a gemergt (gleiche Dateien in
  `tick.ts`), 1d (Formen vorhanden). Dazu `PendingEncounter.via` und `wildwechselChosen`
  (Erfolge `wildwechsel-1`, `landscape-trees`); die Wildwechsel-Karte zeigt ihren Weg auch nach
  dem Neuladen; Baumwahl je Ziel (Leitbaum beim Gründen vorausgewählt); „Zuerst gesehen“
  `meta.journal.firstSeen` für das Album (25.10)
- [x] **2c** Messung Wildwechsel (`game-designer`, 24.11 Nr. 5): Vielfalt der Karten (7.7) mit und
  ohne Wildwechsel, Chance 10 % prüfen, großer Lauf der Landschaft, 24.7/24.10 nachtragen;
  Kiefernheide für den Wachstums-Spieler im Blick (heute −4,7 %, Grenze ±5 %). Abhängig: 1a.
  *Gemessen* (24.10 „Stand 2c“, `runLandscape({ wildwechsel })`, `withoutFeatured`,
  `SIM_LANDSCAPE_WW`): Wildwechsel ist Überraschung, kein Tempo – Landschaft vollständig
  14,2 h (ohne 14,0 h, Harmonie), 13,3 h (13,2 h, Wachstum); gleiches Set, Neu würfeln, lohnend
  und Durststrecke unverändert, +0,5 verschiedene Arten und +0,1–0,2 seltene Karten je Zyklus,
  1,3–1,5 gewählte Nachbar-Arten je Zyklus. Chance getroffen (9,8 / 16,3 / 26,1 % bei 10 / 20 /
  30 %), gewählt wird mit jedem Korridor seltener (43 → 32 → 23 %) – **keine Zahl geändert**,
  Ersetzen bleibt (1–2 Karten: 0,0 %). `wildwechsel-1` im Median im 1. Zyklus des 2. Waldes.
  Waldtypen (24.7, jetzt 160 Durchgänge mit eigenem Wetter je Durchgang): alle ±3,8 %,
  Kiefernheide Wachstum −3,8 % – ihr +2 ☀️ bleibt. Wachstum gegen Harmonie 6,5 / 6,8 % (< 10 %)

**Welle 3 – Oberfläche, Waldtyp-Wetter, Messung**

- [x] **3a** Baumwahl mit fünf Arten (`ui-dev`, 25.6 Nr. 4): Karten für Weißtanne und
  Schwarzerle (vor der Landschaft verborgen, danach gesperrt mit Hinweis), Hauptbaum-Symbol in
  Karte und Tagebuch-Reiter „Landschaft“, Spielanleitung, Erfolge der Landschaft im Tagebuch.
  Abhängig: 2a, 2b. *Umgesetzt im Album* (ALBUM_UI.md G.2 Nr. 1, Phase 8 Schritt 9): Baumwahl
  als Samentütchen auf U:Neuer Zyklus (`album/pages/cycle-page.ts`) mit allen Arten aus
  `isTreeVisible` und Sperre/Vorauswahl über `treeChoiceFor`; Symbol als Sticker (der Renderer
  bietet noch keine Baum-Sticker). Symbol in Karte und Tagebuch, Anleitung und Sichtbarkeit der
  Erfolge (`isAchievementVisible`, jetzt U:Erfolge) kamen schon mit 2a/2b
- [x] **3b** Waldtyp und Wetter – Design (`game-designer`): Gewichte der Wetterlagen je Standort
  als Daten (Bergmischwald mehr Neuschnee, Auwald mehr Landregen, Kiefernheide mehr Dürre,
  Erlenbruch mehr Nebel; offene Frage 24.13). **Warum:** Die Waldtypen unterscheiden sich heute
  nur in Zahlen der Eigenheiten; ein eigenes Wetter macht sie sichtbar und spürbar anders, nutzt
  die fertige Wetter-Grafik und kostet keinen Spielstand. Die Kiefernheide bekommt so ihr
  Käferjahr (Dürre) – der Borkenkäfer passt zum Sand-Kiefernwald. Ziel ±5 % wie 24.7.
  Abhängig: 2c (Messung ohne Wetter als Grundlage).
  *Umgesetzt als Daten* (DESIGN_V2.md **24.14**): `ForestSite.weather` (Faktor je Wetterlage) und
  `weatherSummary` in `src/content/landscape.ts`, noch ohne Wirkung, Inhaltstests in
  `tests/landscape.test.ts`. Auwald 🌧️ × 2 / 🌡️ × 0,5, Erlenbruch 🌫️ × 2 / 🌡️ × 0,5,
  Buchenhallen 🌫️ × 1,5 / 🌬️ × 0,5, Bergmischwald 🌨️ × 2 / 🌧️ × 1,5, Kiefernheide 🌡️ × 2,5 /
  ☀️ × 1,5 / 🌧️ × 0,5, Heimatwald unverändert. Gemessen vorab (Hilfsskript, in 3d entfernt;
  nachgemessen mit der Logik in 3d): alle Waldtypen ±3,5 %
  (Kiefernheide Wachstum −3,8 → −3,4 %), Sommerdürre in der Heide 19,3 statt 9,4 %. **Befund:**
  Das Käferjahr wird dadurch nicht häufiger (begrenzt durch „Käfer ungejagt“ und einmal je
  Zyklus), es fällt nur öfter auf einen Dürretag – offene Frage in 24.13
- [x] **3c** Waldtyp und Wetter – Logik (`core-engineer`): `weatherOfDay` mit Standort-Gewichten,
  Mittelwetter offline je Standort, Vorhersage; kein neues Feld. Abhängig: 3b, 2b gemergt.
  **Genaue Aufgabe** (DESIGN_V2.md 24.14, „Umsetzung“):
  1. `core/weather.ts`: `siteWeatherWeights(season, site)` = `WEATHER_WEIGHTS[season][w] ×
     (LANDSCAPE_SITES_BY_ID.get(site)?.weather[w] ?? 1)`, Reihenfolge wie `WEATHER_WEIGHTS`,
     unbekannter Standort = Heimatwald. `rawWeather`, `weatherOfDayFromSeed`, `weatherOfDay`
     bekommen `site = HOME_SITE` als letztes Argument; Regel „nie zwei rau“ prüft den Vortag am
     selben Standort. Ohne Argument ändert sich nichts (Heimatwald hat keine Faktoren).
  2. Standort = `activeSite(landscapeOf(state))` (fest während eines Zyklus) in `weatherAt`,
     `weatherForecast`, `weatherDamping` (Standard), `averageWeatherEffects`;
     `sceneWeather(cycle, site = HOME_SITE)`, `main.ts` übergibt den aktiven Wald.
  3. Aufrufer mit Standort: `formulas.ts` (`ecosystemOf` mit `eco.site`, Cache-Schlüssel live
     unverändert, „Mittel“ mit Standort `|w:avg:<Art>:<Standort>`), `tick.ts` (`reportSeason`,
     Offline-Tage, `WEATHER_EVENT_FACTORS` beim Ziehen der Ereignisse).
  4. Offline: `weatherProbabilities(season, gentle, site)` – Anteile und rauer Anteil der
     Vorjahreszeit mit den Gewichten des Standorts; `averageWeatherEffectsFor(…, gentle, site)`.
  5. Tests: Heimatwald/Stände ohne Landschaft Tag für Tag wie vor 3c; Häufigkeiten je Standort wie
     24.14 (≥ 10 000 Tage, ±1 Punkt); nie zwei rau je Standort; Mittel = Σ p_eff × Wirkung je
     Standort; Vorhersage, Szene und Ereignis-Gewichte nutzen den aktiven Wald; Wechsel mit
     `startNewCycle` → neue Folge; kleine Ticks = großer Tick, `simulateOffline` im Mittel.
  Keine neue Spielstand-Version, kein neues Feld. Danach klein (`ui-dev`): `weatherSummary` beim
  Standort in Karte/U:Landschaft. **Erledigt:** `siteWeatherWeights`, `weatherSiteOf` in
  `core/weather.ts`; Goldwerte Heimatwald, Tabelle 24.14 je Wald und online = offline in
  `tests/site-weather-core.test.ts`; U:Standort zeigt „Wetter: 🌫️ …“ (`site-weather`).
- [x] **3d** Großer Lauf mit neuen Leitbäumen und Wetter je Standort (`game-designer`): 24.7,
  24.10 und 25.4 mit der echten Logik nachtragen; `scripts/site-trees.ts` und
  `tests/site-trees-balance.test.ts` entfernen, ebenso `scripts/site-weather.ts` und
  `tests/site-weather-balance.test.ts` (3b, Messung vor der Logik); 24.14 nachmessen.
  Abhängig: 2b, 3c. *Gemessen* (24.7/24.10 „Stand 3d“, `tests/landscape-balance.test.ts` mit
  `withoutSiteWeather` und `SIM_LANDSCAPE_SITE_WEATHER=off` als Vergleich, neuer Lauf
  „Häufigkeiten“ für 24.14): Waldtypen alle ±3,4 % (Kiefernheide Wachstum −3,4 %, Bergmischwald
  mit Weißtanne −1,6 / +1,3 %, Erlenbruch mit Schwarzerle +1,2 / −0,6 %); Landschaft vollständig
  14,2 h (Harmonie), 13,3 h (Wachstum), 39,1 h (Zufall) – wie ohne Standort-Wetter; Wachstum
  gegen Harmonie 6,4 / 6,2 % (< 10 %); Häufigkeiten 24.14 auf die Nachkommastelle wie vorab.
  **Keine Zahl geändert.** Hilfsskripte entfernt. Offene Frage 24.13 (Käferjahr der Heide)
  entschieden: ja, als Gewicht des Standorts → 3e
- [x] **3e** Käferjahr der Kiefernheide: Ereignis-Gewicht je Standort (`core-engineer`, 24.13).
  **Warum:** Der Kurztext der Heide verspricht „dann schwärmen die Borkenkäfer“, das Wetter allein
  macht das Käferjahr aber nicht häufiger (40 / 38 von 160 Durchgängen gegen 29 / 28 im
  Heimatwald; das Wetter-Gewicht wirkt nur an Dürretagen). Gemessen mit einem Gewicht × 3 an jedem
  Tag in der Heide: 71 / 52 von 160 (Harmonie / Wachstum), Zeit bis zum Urwald unverändert
  (50:04 / 39:43 gegen 50:05 / 39:48 min). **Genaue Aufgabe:**
  1. `src/content/landscape.ts`: neues Pflichtfeld `ForestSite.eventFactors:
     Readonly<Record<string, number>>` – Faktor auf das Zieh-Gewicht eines Ereignisses (ID aus
     `EVENTS`), solange dieser Wald aktiv ist; fehlt die ID: 1. Daten: Kiefernheide
     `{ 'beetle-year': 3 }`, alle anderen Wälder `{}`. Doku-Kommentar wie bei `weather`.
  2. `core/tick.ts`, `eventWeight(state, eventId, ambient)`: Ergebnis = Wetter-Faktor (wie heute;
     im Modus `off` 1) × Standort-Faktor `LANDSCAPE_SITES_BY_ID.get(weatherSiteOf(state))
     ?.eventFactors[eventId]` (nur endlich und > 0, sonst 1; `Object.hasOwn` wie beim Wetter). Der
     Standort-Faktor gilt in **allen** Modi, auch `off` – er ist kein Wetter. Beispiel: Heide,
     Dürretag → 3 × 3 = 9; Heide, Sonnentag → 3; Heimatwald, Dürretag → 3; Heide, `off` → 3.
  3. Nichts sonst: Jahreszeit, Bedingung „Käfer ungejagt“, `minStage` und „einmal je Zyklus“
     bleiben; kein Ereignis kommt dadurch außerhalb seiner Bedingungen. Keine neue
     Spielstand-Version, kein neues Feld im Spielstand (der aktive Wald ist fest je Zyklus).
  4. Tests: Inhalt (`tests/landscape.test.ts`) – Schlüssel nur bekannte Ereignis-IDs, Faktoren
     endlich, > 1 und ≤ 3, Heimatwald `{}`; Logik (`tests/predation.test.ts`) – die Beispiele aus
     Nr. 2, Heimatwald und Stände ohne Landschaft ziehen Ereignisse wie vorher (Goldwerte
     unverändert), `pickEvent` in der Heide wählt das Käferjahr bei gleichem Zufall öfter.
  5. ✅ Danach (`game-designer`, klein): 24.7-Lauf Käferjahr-Spalte nachmessen (Erwartung Heide
     ~70 / ~50 von 160, Zeit ±0,5 %), 24.13 abhaken. *Gemessen* (24.7 „Stand 3e“, 160
     Durchgänge): Heide 71 / 52 von 160 (Heimatwald 29 / 28), Zeit 50:04 / 39:43 min (vorher
     50:05 / 39:48; Wachstum −3,4 → −3,6 %), alle Waldtypen ±3,6 %; Landschaft 14,2 / 13,3 /
     39,4 h, Wachstum gegen Harmonie 6,1 / 6,2 % (< 10 %). **Keine Zahl geändert.** Optional (Playtest): weitere Wälder mit
     passendem Massenjahr (Auwald Schneckenjahr), erst nach dem Playtest Phase 7. → entschieden
     in Phase 9, 1a (DESIGN_V2.md 26.2).
  Abhängig: 3c. **Erledigt (Nr. 1–4):** `ForestSite.eventFactors` (Heide `{ 'beetle-year': 3 }`),
  `eventWeight` = Wetter-Faktor × Faktor des Waldes (auch im Modus `off`); Tests in
  `tests/landscape.test.ts`, `tests/predation.test.ts` (Beispiele, unbekannter Standort,
  Goldwerte Heimatwald / ohne Landschaft, `pickEvent`, online = offline in der Heide) und
  `tests/site-weather-core.test.ts`. Kein neues Feld, keine neue Spielstand-Version. Offen: Nr. 5.

**Welle 4 – Absichern**

- [x] **4a** e2e Landschaft und Hauptbäume (`qa-tester`): Rest aus Phase 6 (Stammgäste nach
  Hin- und Rückweg, Sync zweier Geräte mit ruhenden Wäldern); Bergmischwald gründen → Weißtanne
  vorausgewählt → Neuladen → Weißtanne wächst; Gerät mit v14 lädt keinen v15-Stand
  (`outdated-client`). Abhängig: 3a – umgesetzt in `e2e/landscape-trees.spec.ts` (Rückweg per
  Import eines Hain-Stands statt Minuten Spielzeit; älteres Spiel = Build gegen einen Stand mit
  `SAVE_VERSION + 1`, live per Abo und per 422 beim Senden, dazu v14 → v15 direkt an der API).
  Sync-Server im e2e mit `AUTH_PER_IP_15MIN` (sonst 429 bei `--repeat-each`)
- [x] **4b** Playtest Phase 7 (`qa-tester`, Funde an `ui-dev` / `renderer`). Abhängig: 4a.
  *Funde `ui-dev` erledigt* (S1–S5, K1, K3–K7): Notiz „Wetter heute“ mit dem Wetter des Waldtyps
  (`weather-site`), Wetter-Zeichen je Standort auf der Karte, Zeile „Wetter“ im Tagebuch der
  Wälder, Kapitel „Wetter“ und „Landschaft“ der Spielanleitung; Rückkehr-Bericht „⛅ Wetter im
  Bergmischwald gemittelt (…)“; Meldungen mit Satzgrenze (`joinSentences`); Baumwahl mit Grund
  der Vorauswahl („Leitbaum im Bergmischwald – …“) und „Wächst jetzt im Heimatwald“ statt
  „(jetzt)“; Erlenbruch 🐸 statt 🌫️; Sperrgrund auf der Karte („erst im Urwald · 5 🪶“); Zahl und
  🪶 umbrechen nicht getrennt; „erneut tippen“ bzw. „klicken“ je Eingabe; „Feuchte“ erklärt;
  Wildwechsel-Hinweis im Kopf der Begegnung, die Kartenreihe rollt die Karte ins Bild. Tests in
  `tests/playtest7-ui.test.ts`, `e2e/playtest7-ui.spec.ts`. *Funde `renderer` erledigt* in #125 (S6 ferne Tanne,
  S7 Wipfel und Zapfen der Weißtanne, K8 Tannen als Begleitbäume). K9 (Laub blendet nach dem Laden
  1–5 s ein) bleibt bewusst: Folge des Zeichnens in Leerlaufzeit (#88), nur in Screenshots auffällig.
  K10 (Käferjahr der Heide) erledigt mit 3e.

## Phase 8 – Album-Oberfläche

Ziel: Die ganze Oberfläche wird zum **Sammelalbum** (Naturtagebuch zum Einkleben). Das
Konzept mit Bestandsaufnahme aller 135 UI-Elemente, Seitenstruktur, Interaktionsmodell,
Architektur und Tests steht in `docs/ALBUM_UI.md`. Es gibt keinen Beta-Schalter: Jeder Schritt
ist ein eigener PR gegen den Sammel-Branch **`claude/album-ui`** (nicht `main`). Erst wenn alles
fertig und getestet ist, folgt ein großer PR `claude/album-ui` → `main`. `main` wird regelmäßig
in `claude/album-ui` gemergt. Es gibt **keine Spielstand-Änderung** in dieser Phase.

- [x] **0** Konzept `docs/ALBUM_UI.md` (`ui-dev`)
- [x] **1** Grundgerüst (`ui-dev`): `claude/album-ui` anlegen; Schriften Caveat/Nunito selbst
  gehostet (OFL), `tokens.css`, `album/nav.ts` + Tests, Verlauf/Hash, Book/Spread/Page/TabStrip/
  PageTurn/Bookmark, Polaroid-Rahmen mit dem Canvas, Etiketten, Stufenleiste; alte Panels als
  Übergangsinhalt in den Reitern, Hilfe/Einstellungen/Spielstand im Umschlag; UI-Steuerung aus
  `main.ts` nach `album/index.ts` (Review `core-engineer`); Fixture-Helfer, Specs grün.
  Abhängig: nichts. *Umgesetzt:* Übergangssteuerung der alten Bauteile in `album/legacy.ts`
  (jeder Schritt löscht dort seinen Teil), Seiten in `album/pages/registry.ts` (eine Zeile je
  Seite), „Spielstand“ ist schon eine echte Unterseite des Umschlags (Umblättern, Lesezeichen,
  Verlauf). Die Karte der Landschaft hängt im Reiter „Landschaft“, ihr Ziel gilt weiter für den
  Knopf im Reiter „Ziele“. Kamera-Knöpfe bis Schritt 3 oben rechts im Polaroid;
  `camera-input.ts` rechnet die Drehung des Polaroids heraus (`offsetX/Y`).
- [x] **2** Sticker-Renderer (`renderer`): `render/sticker.ts` mit `renderSpeciesSticker(id, size,
  opts)`, `stickerKind`, `stickerFit`, Varianten `muted`/`silhouette`, eigener LRU; Test „jede Art
  hat eine eigene Zeichnung“; Sticker-Tafel in der Render-Demo. Abhängig: nichts (parallel zu 1)
- [x] **3** Polaroid und Vollbild (`ui-dev`, Prüfung `renderer`): FLIP mit demselben Canvas, Kamera
  nur im Vollbild, Tier-Tipp → Haftnotiz, Zeichnen aussetzen, wenn verdeckt, Stufen-Stempel.
  Specs camera, scene-animal-tap, canvas-size. Abhängig: 1. *Umgesetzt:* `album/fullscreen.ts`
  (FLIP: Canvas behält während der Animation seine Größe, danach genau ein Resize;
  `object-fit` verhindert Verzerren bis dahin), Verlaufseintrag, Schließen per Knopf, Escape und
  Zurück sowie Wisch nach unten (bei 1×). `camera-input.ts` hat `active` (nur im Vollbild; das Polaroid zeigt immer die ganze
  Szene, die Kamera-Ansicht bleibt fürs nächste Öffnen). Tier-Tipp öffnet den austauschbaren
  Platzhalter `album/scene-note.ts` (in Schritt 4 durch `openNote` ersetzt). `sceneVisible` per
  IntersectionObserver (main.ts zeichnet nur dann). **Schärfe:** Nur Papier und Tape des
  Polaroids sind gedreht, Bild und Bildunterschrift stehen gerade – das gedrehte Live-Canvas
  verlor sonst rund ein Drittel seiner Kantenschärfe (gemessen bei Pixeldichte 1, 2 und 3).
- [x] **4** Haftnotiz und Stempel (`ui-dev`): `Note` (popover + Fallback), Stempel/Zettel statt
  Toast (`toast-place.ts` entfällt), einheitliches `notify`, Banderole, Notizen für Jahreszeit,
  Wetter, Etiketten, Gattungen. Specs seasons, weather, daynight. Abhängig: 1.
  *Umgesetzt:* `album/note.ts` (popover="auto", ohne popover `.note-open` mit eigenem
  Klick-außerhalb; offene Notiz in `nav.note`), freie Notiz `openNote(anchor, content)` für den
  Tier-Tipp in Schritt 3 (ALBUM_UI.md D.6). `album/stamps.ts` + `stamp-rules.ts` (ab 90 Zeichen
  Zettel, höchstens zwei, rückt unter sichtbare Banderolen); `album.notify(text, options)` mit
  `error`, `keep`, `brief` (bis Schritt 12 auch `direct`) ersetzt `showToast`. Etiketten sind Knöpfe mit Notiz
  (Harmonie mit „Mehr ›“, sobald es U:Harmonie gibt), Jahreszeit und Wetter in
  `album/season-weather.ts` (ersetzt `season-badge.ts`/`weather-badge.ts`), Gattungs-Chips öffnen
  eine Notiz. Update-Hinweis und „neuerer Spielstand“ als Banderole (`album/banderole.ts`). Die
  Rückkehr-Meldung zeigt Desktop wie mobil die Kurzfassung (C.8). Übergang bis Schritt 12: Ist
  noch ein alter Dialog mit Hinweisfeld offen, landet `notify` dort (außer `direct`). Neu:
  `e2e/album-notes.spec.ts`. Nach dem Merge von Schritt 3: Der Tier-Tipp im Vollbild öffnet eine
  echte Haftnotiz (`openNote` an einem unsichtbaren Anker an der Tippstelle, „Im Album ansehen ›“;
  `scene-note.ts` entfällt). Bildunterschrift kurz: „🌱 Frühling · ⛅ Wechselhaft · 2:58“
  (Wirkungen des Wetters in der Notiz und im vorgelesenen Namen). Meldungen im Vollbild über die
  ganze Breite unter „Zurück ins Album“.
- [x] **5** Reiter Nischen (`ui-dev`): Stickerreihen, Gattungen, Lebensräume, Pflanzring;
  Unterseiten Tier, Harmonie, Nahrungsnetz. Specs animal-detail, food-web, habitats.
  Abhängig: 2, 4. *Umgesetzt:* `album/sticker.ts` (StickerSlot: eigenes kleines Canvas, zeichnet
  nur bei neuer Art/Variante/Pixeldichte; matte Bilder über die IdleQueue, bis dahin CSS-gedämpft;
  Zufriedenheit als Bogen im weißen Rand, Seltenheit als Edelstein und Randlinie, 🌙 und
  Bestandspunkt) und `sticker-rules.ts` (`stickerTilt` fest je Art und Platz, ±6°).
  `pages/niches-page.ts` (Gattungs-Abzeichen mit Notiz, Reihen „Am Baum“ und „Lebensräume“,
  Pflanzring mit Messbändern, Links zu U:Harmonie und U:Nahrungsnetz – oben statt am Ende,
  damit sie mobil ohne Scrollen erreichbar sind; Kennzahl „9 von 14 Plätzen“), Unterseiten
  `animal-page.ts` (Kopf, „Was es braucht“, „Was es bewirkt“, Räuber und Beute → Nahrungsnetz als
  Ebene 2, Lebensgemeinschaften, Stammgast-★, Notiz, „Zuerst gesehen“ aus `meta.journal.firstSeen`;
  ausgezogen bleibt die Seite offen), `harmony-page.ts` (Zusammensetzung, Gemeinschaften,
  Stufen; „Mehr ›“ der Harmonie-Notiz), `food-web-page.ts` (Jäger als kleine Sticker,
  `FoodWebRowView.hunterIds`). Je Seitenart ein Blatt (`nav.ts`: andere ID derselben Art ersetzt
  sie). Nur sichtbare Seiten schreiben (`PageEnv.eco` mit Zähler, `album.refresh` aktualisiert
  die oberste Seite). `ecosystem-panel.ts` und `animal-detail-dialog.ts` gelöscht; „Im Album
  ansehen ›“ aus dem Vollbild blättert zu U:Tier um. Neu: `e2e/album-animal.spec.ts`,
  `tests/album-niches.test.ts`.
- [x] **6** Begegnungen (`ui-dev`): Zettelstapel mit Wackeln, Unterseite Begegnung, Unterseite
  Pflanze setzen. Specs events, playthrough, full-cycle. Abhängig: 4 (Pflanze setzen: 5)
  *Umgesetzt:* `album/note-stack.ts` (gelber Zettel „2 Zettel: Besuch wartet!“ bzw. „Sturmnacht!“,
  Symbol der vordersten Begegnung als Eck-Sticker, Schatten für den 2. und 3. Zettel, einmal
  Wackeln bei neuem Zettel – reduziert nur Farbblitz; mobil fest unten rechts, Desktop im Kopf, auf
  U:Begegnung verborgen) mit den reinen Texten in `note-stack-view.ts` (`stackIcon` zieht um).
  `ui/encounter-cards.ts` (Kartenaufbau und Eingabeschutz ohne `<dialog>`: Kopf als Zettel,
  Sticker-Karten im Notizzettel-Stil mit Renderer-Sticker bzw. Gruppen-Emoji, „Einkleben“,
  Tausch bei voller Nische, Wildwechsel-Zeile, Ereignis-/Gast-Optionen als große Knöpfe, Legende
  als Haftnotiz am „?“ – öffnet sich beim allerersten Mal von selbst, schmal nicht) und
  `ui/plant-offers.ts` (Pflanzenzettel mit „Setzen“). Unterseiten `pages/encounter-page.ts`
  (Lesezeichen „‹ Später“, nächste Begegnung ohne neues Umblättern mit Überblenden, leerer Stapel
  blättert von selbst zurück, Fokus auf die erste wählbare Karte) und `pages/plant-picker-page.ts`
  (nach dem Setzen zurück zu den Nischen). Meldungen während Begegnung und Pflanzenwahl kommen als
  Stempel (die Weiche ins alte Hinweisfeld entfällt); mobil sammelt `overlayOpen()` die Hinweise in
  einem Stempel, solange eine Unterseite das Polaroid verdeckt. `encounter-dialog.ts`,
  `encounter-stack.ts`, `plant-picker.ts` samt CSS gelöscht. Neu: `e2e/album-encounter.spec.ts`,
  `tests/album-note-stack.test.ts`; e2e-Option `freshLegend` (sonst gilt die Legende als gesehen).
- [x] **7** Reiter Arten (`ui-dev`): Sticker-Raster mit Silhouetten, Pflanzen, Gemeinschaften,
  Andenken, Stammgast-★. Spec journal. Abhängig: 5
  *Umgesetzt:* `album/pages/species-page.ts` (R:Arten: Kopf mit `journal-counts/-meta/-regulars`,
  Sprungmarken als Washi-Streifen, Tiere nach Gattung mit „n von m“ – farbig, wenn die Art im
  Wald lebt, matt, wenn sie entdeckt, aber nicht da ist, unentdeckt als Silhouette „???“;
  ★-Knopf am Sticker (`toggleRegular`), grüner Punkt „lebt hier“; Tipp → U:Tier mit Lesezeichen
  „‹ Arten“, Tipp auf eine Silhouette → Haftnotiz mit Gattung, Seltenheit, Nische und Stufe statt
  Spoiler; Pflanzen mit Gruppen-Emoji und Notiz; Gemeinschaften; Andenken als Samentütchen und
  Zettel). Reine Logik in `pages/species-view.ts` (+ `tests/album-species.test.ts`). **Leistung:**
  feste Zellen je Art und Pflanze (einmal gebaut, danach nur Klassen und Texte), `toJournalView`
  nur bei neuem `speciesPageKey` bzw. neuer Auswertung; Bilder erst, wenn ein
  IntersectionObserver die Zelle meldet; matte Bilder und Silhouetten aus der IdleQueue
  (`StickerImage.draw(…, { preview: false })`, Silhouetten nie mit farbiger Vorschau; ein
  Leerlauf-Rückruf zeichnet bis zu 4 ms lang weitere Sticker). Gemessen mit vollem Tagebuch
  (51 Arten, 14 Pflanzen, 15 Gemeinschaften; Chromium, Rechner unter Last): Aufbau 3–4 ms,
  erste Darstellung 5–9 ms, alle sichtbaren Sticker (Desktop 15) ≈ 0,36 s nach dem
  Reiterwechsel; mit 4-facher CPU-Drosselung 7–36 ms, 14–30 ms und ≈ 0,8 s
  (`performance.measure` `album-species-build` / `album-species-first-render`).
  `journal-dialog.ts` gelöscht; der Tagebuch-Teil „Landschaft“ steht bis Schritt 10 als Abschnitt
  „Unsere Wälder“ im Reiter Landschaft (`ui/journal-landscape.ts`, eingehängt in `legacy.ts`).
  Neu: `e2e/album-species.spec.ts`; journal- und journal-landscape-Spec umgestellt.
- [x] **8** Reiter Pflege (`ui-dev`): Gerade wirksam, Pflegeliste, Unterseite Pflegemaßnahme,
  Punkt am Reiter. Spec care. Abhängig: 4
  *Umgesetzt:* `album/pages/care-page.ts` (R:Pflege: „Gerade wirksam“ als gelber Zettel mit
  Restzeit-Washi-Band, Pflegeliste mit festen Zeilen je Maßnahme, Gruppen-Überschriften in
  Handschrift, Kennzahl „2 kaufbar“ im Seitenkopf, `reveal(id)` für „Zur Pflege“) und
  `album/pages/care-item-page.ts` (U:Pflegemaßnahme: Stimmungstext, Wirkung des nächsten Rangs,
  „Öffnet Lebensraum …“, Schutz, Vorschau, alle Ränge, Voraussetzungen mit ✓/✗, Kaufen bzw.
  Stempel „voll ausgebaut“). Reine Ansichtslogik in `ui/care-view.ts` (`careOrder`,
  `carePreviewText`, `careSummaryText`, `careTabDot`, `barWidth`, `toCareItemView`).
  Seiten-Schnittstelle: `PageEnv.open/float`, `TabPage.badge` (Punkt am Reiter, läuft immer),
  `Subpage.opened(ref)`; Unterseiten registrieren sich nur noch in `pages/registry.ts`.
  `care-panel.ts` und `bonus-panel.ts` samt CSS gelöscht. Neu: `e2e/album-care.spec.ts`.
- [x] **9** Reiter Ziele (`ui-dev`): Tagesziele, Unterseiten Neuer Zyklus, Erfolge, Statistik.
  Specs daily, cycle, cycle-transition, achievements, journal-stats. Abhängig: 4.
  *Umgesetzt:* `album/pages/goals-page.ts` (Tagesziele mit Washi-Kopf, Kurzkarte Zyklus mit
  „bereit!“-Stempel, Link-Karten Erfolge/Statistik, Punkt am Reiter über `TabPage.badge`),
  `cycle-page.ts` (alle Zeilen, Ziel-Wald, Baumwahl als Samentütchen – Phase 7, 3a –, Knopf mit
  zweitem Klick, Stammgäste mit Tier-Stickern; nach dem Start zurück zu „Ziele“, Fokus auf die
  Überschrift), `achievements-page.ts` (Sticker-Bogen), `stats-page.ts`; reine Ansichten in
  `goals-view.ts` (+ Test). Gemeinsames Ziel `album/cycle-target.ts` (`albumTarget`, D.2; seit
  Schritt 10 ohne eigene Karte). Seiten werden nur
  aktualisiert, solange sie oben liegen (`refreshPages` in `album/index.ts`: aktueller Reiter und oberste Unterseite, gedrosselt, sofort nach `invalidate` oder Seitenwechsel, `update(now, force)` für alle Seiten). Gelöscht:
  `cycle-panel.ts`, `daily-panel.ts`, Reiter Erfolge/Statistik des Tagebuch-Dialogs samt CSS
- [x] **10** Reiter Landschaft (`ui-dev`): Karte, Unterseite Standort, Korridore, Wälder,
  gemeinsames Ziel mit dem Neuen Zyklus. Specs landscape, journal-landscape, wildwechsel.
  Abhängig: 9. *Umgesetzt:* `album/pages/landscape-page.ts` (R:Landschaft: Frage, Hähersaat,
  Wildwechsel-Chance, handgezeichnete Karte `album/landscape-map.ts` – vorher `ui/landscape-map.ts`
  –, Ziel-Zeile mit „Neuer Zyklus ›“, Korridore mit „Bauen“ und zweitem Klick, „Tagebuch der
  Wälder“ mit Hähersaat-Tabelle; Kennzahl „🪶 3 Hähersaat“) und `site-page.ts` (U:Standort mit
  allen Angaben, „Als Ziel wählen“ als Umschalter, Stammgäste und Tiere aus dem Tagebuch, Live-
  Ansage). `album/cycle-target.ts` hält jetzt nur Ansicht und Ziel (`view`, `target`, `choose`);
  U:Neuer Zyklus verlinkt den Ziel-Wald („… ansehen ›“, Ebene 2). Neu `PageEnv.goto(tab, page)`
  (Reiterwechsel mit Unterseite, C.1). Reine Ansichten in `pages/landscape-page-view.ts`
  (+ `tests/album-landscape.test.ts`), Fixture `openLandscapeSite`. Gelöscht: der
  Übergangsabschnitt `ui/journal-landscape.ts` (aus Schritt 7) und das alte Karten- und
  Tagebuch-CSS (`.landscape-*`, `.journal-*`) in `style.css`.
- [x] **11** Umschlag und Zettel (`ui-dev`): Anleitung als Kapitel, Einstellungen, Konto,
  Spielstand + Löschen, „Neu hier?“, Rückkehr-Zettel + Unterseite, Banderolen. Specs help,
  sound, account, save-transfer, pwa, return-report. Abhängig: 4. *Umgesetzt:* Umschlag mit
  eingeklebtem Titelschild und vier Papierstreifen (`album/cover.ts`), jeder blättert zu seiner
  Unterseite: U:Anleitung als Inhaltsverzeichnis (Ebene 1) mit Kapitelseiten (Ebene 2,
  `{ kind: 'guide', section }`, eigene Seite über `subpageKey`), „‹ Kapitel davor / nächstes
  Kapitel ›“ ersetzt die oberste Seite; Inhalt und Sichtbarkeitsregel (Landschaft, Erfolge)
  unverändert aus `guide-view.ts`. U:Einstellungen (`pages/settings-page.ts`), U:Konto
  (`pages/account-page.ts`, `album.mountAccount`; Eintrag nur mit Sync-Adresse), U:Spielstand
  mit Export/Import als Karteikarten und „Neu anfangen“. „Neu hier?“ ist eine Haftnotiz am
  Umschlag-Knopf (`album/guide-hint.ts`, ohne Fokusraub). Rückkehr-Zettel „Während du weg
  warst …“ mit „Details ›“ (U:Rückkehr-Bericht) und „Abheften“ (`album/return-report.ts`).
  `initPreferences` liegt jetzt in `ui/preferences.ts`; `help.ts` und `return-report.ts` samt
  CSS gelöscht, Hinweisfeld der Hilfe entfällt (Meldungen gehen als Stempel). Ebene 2 liegt in
  derselben Ablage wie Ebene 1 (übereinander, die weggedrehte zählt nicht zur Höhe).
- [x] **12** Aufräumen (`ui-dev`): Altbauteile und altes CSS löschen, `index.html` neu, Album-Demo,
  DESIGN_V2.md 11 und README-Bilder. Abhängig: 5–11. *Umgesetzt:* `album/legacy.ts` gelöscht –
  Ökosystem-Auffrischung in `album/eco-refresh.ts`, schwebende Zahlen in `album/floats.ts`,
  Stufen-Stempel in `album/stage-banner.ts`, Verdrahtung in `album/index.ts`; `NotifyOptions.direct`
  und `JournalView.landscape` entfallen. `style.css` auf globale Grundregeln gekürzt (≈ 2000 →
  ≈ 150 Zeilen; Kamera-Leiste und Stufen-Stempel in fullscreen.css/polaroid.css). `index.html`
  als Album-Gerüst, `theme-color` und Manifest-Farben = Karton (`#e9dfc9`). Schrift-Lizenzen
  (SIL OFL) in `public/licenses/` (landen in `dist/licenses/`). Album-Demo `src/ui/demo.html`
  mit Beispielstand. Playtest-Funde: Reiterleiste passt mobil stufenweise (`data-fit`: enger,
  Symbole, nur gewählter Reiter mit Namen), Meldungen unten statt über Navigation (oben nur auf
  der ungescrollten Hauptansicht und im Vollbild), Rückkehr-Zettel am Desktop ohne Scrollen,
  „Neu hier?“ mobil unter den Etiketten, verschlossene Lebensräume mobil kompakt, Waldtümpel
  🏞️, Hähersaat nur einmal im Kopf, matte Sticker deutlicher, Sprungmarken ohne Streifen unter
  der Leiste, Sticker nach Pixeldichte-Wechsel scharf, Fokus-Rückgabe nach „Neuer Zyklus ›“ auf
  U:Standort, Texte ohne alte Tagebuch-/Dialog-Verweise. Neuladen auf einer Unterseite spult den
  Verlauf zurück (G.3), veralteter Hash wird ersetzt. Neu: `e2e/album-layout.spec.ts`,
  `tests/album-sticker-idle.test.ts`.
- [x] **13** e2e-Abschluss (`qa-tester`): restliche Specs (smoke, playtest*-UI), neue
  `album-*`-Specs (Navigation, Wischen, reduzierte Bewegung, Haftnotiz, Vollbild, 360 px ohne
  Überlauf), kein `test.fixme`. Abhängig: 12 (album-nav-Spec schon ab 1)
  Erledigt: `e2e/album-viewports.spec.ts` (Matrix 360 × 740, 390 × 844, 1200 × 700: alle Reiter
  samt Hash, alle Unterseiten und Umschlag-Seiten mit Zurück über Lesezeichen, Browser-Zurück
  und Escape, nie Ebene 3, Begegnung einkleben, Pflege kaufen, Neuer Zyklus, Neuladen; kein
  Querscrollen, Bedienelemente ≥ 44 px, Meldungen über keiner Navigation, Screenshots je Reiter
  als Anhang), `album-nav.spec.ts` ergänzt (Hash, Neuladen, unbekannter/gesperrter Hash,
  Tastatur, reduzierte Bewegung ohne `rotateY` mit Gegenprobe), `tests/album-sticker-colors.test.ts`
  (Gattung → Sticker-Farbe). Feste Wartezeiten nach dem Umblättern durch `albumAnimationsDone`
  ersetzt, Überlauf-Messungen erst nach dem Umblättern. Wischen: siehe 13a.
- [x] **13a** Wisch-Zurück auf Unterseiten (`ui-dev`, C.2): `album/swipe.ts` (Schwellen 60 px,
  waagerecht ≥ 2 × senkrecht, oder > 0,5 px/ms ab 20 px; `data-no-swipe`, Eingabefelder,
  Canvas und die linken 20 px ausgenommen; nur auf Unterseiten) mit Vitest
  (`tests/album-swipe.test.ts`, Mitführen in `tests/album-page-turn.test.ts`). Die Seite folgt
  dem Finger (`PageTurn.drag`, Kante unter dem Finger, bis −20°) und blättert über den Verlauf
  zu Ende; bei reduzierter Bewegung nur Auslösen. e2e mit Touch-Emulation in
  `e2e/album-swipe.spec.ts` (U:Tier zurück, Schnipser, Scrollen, Rand, Kartenreihe, Reiterseite).
  Der Wisch nach unten im Vollbild (C.6) war schon in Schritt 3 gebaut.
- [x] **14** Playtest und Feinschliff (`qa-tester` → `ui-dev`/`renderer`), Leistung messen, dann
  PR `claude/album-ui` → `main`. Abhängig: 13
  Erledigt: zwei Playtests (Handy 390/360, Desktop 1280/1200) mit Rückkehrer und Spätspiel,
  keine Konsolenfehler, kein Querscrollen, kein Speicherleck. Funde behoben in #115 (doppelte
  Tagesziele nach dem Neuen Zyklus, DESIGN_V2), #116 (Meldungen verdecken keine Bedienelemente,
  Rückkehr ohne Doppelung, Reiterwechsel mobil), #117 (Einkleben im Bild, Vorratsleiste,
  Landschaftskarte hochkant, erster Start) und #118 (Umblättern ohne Stil-Neuberechnung der
  Hauptansicht). Messung 390 × 844 bei 4× CPU-Drosselung: Leerlauf ≈ 59 fps (alte UI ≈ 40),
  Dauerumblättern 39 → 44–46 fps.
  Offen als Folgeaufgaben: ~~erster Wechsel zu Arten (2 Long Tasks ≈ 200 ms bei 4× Drosselung)~~,
  ~~Sticker-Canvas als eigene Compositing-Ebenen (ggf. `<img>`)~~ – erledigt in
  `claude/leistung-arten` (ALBUM_UI.md R3: Sticker als `<img>`, Ebenen Nischen 78 → 12;
  verborgene Reiterseiten gesperrt statt `display: none`; Arten stückweise aufgedeckt und
  vorgewärmt; erster Wechsel ≈ 265 → ≈ 84 ms, erneuter Wechsel ohne Long Task, Umblättern
  39–46 → 51 fps), Landschaftskarte am Desktop mit DejaVu Sans bei 125 % (Bergmischwald knapp).

Parallel nach 1 und 4: 5, 6, 8, 9, 11; danach 7 und 10. Offene UI-Aufgaben aus Phase 7 (3a)
möglichst im Album umsetzen (ALBUM_UI.md G.2 Nr. 1).

## Phase 9 – Geschichten der Wälder

Ziel: Nach „Landschaft vollständig“ (~14 h) und „alle Wälder voll“ (~16,5 h) gibt es heute nur
noch Ernte. Phase 9 gibt jedem Wald eine **Geschichte**, die man erleben und einkleben kann –
in die Breite, ohne neuen Multiplikator (DESIGN_V2.md **26**, 24.1): ein eigenes Ereignis je
Waldtyp, sechs **Kennarten**, die nur in alten Wäldern leben, und eine **Waldchronik** mit sechs
Kapiteln je Wald, deren Abschluss ein Andenken bringt. Dazu kleine Rituale (Erfolge für die
Tagesziel-Serie) und die Album-Folgeaufgaben aus Phase 8. Reihenfolge in Wellen;
Zustandsänderungen nacheinander, nie parallel. **Einzige Spielstand-Änderung der Phase: v16**
(Chronik und Kennarten, Welle 2). Keine neuen Abhängigkeiten, kein Server.

**Bewusst kein eigener Punkt: dritte Prestige-Ebene / Klima-Epochen.** Erst wenn die Messung
(2c) und der Playtest (4b) zeigen, dass die Chroniken zu früh enden (26.10, 26.11).

**Welle 1 – Kleines zuerst** (ohne Spielstand-Änderung)

- [x] **1a** Ereignis und Lebensraum je Waldtyp (`game-designer`, 26.2): `eventFactors` Auwald
  `{ rain: 2, 'slug-year': 3 }`, Erlenbruch `{ 'toad-migration': 3 }`, Buchenhallen
  `{ 'mast-year': 2, 'vole-year': 3 }`, Bergmischwald und Heimatwald `{}`, Kiefernheide wie
  bisher; Kiefernheide ab Hain +1 Platz Trockenmauer (Eigenheit `slot`), Kurztexte. Offiziellen
  Lauf „Waldtypen“ (24.7) um eine Spalte „Ereignis des Waldes“ erweitern und nachmessen; prüfen,
  ob der Mauer-Platz die Mauer ohne Pflege öffnet und wie oft die Sonnenmauer in der Heide
  entsteht (23.9). **Warum:** beantwortet die offene Frage „weitere Massenjahre je Wald“ aus 3e
  mit einer Messung statt nach Gefühl: Das Schneckenjahr allein bliebe im Auwald unsichtbar
  (10 / 8 von 160), Regenreicher Frühling, Krötennacht und Buchenmast werden dagegen spürbar
  (78–81 %, 47–50 %, 56–66 %) – bei allen Wäldern innerhalb ±3 % (vorab gemessen, 26.2). Nur
  Daten. Abhängig: nichts. **Erledigt:** Daten in `src/content/landscape.ts` (Kurztexte im
  Wetter-Text und in der Eigenheit der Heide), Inhaltstests in `tests/landscape.test.ts`; der
  offizielle Lauf (`tests/landscape-balance.test.ts`, „Waldtypen“ mit Spalten „ohne
  Ereignis-Faktor“ und „Ereignis des Waldes“, neuer Lauf „Mauer-Platz“) bestätigt 26.2 auf die
  Sekunde: alle Waldtypen ±2,9 % (24.7 „Stand 1a“). Der Mauer-Platz öffnet die Mauer ohne
  Pflege; Sonnenmauer in der Heide 10 / 2 von 160 (vorher 3 / 0). Keine Zahl geändert
- [x] **1b** Album-Folgeaufgaben (`ui-dev`, 26.9): PNG-Kodierung bei kaltem Cache auf dem ersten
  Weg nach Arten messen (erst ab > 50 ms in einem Task handeln); `hidden="until-found"` mit
  `beforematch` für die aufgeschobenen Blöcke (`deferred-reveal.ts`), sonst wie heute;
  Safari-Notiz (kein `requestIdleCallback`, `setTimeout`-Ersatz in WebKit prüfen) in
  ALBUM_UI.md R3 und `render/idle.ts`; optional Landschaftskarte mit DejaVu Sans bei 125 %.
  **Warum:** Rest aus Phase 8, Schritt 14 / R3 – die Strg+F-Suche findet heute keine Art
  unterhalb des ersten Bildschirms, und Safari ist ungemessen. Klein, eine PR. Abhängig: nichts.
  **Erledigt** (`claude/p9-album-folge`, ALBUM_UI.md R3 „Phase 9 / 1b“): Kodierung gemessen –
  höchstens 24 ms in einem Task (Pixeldichte 3), keine Änderung; `hidden="until-found"` +
  `beforematch` → alles aufdecken; Safari-Ersatz wartet jetzt auf den nächsten Frame
  (`afterFramePost`, vorher mehrere Blöcke vor einem Frame); Kartenknöpfe am Desktop wachsen
  mit der Textgröße (`5.875rem`), mobil Zustand bis drei Zeilen. WebKit war in der Testumgebung
  nicht installierbar (gemessen in Chromium ohne `requestIdleCallback`).
- [x] **1c** Ereignis des Waldes anzeigen (`ui-dev`): U:Standort und Karte nennen die Ereignisse
  mit Faktor („Hier öfter: 🌧️ Regenreicher Frühling, 🐌 Schneckenjahr“, aus `eventFactors`);
  Spielanleitung „Landschaft“. **Warum:** Ein Gewicht, das niemand sieht, ist kein Charakter.
  Abhängig: 1a. **Erledigt:** `siteEventHints`/`siteEventText` in `ui/landscape-view.ts` (Symbol
  und Name aus `EVENTS_BY_ID`); Zeile „Hier öfter“ in U:Standort, Zeichen-Schild links oben am
  Standort der Karte (Tooltip, vorgelesen); ein Satz in der Spielanleitung. Die „… öfter“-Anhänge
  aus 1a sind aus `weatherSummary` entfernt („Wetter“ ist wieder nur Wetter, 26.2 „Anzeige“).
  Tests in `tests/landscape-view.test.ts`, `e2e/landscape.spec.ts`
- [x] **1d** Erfolge der Tagesziele (`core-engineer`, Daten aus 26.5): Bedingungsart `daily`
  (`bestStreak` | `goalsDone` | `perfectDays`), Erfolge `daily-streak-7` „Sieben Morgen“ und
  `daily-50` „Fünfzig Handgriffe“, Nachtrag beim Laden wie 12.6, Tests. **Warum:** offene Frage
  20.8 – das tägliche Ritual bekommt ein sanftes Ziel ohne Zahlen-Belohnung; die Zähler stehen
  seit v12 im Spielstand. Abhängig: nichts. **Erledigt:** ohne Spielstand-Änderung; Nachtrag bei der
  ersten Prüfung nach dem Laden, ein erfülltes Tagesziel prüft die Erfolge sofort (ein Hinweis);
  Tests in `tests/achievements-daily.test.ts` und `e2e/daily.spec.ts`. Katalog 34 (27 sichtbar ohne
  Landschaft)

**Welle 2 – Kennarten und Waldchronik (Spielstand v16)**

- [x] **2a** Zeichnungen der sechs Kennarten (`renderer`, 26.3/26.7): Haselmaus, Biber,
  Moorfrosch (im Frühling blau), Ästiger Stachelbart, Luchs, Ziegenmelker – Szene und Sticker,
  Anker wie 23.8, Nachtarten wie 21.8; zunächst nur in der Demo (`?species=`), Test „jede Art
  hat eine eigene Zeichnung“ erst mit 2b. **Warum:** Sticker sind das Herz des Albums; die
  Grafik ist der größte Brocken und hängt an nichts. Abhängig: nichts – frühe Welle möglich – umgesetzt in
  `src/render/kennart-sprites.ts` (`KENNART_IDS`, `KENNART_DEFS`, `KENNART_PAINT`,
  `KENNART_HOME`), schon in `animals.ts` und damit in `stickerKind` eingehängt: 2b muss nur die
  Daten anlegen. Haselmaus und Ziegenmelker mit Schlafbild (tagsüber, Winterschlaf bzw. Zugzeit,
  `nocturnal.ts` `sleeping`), Moorfrosch im zeitigen Frühling blau (`phenology.ts`
  `moorfrogBlue`, überblendet; Sticker blau), Biber watet am Tümpelrand (hohe Watende passen
  sich der Senke an). Demo: `?species=all|dormouse,…`, `?gallery=kennarten`, Sticker-Tafel;
  Tests `tests/render-kennarten.test.ts`
- [x] **2b** Waldchronik und Kennarten, Spielstand v16 (`core-engineer`, 26.3–26.6): Bedingung
  `{ kind: 'site', site }` (Landschaft offen, aktiver Wald, alt oder jetzt Urwald); die sechs
  Kennarten als Daten aus 26.3 (Block „Kennarten“ in `species.ts`, zwei in `NOCTURNAL`);
  `ForestSite.kennart`, `.chronicleEvent`, `.keepsake`, `content/chronicle.ts`;
  `LandscapeSite.chronicle` mit den sechs Kapiteln an den Stellen aus 26.4 (`startNewCycle`,
  Winter-Grenze in `tick`, Entscheidung eines Ereignisses, Änderungen am Ökosystem),
  `TickReport.chapters` / `OfflineReport.chapters`; Bedingungsarten `chronicles` und `journal:
  'kennarten'`, `species-all` ohne Kennarten, Erfolge `chronicle-1`, `chronicle-all`,
  `kennarten-all`; `SAVE_VERSION` 16, Migration v15 → v16 (abgeleitete Kapitel ohne Datum),
  robustes Laden (26.6), Tests (jede Version v2 … v15 lädt; online = offline für `first-snow`;
  Kennart nie vor der Landschaft; Goldwerte ohne Landschaft unverändert). **Warum:** Die Ernte
  nach der Landschaft bekommt Ziele, die zu Orten gehören – und ein Grund, im Urwald zu
  verweilen. Das Feld ist nötig, weil Kapitel wie „Erster Schnee“ und „Ereignis des Waldes“
  nicht aus dem Spielstand ableitbar sind; die Kennarten-IDs brauchen die Versionsprüfung
  (Fall 25.5). Abhängig: 1a und 1d gemergt (gleiche Dateien `landscape.ts`, `achievements.ts`).
  **Erledigt:** Daten (`content/chronicle.ts`, Kennarten in `species.ts` und `daytime.ts`,
  Standorte in `landscape.ts`), Logik in `core/landscape.ts` (`writeChapter`,
  `syncActiveChronicle`, `chronicleOf`, `completedChronicles`, `oldSiteOf`) und `core/tick.ts`,
  Laden in `core/save.ts` (`loadChronicles`); Tests in `tests/chronicle.test.ts` (online =
  offline für `first-snow` auch im Schnellvorlauf, Kennart nie vor der Landschaft, v2 … v15 laden),
  Goldwerte unverändert (nur sechs neue Zeilen). Katalog 37 (27 ohne Landschaft). Sync-Server
  ohne Änderung (vergleicht nur `schema`). Abweichung: Biber +2 💧 und Feuchte statt „+1 Platz
  Waldtümpel“ (26.3). Kleine Oberfläche bis 3a: Kennarten vor der Landschaft unsichtbar im
  Naturtagebuch und in der Spielanleitung
- [ ] **2c** Messung Chronik und Kennarten (`game-designer`, 26.8): Chronik-Politik in
  `scripts/landscape.ts` (offene Kapitel zuerst, im Urwald bis zum Winter verweilen), großer Lauf
  Harmonie / Wachstum / Zufall, Ziele (a)–(f) aus 26.8; Stellschrauben Seltenheit der Kennarten,
  `CHRONICLE_HARMONY`, Wirkungen; 24.7/24.10 und 26 nachtragen. **Warum:** Zahlen nie nach
  Gefühl – die Startwerte in 26.3/26.4 sind Schätzungen. Abhängig: 2b. **Verschoben hinter
  Phase 10, 3b** (DESIGN_V2.md 27.13): Phase 10 stellt die Ökonomie um (Begegnungen nur Tiere,
  Aussaat, Forschung in ⚖️) und verschiebt nach der Vorab-Messung H_max und Gedächtnis
  (27.10) – eine Chronik-Messung davor wäre sofort veraltet. **Zusammengelegt mit Phase 11, 3c**
  (DESIGN_V2.md 28.10): Phase 11 ändert die Ökonomie noch einmal (Ausbau, offline 10 %); gemessen
  wird einmal danach, mit derselben Chronik-Politik

**Welle 3 – Oberfläche**

- [x] **3a** Chronik und Kennarten im Album (`ui-dev`, 26.7): Abschnitt „Chronik“ auf
  U:Standort (sechs Zettel, Stempel mit Datum, Hinweise ohne Spoiler, Andenken), Kennzahl
  „📜 9 / 36 Kapitel“ und Wachssiegel auf der Karte, Spalte „Chronik“ im Tagebuch der Wälder,
  offene Kapitel beim Ziel-Wald in U:Neuer Zyklus, Reihe „Kennarten“ und Andenken in R:Arten
  (verborgen vor der Landschaft), Stempel je Kapitel, Kapitel im Rückkehr-Bericht,
  Spielanleitung „Chroniken und Kennarten“, mobil 360 px ohne Querscrollen. **Warum:** Die
  Chronik ist eine Album-Funktion – erst als Seite zum Durchblättern wird sie zur Geschichte.
  Abhängig: 2b (Sticker aus 2a; ohne sie zeigt der Sticker die Gattung)
  **Erledigt:** Texte und Ansichten rein in `ui/chronicle-view.ts` (Kennzahl, Zettel, Datum
  „7. Zyklus · Winter“ / „schon früher“, offene Kapitel als Kurzname, Stempeltext, Andenken);
  U:Standort `album/pages/site-chronicle.ts` (sechs Zettel, Stempel, Andenken als großer
  Sticker, „Stempel-Effekt“ bei neuem Kapitel, ohne Bewegung bei reduzierter Bewegung), Karte
  mit Wachssiegel (`site-seal`, Token `--wax`), Kennzahl `chronicle-total`, Zeile „Chronik“ im
  Tagebuch der Wälder, `cycle-chronicle` auf U:Neuer Zyklus, R:Arten mit eigener Reihe
  „🔎 Kennarten“ (Silhouette mit ihrem Wald, erst mit der Landschaft im DOM) und „Chroniken“ unter
  Andenken (offen „???“ ohne Namen), Spielanleitung „Chroniken und Kennarten“ (nur mit der
  Landschaft, ohne Kennart beim Namen). Stempel: `main.ts` vergleicht `chronicleOf` vorher/nachher
  (`chronicleMark`/`chaptersSince`, kein neues Feld in core) nach Aktionen, Ticks und dem Neuen
  Zyklus; offline `OfflineReport.chapters` als Punkt im Rückkehr-Bericht; die Freischaltung nennt
  die still geschriebenen Kapitel („📜 Im Heimatwald stehen schon 3 Kapitel der Chronik.“). Tests
  `tests/chronicle-view.test.ts`, `e2e/chronicle.spec.ts` (inkl. 360/390 px ohne Querscrollen)

**Welle 4 – Absichern**

- [x] **4a** e2e Phase 9 (`qa-tester`): v15-Stand lädt als v16 mit abgeleiteten Kapiteln;
  Kapitel per Fixture schreiben → Stempel → Neuladen → Chronik und Andenken bleiben; Kennarten
  vor der Landschaft unsichtbar (Arten, Zähler, Hash); v15-Gerät lehnt den v16-Stand ab
  (`outdated-client`, `newer` beim Import). Abhängig: 3a
  **Erledigt:** `e2e/chronicle-save.spec.ts` ergänzt `e2e/chronicle.spec.ts` (3a) um die Lücken:
  v15-Stand (mit fremdem Feld `chronicle`) lädt als v16 mit „schon früher“-Kapiteln, ohne Stempel,
  gespeichert als v16; letztes Kapitel online → Stempel und Erfolg „Eine Waldgeschichte“ →
  Andenken, Siegel, Andenken in R:Arten – auch nach dem Neuladen; vor der Landschaft verrät nichts
  eine Kennart (Hashes wie `#arten/beaver`, `#kennarten`, `#landschaft` → `#nischen`; Zähler je
  Gattung und gesamt, Statistik, Anleitung „Gattungen“ und „Nachtarten“; auch mit einer Kennart im
  Tagebuch); Import eines Codes einer neueren Version → `newer`, nichts geändert; Sync-Server
  lehnt ein v15-Gerät (`schema: 15`) mit 422 `outdated-client` ab, der v16-Stand bleibt. Unit-Test
  in `tests/chronicle.test.ts`: „Voller Einklang“ im Schnellvorlauf (`skipYears`) mit derselben
  Jahreszeit (Sommer) wie Schritt für Schritt. `e2e/landscape.spec.ts` mit `--repeat-each=5`
  stabil (85/85). Nach Phase 10, 2a (v17) versionsneutral: der v15-Stand lädt über v16 in die
  aktuelle Version, „älteres Gerät“ = `SAVE_VERSION - 1`. Dazu zwei wackelnde Tests robust:
  `album-encounter.spec.ts` (U:Pflanze setzen) mit angehaltener Testuhr, `album-viewports.spec.ts`
  ohne DOM-Schnappschüsse im Trace (die kosteten bei 1200 × 700 je Aufruf ~300 ms)
- [ ] **4b** Playtest Phase 9 (`qa-tester`, Funde an `ui-dev` / `renderer` / `game-designer`):
  Spätspiel-Stand mit voller Landschaft – trägt die Chronik? Wird das Verweilen im Urwald als
  schön oder als Warten erlebt? Sind Kennarten zu selten? Danach Entscheidung über eine dritte
  Ebene (26.11). Abhängig: 4a
  - Funde ui-dev erledigt (F2–F4, F6–F9): Kennart-Hinweis im alten Wald, Restzeit bis zum Winter
    beim Verweilen (U:Standort, U:Neuer Zyklus), Kapitel als eigener Stempel und Abschluss als
    Zettel mit Andenken, „Hier öfter“ markiert das Ereignis des Waldes (📜), Rückkehr-Kurzfassung
    zählt Kapitel, Sprungmarke „Chroniken“ mit offenen Kapiteln, Tagebuch der Wälder mit
    „Chronik“ oben und einklappbaren Stammgästen. Tests `tests/chronicle-view.test.ts`,
    `e2e/chronicle-playtest.spec.ts`.
  - Übrige Funde (u. a. **F5**) bleiben eigene, kleine Aufgaben und hängen nicht an Phase 11.
    Berührt ein Fund Zahlen (Seltenheit, Wirkungen), misst ihn Phase 11, 3a/3c mit, statt eine
    eigene Messung zu starten.

Parallel: 1a, 1b, 1d und 2a sofort; 1c nach 1a; 2b nach 1a und 1d; 3a nach 2b; 2c nach 2b **und
Phase 10, 3b**.

## Phase 10 – Forschung, Aussaat und Harmonie-Produktion

Ziel: Das Playtest-Feedback nach Phase 9 umsetzen (DESIGN_V2.md **27**, Wortlaut in 27.1):
**Begegnungen nur mit Tieren** (dazu Ereignisse und Gäste) – „Etwas keimt“ verlässt das Deck;
Pflanzen kommen über die **Aussaat**, einen Kauf mit Samen, der mit jedem Kauf teurer wird und die
bekannte Kartenwahl öffnet; die Pflege wird ein **Forschungsbaum** mit sechs Ästen und fünf
Gabeln, bezahlt mit **Harmonie**, die als Produktion (⚖️/min) einen Vorrat füllt; der
**Harmonie-Bonus** richtet sich nach dieser Produktion. Tempo bis Urwald und Landschaft bleibt
grob gleich (Ziele 27.11). Reihenfolge in Wellen; Zustandsänderungen nacheinander, nie parallel.
**Einzige Spielstand-Änderung der Phase: v17** (Welle 2, nach Phase 9 v16). Keine neuen
Abhängigkeiten, kein Server-Umbau (Versionsprüfung wie 25.5).

**Bewusst nicht:** bleibende Forschung (zweite Prestige-Ebene), Tausch Harmonie ↔ Samen,
Prozent-Boni auf die Harmonie-Produktion (27.14).

**Welle 1 – Vorbereitung** (ohne Spielstand, parallel)

- [x] **1a** Daten Forschungsbaum und Aussaat (`game-designer`, 27.6/27.7): neue Datei
  `src/content/research.ts` mit den 32 Knoten (ID, Ast, Ebene, Kosten, `requires`/`requiresAny`,
  `excludes`, `condition`, Wirkungen, Text, `boughtText`), `RESEARCH_BRANCHES` (Symbol, Name,
  Farbe) und den Wirkungstypen `happiness`, `sowCards`, `sowCost`, `sowFreeReroll` als Typen;
  Aussaat-Konstanten (`SOWING_BASE = 20`, `SOWING_GROWTH = 1,75`, `SOWING_MIN_STAGE = 1`,
  `SPRING_SOWING_FACTOR = 0,8`, `MAX_SOWING_CARDS = 4`); Migrations-Tabelle Pflege → Knoten als
  Daten (`CARE_TO_RESEARCH`). Noch nicht verdrahtet – `care.ts` bleibt bis 2a. Inhaltstests aus
  27.7 (kreisfrei, Gabeln gegenseitig und gleich teuer, jede Pflege-Wirkung genau einmal, Texte
  ≤ 120 Zeichen). **Warum:** Der Baum ist die größte Design-Arbeit und reine Daten; der
  `core-engineer` baut 2a dann gegen feste Inhalte, und die UI-Skizze 1c kann sofort beginnen.
  Abhängig: nichts
  *Erledigt:* `src/content/research.ts` (32 Knoten, 6 Äste, `RESEARCH_FORKS`,
  `CARE_TO_RESEARCH`), Aussaat-Konstanten in `src/content/sowing.ts`, neue Wirkungen als Typ
  `ResearchEffect` in `research.ts` (keine Änderung an `content/types.ts` oder `core/`),
  `tests/research.test.ts`; drei neue Wörter in `ui/hyphenate.ts`.
- [x] **1b** Aussaat-Animation (`renderer`, 27.12): Samen (Ahornflügel, Pusteblume) fliegen vom
  Rand in den Pflanzring; einmal je Setzen, gecacht, reduzierte Bewegung ohne; zunächst nur in der
  Demo (`?demo=sowing`). **Warum:** Die Aussaat ersetzt ein Ereignis, das der Spieler „bekam“ –
  ein sichtbarer Moment macht den Kauf zum Säen. Unabhängig von allem. Abhängig: nichts
- [x] **1c** Forschungsbaum-Layout (`ui-dev`, 27.12): Reiter „Forschung“ als Ansicht aus
  `RESEARCH` mit Platzhalter-Zuständen (Demo-Schalter), mobil 390 px (Äste aufklappbar, Zweig mit
  Ebenen, Gabel als zwei halbe Karten mit „oder“, Querverweise „braucht …“) und Desktop (Raster
  6 × 5, SVG-Verbindungen einmal je Layout); `aria-disabled`, 44-px-Treffer, kein Querscrollen
  bei 360 px. **Warum:** Die Baumdarstellung ist neu und auf dem Handy der heikle Teil; sie hängt
  nur an den Daten. Abhängig: 1a
  *Erledigt:* reine Ansicht `src/ui/album/research-tree.ts` (+ `.css`), Abbildung Zustand →
  Texte/Klassen/aria in `src/ui/research-view.ts` (inkl. `researchStatusFromBlocker` für 4a),
  Beispielzustände in `src/ui/research-fixtures.ts`, Vorschau `src/ui/research-preview.html`
  (`?state=start|middle|late&frame=full|page`). Umgeschaltet nach der **Breite des Baums** (nicht
  des Fensters): Liste mit Ast-Register unter 940 px – auch die rechte Album-Seite bei 1200 px –,
  Raster 6 × 5 darüber. Im Raster stehen Gabeln untereinander („oder“ dazwischen; Spalten zu schmal
  für zwei halbe Karten), die SVG-Linien laufen als Leitungen in den Spaltenzwischenräumen (Weg B
  rechts), damit keine Linie hinter einer Karte verschwindet. „Anderer Weg gewählt“ schlägt in der
  Anzeige die Stufensperre. Tests: `tests/research-view.test.ts`, `e2e/research-tree.spec.ts`
  (360/390/1200 px, eigener Vite-Server).

**Welle 2 – Spielstand v17** (nacheinander)

- [x] **2a** Harmonie-Vorrat und Forschung, Spielstand v17 (`core-engineer`, 27.3/27.4/27.7–27.9):
  `harmonyPoints`, Ertrag `p/60 · G` in `tick` (online = offline, Halt-Logik wie Samen),
  `cycle.research` statt `cycle.care`, Aktionen `research`/`researchBlocker`/`previewResearch`,
  Wirkungen über den Pflege-Pfad plus `happiness` je Gattung; **alle** v17-Felder schon hier
  (`cycle.sowings`, `sowing`, `freeSowing`, `meta.research`, `stats.harmonyEarned`), damit 2b den
  Typ nicht mehr ändert; `SAVE_VERSION` 17, Migration v16 → v17 (Tabelle, geschenkte
  Voraussetzungen, Startguthaben 10 min, offene Pflanzenbegegnung → offene Aussaat), robustes
  Laden, Neuer Zyklus setzt zurück und schreibt `meta.research.plan`; Texte der Erfolge
  (`harmony-*`, `care-10`) und des Tagesziels `harmony` („⚖️/min“). **Kleine UI-Anpassung im
  PR:** R:Pflege listet die Knoten flach mit Erforschen-Knopf (Adapter von `toCareViews`), damit
  `main` spielbar bleibt. Tests aus 27.9. **Warum:** Feedback 3–5 – die Harmonie wird ausgebbar,
  der Bonus hängt an der Produktion, die Pflege wird ein Baum; das Feld braucht die
  Versionsprüfung (Fall 25.5). Abhängig: 1a; **Phase 9, 2b gemergt** (v16)
  *Erledigt:* `SAVE_VERSION` 17 mit allen Feldern aus 27.9 (`harmonyPoints`, `cycle.research`,
  `cycle.sowings`/`sowing`/`freeSowing`, `meta.research`, `meta.stats.harmonyEarned`); Ertrag
  `harmonyIncome` (`p/60 · G`) in `tick` und im Jahres-Schnellvorlauf, `OfflineReport.harmony`;
  Aktionen `research`, `researchBlocker`, `previewResearch` (`core/tick.ts`), Wirkungen über
  `researchEffects` (`core/formulas.ts`, auch `happiness` und Wetterschutz), `researchSowing` für
  2b; Migration v16 → v17 und robustes Laden (`core/save.ts`); Neuer Zyklus schreibt den Plan;
  `content/care.ts` entfällt (eingefroren in `tests/fixtures/care-v16.ts`), Waldwiese und
  Trockenmauer als Knoten in `habitats.ts`; Tagesziel `care` mit ⚖️; Notliste im Reiter Pflege
  mit Vorrat im Kopf; Simulator forscht vorläufig mit der Pflege-Wahl. Tests:
  `tests/research-core.test.ts`, `tests/care-view.test.ts`. **Abweichung:** Offene
  Pflanzenbegegnung → Aussaat und `forced` Pflanze → `freeSowing` (27.9 Schritt 4 und robustes
  Laden) kommen mit **2b** – bis dahin zieht das Deck noch „Etwas keimt“, eine Umwandlung beim
  Laden würde laufende Begegnungen ohne Aussaat-Logik verstecken. Balancing-Checks der
  Samen-Senke vorübergehend gelockert (Messung 3a).
- [x] **2b** Aussaat und Begegnungen nur mit Tieren (`core-engineer`, 27.5/27.6): `sow`,
  `sowBlocker`, `sowingCost`, `chooseSowing`, `discardSowing`, `rerollSowing`; Preis mit
  Geschenk, Frühling, `sowCost`; `sowCards`, `sowFreeReroll`; `ENCOUNTER_WEIGHTS` ohne
  Pflanzenspalte, `SCRIPTED_ENCOUNTERS` mit `'sowing'`, `PLANT_WEIGHT_RING_FULL` und
  `plantSeed`/`plantBlocker`/`nextPlantCost` entfernen; Vogelsaat → `freeSowing`
  (`ForcedEncounterType` nur `'animal'`, Inhaltstest), Frühling „Saatzeit“, Tagesziel `plant`,
  Statistik `plantsPlanted`/`cardsChosen`; Golden-Test der Ziehung neu. **Kleine UI-Anpassung im
  PR:** Knopf „Säen“ statt U:Pflanze setzen, öffnet die vorhandene Kartenwahl. **Warum:**
  Feedback 1–2 – Pflanzen sind eine eigene Entscheidung des Spielers statt jeder siebten
  Begegnung, und die Samen bekommen mit dem steigenden Preis ihre Senke zurück. Abhängig: 2a
  *Erledigt:* Aktionen `sow`, `sowBlocker`, `chooseSowing`, `discardSowing`, `rerollSowing`,
  `rerollSowingBlocker` (`core/tick.ts`); Formeln `sowingCost`/`sowingCostAt` (Geschenk, Saatzeit
  aus `Season.sowingCostFactor`, Samenbank, Aufrunden mit Toleranz), `sowingCardCount`,
  `sowingRerollCost`, `resolveSowing`/`previewSowing`/`sowingChoiceBlocker` (`core/formulas.ts`);
  `ENCOUNTER_WEIGHTS` [Tier, Ereignis, Gast], `SCRIPTED_ENCOUNTERS` mit `'sowing'` (Wegpunkt 2 öffnet
  die geschenkte erste Aussaat, `TickReport.sowings`); neue Ereignis-Wirkung `freeSowing` für die
  Vogelsaat (`ForcedEncounterType` nur `'animal'`, `PendingEncounterType` ohne `'plant'`);
  `plantSeed`/`plantBlocker`/`nextPlantCost`/`PLANT_COST_*`/`PLANT_WEIGHT_RING_FULL` entfernt.
  Laden: offene „Etwas keimt“-Begegnung → offene Aussaat (weitere ziehen weiter), `forced` Pflanze
  → `freeSowing` – für v16 und v17 gleich, ohne neue Version (`convertPlantEncounters`, `save.ts`);
  `loadFreeSowing` liest die Vogelsaat. Tagesziel `plant` und Statistik auf die Aussaat umgestellt.
  **UI (einfach, 4a verfeinert):** Knopf „🌱 Säen · Preis“ im Pflanzring (Saatzeit, „tauschen“,
  „Aussaat offen ›“), die offene Aussaat liegt obenauf im Zettelstapel („Aussaat!“) und nutzt die
  Kartenwahl von U:Begegnung („Zurücklegen“ statt „Ablehnen“); U:Pflanze setzen entfällt;
  Spielanleitung: Kapitel „Säen“, „Begegnungen“ nur Tiere. Simulator sät (frei: wenn eine Pflanze
  verbessert; voll: wenn ein Tausch verbessern könnte) und wählt aus den gezogenen Karten.
  Balancing-Checks: Samen-Höchststand (< 250, Check 260), Samenbestand beim Hain (< 10 min) und
  Reserve mit Forschung (Hain < 10, Wald < 12 min) wieder auf den Grenzen vor 2a; **für 3b
  markiert** (höheres H_max ohne „Etwas keimt“, 27.10): Gedächtnis-Vorsprung Harmonie/Wachstum
  im Check > 8, erster Zyklus < 90, Urwald-Neustart < 115, Zyklus-2-Tempo Wachstum < 0,45.
  Golden-Werte (`tests/tick.test.ts`, `golden.json`) neu aufgenommen. Tests: `tests/sowing.test.ts`.

**Welle 3 – Messen und Balancing**

- [x] **3a** Messung erster Zyklus (`game-designer`, 27.10/27.11): `scripts/simulate.ts` auf
  Aussaat (Kauf und Tausch je Strategie, Wahl aus den gezogenen Karten) und Forschung (Wahl an
  den Gabeln nach Strategie, Kauf sobald bezahlbar) umstellen; großer Lauf (500 Durchgänge,
  Harmonie / Wachstum / Zufall und Stapler), alle Ziele aus 27.11; Stellschrauben in der
  Reihenfolge aus 27.11; Tabellen 15.4, 27.10 und GAME_DESIGN.md nachtragen. **Warum:** Zahlen
  nie nach Gefühl – die Startwerte in 27.6/27.7 stammen aus einem Modell ohne Kartenwahl und ohne
  Forschung, und die Vorab-Messung zeigt H_max +5 am Hain (Gedächtnis +~16). Abhängig: 2b.
  **→ Zusammengelegt mit Phase 11, 3a** (eine große Messung nach Ausbau und offline 10 %, DESIGN_V2.md
  28.10): Die Simulator-Umstellung (Gabel-Wahl, Aussaat-Tausch je Strategie) beginnt sofort als
  Phase 11, 1e; die Ziele aus 27.11 gelten dort weiter, ergänzt um 28.10
  **Erledigt mit Phase 11, 3a** (Stellschrauben 27.11: `SOWING_GROWTH` 1,6, drei Gabel-Seiten
  gestärkt; Tabelle 27.10 „Echte Messung“)
- [ ] **3b** Messung Zyklen und Landschaft (`game-designer`, 27.11): `balance-cycles` (Zyklus 2,
  Neustart in Hain/Wald/Urwald), `scripts/landscape.ts` (Landschaft vollständig ±0,7 h, Waldtypen
  ±5 % wie 24.7, Knoten je Zyklus in vollen Wäldern mit G); falls nötig Gedächtnis-Schwellen
  (`MEMORY_HARMONY_RULES`) um ΔH_max heben; 10, 24.10 und 27 nachtragen. **Warum:** Der
  Gedächtnisfaktor auf den Ertrag (27.3) und die höhere Harmonie wirken erst über viele Zyklen.
  Danach darf **Phase 9, 2c** (Chronik) messen. Abhängig: 3a. **→ Zusammengelegt mit Phase 11, 3b**

**Welle 4 – Oberfläche und Komfort**

- [x] **4a** Forschung, Harmonie und Aussaat im Album (`ui-dev`, 27.12): Reiter „Pflege“ →
  „Forschung“ (Layout aus 1c an die echte Logik: Zustände, Vorschau, „Noch 120 ⚖️ · ~1 min“,
  Bestätigung und Doppelklick-Schutz wie die Pflege), U:Forschungsknoten statt U:Pflegemaßnahme,
  Kopf „⚖️ Vorrat · +110/min“, Etikett und U:Harmonie (Produktion, Vorrat, Bonus), Knopf „🌱
  Säen“ mit Preis/Saatzeit/Tausch, grüner Zettel „Aussaat“ auf dem Stapel, Rückkehr-Meldung mit
  ⚖️, „Zur Forschung“ an verschlossenen Nischen, Spielanleitung (Begegnungen, Säen, Forschung,
  Harmonie), Statistik, Jahreszeiten- und Tagesziel-Texte; ALBUM_UI.md nachtragen. **Warum:** Der
  Baum und die zweite Währung müssen auf dem Handy lesbar sein, sonst ist die Abzweigung keine
  Entscheidung. Abhängig: 1c, 2b (Zahlen aus 3a kommen nur als Daten). **→ Zusammengelegt mit
  Phase 11, 4a** (gleich mit der Zeile „∞“ der wiederholbaren Knoten und dem Schalter aus 4c)
  **Erledigt mit Phase 11, 4a** (Forschung, Kopf, U:Harmonie, Rückkehr-Meldung, „Zur Forschung“,
  Spielanleitung; Säen-Knopf und Aussaat-Zettel kamen schon mit Phase 10, 2b)
- [x] **4b** Forschungsplan (`core-engineer`, 27.8): `meta.research.auto`; in `tick` Halt, sobald
  der Vorrat die Kosten des nächsten geplanten Knotens erreicht, Kauf streng in Plan-Reihenfolge
  (warten bei fehlender Stufe, überspringen bei anders entschiedener Gabel); Aktion
  `setResearchAuto`; online = offline (Tests). **Warum:** Späte Zyklen dauern 8–20 min – 25
  Klicks je Zyklus wären Pflicht statt Wahl. Abhängig: 2a. **→ Zusammengelegt mit Phase 11, 2b**
  (der Plan muss die Ränge der wiederholbaren Knoten kennen – ein PR statt zwei in `tick`)
  **Erledigt mit Phase 11, 2b** (`nextPlannedResearch`, `setResearchAuto`, Halt in `tick`)
- [x] **4c** Schalter „Plan folgen“ und Plan-Nummern (`ui-dev`, 27.12). Klein. Abhängig: 4a, 4b.
  **→ in Phase 11, 4a** – **Erledigt mit Phase 11, 4a**
- [x] **4d** Aussaat-Animation einhängen (`renderer`): aus 1b beim Setzen aus einer Aussaat
  (Bericht aus `chooseSowing`), Stufenbild unverändert. Abhängig: 1b, 2b. Bleibt eigenständig und
  kann sofort laufen (Phase 11 berührt die Aussaat nicht); gern im selben Zug wie Phase 11, 4d
  *Erledigt* (`claude/p10-4d-aussaat`): neues Feld `SceneInput.sowing = { startedAt, slot }`
  (render/tree.ts). main.ts merkt nach `chooseSowing` den Platz der neuen Pflanze (`sowingSlot`:
  Vorher/Nachher von `state.plants`) in einem `SowingCue` und startet, sobald die Szene zu sehen ist
  (mobil nach dem Zurückscrollen, verfällt nach 8 s); Neuer Zyklus, Löschen/Import und
  Konto-Abgleich verwerfen sie. drawScene versteckt die Pflanze bis zur Landung – Lage aus der
  ganzen Liste, die übrigen rücken nicht –, die Ebenen entstehen nur bei Beginn und Landung neu;
  Bahnen einmal je Aussaat, Sprites nur während der Aussaat. Weniger Bewegung: nichts fliegt, kein
  zusätzliches Neuzeichnen. Stufenbild und Szene nach der Aussaat unverändert. Tests
  `tests/render-sowing-scene.test.ts`, e2e in `album-encounter.spec.ts` (mit und ohne Bewegung)

**Welle 5 – Absichern**

- [x] **5a** e2e Phase 10 (`qa-tester`): v16-Stand lädt als v17 (Pflege-Ränge → Knoten,
  Startguthaben, offene Pflanzenbegegnung → Aussaat-Zettel); Säen → Karte → Neuladen → gleiche
  Karten; Gabel wählen → andere Seite gesperrt → Neuladen; Neuer Zyklus setzt Vorrat und Baum
  zurück, Plan folgt; v16-Gerät lehnt v17 ab (`outdated-client`, `newer` beim Import); R:Forschung
  bei 360/390 px ohne Querscrollen. Abhängig: 4a, 4c. **→ Zusammengelegt mit Phase 11, 5a**
- [x] **5b** Playtest Phase 10 (`qa-tester`, Funde an `ui-dev` / `renderer` / `game-designer`):
  Fühlen sich die Gabeln wie Entscheidungen an? Ist „Säen“ zu teuer/zu billig, verlieren Samen ab
  dem Wald ihren Sinn? Versteht man Vorrat gegen Produktion? Offene Fragen 27.13 entscheiden.
  Abhängig: 5a. **→ Zusammengelegt mit Phase 11, 5b**

Parallel: 1a und 1b sofort; 1c nach 1a; 2a nach 1a und Phase 9, 2b; 2b nach 2a; 3a nach 2b; 3b
nach 3a, danach Phase 9, 2c; 4a nach 1c und 2b (parallel zu 3a/3b); 4b nach 2a; 4c nach 4a und
4b; 4d nach 1b und 2b; 5a nach 4a und 4c; 5b nach 5a.

**Stand nach dem Konzept zu Phase 11** (DESIGN_V2.md 28): 3a/3b, 4a–4c, 5a/5b laufen in Phase 11
mit (Hinweise an den Aufgaben); eigenständig bleibt nur 4d.

## Phase 11 – Wachsen und Ausbauen

Ziel: Das Spieler-Feedback nach Phase 10 umsetzen (DESIGN_V2.md **28**, Wortlaut in 28.1): „ziellos“,
„viel zu viele Samen“, „mehr Incremental Game“, „immer was zum Upgraden“. **Offline bringt 10 %**
der Erträge (die Zeit läuft voll); Samen bekommen zwei endlose Senken – den **Nischen-Ausbau**
(je Stufe +0,1 % 🌿/🌰 je Tier, Meilensteine 10/25/50) und den **Baum-Ausbau** (Jahresringe,
Blattwerk, Pilzgeflecht); jeder Forschungsast endet in einem **wiederholbaren Knoten** (⚖️); eine
**Zielzeile** nennt immer das nächste Ziel mit Zeit. Rollen: 🌰 Menge, ⚖️ Qualität, Gedächtnis
Prestige. Ziele mit Toleranz in 28.10 (Takt 20–60 s, aktives Spiel 5–10 % schneller, Abstand der
Spielweisen und Gedächtnis wie heute). **Einzige Spielstand-Änderung: v18** (Welle 2). Keine neuen
Abhängigkeiten, kein Server-Umbau (Versionsprüfung wie 25.5).

**Zusammengelegt mit Phase 10 und 9** (Hinweise dort): eine große Messung statt zwei (Phase 10,
3a/3b → 3a/3b hier; Phase 9, 2c → 3c), Forschungs-Oberfläche einmal mit der Zeile „∞“ (Phase 10,
4a/4c → 4a), Forschungsplan mit Rängen (Phase 10, 4b → 2b), ein e2e und ein Playtest (Phase 10,
5a/5b → 5a/5b). Eigenständig bleiben Phase 10, 4d (Aussaat-Animation einhängen) und die übrigen
Funde aus Phase 9, 4b (F5).

**Bewusst nicht:** bleibender Ausbau, Ausbau mit ⚖️, Prozent auf Harmonie/Gedächtnis, automatisches
Ausbauen, neue Arten (28.13). Stufen-Tore und Aufträge erst als Welle 6 nach dem Playtest.

**Welle 1 – Sofort und ohne Spielstand** (parallel)

- [x] **1a** Daten Ausbau und endlose Knoten (`game-designer`, 28.4/28.6): neue Datei
  `src/content/upgrades.ts` (Startpreise `b_n` je Nische, `UPGRADE_GROWTH = 1,15`,
  `NICHE_UPGRADE_PCT = 0,1`, Baumteile `rings`/`leaves`/`mycorrhiza` mit Startpreis 15, Wirkung je
  Stufe und Text, Meilensteine als Daten `{ level, kind: 'drawWeight' | 'slot' | 'rareWeight' |
  'light' | 'water' | 'badge', … }`, `MAX_UPGRADE_LEVEL`), sechs wiederholbare Knoten in
  `research.ts` (`repeatable: { base: 1500, growth: 1.3 }`, `requiresAny` Gabel des Asts, Wirkung je
  Rang), `OFFLINE_YIELD = 0,1` und `OFFLINE_FULL_SECONDS = 60`; nur Typen, noch nicht verdrahtet.
  Inhaltstests (Preise steigend, jeder Meilenstein einmal, jede Nische einen Startpreis, Texte
  ≤ 120 Zeichen, wiederholbare Knoten ab Hain und nur hinter einer Gabel). **Warum:** Der `core-engineer`
  baut Welle 2 gegen feste Inhalte, `ui-dev` und `renderer` können sofort mit echten Namen und
  Zahlen skizzieren. Abhängig: nichts
  *Erledigt:* `src/content/upgrades.ts` (`NICHE_UPGRADE_BASE`, `UPGRADE_GROWTH`, `NICHE_UPGRADE_PCT`,
  `TREE_PARTS` mit Wirkung `treeGrowth`/`treeSeeds`/`companions` je Stufe, `NICHE_MILESTONES` und
  Meilensteine je Baumteil als `UpgradeMilestone`, `MAX_UPGRADE_LEVEL` = 1.000, Typ `TreePartId`),
  `src/content/offline.ts` (`OFFLINE_YIELD`, `OFFLINE_FULL_SECONDS`), in `research.ts` das Feld
  `repeatable` am Knoten, `RESEARCH_REPEATABLE` (sechs Knoten), `REPEATABLE_RESEARCH_BASE`/`_GROWTH`,
  `MAX_RESEARCH_RANK` = 200. **Bis 2b ausgeblendet:** die endlosen Knoten stehen nicht in `RESEARCH`
  / `RESEARCH_BY_ID` (core, Ansicht und Simulator iterieren sie); 2b nimmt sie auf. Saat hängt an
  der Gabel Samenbank/Anzuchtbeet (statt Benjeshecke, 28.6 nachgetragen), Offenland ohne Gabel an
  Spätmahd/Trockenmauer; Baumteile mit Abzeichen 25/50/75 wie die Nischen. Tests
  `tests/upgrades.test.ts`; core unverändert; ein neues Wort in `ui/hyphenate.ts` (Pilzgeflecht)
- [x] **1b** Offline 10 % (`core-engineer`, 28.3): Ertragsfaktor `f` in `tick` (Raten und
  Halte-Rechnung, nie `elapsed`), `simulateOffline` = 60 s voll + Rest × `OFFLINE_YIELD`,
  `OfflineReport.yieldFactor`/`fullSeconds`; automatisches Weiterziehen zahlt Samen-Sekunden × `f`;
  Tests: viele kleine Ticks = ein großer Tick je `f`, 30 s offline = voll, 2 h = 60 s + Rest × 0,1,
  Jahreszeit/Wetter/Chronik nach 2 h gleich wie heute, Golden-Werte online unverändert,
  Tagesziele offline unverändert. **Kleine UI-Anpassung im PR:** Rückkehr-Bericht mit „mit einem
  Zehntel der Kraft“ und dem einmaligen Hinweis (28.3), Spielanleitung „Offline“. **Warum:**
  Feedback „viel zu viele Samen, offline höchstens 10 %“ – heute trägt eine Nacht den Baum vom
  Setzling bis zum Wald (28.2). Ohne Spielstand-Änderung, darum sofort. Abhängig: nichts (Konstanten
  notfalls im PR selbst anlegen, 1a übernimmt sie)
  **Erledigt** (`claude/p11-1b-offline`): `tick(…, f)` und `simulateOffline` = `tick(60 s, 1)` +
  `tick(Rest, 0,1)` im selben Wetter-Modus; `declineReward(state, f)`, `normalizeYieldFactor`;
  Konstanten in `src/content/offline.ts` (inhaltsgleich mit 1a). Alle Nachrechnungen
  (Start, Tab zurück, Ruhezustand, Sync-Übernahme) laufen über `catchUp` → gleiche Regel; Server
  rechnet nicht nach. Tests `tests/offline-yield.test.ts`, Helfer `offlineTick` in `tests/helpers.ts`
  für „kleine Ticks = simulateOffline“; Rückkehr-Bericht, einmaliger Hinweis (Merker in den
  Einstellungen), Kapitel „Offline“ der Spielanleitung (21 Kapitel)
- [x] **1c** Layout Ausbau und Zielzeile (`ui-dev`, 28.9): R:Nischen mit Abschnitt „🌳 Dein Baum“,
  Fußzeile je Nische (Stufe, Meilenstein-Balken, Wirkung je Tier, Knopf), Kaufmenge ×1/×10/Max,
  verschlossene Nische ohne Knopf, Abzeichen am Etikett; Zielzeile im Polaroid-Kopf; reine Ansicht
  mit Beispielzuständen (Muster wie `research-fixtures.ts`), mobil 360/390 px ohne Querscrollen,
  44-px-Treffer, Desktop ≥ 900 px. **Warum:** Die Fußzeile macht jede Nischenkarte höher – das ist auf
  dem Handy der heikle Teil und hängt nur an den Daten. Abhängig: 1a (Namen; vorher Platzhalter)
  **Erledigt:** Vorschau `/src/ui/upgrade-preview.html` (Beispielzustände Keimling/Hain/Urwald,
  Platzhalter-Daten in `ui/upgrade-fixtures.ts` wie 1a), View-Modelle `ui/upgrade-view.ts`,
  Bausteine `album/upgrade-panel.ts`; Tests `tests/upgrade-view.test.ts` und
  `e2e/upgrade-preview.spec.ts` (360/390/1200 px). Noch nicht in `main.ts` – das macht 4b.
- [x] **1d** Baum-Ausbau im Bild (`renderer`, 28.9): Stammbreite, Kronenvolumen und Pilzhüte je
  10 Stufen, kleine Nischen-Details bei 25/50; Eingabe `scene.upgrades` (Schritte), in den
  Offscreen-Caches gezeichnet, neu nur beim Schrittwechsel; zunächst nur in der Demo
  (`?upgrades=rings:30,leaves:20`). **Warum:** In einem grafischen Incremental muss man den Ausbau
  sehen – und die Grafik hängt an nichts. Abhängig: nichts
  **Erledigt:** `src/render/upgrades.ts` – `SceneInput.upgrades` (Schritte; Nischen 0/1/2),
  `sceneUpgradesFromLevels` für 4d, Demo `?upgrades=rings:100,leaves:100,mycorrhiza:60,roots:50,crown:50,edge:50`.
  Stamm und Hauptäste breiter (dünne Zweige kaum), Krone mit größeren Büscheln (am Bildrand
  rücken sie nach innen, Weißtanne: dichtere Fächer), Pilzhüte am Stammfuß (im tiefen Winter
  ruhend), Wurmgänge (Wurzelraum), Nistkasten am Stamm bzw. Hauptast (Krone), Blütenpunkte
  (Waldsaum, im Winter keine). Andere Nischen noch ohne Detail; der alte Wald im
  Zyklus-Übergang bleibt ohne Ausbau
- [x] **1e** Simulator vorbereiten (`game-designer`, Rest von Phase 10, 3a): Gabel-Wahl je
  Strategie statt Pflege-Reihenfolge, Aussaat-Tausch je Strategie, Takt-Kennzahl „Zeit zwischen zwei
  Käufen“ je Stufe (Median, längste), Anteil ausgegebener Samen, Sitzungsprofil (30 min aktiv / 8 h
  offline über `simulateOffline`). **Warum:** Die große Messung 3a braucht diese Kennzahlen; der
  Umbau hängt nur an Phase 10 (fertig). Abhängig: nichts; das Sitzungsprofil misst erst nach 1b 10 %
  – **erledigt:** `forkChoice`, `sowPolicy`, `purchaseTable`, `economyTable`, `runSession`;
  Ist-Stand in DESIGN_V2.md 28.10 („Simulator vorbereitet“)

**Welle 2 – Spielstand v18 und Logik** (nacheinander)

- [x] **2a** Ausbau, Spielstand v18 (`core-engineer`, 28.4/28.8): **alle** v18-Felder (`cycle.upgrades`,
  `cycle.researchRanks`, `meta.upgrades.best`, `stats.upgradesBought`/`upgradeSeeds`), damit 2b den
  Typ nicht mehr ändert; Aktionen `upgradeNiche`, `upgradeTree`, `upgradeBlocker`, `upgradeCost`
  (mit `count`); Wirkung in `evaluate` (je Tier `0,1 % · L · z`, Hauptbaum, Begleitpflanzen),
  Ausbau-Plätze in `slotBonuses` (öffnen keine Nische), Licht/Wasser der Meilensteine, Gewichte in
  `drawAnimals` (×1,5 ab 10, seltene ×2 ab 50); Cache-Schlüssel; Neuer Zyklus setzt zurück, `best`
  bleibt; `SAVE_VERSION` 18, Migration v17 → v18, robustes Laden; Tests aus 28.8. **Kleine
  UI-Anpassung im PR:** einfacher „Ausbauen · Preis“-Knopf je Nische und drei Baum-Zeilen, damit
  `main` spielbar bleibt. **Warum:** Feedback „Was mache ich mit den Samen? Nischen ausbauen, immer
  was zum Upgraden“; das Feld braucht die Versionsprüfung (Fall 25.5). Abhängig: 1a; Phase 10, 2b
  (gemergt)
  **Erledigt:** `SAVE_VERSION` 18 mit allen Feldern aus 28.8 (`cycle.upgrades`,
  `cycle.researchRanks`, `meta.upgrades.best`, `meta.stats.upgradesBought`/`upgradeSeeds`); reine
  Regeln in `src/core/upgrades.ts` (Preis, Kaufmenge, Meilensteine, Plätze, ☀️/💧, Kartengewichte,
  Cache-Schlüssel), Aktionen `upgradeNiche`, `upgradeTree`, `upgradeBlocker`, `upgradeCost`,
  `upgradeAffordable` in `core/tick.ts`; Wirkung in `evaluateEcosystem` (Ökosystem-Feld `upgrades`),
  Ausbau-Plätze als `SlotBonus.upgrade` in `slotBonuses` (nicheSlots zählt sie nur in schon offenen
  Nischen), Gewichte in `drawAnimals` (nur mit Ausbau gewichtet – sonst gleicher Zufall);
  Schlüssel `|u:` beider evaluate-Caches; Neuer Zyklus über `createCycle`; Migration v17 → v18 und
  robustes Laden in `core/save.ts` (Ausbau vor den Nischen geladen, damit seine Plätze beim
  Kürzen zählen). Server unverändert (vergleicht nur `schema`). Oberfläche: Zeile und Knopf je
  offener Nische, Abschnitt „🌳 Dein Baum“, Meilenstein-Zettel (`upgradeMilestoneText`). Tests
  `tests/upgrades-core.test.ts`, `tests/upgrade-ui.test.ts`, online = offline mit Ausbau in
  `tests/tick.test.ts`, e2e `e2e/upgrades-basic.spec.ts`. Abweichung: 1 Mio. 🌰 reichen für
  Wurzelraum 68, nicht 55 (28.8 korrigiert); Ränge zusätzlich erst ab ihrer Stufe (Hain)
- [x] **2b** Wiederholbare Knoten und Forschungsplan (`core-engineer`, 28.6; enthält Phase 10, 4b):
  Rang statt `'owned'` für wiederholbare Knoten, `researchCost`, `researchEffects` × Rang, Plan mit
  wiederholten IDs; `meta.research.auto`, Halt in `tick` bei Kosten des nächsten Plan-Eintrags,
  `setResearchAuto`; online = offline (auch mit `f` aus 1b). **Warum:** Nach dem letzten Knoten gibt es
  heute nichts mehr für ⚖️ (28.2); der Plan muss die Ränge kennen, sonst wären es zwei PRs in
  denselben Zeilen von `tick`. Abhängig: 2a (Feld `researchRanks`), 1b (Faktor in der Halte-Rechnung)
  **Erledigt** (ohne neue Spielstand-Version – `cycle.researchRanks` und `meta.research.auto` gab es
  schon): die sechs Knoten am Ende von `RESEARCH` (einmalige: `RESEARCH_ONCE`); `researchCost(state,
  id)` mit `researchCostAt` (⌈1.500 · 1,3^r⌉, ab Rang 200 Infinity), `researchRank`,
  `researchRankOf`, `researchComplete` (erst Rang 200 „erledigt“); `researchBlocker` meldet `'owned'`
  nur noch beim höchsten Rang; `research` kauft den nächsten Rang und hängt die ID je Rang an
  `cycle.research` an – so schreibt der Neue Zyklus den Plan mit wiederholten IDs ohne neues Feld;
  `researchEffects(research, ranks)` × Rang (auch `happiness`, Ökosystem-Feld `researchRanks`),
  Cache-Schlüssel `|rr:`. Plan: `nextPlannedResearch` (erledigt / überspringen bei Gabel, auch über
  Voraussetzungen, `researchUnreachable` / warten / sparen), `plannedResearchNeed`, Kauf am Anfang
  jeder Runde und am Ende von `tick`, Halt = fehlende ⚖️ ÷ (Zufluss × f), auch in `skipYears`;
  `TickReport.research`; Plan-Käufe zählen nicht fürs Tagesziel. Laden: Verlauf höchstens so oft wie
  der Rang, Plan je wiederholbarem Knoten ≤ 200 Einträge. Simulator: Kosten über `researchCost`,
  `careRanks` mit Rang (bietet die Ränge wie jeden Knoten an – Messung in 3a). Oberfläche minimal:
  Forschungsliste „🪱 Boden · ∞ Rang 3“ mit Kosten des nächsten Rangs; Vorschau-Baum
  (`research-view.ts`) zeigt nur `RESEARCH_ONCE` (Zeile „∞“ = 4a); kein Schalter (4a). Tests
  `tests/research-ranks.test.ts`, online = offline mit Plan in `tests/tick.test.ts`, Liste in
  `tests/care-view.test.ts`. Nach Review: Unerreichbares wird vor der Stufe geprüft (sonst wartete
  der Plan ewig), Plan-Käufe melden neue Lebensgemeinschaften (`TickReport.discovered`), mit „Plan
  folgen“ kein Tagesziel „erforschen“, Erfolg `care-10` zählt Knoten und Ränge (Text), Anleitung
  nennt 32 Knoten plus die endlosen
- [x] **2c** Zielzeile (`core-engineer`, 28.7): `nextGoal(state)` rein in `formulas.ts`
  (Kandidaten, Meilenstein-Regel ≤ 120 s, billigster, Gleichstand, Zeit aus der Rate, `null` ohne
  Kandidat), Erfolge `upgrade-25` „Gut bewohnt“, `upgrade-50` „Prachtnische“, `upgrades-all-10`
  „Rundum eingelebt“ (alle offenen zehn Nischen in einem Zyklus ≥ 10) mit Bedingungsart `upgrade`
  und Nachtrag beim Laden; Tests. **Warum:** „ziellos“ – die Zeile beantwortet „was jetzt?“ in einem
  Satz; Erfolge geben dem Ausbau über den Zyklus hinaus ein Ziel. Abhängig: 2a
  **Erledigt:** `nextGoal`, `goalCandidates`, `researchAvailable`, `MILESTONE_GOAL_SECONDS` in
  `src/core/goal.ts` (eigene Datei: braucht die Sperrgründe aus `tick.ts`; 28.7 „Stand 2c“);
  Meilenstein-Regel nur für Meilensteine mit Wirkung (keine reinen Abzeichen). Bedingungsart
  `upgrade` (`level`, `atLeast`, `inCycle`) in `content/achievements.ts`/`core/achievements.ts`,
  drei Erfolge (jetzt 40, ohne Landschaft 30), ohne `SAVE_VERSION`-Wechsel – Nachtrag über die
  Bestmarke bei der ersten Prüfung nach dem Laden. **Kleine UI-Anpassung:** Zielzeile
  (`createGoalLine`/`goalLineView` aus 1c) unter den Etiketten, Tippen öffnet R:Nischen bzw.
  R:Forschung, neu gewählt nach `goalEpochKey` (Regel 5); Sprung zum Eintrag, Rückkehr-Bericht
  und Feinschliff bleiben 4c. Spielanleitung „Erfolge“ nennt den Ausbau. Tests
  `tests/goal.test.ts`, `tests/achievements-upgrade.test.ts`, `tests/upgrade-ui.test.ts`

**Welle 3 – Eine große Messung** (Phase 10, 3a/3b und Phase 9, 2c zusammengelegt)

- [x] **3a** Messung erster Zyklus (`game-designer`, 27.11 + 28.10): Simulator mit Ausbau-Strategie
  („billigste Stufe zuerst“ mit Meilenstein-Regel; Zufall wählt zufällig), 500 Durchgänge Harmonie /
  Wachstum / Zufall und Stapler; alle Ziele aus 27.11 und 28.10 (Takt 20–60 s, Anteil ausgegeben
  ≥ 85 %, Tempo −5 bis −10 %, Wachstum ÷ Harmonie ≥ 0,85, H am Hain ±3); Stellschrauben in der
  Reihenfolge 27.11, dann 28.10; Tabellen 15.4, 27.10, 28.2 und GAME_DESIGN.md nachtragen.
  **Warum:** Zahlen nie nach Gefühl – die Startwerte stammen aus Stellvertreter-Szenarien und einem
  Modell ohne Rückkopplung (28.2, 28.5). Einmal messen statt zweimal: Phase 10 allein zu messen
  wäre nach dem Ausbau veraltet. Abhängig: 1e, 2a, 2b, 2c, 1b
  **Erledigt** (`claude/p11-3a-messung`, DESIGN_V2.md 28.10 „Messung 3a“, 27.10, 28.2, 15.4,
  GAME_DESIGN.md): Simulator mit Ausbau-Strategie (`spendSeeds`: Zielzeilen-Auswahl über
  `goalCandidates`/`cheapestGoal`, Säen mit Vorrang, Zufall zufällig unter den bezahlbaren, Rücklage
  60 Samen-Sekunden; Ausbau-Käufe im Takt, `upgradeTable`, Tausch und Ränge in `economyTable`),
  neuer Vergleich mit/ohne Ausbau `tests/balance-upgrades.test.ts`, Prüfungen 28.10 in
  `tests/balance.test.ts`. **Zahlen:** `UPGRADE_GROWTH` 1,15 → 1,2, Startpreise ×2 (Wurzelraum 20 …
  Mauer 1.200, Baumteile 30), `NICHE_UPGRADE_PCT` 0,1 → 0,06, `SOWING_GROWTH` 1,75 → 1,6, Käferburg
  +3 ⚖️, Dichte Krone (+1 Platz Höhlen, −1 ☀️, +1 ⚖️), Quellbach (+40 % Moose & Farne, Amphibien
  +15 %, +3 ⚖️). **Kernzahlen** (500 Durchgänge, Harmonie / Wachstum / Zufall): Hain 54:27 /
  48:48 min / 1:17 h, Urwald 2:02 / 1:49 / 3:02 h, Wachstum ÷ Harmonie 0,896 / 0,894, H am Hain 118,5
  (ohne Ausbau 117,8), Takt 🌰 ab Alter Baum 23 / 28 / 33 s (Zufall 31 / 44 / 50 s), längste Pause bis
  Hain 1:44 min, 96–98 % der Samen ausgegeben, Bestand 1,1–1,5 min, ⚖️-Vorrat ≤ 6,6 min, 10,1 / 8,9 /
  10,6 Aussaaten bis Hain, Gabeln Krone/Boden/Wasser/Saum 62/61/66/38 % Weg A, 8 h offline am Hain 7
  Wegpunkte, keine Stufe. **Offen** (28.10, „Lücken“): Gabel Saat 100 % Samenbank (Simulator würfelt
  Aussaaten nicht neu), Takt Setzling/Junger Baum 13–15 s (Kaufrausch), endlose Ränge im ersten
  Zyklus nur beim Zufallsspieler; die Zyklen-Grenzen des großen Laufs (vier Prüfungen, schon auf `origin/main`
  verfehlt) stehen vorläufig auf den Check-Grenzen → 3b. Kleine UI-Anpassung: `formatPlusPercent`
  zeigt unter 1 % zwei Nachkommastellen („+0,06 %“), Spielanleitung nutzt sie.
- [x] **3b** Messung Zyklen, Landschaft und Offline-Tag (`game-designer`, 27.11/28.10):
  `balance-cycles` (Zyklus 2, Neustart in Hain/Wald/Urwald, Gedächtnis-Vorsprung ≥ 15),
  `scripts/landscape.ts` (Landschaft vollständig 12,5–14,5 h, Waldtypen ±5 %, Stufen und Ränge je
  Zyklus mit G), Sitzungsprofil (8 h offline am Hain ≤ 1 Stufe); falls nötig
  `MEMORY_HARMONY_RULES` heben (Platz-Meilensteine ab Wald). **Warum:** G hebt die Samen und damit die
  Stufen späterer Zyklen; die Platz-Meilensteine wirken erst ab dem Wald. Abhängig: 3a
  **Aus 3a übernommen:** Im großen Lauf stehen sechs Zyklen-Grenzen vorläufig auf den Check-Werten
  (`tests/balance-cycles.test.ts`, „Phase 11, 3b“: Zyklus 2 Harmonie < 0,52 statt 0,45, Wachstum
  < 0,45 statt 0,37, erster Gewinn < 90 statt 75, Vorsprung > 15 statt 30, Neustart-Verhältnis
  ≥ 0,92/0,93 statt 0,95/0,97, Urwald-Gewinn < 115 statt 95) – H_max am Hain 121,5 statt ~110 (27.11, Stellschraube 1:
  Schwellen T heben); Gabel Saat erst messbar, wenn der Simulator Aussaaten neu würfelt
  **Erledigt** (`claude/p11-3b-zyklen`, DESIGN_V2.md 28.10 „Messung 3b“, 15.4, 24.10, GAME_DESIGN.md):
  `MEMORY_HARMONY_RULES` Schwellen 100 / 148 / 164 → **112 / 168 / 196** (Teiler, Obergrenzen, Formel
  bleiben). Zyklus 2 bis Hain −43,3 / −28,2 / −22,7 % (H / W / Z), erster Gewinn 65,9, Vorsprung Wald /
  Urwald 86,9 / 71,3, Neustart-Verhältnisse ≥ 1,19 – die vorläufigen Grenzen stehen wieder auf den
  Zielen; Urwald-Gewinn 98,4 (Ziel < 95 mit T nicht erreichbar, Grenze < 105, Urwald ÷ Hain 1,49).
  Mit umgesetzt aus Playtest 5b (Fund F1): **Zielzeile** überspringt leere Nischen (kleine
  core-Änderung `core/goal.ts`, Tests `tests/goal.test.ts`), Simulator-Spieler „folgt der Zielzeile“
  (Hain 54:38, Wald 1:30:49 – nahe am Harmonie-Spieler). Simulator: Gratis-Wurf der Aussaat, feste
  Gabel-Seite, Offline-Tag in Zyklus 2/3, Ausbau und Ränge je Zyklus in der Landschaft; Stapler im
  großen Lauf nur bis Hain (`npm run balance` ~60 → ~38 min). **Offen** (28.10 „Lücken“): Landschaft
  11,7 h statt 12,5–14,5 h (schon vor 3b 11,6 h, Folge des Ausbaus; Landschafts-Regeln gesperrt),
  Abstand der Spielweisen ab Zyklus 2 (Wachstum ÷ Harmonie ~1,15–1,35), endlose Ränge bei bewertenden
  Spielern nie gekauft, 8 h offline in Zyklus 3 1,5 Stufen, Gabel Saat Geschmack (< 1 % Unterschied)
- [ ] **3c** Messung Chronik und Kennarten (`game-designer`, = Phase 9, 2c, 26.8): wie dort
  beschrieben, auf der Ökonomie nach 3a/3b. Abhängig: 3b

**Welle 4 – Oberfläche** (parallel zu Welle 3; Zahlen aus 3a kommen nur als Daten)

- [x] **4a** Forschung im Album (`ui-dev`, = Phase 10, 4a + 4c, dazu 28.9): Layout aus Phase 10, 1c
  an die echte Logik, Zeile „∞“ mit Rang-Stempel und Kosten, Schalter „Plan des letzten Zyklus
  folgen“ mit Plan-Nummern (auch wiederholte Ränge), Kopf „⚖️ Vorrat · +110/min“, U:Harmonie,
  Rückkehr-Meldung mit ⚖️, „Zur Forschung“ an verschlossenen Nischen, Spielanleitung; ALBUM_UI.md.
  **Warum:** ein Umbau des Reiters statt zwei – die Zeile „∞“ gehört ins Raster von Anfang an.
  Abhängig: Phase 10, 1c; 2b
  **Erledigt:** Reiter „Pflege“ heißt „Forschung“ (🔍, Hash `#forschung`, `#pflege` führt weiter;
  interne Kennung `care` bleibt) und zeigt den Baum aus 1c statt der Notliste
  (`album/pages/care-page.ts`); Spielstand → Baum in `ui/research-state.ts` (Blocker einmal je
  Stufe/Forschung/Auswertung, „erforschbar“/„sparen“ danach nur aus dem Vorrat, Kosten und Rang,
  offene Plan-Nummern je Rang). Zeile „∞ immer weiter“ unter der Wald-Ebene (Liste und Raster 6 × 6),
  Stempel „Rang 3“ neben „Erforschen · ⚖️ 3.296“, über `MAX_HARMONY_POINTS` „unerreichbar“ (auch
  `researchBlockerText`, U:Forschungsknoten). Schalter „Plan des letzten Zyklus folgen“
  (`AlbumActions.setResearchAuto`) mit Zeile „Als Nächstes (Nr. 3) …“; Plan-Käufe
  (`TickReport.research`) speichern sofort und melden sich dezent („🔍 Nach Plan erforscht: …“,
  offline als Punkt im Rückkehr-Bericht). Kauf mit Doppelklick-Schutz (`care-buy.ts`), Aufleuchten,
  schwebender Bestätigung, Fokus auf den Namen. U:Forschungsknoten für alle Knoten (auch spätere
  Stufen, `toCareView`); U:Harmonie oben Produktion/Vorrat/Bonus; Rückkehr-Meldung „+840 ⚖️“;
  „Zur Forschung ›“ an verschlossenen Nischen; Spielanleitung „🔍 Forschung“ (Reiter, ∞, Plan).
  Die alte Liste (`careOrder`, `sortCareViews`, Gruppen-Etiketten) ist entfernt. Echte 44-px-Treffer:
  Name der Karte (negativer Rand statt Pseudo-Fläche), Reiter mindestens 44 px breit („Ziele“ bei
  360 px), kein neuer Eintrag in `SMALL_OK`. Äste klappen nur mobil (Fenster < 640 px) anfangs zu.
  Tests: `tests/research-state.test.ts`, `tests/research-view.test.ts` (Zeile „∞“, Plan-Nummern),
  `tests/care-view.test.ts`, `tests/return-report-view.test.ts`, `tests/album-nav.test.ts`; e2e
  `e2e/care.spec.ts` (neu: Baum, ∞, unerreichbar, Plan), `e2e/album-care.spec.ts` und die übrigen
  Specs auf `#forschung` und die Karten-Helfer in `e2e/fixtures.ts`
- [x] **4b** Ausbau im Album (`ui-dev`, 28.9): Layout aus 1c an die echte Logik (Kaufmenge,
  Bestätigung, Meilenstein-Stempel, Einkleben des neuen Platzes, Abzeichen in Tagebuch und
  Statistik, Hinweis bei geschlossener Nische), Spielanleitung „Ausbau“; ALBUM_UI.md. **Warum:** Der
  Ausbau ist die neue Hauptschleife – er muss sich auf dem Handy wie ein Griff anfühlen. Abhängig:
  1c, 2a
  **Erledigt:** `ui/upgrade-adapters.ts` (Spielstand → Eingaben der Ansicht, Käufe je Kaufmenge
  aus `upgradeCost`/`upgradeAffordable`, Stempeltext, Statistik), R:Nischen mit den Bausteinen aus
  1c statt der 2a-Zeilen (`album/pages/niches-page.ts`: Kaufmenge im Seitenkopf, gemerkt als
  `settings.buyAmount`; „🌳 Dein Baum“; Fußzeile und Abzeichen je Nische), Aktion
  `AlbumActions.upgrade(target, count)` mit Ergebnis (Infinity = Max). Rückmeldung: Aufleuchten,
  „+1 Stufe“, „−x 🌰“, Meilenstein-Stempel (Abzeichen nur, wenn neu), neuer Platz klebt sich ein
  (`slot-arrive`, ruhig bei reduzierter Bewegung). „Bestätigung“ als sichtbare Rückmeldung, ohne
  Rückfrage (Griff statt Dialog; blasser Knopf kauft nichts, ein Kauf je Frame). Statistik
  „Ausbaustufen gekauft“ und „Höchste Ausbaustufen“, Abzeichen am Etikett auch an verschlossenen
  Nischen, Hinweis „dann lassen sie sich auch ausbauen“ an der Zusammenfassung, Spielanleitung
  „🪺 Ausbau“ (22 Kapitel). `ui/upgrade-fixtures.ts` auf echten Inhalten und core-Preisen (nur das
  Ziel bleibt nachgeahmt bis 2c). Tests `tests/upgrade-ui.test.ts`, `tests/upgrade-view.test.ts`,
  `tests/settings.test.ts`, `tests/journal-stats.test.ts`; e2e `e2e/upgrades.spec.ts` (ersetzt
  `upgrades-basic.spec.ts`, 360/390 px). 4d gleich mit erledigt (siehe dort)
- [x] **4c** Zielzeile und Rückkehr-Bericht (`ui-dev`, 28.7/28.9): Zeile im Polaroid-Kopf mit Sprung
  zum Ziel, stabil zwischen Käufen, `aria-live` nur beim Wechsel; Rückkehr-Bericht endet mit der
  Zielzeile („Genug für 6 Ausbaustufen“). Klein. Abhängig: 2c, 4b
  **Erledigt:** Sprung `jumpToGoal` (album/index.ts) → `NichesPage.reveal`: Nische, Baumteil bzw.
  Pflanzring (Säen) mittig ins Bild, Fokus auf den Namen, Aufleuchten `goal-flash`; Ziel neu nur
  bei `goalEpochKey`, Ersetzen des Spielstands oder Rückkehr; `aria-live` nur bei neuem Ziel
  (geprüft, auch e2e). Rückkehr-Bericht endet mit „🎯 Genug für N Ausbaustufen ›“
  (`affordableUpgradeSteps` in `core/goal.ts`: billigste Stufe zuerst über alle offenen Ziele =
  größtmögliche Zahl) bzw. der Zielzeile (`returnGoalView`), letzter Punkt und „Zum Ziel ›“ auf
  U:Rückkehr-Bericht. Feinschliff 2c: Auf der Doppelseite ersetzt der Zettel-Knopf die Zielzeile im
  Kopf, solange er offen ist – Polaroid bei 1200 × 700 wieder größer. ALBUM_UI.md B.1/C.8. Tests
  `tests/goal.test.ts`, `tests/upgrade-ui.test.ts`, `e2e/upgrades.spec.ts`,
  `e2e/return-report.spec.ts`
- [x] **4d** Baum-Ausbau einhängen (`renderer`): aus 1d mit `scene.upgrades` aus dem Spielstand
  (`main.ts`), Stufenbild unverändert; gern zusammen mit Phase 10, 4d. Abhängig: 1d, 2a
  **Erledigt mit 4b:** `refreshSceneEcosystem` in `main.ts` setzt `scene.upgrades =
  sceneUpgradesFromLevels(cycle.upgrades)`, sobald das Ökosystem neu ausgewertet ist (nach jedem
  Kauf, Laden, Neuem Zyklus) – nie pro Frame. Phase 10, 4d (Aussaat-Animation) bleibt offen

**Welle 5 – Absichern** (Phase 10, 5a/5b zusammengelegt)

- [x] **5a** e2e Phase 10 + 11 (`qa-tester`): v16 lädt als v18 (über v17: Pflege → Knoten, offene
  Pflanzenbegegnung → Aussaat), v17 lädt als v18 ohne Verlust; Ausbau kaufen → Meilenstein 25 →
  neuer Platz → Neuladen bleibt; ×10/Max; verschlossene Nische ohne Knopf; Zielzeile springt;
  Offline: Uhr 2 h vorstellen → Rückkehr-Bericht mit „Zehntel“, Jahreszeit weiter; Tab 30 s im
  Hintergrund → kein Verlust; Gabel wählen → andere Seite gesperrt; Rang kaufen; Neuer Zyklus setzt
  Ausbau, Ränge, Vorrat zurück, Abzeichen bleiben, Plan folgt; v17-Gerät lehnt v18 ab
  (`outdated-client`, `newer` beim Import); R:Nischen und R:Forschung bei 360/390 px ohne
  Querscrollen. Abhängig: 4a, 4b, 4c
  **Erledigt:** neue Spec `e2e/phase11.spec.ts` für die Lücken – v16 → v18 (Pflege → Knoten,
  Startguthaben, zwei Pflanzenbegegnungen → Aussaat + Samen, Neuladen ohne zweite Migration), v17 → v18
  ohne Verlust, Tab 30 s im Hintergrund = online (Vergleich mit `tick`), Uhr 2 h vorstellen (Erträge
  wie `simulateOffline`, „Zehntel“, Jahreszeit weiter), Gabel → andere Seite gesperrt → endloser
  Knoten frei → Rang → Neuladen, Neuer Zyklus (Ausbau/Ränge/Vorrat 0, Abzeichen und Erfolg bleiben,
  Plan kauft per Testuhr), R:Nischen/R:Forschung mit großen Zahlen bei 360/390 px. Schon abgedeckt
  und nicht doppelt: Meilenstein 25, ×10/Max, verschlossene Nische, Zielzeile (`upgrades.spec.ts`),
  Rang/Plan (`care.spec.ts`), `outdated-client`/`newer` (`chronicle-save.spec.ts`, SAVE_VERSION ∓ 1).
  `upgrades.spec.ts` und `care.spec.ts` rechnen Preise jetzt aus content/core (3a ändert sie)
- [x] **5b** Playtest Phase 10 + 11 (`qa-tester`, Funde an `ui-dev` / `renderer` / `game-designer`):
  Fühlt sich das Spiel noch ziellos an? Gibt es immer etwas zu kaufen, ohne Klick-Pflicht? Ist 10 %
  offline fair? Fühlen sich die Gabeln wie Entscheidungen an, verlieren Samen ab dem Wald ihren Sinn?
  Offene Fragen 27.13 und 28.12 entscheiden – auch, ob Welle 6 kommt. Abhängig: 5a
  **Erledigt:** Bericht `docs/playtest/phase11.md` (Screenshots in `docs/playtest/phase11/`):
  Zielzeilen-Spieler per Testuhr bei 1200/390 px bis Wald bzw. Hain, Neuer Zyklus, 8 h offline,
  360 px und große Zahlen. *Kurzfazit:* nicht mehr ziellos (Zielzeile immer da, Kauf alle ≤ 45 s,
  längste Pause 90 s), aber kurzsichtig wie ein Laufband; keine Klick-Pflicht (nichts geht
  verloren); 10 % offline fair (8 h ≈ 40–45 min aktiv); Gabeln lesen sich als Wahl; Samen tragen
  auch im Wald. Empfehlungen: 27.13 Sofort-⚖️ und Urwald-Ebene nein; 28.12 so lassen; Welle 6:
  6a nicht nötig, 6b erst nach F1/F4 neu bewerten. Funde: F1 Zielzeile schlägt Nischen ohne Tier
  vor (`game-designer`/`core-engineer`), F2 mobil „erforschbar ›“ landet bei zugeklappten Ästen,
  F3–F6, F8, F9 kleine Anzeige-Funde (`ui-dev`), F7 optional (`game-designer`)
  - Funde ui-dev erledigt (F2–F6, F8, F9): „🔍 erforschbar ›“ ohne Zahl, springt zum billigsten
    bezahlbaren Knoten (Ast auf, Fokus, Aufleuchten); Äste klappen bei neu Erforschbarem auf,
    selbst zugeklappte nicht; „Wald in ~22 Min.“ unter der Stufenleiste, mobil „🎯“ in der
    Vorratsleiste; „%“ und „in 0:20“ brechen nicht mehr ab; „alle Meilensteine“ umbricht ganz;
    Zahlen jenseits der Billion („Brd.“, „Trio.“, „Trd.“, ab 1e24 „1,23·10²⁴“); „+1 Stufe“ geht
    beim Reiterwechsel mit (`e2e/playtest11-ui.spec.ts`)

**Welle 6 – Später, optional** (eigene Konzeptrunde nach 5b, 28.11)

- [ ] **6a** Stufen-Tore (`game-designer` Konzept, dann `core-engineer`): z. B. Hain braucht 3 Nischen
  auf Stufe 5; Wachstum sammelt sich, Wegpunkte warten. **Warum:** nur, falls 5b zeigt, dass der
  Ausbau neben dem Wachsen herläuft statt es zu tragen. Abhängig: 5b
  **Playtest 5b:** nicht nötig – der Ausbau trägt das Wachsen (`docs/playtest/phase11.md`).
- [ ] **6b** Aufträge der Tiere (`game-designer` Konzept, dann `core-engineer`/`ui-dev`, v19): ein
  offener Wunsch eines Tiers („Wurzelraum auf 15“), Belohnung Zufriedenheit oder Samen-Sekunden.
  **Warum:** lenkt den Ausbau erzählerisch statt über Zahlen. Abhängig: 5b
  **Playtest 5b:** später, erst nach F1/F4 (Zielzeile) neu bewerten.

Parallel: 1a, 1b, 1d und 1e sofort; 1c nach 1a; 2a nach 1a; 2b nach 2a und 1b; 2c nach 2a; 3a nach
1e, 1b, 2a–2c; 3b nach 3a; 3c nach 3b; 4a nach 2b; 4b nach 1c und 2a; 4c nach 2c und 4b; 4d nach 1d
und 2a; 5a nach 4a–4c; 5b nach 5a; Welle 6 nach 5b. Phase 10, 4d jederzeit.
