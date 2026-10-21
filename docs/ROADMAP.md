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
- [ ] Wald und Urwald balancen, Samen-Formel an neue Schwellen anpassen (`game-designer`)
- [ ] Renderer: statische Kulisse getrennt cachen, Größenänderung entprellen (`renderer`)
- [ ] Seitenleiste: DOM-Referenzen einmal merken statt `querySelector` pro Frame (`ui-dev`)
- [ ] Schwebende Zahlen sollen das Ressourcen-Label nicht überdecken (`ui-dev`)

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


- [ ] 1.1 Inhalte v2 als Daten: Arten, Nischen, Gattungsboni, Wegpunkte + Inhaltstests (`game-designer`)
- [ ] 1.2 GameState v2, `SAVE_VERSION = 2`, Migration „Neustart mit Andenken“, `rngState` (`core-engineer`)
- [ ] 1.3 `evaluate(state)`, Wegpunkte, Begegnungs-Warteschlange (max. 3), Offline (`core-engineer`)
- [ ] 1.4 Aktionen `chooseCard`, `declineEncounter`, `rerollEncounter` (`core-engineer`)
- [ ] 1.5 Kartenwahl-Dialog, Nischen-Liste, Harmonie-Anzeige; Upgrade-Panel und Klick entfernen (`ui-dev`)
- [ ] 1.6 Simulator und `balance.test.ts` auf die echte v2-Logik umstellen (`game-designer`)
- [ ] 1.7 Playwright: Karte wählen, Neuladen, gleiche offene Karten (`qa-tester`)
- [ ] 1.8 Playtest des Prototyps mit dem PO

### Schritt 2 – Ausbau

- [ ] 2.1 Pflanzen, Licht/Wasser-Versorgung, Samen, „Etwas keimt“, Pflanzen setzen (`game-designer` + `core-engineer`)
- [ ] 2.2 Alle 5 Gattungen, 32 Arten, Gattungsboni, Seltenheit, Fähigkeiten (`game-designer` + `core-engineer`)
- [x] 2.3 Lebensgemeinschaften, vollständige Harmonie (`game-designer`)
- [x] 2.4 Ereignisse mit Wahl, Durchreisende (`core-engineer` + `game-designer`)
  - [x] Inhalte: 10 Ereignisse (`src/content/events.ts`), 8 Durchreisende
    (`src/content/visitors.ts`), Gewichte und Zwischenhalt ab Hain (`encounters.ts`),
    grobes Modell im Simulator (`scripts/extras.ts`), DESIGN_V2.md 7.2/7.4/7.5 (`game-designer`)
  - [ ] Logik nach Umsetzungsnotiz DESIGN_V2.md 7.8 (SAVE_VERSION 5), Simulator auf echte
    Logik umstellen (`core-engineer`)
- [ ] 2.5 Gattungsleiste, Pflanzenring, Harmonie-Aufschlüsselung (`ui-dev`)
  - [x] Lebensgemeinschaften-Ansicht: aufklappbare Übersicht in der Seitenleiste (aktive mit
    Harmonie, fast fertige mit „fehlt: …“, unentdeckte als „???“ mit Fortschritt), Hinweis
    „✨ vervollständigt …“ auf Karten und in „Pflanze setzen“, Entdeckungs-Meldung (`ui-dev`)
- [ ] 2.6 Tiere und Pflanzen im Bild: Ankerpunkte, gecachte Sprites (`renderer`)
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
- [ ] 2.10 Balancing aller Zahlen mit dem v2-Simulator, `scripts/v2/` aufräumen (`game-designer`)

## Phase 3 – Tiefe

- ~~Nährstoffe + Pilznetzwerk als Automatisierung~~ – in v2 aufgegangen (Gattung Pilze,
  Hallimasch „Waldweites Netz“); Humus-Kreislauf als optionale Erweiterung (DESIGN_V2.md 2.6)
- [ ] Jahreszeiten (Logik: `core-engineer`, Grafik: `renderer`) – nach v2, wirkt auf Zufriedenheit und Begegnungen
  - [x] Grafik (renderer): `SceneInput.season` 0–4 – Laubfarben, kahle Bäume, Blüten, Schnee, fallende Blätter
  - [ ] Logik (core): Jahreszeit im Spielstand, Wirkung auf Zufriedenheit und Begegnungen
- ~~Zufallsereignisse mit gespeichertem Seed~~ – in v2 aufgegangen (Begegnungen, `rngState`)
- [ ] Statistik-Seite (Spielzeit, Gesamt-Wachstum, entdeckte Arten) (`ui-dev`)
- [ ] Gattung Amphibien mit Waldtümpel (Erdkröte, Bergmolch) als Erweiterung (`game-designer`)

## Phase 4 – Prestige & Langzeitspiel

- ~~Samen + Prestige „Neuer Zyklus“~~ – Teil von v2 (Schritt 2.8)
- ~~Samen-Shop mit dauerhaften Boni~~ – ersetzt durch Waldgedächtnis und Stammgäste (v2)
- [ ] Hauptbaum-Arten (Buche, Kiefer als Startbaum) mit eigener Grafik (`renderer` + `game-designer`)
- [ ] Umstieg auf `break_infinity.js`, falls Zahlen > 1e300 (`core-engineer`)
- [ ] Erfolge / Achievements, verknüpft mit dem Naturtagebuch (`ui-dev`)

## Phase 5 – Veröffentlichung

- [ ] Deployment auf GitHub Pages
- [x] Spielstand exportieren/importieren (Text-Code „VSZW1:…“ mit Prüfsumme, Bestätigung per zweitem Klick)
- [x] Spielanleitung „❓“ (Zahlen aus content/core, Platzhalter für Ereignisse, Gäste, Pflege)
  und Hinweis „Neu hier?“ beim ersten Start (`ui-dev`)
- [x] Einstellungen „⚙️“ in localStorage: Bewegung reduzieren (Automatisch/An/Aus),
  Zahlenformat (kurz/ausgeschrieben), Hinweise länger anzeigen (`ui-dev`)
- [ ] Sound & Musik (optional)
