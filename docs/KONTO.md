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
  200 000 Zeichen – genau so viel, wie das Spiel selbst importieren kann (die Anfrage darf mit
  Hülle 256 KB groß sein). Jede Speicherung erhöht die Version; geschrieben wird nur, wenn das
  Gerät die aktuelle Version kennt (sonst 409 Konflikt). Ein Gerät sendet nie einen Stand, den
  es selbst nicht wieder importieren könnte (dann steht im Konto-Abschnitt „zu groß“).
- **Spielversionen:** Mit jedem Stand speichert der Server die Spielstand-Version des
  schreibenden Spiels (`SAVE_VERSION`). Ein älteres Spiel übernimmt nie einen Stand einer
  neueren Version und sendet dann nichts mehr („Neue Spielversion – bitte neu laden“ im
  Konto-Abschnitt); der Server lehnt sein Schreiben zusätzlich ab (422 `outdated-client`). So
  kann ein alter, noch offener Tab einen neueren Stand nie herabstufen.
- **Unlesbarer Stand im Konto:** wird weder übernommen noch überschrieben; der Abgleich hält an
  („nicht lesbar“) und prüft mit wachsenden Pausen erneut – kein Hin und Her zwischen Geräten.
- **Gleichzeitig spielen:** Nach jeder Spieleraktion schickt das Gerät den Stand sofort
  (höchstens einmal je Sekunde), sonst alle 15 s. Andere Geräte erfahren es per
  Server-Sent Events und übernehmen den Stand („Auf anderem Gerät weitergespielt –
  übernommen“). Weil das Spiel deterministisch ist (Zeit nur über `lastTick`), müssen
  reine Zeit-Speicherungen ohne Aktion nicht übernommen werden – nur die Version rückt
  nach; so springt nichts, solange auf dem anderen Gerät nur Zeit vergeht. Wie lange ein
  übernommener Stand schon liegt, rechnet das Spiel allein mit der Uhr des Servers
  (`serverTime − updatedAt`) – eine falsch gehende Geräte-Uhr verschenkt oder verschluckt
  keine Wachstumszeit.
- **Konflikt:** Hat ein anderes Gerät inzwischen eine Aktion gemacht, gewinnt dessen Stand;
  die eigene, noch nicht gesendete Aktion geht verloren, liegt aber als Sicherung im
  Sicherungs-Ring (siehe unten).
  Stammt der Stand im Konto von diesem Gerät selbst (die Antwort auf einen Push ging
  verloren), ist er die eigene Linie: Das Gerät schreibt weiter, statt den älteren
  Schnappschuss zu übernehmen.
- **Erste Anmeldung auf einem Gerät:** Vorher werden **beide** Stände gesichert (lokaler und
  Cloud-Stand, im Sicherungs-Ring). Gehört der lokale Stand zu einem anderen
  Konto (das Gerät merkt sich, mit welchem Konto es zuletzt abgeglichen hat), gewinnt der
  Stand aus dem Konto. Sonst gewinnt der weiter fortgeschrittene (Zyklus, dann
  Gesamt-Wachstum, dann Spielzeit).
- **Mehrere Tabs:** Die Sitzung liegt im `localStorage` und gilt für alle Tabs des Browsers.
  Jeder Tab schreibt nur mit der Sitzung des Kontos, mit dem er gestartet ist. Meldet sich ein
  anderer Tab ab, ist auch dieser Tab abgemeldet; meldet sich ein anderer Tab mit einem
  (anderen) Konto an, hält dieser Tab den Abgleich an und bittet um „Neu laden“ – sein Spiel
  im Speicher gehört nicht zu diesem Konto. Ab dann schreibt dieser Tab auch den gemeinsamen
  lokalen Spielstand nicht mehr (auch nicht beim Neuladen), sonst landete sein Spiel nach dem
  Neuladen im anderen Konto. Abmelden und eine abgelaufene Sitzung löschen nur die eigene
  Sitzung, nie die eines anderen Tabs. Meldet sich ein anderer Tab mit genau dem Konto an,
  zu dem das Spiel dieses Tabs gehört, macht dieser Tab wieder mit – wie bei einer ersten
  Anmeldung (beide Stände gesichert), weil sein Spiel vom gespeicherten abweichen kann.
