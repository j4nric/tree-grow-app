# 🌱 Vom Samen zum Wald

Ein grafisches Incremental Game im Browser: Du beginnst als kleiner Samen und wächst
über Keimling, Setzling und Baum bis zu einem riesigen Urwald.

## Loslegen

```bash
npm install
npm run dev     # http://localhost:5173
npm run check   # Typecheck + Tests (schnell, vor jedem Commit)
npm run balance # großer Balancing-Lauf: 500 Durchgänge, alle Tabellen (DESIGN_V2.md 15.4)
```

## Als App installieren und offline spielen

Das Spiel ist eine installierbare Web-App (PWA): Im Browser „Zum Startbildschirm
hinzufügen“ bzw. „App installieren“ wählen. Nach einem Besuch mit Netz startet es auch
offline; Konto und Gerätesync brauchen weiterhin Netz und holen den Abgleich später nach.
Gibt es eine neue Version, erscheint oben „Neue Version verfügbar – neu laden“ – der
Spielstand wird vor dem Neuladen gespeichert.

- Manifest und Icons: `public/manifest.webmanifest`, `public/icons/` (erzeugt mit
  `node --experimental-strip-types scripts/generate-icons.ts`)
- Service Worker: von Hand in `src/pwa/service-worker.ts`; `npm run build` schreibt daraus
  `dist/sw.js` mit allen gebauten Dateien und einer Inhalts-Version (Plugin in
  `vite.config.ts`). Seiten zuerst aus dem Netz, gehashte Dateien aus dem Cache; der
  Sync-Server (andere Adresse, `/api/`, Event-Stream) wird nie abgefangen.
- Angemeldet wird er nur im Build, nicht mit `npm run dev` und nicht in e2e-Tests
  (außer `e2e/pwa.spec.ts`, das ihn mit `window.__VSZW_SW__ = true` einschaltet).

## Projekt

- [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) – Spielregeln, Zahlen, geplante Systeme
- [`docs/ROADMAP.md`](docs/ROADMAP.md) – Aufgaben nach Phasen
- [`docs/KONTO.md`](docs/KONTO.md) – optionales Konto mit Gerätesync (Sync-Server in `server/`)
- [`CLAUDE.md`](CLAUDE.md) – Architektur und Regeln für Entwickler und Claude-Agenten

## Mit Claude-Agenten arbeiten

Unter [`.claude/agents/`](.claude/agents/) liegen spezialisierte Rollen:

| Agent | Bereich |
|---|---|
| `game-designer` | Balancing, Inhalte, `docs/GAME_DESIGN.md` |
| `core-engineer` | Spiellogik in `src/core/`, Speichern, Game Loop |
| `renderer` | Prozeduraler Baum und Szene in `src/render/` |
| `ui-dev` | Oberfläche in `src/ui/` und `src/style.css` |
| `qa-tester` | Unit- und Playwright-Tests |
| `reviewer` | Code-Review (nur lesend) |

In einer Claude-Code-Session einfach ansprechen, z. B.
*„Lass den game-designer die Upgrades bis zum Hain balancen.“*

Für parallele Arbeit: pro Roadmap-Aufgabe eine eigene Session auf claude.ai/code
starten. Jede Session arbeitet auf ihrem eigenen Branch und öffnet einen PR.
