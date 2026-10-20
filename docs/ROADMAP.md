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

## Phase 2 – Spielbares MVP (parallelisierbar)

- [ ] **Balancing-Simulator** – Skript, das eine Spielstrategie simuliert und die Zeit
      bis zu jeder Stufe ausgibt (`game-designer`)
- [ ] **Upgrades bis „Hain“** ergänzen und auf die Zeitziele balancen (`game-designer`)
- [ ] **Renderer aufwerten** – Baum in Offscreen-Canvas cachen, dichtere Krone,
      Wurzeln unter der Erde sichtbar, Himmel mit Wolken (`renderer`)
- [ ] **Feedback beim Klicken** – schwebende „+1 💧“-Zahlen, Partikel, Kauf-Animation (`ui-dev`)
- [ ] **Playwright-Smoke-Test** – Spiel starten, wachsen, kaufen, neu laden (`qa-tester`)

## Phase 3 – Tiefe

- [ ] Nährstoffe + Pilznetzwerk als Automatisierung (`core-engineer` + `game-designer`)
- [ ] Jahreszeiten (Logik: `core-engineer`, Grafik: `renderer`)
- [ ] Zufallsereignisse mit gespeichertem Seed (`core-engineer`)
- [ ] Statistik-Seite (Spielzeit, Gesamtenergie, Klicks) (`ui-dev`)

## Phase 4 – Prestige & Langzeitspiel

- [ ] Samen + Prestige „Neuer Zyklus“ (`core-engineer` + `game-designer`)
- [ ] Samen-Shop mit dauerhaften Boni (`game-designer`)
- [ ] Baumarten mit eigener Grafik (`renderer`)
- [ ] Umstieg auf `break_infinity.js`, falls Zahlen > 1e300 (`core-engineer`)
- [ ] Erfolge / Achievements (`ui-dev`)

## Phase 5 – Veröffentlichung

- [ ] Deployment auf GitHub Pages
- [ ] Spielstand exportieren/importieren (Text-Code)
- [ ] Sound & Musik (optional)
