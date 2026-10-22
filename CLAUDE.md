# Vom Samen zum Wald – Leitfaden für Claude-Agenten

Ein grafisches Incremental Game im Browser: Der Spieler beginnt als Samen und wächst
bis zum Urwald. Spielsprache ist **Deutsch**, Code und Bezeichner sind **Englisch**,
Kommentare auf Deutsch.

## Befehle

```bash
npm install        # Abhängigkeiten
npm run dev        # Dev-Server (http://localhost:5173)
npm run check      # Typecheck + Tests – vor jedem Commit ausführen
npm run build      # Produktions-Build nach dist/
npm run balance    # großer Balancing-Lauf: 500 Durchgänge, alle Tabellen (~8 min)
```

## Architektur

```
src/
  core/      Spiellogik. Reines TypeScript, KEIN DOM, kein Date.now(), kein Math.random().
             Zeit kommt nur als Parameter (dt / now) hinein → deterministisch & testbar.
    state.ts     GameState (JSON-serialisierbar) + Startwerte
    formulas.ts  Raten, Kosten, Stufen, growth() für die Darstellung
    tick.ts      tick(), Spieleraktionen (clickGrow, buyUpgrade), Offline-Simulation
    save.ts      Serialisieren, robustes Laden, localStorage
  content/   Spielinhalte als reine Daten (Stufen, Upgrades). Keine Logik.
  render/    Canvas-Zeichnung. Liest nur `growth` + Zeit, verändert nie den Spielstand.
  ui/        DOM-Oberfläche (Seitenleiste, Zahlenformat). Ruft nur Aktionen aus core/ auf.
  sync/      Konto und Gerätesync (Client): Entscheidungslogik rein in policy.ts, Netzwerk in
             http-service.ts, nur aktiv mit VITE_SYNC_URL. core/ bleibt ohne Netzwerk.
  pwa/       Service Worker (rein, ohne DOM); Registrierung und Update-Hinweis in ui/pwa.ts.
             Nie fremde Origins, /api/ oder SSE abfangen. Not-Aus: VSZW_SW_KILL=1 (README).
  main.ts    Verdrahtung: Game Loop (requestAnimationFrame), Autosave, Offline-Fortschritt.
server/      Sync-Server (Node, node:sqlite, eigenes package.json, eigene Tests).
deploy/      Docker Compose und setup.sh für den Sync-Server; Anleitung in docs/KONTO.md.
tests/       Vitest-Tests, vor allem für core/ und content/.
docs/        GAME_DESIGN.md (Spielregeln & Zahlen), ROADMAP.md (Aufgaben).
```

**Abhängigkeitsrichtung:** `ui` / `render` → `core` → `content`. Nie umgekehrt
(Ausnahme: `content` darf *Typen* aus `core/state.ts` importieren).

## Regeln

- **Zuständigkeiten respektieren:** Jeder Agent arbeitet in seinem Bereich (siehe
  `.claude/agents/`). Änderungen an fremden Bereichen klein halten und im PR erwähnen.
- **Spielstand-Format ist eine Schnittstelle.** Wer `GameState` ändert, erhöht
  `SAVE_VERSION`, ergänzt eine Migration in `save.ts` und einen Test dafür.
  Alte Spielstände dürfen nie zum Absturz führen.
- **Neue Inhalte zuerst als Daten** in `content/`. Neue Effekttypen brauchen Logik
  in `core/formulas.ts` und einen Test.
- **Zahlen und Balancing** stehen in `docs/GAME_DESIGN.md`. Wer Werte in `content/`
  ändert, aktualisiert das Dokument.
- **Jede Logikänderung bekommt Tests.** `npm run check` muss grün sein.
- **Große Zahlen:** JS-`number`s reichen, auch für die Waldlandschaft (gemessen < 1e5 🌿/s,
  Begründung in `docs/DESIGN_V2.md` §24.9). Neue Prestige-Ebenen gehen in die Breite, nicht
  in unbegrenzte Multiplikatoren: jeder Faktor bekommt eine Obergrenze. `break_infinity.js`
  erst, wenn eine Messung ~1e300 zeigt (Migrationsplan in §24.9).
- **Performance:** Der Renderer läuft jeden Frame. Teure Zeichnungen cachen
  (z. B. Offscreen-Canvas), nicht pro Frame neu berechnen.
- Keine neuen Abhängigkeiten ohne Begründung im PR.

## Git-Workflow

- Ein Branch pro Aufgabe (`claude/<kurzbeschreibung>`), ein PR pro Branch.
- Commit-Nachrichten auf Deutsch, im Imperativ: „Füge Jahreszeiten hinzu“.
- PR-Beschreibung: Was, Warum, wie getestet, betroffene Bereiche.
- Erledigte Aufgaben in `docs/ROADMAP.md` abhaken.
