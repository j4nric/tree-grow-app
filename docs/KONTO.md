# Konto und Gerätesync

Mit einem Konto spielt man denselben Wald auf mehreren Geräten – auch gleichzeitig. Das
Spiel bleibt eine statische Seite auf GitHub Pages; die Spielstände liegen auf einem
**eigenen kleinen Sync-Server** (`server/`, Node 22, SQLite) auf dem vServer.

Ohne die Build-Variable `VITE_SYNC_URL` gibt es kein Konto: Der Abschnitt „Konto“ in ⚙️
Einstellungen fehlt, das Spiel macht keine Netzaufrufe und läuft rein lokal wie bisher.

## So funktioniert es

- **Anmelden:** Benutzername + Passwort, „Konto anlegen“ beim ersten Mal. Das Passwort wird
  auf dem Server mit scrypt (zufälliges Salt) gehasht. Nach der Anmeldung bekommt das Gerät
  ein Sitzungstoken (90 Tage, verlängert sich bei Nutzung), das im `localStorage` liegt und
  als `Authorization: Bearer …` gesendet wird – keine Cookies (das Spiel liegt auf einer
  anderen Domain als die API). „Abmelden“ beendet nur die Sitzung dieses Geräts.
- **Spielstand:** derselbe Text-Code wie beim Export („VSZW1:…“ mit Prüfsumme), höchstens
  256 KB. Jede Speicherung erhöht die Version; geschrieben wird nur, wenn das Gerät die
  aktuelle Version kennt (sonst 409 Konflikt).
- **Gleichzeitig spielen:** Nach jeder Spieleraktion schickt das Gerät den Stand sofort
  (höchstens einmal je Sekunde), sonst alle 15 s. Andere Geräte erfahren es per
  Server-Sent Events und übernehmen den Stand („Auf anderem Gerät weitergespielt –
  übernommen“). Weil das Spiel deterministisch ist (Zeit nur über `lastTick`), müssen
  reine Zeit-Speicherungen ohne Aktion nicht übernommen werden – nur die Version rückt
  nach; so springt nichts, solange auf dem anderen Gerät nur Zeit vergeht.
- **Konflikt:** Hat ein anderes Gerät inzwischen eine Aktion gemacht, gewinnt dessen Stand;
  die eigene, noch nicht gesendete Aktion geht verloren, liegt aber als Sicherung unter
  `vszw-backup-before-sync` im `localStorage` (als Text-Code, über „Importieren“ ladbar).
- **Erste Anmeldung auf einem Gerät:** Gibt es lokal und im Konto einen Stand, gewinnt der
  weiter fortgeschrittene (Zyklus, dann Gesamt-Wachstum, dann Spielzeit); der lokale Stand
  wird vorher unter `vszw-backup-before-sync` gesichert.
- **Offline:** Das Spiel läuft lokal weiter; der Abgleich versucht es mit wachsenden Pausen
  (2 s bis 5 min) erneut. Netzfehler ändern den lokalen Stand nie.

Die Entscheidungslogik steht rein und getestet in `src/sync/policy.ts` und
`src/sync/engine.ts` (`tests/sync-engine.test.ts`), der Server in `server/`
(`server/tests/`). Die e2e-Tests (`e2e/account.spec.ts`) spielen mit zwei Browsern gegen
einen lokalen Sync-Server.

## API (Kurzfassung)

| Methode | Pfad | Inhalt |
|---|---|---|
| POST | `/api/register` | `{username, password}` → 201 `{token, username}` · 409 Name vergeben |
| POST | `/api/login` | `{username, password}` → 200 `{token, username}` · 401 |
| POST | `/api/logout` | (Bearer) → 204 |
| GET | `/api/me` | (Bearer) → `{username}` |
| GET | `/api/save` | (Bearer) → `{data, version, actionVersion, updatedAt, deviceId}` · 204 ohne Stand |
| PUT | `/api/save` | `{data, baseVersion, deviceId, action}` → 200 · 409 `{current}` · 413 > 256 KB |
| POST | `/api/events/ticket` | (Bearer) → `{ticket}` (60 s gültig, einmalig) |
| GET | `/api/events?ticket=…` | Server-Sent Events `ready`, `save` |
| GET | `/api/health` | `{ok: true}` |