- **Wem der lokale Stand gehört:** `vszw-sync-base` = `{user, version, pending}` – Konto,
  Cloud-Version, auf der er beruht, und ob seitdem eine Aktion fehlt. Diese Angaben schreibt
  jeder Tab **im selben Takt wie den Spielstand** und aus seinem eigenen Speicher; so passen
  „Spielstand“ und „gehört zu X“ immer zusammen, auch wenn mehrere Tabs abwechselnd speichern
  oder ein Tab eine Sicherung lädt. Die Grundlage gilt nur für genau dieses Konto – nach
  A → B → A gewinnt bei A der Cloud-Stand.
- **Sicherungs-Ring:** `vszw-backups` hält die letzten 10 ersetzten Stände (zusammen höchstens
  1,5 Mio. Zeichen), je mit Konto, Zeitpunkt, Grund (erste Anmeldung lokal/Cloud, überholte
  Aktion, vor dem Übernehmen, vor dem Wiederherstellen) und Fortschritt. Denselben Stand gibt
  es nur einmal; ist der Ring voll, weicht zuerst das Sicherheitsnetz „vor dem Übernehmen“,
  dann die älteste. Frühere Einzel-Sicherungen (`vszw-backup-before-sync` …) werden beim Start
  übernommen. Im Konto-Abschnitt listet „Sicherung vor dem Sync wiederherstellen“ sie mit
  Grund, Konto, Zyklus und Alter; „Laden“ in der aufgeklappten Liste ist die Bestätigung und
  ersetzt den aktuellen Wald (angemeldet geht er wie eine Aktion ans Konto; der Stand davor
  kommt selbst in den Ring). Angemeldet werden nur Sicherungen des eigenen Kontos und rein
  lokale angeboten, abgemeldet alle mit Angabe des Kontos; eine abgemeldet geladene Sicherung
  gehört danach ihrem Konto – ohne Grundlage, also beim nächsten Anmelden wie eine erste
  Anmeldung.
- **Grundsatz:** Kein Weg ersetzt einen lokalen oder Cloud-Stand, ohne ihn vorher zu sichern;
  ein Spiel, das zuletzt mit Konto X lief, landet nie in einem anderen Konto mit Stand. Dafür
  merkt sich jeder Tab, zu welchem Konto das Spiel in seinem Speicher gehört; die
  Geräte-Kennung ist je Anmeldung neu (eigene Linie nur, wenn der Stand zu diesem Konto
  gehört); vor jedem Übernehmen beim Start wird der lokale Stand gesichert; abgemeldet
  gespielte Fortschritte werden für das Konto des Stands als offen vermerkt.
  `tests/sync-sequences.test.ts` spielt Abfolgen aus Anmelden A/B, Abmelden, Spielen,
  Neuladen (auch mitten im Senden), Wiederherstellen, zweitem Tab, Schreiben anderer Geräte,
  Netzfehlern (vor/nach dem Schreiben, Sitzung weg, 422, 507) und verlorenen Live-Meldungen
  durch – alle der Länge 3, dazu 4000 zufällige der Länge 8, jeder Takt mit Autosave – und
  prüft nach jedem Schritt beides; verlorene Stände müssen bis zum Ende im Ring liegen.
- **Abmelden:** sendet vorher den letzten Stand. Klappt das nicht (offline), weist der
  Konto-Abschnitt darauf hin; ein zweiter Tipp („Trotzdem abmelden“) meldet trotzdem ab – der
  Stand bleibt auf dem Gerät.
- **Offline:** Das Spiel läuft lokal weiter; der Abgleich versucht es mit wachsenden Pausen
  (2 s bis 5 min) erneut. Netzfehler ändern den lokalen Stand nie.

Die Entscheidungslogik steht rein und getestet in `src/sync/policy.ts` und
`src/sync/engine.ts` (`tests/sync-engine.test.ts`), der Server in `server/`
(`server/tests/`). Die e2e-Tests (`e2e/account.spec.ts`) spielen mit zwei Browsern gegen
einen lokalen Sync-Server.

## API (Kurzfassung)

| Methode | Pfad | Inhalt |
|---|---|---|
| POST | `/api/register` | `{username, password}` → 201 `{token, username}` · 409 Name vergeben · 403 `registration-closed` · 507 |
| POST | `/api/login` | `{username, password}` → 200 `{token, username}` · 401 |
| POST | `/api/logout` | (Bearer) → 204 |
| GET | `/api/me` | (Bearer) → `{username}` |
| GET | `/api/save` | (Bearer) → `{data, version, actionVersion, updatedAt, deviceId, schema, serverTime}` · 204 ohne Stand |
| PUT | `/api/save` | `{data, baseVersion, deviceId, action, schema}` → 200 · 409 `{current}` · 413 (Code > 200 000 Zeichen bzw. Anfrage > 256 KB) · 422 `outdated-client` (schema kleiner als gespeichert) · 507 Datenträger fast voll |
| POST | `/api/events/ticket` | (Bearer) → `{ticket}` (60 s gültig, einmalig; höchstens 4 offene je Sitzung) |
| GET | `/api/events?ticket=…` | Server-Sent Events `ready`, `save` · 429 bei zu vielen offenen Streams |
| GET | `/api/health` | `{ok: true}` |

