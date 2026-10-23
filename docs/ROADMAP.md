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
- [ ] Prestige-Stufe 2 „Waldlandschaft“ (`game-designer`, `core-engineer`, `renderer`):
  mehrere Wälder nebeneinander mit eigenem Hauptbaum, Wildwechsel über Korridore;
  `break_infinity.js` ist dafür **nicht** nötig (gemessen, `DESIGN_V2.md` 24.9). Spielbar und
  ausgeliefert; offen sind nur Wildwechsel, Erfolge und ein Rest e2e – weiter in Phase 7, Welle 1
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
  - [ ] e2e (`qa-tester`, 24.11 Nr. 7) – teilweise: Gründen, Neuladen und Wechsel zurück mit
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
  5. Danach (`game-designer`, klein): 24.7-Lauf Käferjahr-Spalte nachmessen (Erwartung Heide
     ~70 / ~50 von 160, Zeit ±0,5 %), 24.13 abhaken. Optional (Playtest): weitere Wälder mit
     passendem Massenjahr (Auwald Schneckenjahr), erst nach dem Playtest Phase 7.
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
- [ ] **4b** Playtest Phase 7 (`qa-tester`, Funde an `ui-dev` / `renderer`). Abhängig: 4a.
  *Funde `ui-dev` erledigt* (S1–S5, K1, K3–K7): Notiz „Wetter heute“ mit dem Wetter des Waldtyps
  (`weather-site`), Wetter-Zeichen je Standort auf der Karte, Zeile „Wetter“ im Tagebuch der
  Wälder, Kapitel „Wetter“ und „Landschaft“ der Spielanleitung; Rückkehr-Bericht „⛅ Wetter im
  Bergmischwald gemittelt (…)“; Meldungen mit Satzgrenze (`joinSentences`); Baumwahl mit Grund
  der Vorauswahl („Leitbaum im Bergmischwald – …“) und „Wächst jetzt im Heimatwald“ statt
  „(jetzt)“; Erlenbruch 🐸 statt 🌫️; Sperrgrund auf der Karte („erst im Urwald · 5 🪶“); Zahl und
  🪶 umbrechen nicht getrennt; „erneut tippen“ bzw. „klicken“ je Eingabe; „Feuchte“ erklärt;
  Wildwechsel-Hinweis im Kopf der Begegnung, die Kartenreihe rollt die Karte ins Bild. Tests in
  `tests/playtest7-ui.test.ts`, `e2e/playtest7-ui.spec.ts`. Offen: Funde `renderer` (S6, S7, K8, K9)

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
  Offen als Folgeaufgaben: erster Wechsel zu Arten (2 Long Tasks ≈ 200 ms bei 4× Drosselung),
  Sticker-Canvas als eigene Compositing-Ebenen (ggf. `<img>`), Landschaftskarte am Desktop mit
  DejaVu Sans bei 125 % (Bergmischwald knapp).

Parallel nach 1 und 4: 5, 6, 8, 9, 11; danach 7 und 10. Offene UI-Aufgaben aus Phase 7 (3a)
möglichst im Album umsetzen (ALBUM_UI.md G.2 Nr. 1).