`EventSource` kann keine Header senden. Statt des langlebigen Tokens steht deshalb nur ein
**einmaliges Ticket** (60 s) in der URL – ein Eintrag im Zugriffs-Log des Proxys ist damit
wertlos. Regeln: Benutzername 3–32 Zeichen `a–z 0–9 _ - .` (Groß-/Kleinschreibung egal),
Passwort mindestens 8 Zeichen. Anmelden und Registrieren: höchstens 20 Versuche je IP in
15 Minuten (429 mit `Retry-After`).

## Einrichtung Schritt für Schritt

Voraussetzungen: ein vServer mit öffentlicher IPv4, Linux, SSH-Zugang.

### 1. Hostname (DNS) – ohne eigene Domain

Die Seite läuft auf HTTPS, also braucht auch die API HTTPS – und dafür einen Hostnamen.

**Standard: sslip.io** (kostenlos, keine Anmeldung). Der Name enthält die IP und zeigt
automatisch auf sie: Server-IP `203.0.113.5` → **`203-0-113-5.sslip.io`** (IPv4 mit
Bindestrichen). Let's Encrypt stellt dafür ganz normal ein Zertifikat aus.

**Alternative: DuckDNS**, falls sich die IP des Servers ändern kann: auf
<https://www.duckdns.org> mit GitHub anmelden, einen Namen anlegen (`name.duckdns.org`) und
die IP eintragen (bei wechselnder IP per Cron aktualisieren, Anleitung auf der Seite).
Dann überall `SYNC_PUBLIC_HOST=name.duckdns.org` verwenden.

Mit eigener Domain: A-Eintrag (z. B. `sync.example.org`) auf die Server-IP setzen.

### 2. Docker installieren

```bash
curl -fsSL https://get.docker.com | sh     # Docker Engine + Compose-Plugin
docker compose version                     # prüfen
```

Ist Docker schon da (andere Apps), nichts neu installieren.

### 3. Firewall