`EventSource` kann keine Header senden. Statt des langlebigen Tokens steht deshalb nur ein
**einmaliges Ticket** (60 s) in der URL – ein Eintrag im Zugriffs-Log des Proxys ist damit
wertlos. Abmelden löscht die offenen Tickets der Sitzung. Regeln: Benutzername 3–32 Zeichen
`a–z 0–9 _ - .` (Groß-/Kleinschreibung egal), Passwort mindestens 8 Zeichen.

**Grenzen gegen Missbrauch** (jede 429-Antwort trägt `Retry-After`):

| Was | Grenze |
|---|---|
| Anmelden und Registrieren je IP | 20 Versuche in 15 Minuten |
| Fehlgeschlagene Anmeldungen je Benutzername **und IP** | 10 in 15 Minuten (diese IP ist dann für dieses Konto gesperrt; Erfolg setzt zurück) |
| Fehlgeschlagene Anmeldungen je Benutzername über alle IPs | 100 in 15 Minuten (gegen verteiltes Raten; eine einzelne fremde IP kann ein Konto so nicht aussperren) |
| Neue Konten je IP | 3 je Stunde (`REGISTRATIONS_PER_IP_HOUR`) – eine IP allein kann das Gesamtkontingent nicht aufbrauchen |
| Neue Konten insgesamt | 30 je Stunde |
| Sitzungen (angemeldete Geräte) je Konto | 20 – bei der 21. Anmeldung endet die am längsten unbenutzte (Nutzung verlängert die Laufzeit höchstens einmal am Tag) |
| Konten insgesamt | `MAX_ACCOUNTS` (Standard 1000) → 403 `registration-closed` |
| Freier Platz auf dem Daten-Volume | unter `MIN_FREE_MB` (Standard 512) → 507 für Registrieren, Anmelden und Schreiben (Lesen geht) |
| Offene Event-Streams | 8 je Konto, 16 je IP, 2000 insgesamt |
| Offene Tickets | 4 je Sitzung (das älteste verfällt), 10 000 insgesamt |
| Anfrage empfangen | Kopf 20 s, ganze Anfrage 30 s (gilt nicht für die offene Antwort eines Event-Streams) |

Die IP für diese Grenzen ist die Adresse der Verbindung. Nur wenn sie privat ist (der Proxy im
Docker-Netz oder auf demselben Server) **und** `TRUST_PROXY=1` gesetzt ist, zählt der letzte
Eintrag von `X-Forwarded-For` – den hat der eigene Proxy angehängt; frühere Einträge kann der
Client frei erfinden. IPv6-Adressen zählen je /64-Netz (ein Anschluss hat meist ein ganzes /64);
IPv4-gemappte Adressen (`::ffff:a01:203`) zählen als IPv4.

**Abwägung bei der Sperre je Benutzername:** Die Grenze über alle IPs (100 Fehlversuche in
15 Minuten) bremst verteiltes Passwort-Raten. Wer genug IP-Adressen hat (mindestens fünf, weil
jede IP höchstens 20 Versuche hat), kann damit ein Konto aber gezielt bis zu 15 Minuten lang
für alle sperren – auch für den Inhaber mit richtigem Passwort; Geräte, die schon angemeldet
sind, spielen weiter. Bewusst so gewählt: Eine einzelne fremde IP sperrt nur sich selbst, und
die Schwelle ist hoch genug, dass versehentliche Fehleingaben sie nie erreichen. Ein starkes
Passwort bleibt der eigentliche Schutz.

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
docker compose version                     # prüfen: mindestens 2.24
```

Nötig ist **Docker Compose 2.24 oder neuer** (`docker-compose.proxy-net.yml` nutzt `!reset`);
`setup.sh` prüft das und bricht sonst mit einem Hinweis ab. Ältere Versionen über die
Paketquelle von Docker aktualisieren (`sudo apt-get install --only-upgrade docker-compose-plugin`).

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
3. legt `deploy/.env` an (Vorlage `deploy/.env.example`) – eine vorhandene `deploy/.env` bleibt unverändert (die erkannten Werte gelten dann nur für
   diesen Lauf);
4. startet die `vszw-`Container:
   - **Ports 80/443 frei:** Betriebsart A (eigener Caddy);
   - **80/443 gehören einem Container** (z. B. dem Caddy einer anderen App – ein Container mit
     veröffentlichtem `:443` zählt immer als „belegt“): Betriebsart B. `setup.sh` legt das
     eigene Docker-Netzwerk **`vszw-proxy`** an (falls es fehlt), `vszw-sync` tritt nur diesem
     bei (Alias `vszw-sync`, kein Host-Port). Der Proxy-Container tritt `vszw-proxy` danach
     bei – `vszw-sync` kommt nie in das interne Netzwerk der anderen App (dort wäre z. B. deren
     Datenbank erreichbar);
   - **80/443 gehören einem Proxy direkt auf dem Server:** Betriebsart B, nur
     `127.0.0.1:8787`;
5. gibt aus, was im vorhandenen Proxy zu ergänzen ist (bei Caddy im Container: Beitritt zu
   `vszw-proxy`, den fertigen Block und die Befehle zum sicheren Einspielen samt Rückweg) – **fremde Dateien ändert es
   nie** – und nennt am Ende die URL für `VITE_SYNC_URL`.

Erzwingen bzw. vorgeben: `MODE=B`, `PROXY_NETWORK=<netz>` (Standard `vszw-proxy`; ein
anderes nur bewusst), `SYNC_PORT=8790`, `SYNC_PUBLIC_HOST=…` (jeweils vor `./setup.sh`).
Nennt eine ältere `deploy/.env` noch ein fremdes Netzwerk (z. B. `haushalt-prod-intern`),
bricht `setup.sh` mit einem Hinweis ab – dann die Zeile auf `PROXY_NETWORK=vszw-proxy`
ändern. Spätere Updates: den Befehl verwenden, den `setup.sh` am Ende nennt.

Alle Container, Volumes und Netzwerke heißen `vszw-…` (`vszw-sync`, `vszw-caddy`,
`vszw-data`, `vszw-net`, `vszw-proxy`), laufen mit `restart: unless-stopped` und Limits
(Sync-Server 256 MB / 0,5 CPU, Caddy 128 MB). Nur Betriebsart A bindet an alle Adressen
(Port 80/443); sonst ist der Sync-Server höchstens unter `127.0.0.1` erreichbar.

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
`haushalt-prod-caddy-1` aus dem Compose-Projekt `haushalt-prod` belegt 80/443).

`vszw-sync` und der Caddy treffen sich im **eigenen** Netzwerk `vszw-proxy` – nie im internen
Netzwerk der anderen App (`haushalt-prod-intern`), denn dort wären deren Datenbank und andere
Dienste für `vszw-sync` erreichbar. Reihenfolge:

1. **Zuerst `setup.sh`** (dieses Repository): legt `vszw-proxy` an, falls es fehlt
   (`docker network create vszw-proxy`), und startet `vszw-sync` in diesem Netzwerk
   (Alias `vszw-sync`, kein Host-Port). Von Hand dasselbe:

   ```bash
   docker network inspect vszw-proxy >/dev/null 2>&1 || docker network create vszw-proxy
   docker compose -f docker-compose.yml -f docker-compose.proxy-net.yml up -d --build
   ```

2. **Dann das Deployment der anderen App:** Ihr Caddy tritt `vszw-proxy` bei (im Compose der
   haushalt-app, eigener PR dort):

   ```yaml
   services:
     caddy:
       networks:
         - default          # bzw. die bisherigen Netzwerke
         - vszw-proxy
   networks:
     vszw-proxy:
       external: true
   ```

   und ihre Caddyfile leitet den Namen an `vszw-sync:8787` weiter (`flush_interval -1` reicht
   Server-Sent Events sofort durch):

   ```caddyfile
   62-83-23-90.sslip.io {
   	reverse_proxy vszw-sync:8787 {
   		flush_interval -1
   	}
   }
   ```

   Weil `vszw-proxy` als `external` eingebunden ist, muss es vor diesem Deployment existieren –
   deshalb kommt `setup.sh` zuerst.

Übergangsweise (bis das Deployment der anderen App das erledigt) lässt sich der laufende Caddy
von Hand anschließen – das geht verloren, sobald sein Container neu erstellt wird:

```bash
docker network connect vszw-proxy haushalt-prod-caddy-1
```

Den Caddy-Block übergangsweise sicher einspielen – Pfad der Caddyfile auf dem Host steht in
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
sähe der Container nicht. Gehört die Caddyfile zum Repository der anderen App, geht der
angehängte Block beim nächsten Deployment dieser App verloren – dauerhaft gehört er (wie der
Netzwerk-Beitritt) in deren Repository.

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

**nginx oder Traefik im Docker-Container:** wie beim Caddy-Container über das Netzwerk
`vszw-proxy` (bzw. die Traefik-Datei nutzen) und als Ziel `http://vszw-sync:8787` statt
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
behält rotierend die neuesten 7 (`BACKUP_KEEP`). Ist der Datenträger fast voll
(`MIN_FREE_MB`), fällt die Sicherung aus (Hinweis in `docker logs vszw-sync`).