Von außen müssen **Port 80 und 443** offen sein (80 nur für die Zertifikatsprüfung von
Let's Encrypt). Läuft schon ein Reverse-Proxy für andere Apps, sind sie das bereits.
Beispiel mit ufw: `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp`. Beim Anbieter des
vServers ggf. auch die Firewall im Kundenmenü prüfen. Den Sync-Port (8787) **nicht**
öffnen – er ist nur lokal gebunden.

### 4. Repository holen und starten

```bash
git clone https://github.com/j4nric/tree-grow-app.git
cd tree-grow-app/deploy
./setup.sh
```

`setup.sh` verändert nichts Bestehendes. Es

1. prüft Docker, zeigt die laufenden Container (`docker ps`) und ob Port 80/443 belegt sind
   (`ss -tlnp`), und ob der lokale Sync-Port frei ist;
2. ermittelt die öffentliche IP (`curl -4 ifconfig.me`) und den sslip.io-Namen
   (oder nimmt `SYNC_PUBLIC_HOST=… ./setup.sh`);
3. schreibt `deploy/.env` (Vorlage `deploy/.env.example`);
4. startet die `vszw-`Container:
   - **Ports 80/443 frei:** Betriebsart A (eigener Caddy);
   - **80/443 gehören einem Container** (z. B. dem Caddy einer anderen App): Betriebsart B,
     `vszw-sync` tritt dessen Docker-Netzwerk bei (`PROXY_NETWORK`, kein Host-Port);
   - **80/443 gehören einem Proxy direkt auf dem Server:** Betriebsart B, nur
     `127.0.0.1:8787`;
5. gibt aus, was im vorhandenen Proxy zu ergänzen ist (bei Caddy im Container: den fertigen
   Block und die Befehle zum sicheren Einspielen samt Rückweg) – **fremde Dateien ändert es
   nie** – und nennt am Ende die URL für `VITE_SYNC_URL`.

Erzwingen bzw. vorgeben: `MODE=B`, `PROXY_NETWORK=<netz>`, `SYNC_PORT=8790`,
`SYNC_PUBLIC_HOST=…` (jeweils vor `./setup.sh`). Spätere Updates: den Befehl verwenden, den
`setup.sh` am Ende nennt.

Alle Container, Volumes und das Netzwerk heißen `vszw-…` (`vszw-sync`, `vszw-caddy`,
`vszw-data`, `vszw-net`), laufen mit `restart: unless-stopped` und Limits (Sync-Server
256 MB / 0,5 CPU, Caddy 128 MB). Nur Betriebsart A bindet an alle Adressen (Port 80/443);
sonst ist der Sync-Server höchstens unter `127.0.0.1` erreichbar.

#### Betriebsart A: eigener Caddy (nur wenn 80/443 frei sind)

```bash
docker compose --profile caddy up -d --build
```

Caddy holt das Zertifikat für `SYNC_PUBLIC_HOST` automatisch (Datei `deploy/Caddyfile`).

#### Betriebsart B: vorhandener Reverse-Proxy (Standard, wenn 80/443 belegt sind)

Im vorhandenen Proxy einen Eintrag ergänzen (Beispiele mit `203-0-113-5.sslip.io` – durch
den eigenen Namen ersetzen). Wichtig für die Live-Synchronisierung: **keine Pufferung** und
lange Lesezeit für `/api/events`.

**Caddy im Docker-Container einer anderen App** (häufigster Fall, z. B. ein Container
`haushalt-prod-caddy-1` aus dem Compose-Projekt `haushalt-prod` belegt 80/443):

```bash
docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' haushalt-prod-caddy-1
#   → z. B. haushalt-prod-intern
echo 'PROXY_NETWORK=haushalt-prod-intern' >> .env          # setup.sh erledigt das selbst
docker compose -f docker-compose.yml -f docker-compose.proxy-net.yml up -d --build
```

`vszw-sync` hängt damit im Netzwerk des Caddy und ist dort als `vszw-sync:8787` erreichbar.
Block für dessen Caddyfile (`flush_interval -1` reicht Server-Sent Events sofort durch):

```caddyfile
62-83-23-90.sslip.io {
	reverse_proxy vszw-sync:8787 {
		flush_interval -1
	}
}
```

Sicher einspielen – Pfad der Caddyfile auf dem Host steht in
`docker inspect haushalt-prod-caddy-1` unter „Mounts“ (Ziel `/etc/caddy/Caddyfile`), im
Beispiel `/home/deploy/haushalt-app/infra/production/Caddyfile`:

```bash
CADDYFILE=/home/deploy/haushalt-app/infra/production/Caddyfile
BACKUP="$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
sudo cp "$CADDYFILE" "$BACKUP"
printf '\n%s {\n\treverse_proxy vszw-sync:8787 {\n\t\tflush_interval -1\n\t}\n}\n' '62-83-23-90.sslip.io' \
  | sudo tee -a "$CADDYFILE" >/dev/null
docker exec haushalt-prod-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec haushalt-prod-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Rückweg, falls `validate` oder `reload` scheitert:

```bash
sudo cp "$BACKUP" "$CADDYFILE"
docker exec haushalt-prod-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

`cp` und `tee -a` schreiben in die bestehende Datei. Das ist wichtig, wenn sie einzeln in den
Container eingebunden ist: Änderungen per `sed -i` oder von Editoren, die die Datei ersetzen,
sähe der Container nicht. Caddy holt das Zertifikat für den neuen Namen selbst. Der Block ist eine
eigene Site – die bestehende (`{$DOMAIN}` mit `handle_path`, `encode zstd gzip` …) bleibt
unverändert, `reload` übernimmt die Konfiguration ohne Neustart.

Gehört die Caddyfile zum Repository der anderen App, geht der angehängte Block beim nächsten
Deployment dieser App verloren, falls sie die Datei überschreibt. Dann den Block dort
dauerhaft eintragen (oder per `import` aus einer eigenen Datei einbinden) – nach Absprache
mit dieser App, und erst nach `caddy validate`.

**Proxy direkt auf dem Server** – der Sync-Server lauscht nur auf `127.0.0.1:8787`:

```bash
docker compose up -d --build
```

**nginx direkt auf dem Server** (`/etc/nginx/sites-available/vszw-sync`, dann nach
`sites-enabled` verlinken):

```nginx
server {
    listen 80;
    server_name 203-0-113-5.sslip.io;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        # Server-Sent Events (Live-Sync)
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        client_max_body_size 1m;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d 203-0-113-5.sslip.io     # HTTPS + Weiterleitung von http
```

**Traefik** (Docker-Provider): Override-Datei `deploy/docker-compose.traefik.yml` nutzen.
Netzwerkname, Entrypoint und Zertifikats-Resolver wie in der eigenen Traefik-Konfiguration
in `deploy/.env` eintragen:

```bash
# deploy/.env ergänzen:
TRAEFIK_NETWORK=traefik          # docker network ls
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERTRESOLVER=letsencrypt
```

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

Die Datei setzt diese Labels und hängt den Container zusätzlich ins Traefik-Netzwerk:

```yaml
labels:
  traefik.enable: 'true'
  traefik.docker.network: traefik
  traefik.http.routers.vszw-sync.rule: Host(`203-0-113-5.sslip.io`)
  traefik.http.routers.vszw-sync.entrypoints: websecure
  traefik.http.routers.vszw-sync.tls.certresolver: letsencrypt
  traefik.http.services.vszw-sync.loadbalancer.server.port: '8787'
```

Traefik leitet Server-Sent Events ohne weitere Einstellung durch.

**Caddy direkt auf dem Server** (`/etc/caddy/Caddyfile`):

```caddyfile
203-0-113-5.sslip.io {
	reverse_proxy 127.0.0.1:8787 {
		flush_interval -1
	}
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

**nginx oder Traefik im Docker-Container:** wie beim Caddy-Container `PROXY_NETWORK` setzen
(bzw. die Traefik-Datei nutzen) und als Ziel `http://vszw-sync:8787` statt
`http://127.0.0.1:8787` eintragen.

### 5. Prüfen

```bash
curl https://203-0-113-5.sslip.io/api/health      # → {"ok":true}
docker logs vszw-sync
```

### 6. Spiel verbinden

1. GitHub → Repository → **Settings → Secrets and variables → Actions → Variables** →
   „New repository variable“: Name `VITE_SYNC_URL`, Wert `https://203-0-113-5.sslip.io`
   (ohne `/` am Ende).
2. **Actions → Pages → Run workflow** (oder einen Commit auf `main`), damit das Spiel neu
   gebaut wird.
3. Im Spiel ⚙️ Einstellungen → „Konto“ → Konto anlegen; auf dem zweiten Gerät mit
   denselben Daten anmelden.

Andere Herkunft als `https://j4nric.github.io` (z. B. eigene Domain für das Spiel):
`ALLOWED_ORIGIN` in `deploy/.env` anpassen (mehrere mit Komma) und
`docker compose up -d` erneut ausführen.

## Sicherungen

Der Server sichert die Datenbank **täglich** selbst (Online-Backup von SQLite, konsistent
auch beim Schreiben) nach `/data/backups/saves-JJJJ-MM-TT.db` im Volume `vszw-data` und
behält die neuesten 14 (`BACKUP_KEEP`). Auf den Rechner holen:

```bash
docker cp vszw-sync:/data/backups ./vszw-backups
```

Wiederherstellen: Container stoppen, Sicherung als `/data/saves.db` zurückkopieren
(dabei `saves.db-wal` und `saves.db-shm` löschen), Container starten. Für Sicherungen
außerhalb des Servers den Ordner regelmäßig (z. B. per Cron und `docker cp`) wegkopieren.

## Aktualisieren

```bash
cd tree-grow-app && git pull
cd deploy && docker compose up -d --build        # bzw. mit --profile caddy / Traefik-Datei
```

Die Daten im Volume `vszw-data` bleiben erhalten. Docker-weite Aufräumbefehle sind nicht
nötig – auf einem Server mit anderen Apps bitte auch keine verwenden.

## Sicherheitshinweise

- Passwörter liegen nur als scrypt-Hash vor, Sitzungstoken nur als SHA-256-Hash. Wer die
  Datenbank kopiert, kann sich damit nicht anmelden.
- Nur HTTPS verwenden (`VITE_SYNC_URL` mit `https://`) – sonst gehen Passwort und Token im
  Klartext über das Netz. Der Browser blockiert http-Aufrufe von der https-Seite ohnehin.
- CORS lässt nur `ALLOWED_ORIGIN` zu; Anfragen anderer Seiten werden mit 403 abgelehnt.
- Rate-Limit gegen Passwort-Raten (20 Versuche je IP in 15 Minuten); hinter dem Proxy
  zählt die IP aus `X-Forwarded-For` (der Proxy muss sie setzen, wie in den Beispielen).
- Das Token liegt im `localStorage` des Browsers. Auf fremden Geräten nach dem Spielen
  „Abmelden“.
- Der Container läuft ohne Root, mit schreibgeschütztem Dateisystem (außer `/data`),
  `no-new-privileges` und Speicher-/CPU-Limits. Der Sync-Port ist nur lokal gebunden.
- Es gibt kein „Passwort vergessen“ (keine E-Mail). Notfalls auf dem Server das Konto
  löschen (`DELETE FROM users WHERE username = '…'` per `sqlite3` im Volume) und neu
  anlegen; der Spielstand lässt sich vorher über den Export des Spiels sichern.