Im Image gibt es kein `sqlite3`; für Verwaltung und Sicherungen liegt ein kleines Werkzeug bei
(`dist/admin-cli.js`):

```bash
# Sofort sichern (zusätzlich zur täglichen Sicherung)
docker exec vszw-sync node --disable-warning=ExperimentalWarning dist/admin-cli.js backup
# Sicherungen auf den Rechner holen
docker cp vszw-sync:/data/backups ./vszw-backups
# Konten ansehen (Name, angelegt, Größe des Spielstands)
docker exec vszw-sync node --disable-warning=ExperimentalWarning dist/admin-cli.js users
```

Eine Sicherung lässt sich auf dem Rechner mit jedem SQLite-Werkzeug öffnen (z. B.
`sqlite3 vszw-backups/saves-2026-10-21.db '.tables'`).

Wiederherstellen: Container stoppen, Sicherung als `/data/saves.db` zurückkopieren
(dabei `saves.db-wal` und `saves.db-shm` löschen), Container starten – z. B.:

```bash
docker compose stop sync
docker run --rm -v vszw-data:/data -v "$PWD/vszw-backups:/restore:ro" alpine \
  sh -c 'cp /restore/saves-2026-10-21.db /data/saves.db && rm -f /data/saves.db-wal /data/saves.db-shm && chown 1000:1000 /data/saves.db'
docker compose start sync
```

**Wichtig: Kopien außerhalb des Servers.** Die täglichen Sicherungen liegen im selben Volume
auf demselben Datenträger wie die Datenbank – gegen einen defekten oder gelöschten Server,
ein versehentlich gelöschtes Volume (`docker volume rm`, `docker compose down -v`) oder einen
Fehler beim Anbieter helfen sie nicht. Deshalb regelmäßig (z. B. täglich per Cron) auf einen
anderen Rechner kopieren, etwa vom eigenen Rechner aus:

```bash
mkdir -p ~/vszw-backups && ssh deploy@<server> 'docker cp vszw-sync:/data/backups -' | tar -x -C ~/vszw-backups
```

und gelegentlich prüfen, dass sich eine Kopie öffnen lässt (siehe oben).

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
- Rate-Limits gegen Passwort-Raten und massenhaftes Anlegen (Tabelle „Grenzen gegen
  Missbrauch“). Hinter dem Proxy zählt der letzte Eintrag von `X-Forwarded-For`, aber nur,
  wenn die Verbindung von einer privaten Adresse kommt.
- Passwörter: scrypt mit N = 2^15 (die Parameter stehen im Hash; höchstens zwei Rechnungen
  gleichzeitig, damit 256 MB Speicher reichen).
- Das Token liegt im `localStorage` des Browsers. Auf fremden Geräten nach dem Spielen
  „Abmelden“.
- Der Container läuft ohne Root, mit schreibgeschütztem Dateisystem (außer `/data` und
  `/tmp`), ohne Linux-Capabilities (`cap_drop: ALL`), `no-new-privileges`, Speicher-/CPU-
  Limits und fest gewählter Basis-Version (`node:22.22.3-alpine3.24`). Der Sync-Port ist nur
  lokal gebunden; im Docker-Betrieb hinter einem fremden Proxy teilt er nur das eigene Netz
  `vszw-proxy` mit diesem.
- Ein Fehler in einer Anfrage (auch eine kaputte Anfrage-Zeile wie `GET //a:99999/`) wird
  beantwortet und geloggt, beendet aber nie den Prozess.
- Es gibt kein „Passwort vergessen“ (keine E-Mail). Notfalls auf dem Server das Konto
  löschen und neu anlegen; der Spielstand lässt sich vorher über den Export des Spiels
  sichern:

  ```bash
  docker exec vszw-sync node --disable-warning=ExperimentalWarning dist/admin-cli.js delete-user <name>
  ```
