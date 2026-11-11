#!/usr/bin/env bash
# Richtet den Sync-Server für „Vom Samen zum Wald“ auf dem vServer ein – ohne bestehende
# Apps oder fremde Dateien anzufassen. Ablauf:
#   1. prüft Docker, Ports 80/443 (ss -tlnp), laufende Container (docker ps) und den Sync-Port
#   2. ermittelt die öffentliche IPv4 und den sslip.io-Namen (oder nimmt SYNC_PUBLIC_HOST)
#   3. wählt die Betriebsart:
#      A   Ports 80/443 frei                 → eigener Caddy (HTTPS automatisch)
#      B   80/443 gehören einem Container    → eigenes Netzwerk vszw-proxy (legt es an), dem
#          (z. B. Caddy einer anderen App)     vszw-sync beitritt (Alias vszw-sync, kein Host-
#                                              Port); der Proxy-Container tritt ihm danach bei
#                                              (Deployment der anderen App) – nie umgekehrt
#      B   80/443 gehören einem Proxy direkt → vszw-sync nur auf 127.0.0.1:SYNC_PORT
#          auf dem Server (nginx, Caddy …)
#   4. legt deploy/.env an (eine vorhandene bleibt unverändert), startet die vszw-Container und gibt aus,
#      was im vorhandenen Proxy zu ergänzen ist – fremde Konfigurationen ändert es nie.
#      Betriebsart B mit Proxy-Container: vszw-sync hängt zusätzlich im gemeinsamen Netzwerk
#      `edge`, und unser Eintrag deploy/site.caddy kommt als vszw.caddy ins gemeinsame Volume
#      `caddy-sites`, das der vordere Caddy (Label edge.caddy=true) importiert. Der vordere
#      Caddy prüft die ganze Konfiguration und lädt neu; lehnt er ab, kommt der vorige Eintrag
#      zurück und setup.sh bricht ab (Muster aus skat-roguelite ADR 0024).
#   5. nennt die URL für die Repository-Variable VITE_SYNC_URL.
#   6. erzeugt ein ADMIN_BACKUP_TOKEN für die Sicherung außerhalb des Servers, falls es in
#      deploy/.env fehlt (neue .env: dort eingetragen; vorhandene .env: nur Anleitung zum
#      Ergänzen) und nennt es für das Repository-Secret SYNC_BACKUP_TOKEN.
#
# Aufruf (im Ordner deploy/):   ./setup.sh
# Optional: SYNC_PUBLIC_HOST=name.duckdns.org ./setup.sh · MODE=A|B · PROXY_NETWORK=<netz> · SYNC_PORT=8790
#
# Sicherheit: vszw-sync tritt NIE dem internen Netzwerk einer anderen App bei (dort wäre z. B.
# deren Datenbank erreichbar) – nur dem eigenen Netzwerk vszw-proxy, in das der Proxy kommt.
set -euo pipefail

cd "$(dirname "$0")"

say() { printf '%s\n' "$*"; }
fail() { printf 'Fehler: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "Docker ist nicht installiert (siehe docs/KONTO.md)."
docker compose version >/dev/null 2>&1 || fail "„docker compose“ fehlt (Docker-Compose-Plugin installieren)."
# docker-compose.proxy-net.yml nutzt `!reset` – das kennt Docker Compose erst ab 2.24.
COMPOSE_VERSION="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
if [[ "$COMPOSE_VERSION" =~ ^([0-9]+)\.([0-9]+) ]]; then
  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  if (( major < 2 || (major == 2 && minor < 24) )); then
    fail "Docker Compose ${COMPOSE_VERSION} ist zu alt – nötig ist mindestens 2.24 (für „!reset“). Docker aktualisieren (siehe docs/KONTO.md)."
  fi
else
  say "Hinweis: Version von Docker Compose nicht erkannt („${COMPOSE_VERSION}“) – nötig ist mindestens 2.24."
fi

# Werte aus der Umgebung haben Vorrang vor einer vorhandenen deploy/.env.
ENV_SYNC_PUBLIC_HOST="${SYNC_PUBLIC_HOST:-}"
ENV_PROXY_NETWORK="${PROXY_NETWORK:-}"
ENV_SYNC_PORT="${SYNC_PORT:-}"
DEFAULT_PROXY_NETWORK=vszw-proxy
ENV_EXISTS=0
[[ -f .env ]] && ENV_EXISTS=1
# Admin-Token für die Sicherung außerhalb des Servers: steht es schon (mit Wert) in .env?
ADMIN_TOKEN_STATE='missing'
if [[ "$ENV_EXISTS" == 1 ]]; then
  if grep -Eq '^[[:space:]]*ADMIN_BACKUP_TOKEN=[^[:space:]]' .env; then
    ADMIN_TOKEN_STATE='set'
  elif grep -Eq '^[[:space:]]*ADMIN_BACKUP_TOKEN=' .env; then
    ADMIN_TOKEN_STATE='empty'
  fi
fi
new_token() {
  if command -v openssl >/dev/null; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}
NEW_ADMIN_TOKEN=""
# Eine vorhandene .env enthält Geheimnisse (ADMIN_BACKUP_TOKEN) – nur der Besitzer darf lesen.
if [[ "$ENV_EXISTS" == 1 ]]; then
  ENV_PERMS="$(stat -c %a .env 2>/dev/null || stat -f %Lp .env 2>/dev/null || true)"
  if [[ "$ENV_PERMS" =~ ^[0-7]+$ && "${ENV_PERMS: -2}" != "00" ]]; then
    say "Warnung: deploy/.env ist für andere lesbar (Rechte ${ENV_PERMS}). Bitte einschränken:  chmod 600 .env"
  fi
fi
[[ "$ADMIN_TOKEN_STATE" != set ]] && NEW_ADMIN_TOKEN="$(new_token)"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
SYNC_PUBLIC_HOST="${ENV_SYNC_PUBLIC_HOST:-${SYNC_PUBLIC_HOST:-}}"
PROXY_NETWORK="${ENV_PROXY_NETWORK:-${PROXY_NETWORK:-}}"
SYNC_PORT="${ENV_SYNC_PORT:-${SYNC_PORT:-8787}}"
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-https://j4nric.github.io}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"

# --- Hostname ------------------------------------------------------------------------
if [[ -z "$SYNC_PUBLIC_HOST" ]]; then
  command -v curl >/dev/null || fail "curl fehlt – oder SYNC_PUBLIC_HOST selbst setzen."
  IP="$(curl -4 -s --max-time 10 ifconfig.me || true)"
  [[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Öffentliche IPv4 nicht ermittelbar – SYNC_PUBLIC_HOST selbst setzen."
  # Eigene Subdomain: Die IP-Adresse selbst (62-83-23-90.sslip.io) nutzt oft schon eine andere
  # App auf dem Server; ein zweiter Caddy-Block mit demselben Namen ließe Caddy nicht starten.
  SYNC_PUBLIC_HOST="sync.${IP//./-}.sslip.io"
fi
say "Hostname der API: ${SYNC_PUBLIC_HOST}"

# --- Bestand prüfen (nur lesen) --------------------------------------------------------
port_busy() {
  if command -v ss >/dev/null; then
    ss -tlnH "( sport = :$1 )" 2>/dev/null | grep -q .
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  fi
}

say ""
say "Laufende Container (zur Info):"
docker ps --format '  {{.Names}}  ({{.Image}})  {{.Ports}}' || true

running() { docker ps --format '{{.Names}}' | grep -qx "$1"; }

# Container, der Port 443 veröffentlicht (ein Reverse-Proxy einer anderen App)?
PROXY_CONTAINER=""
PROXY_IMAGE=""
while IFS=$'\t' read -r name image ports; do
  [[ "$name" == vszw-* ]] && continue
  if [[ "$ports" == *":443->"* ]]; then
    PROXY_CONTAINER="$name"
    PROXY_IMAGE="$image"
    break
  fi
done < <(docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}')

PORTS_FREE=1
# Ein Container mit veröffentlichtem :443 belegt die Ports, auch wenn ss ihn nicht zeigt
# (z. B. ohne docker-proxy).
if [[ -n "$PROXY_CONTAINER" ]]; then
  PORTS_FREE=0
  say ""
  say "Port 443 gehört dem Container „${PROXY_CONTAINER}“ (${PROXY_IMAGE})."
fi
if ! running vszw-caddy; then
  for p in 80 443; do
    if port_busy "$p"; then
      PORTS_FREE=0
      say ""
      say "Port ${p} ist belegt:"
      ss -tlnp "( sport = :$p )" 2>/dev/null | sed 's/^/  /' || true
    fi
  done
fi

MODE="${MODE:-}"
if [[ -z "$MODE" ]]; then
  if [[ "$PORTS_FREE" == 1 ]]; then MODE=A; else MODE=B; fi
fi
if [[ "$MODE" == A && "$PORTS_FREE" == 0 ]]; then
  fail "Betriebsart A braucht freie Ports 80 und 443 – nimm Betriebsart B (MODE=B)."
fi

# Betriebsart B mit Proxy-Container: eigenes Netzwerk vszw-proxy (nie das Netzwerk der anderen App).
if [[ "$MODE" == B && -z "$PROXY_NETWORK" && -n "$PROXY_CONTAINER" ]]; then
  PROXY_NETWORK="$DEFAULT_PROXY_NETWORK"
fi
if [[ -n "$PROXY_NETWORK" && "$PROXY_NETWORK" != "$DEFAULT_PROXY_NETWORK" && -z "$ENV_PROXY_NETWORK" ]]; then
  # Stammt z. B. aus einer älteren deploy/.env (früher: Netzwerk des fremden Caddy).
  fail "deploy/.env nennt PROXY_NETWORK=${PROXY_NETWORK}. Empfohlen ist das eigene Netzwerk ${DEFAULT_PROXY_NETWORK}
  (ein fremdes internes Netzwerk machte z. B. dessen Datenbank erreichbar). Die Zeile in deploy/.env auf
  PROXY_NETWORK=${DEFAULT_PROXY_NETWORK} ändern – oder bewusst: PROXY_NETWORK=${PROXY_NETWORK} ./setup.sh"
fi
if [[ -n "$PROXY_NETWORK" ]] && ! docker network inspect "$PROXY_NETWORK" >/dev/null 2>&1; then
  if [[ "$PROXY_NETWORK" == "$DEFAULT_PROXY_NETWORK" ]]; then
    say ""
    say "Lege das Docker-Netzwerk ${PROXY_NETWORK} an (nur für Proxy ↔ vszw-sync)."
    docker network create "$PROXY_NETWORK" >/dev/null
  else
    fail "Docker-Netzwerk „${PROXY_NETWORK}“ gibt es nicht (docker network ls)."
  fi
fi

COMPOSE=(docker compose)
# EDGE=1: Eintrag im vorderen Caddy über Netzwerk `edge` und Volume `caddy-sites`.
EDGE=0
if [[ "$MODE" == A ]]; then
  COMPOSE+=(--profile caddy)
elif [[ -n "$PROXY_NETWORK" ]]; then
  COMPOSE+=(-f docker-compose.yml -f docker-compose.proxy-net.yml)
  EDGE=1
  # Gemeinsames Netzwerk aller Apps mit dem vorderen Caddy (docker-compose.proxy-net.yml
  # bindet es als external ein, also muss es vor dem Start existieren).
  if ! docker network inspect edge >/dev/null 2>&1; then
    say ""
    say "Lege das gemeinsame Docker-Netzwerk edge an (vorderer Caddy ↔ Apps)."
    docker network create edge >/dev/null
  fi
else
  if ! running vszw-sync && port_busy "$SYNC_PORT"; then
    fail "Port ${SYNC_PORT} ist schon belegt. Anderen Port wählen: SYNC_PORT=8790 ./setup.sh"
  fi
fi

# --- deploy/.env (eine vorhandene wird nie überschrieben) ------------------------------
if [[ "$ENV_EXISTS" == 1 ]]; then
  say ""
  say "deploy/.env gibt es schon – sie bleibt unverändert. Für diesen Lauf gelten:"
  say "  SYNC_PUBLIC_HOST=${SYNC_PUBLIC_HOST}  SYNC_PORT=${SYNC_PORT}  PROXY_NETWORK=${PROXY_NETWORK:-<leer>}"
  # Für docker compose in diesem Lauf (Werte aus der Umgebung haben Vorrang vor .env).
  export SYNC_PUBLIC_HOST SYNC_PORT PROXY_NETWORK
else
  # Nur für den Besitzer lesbar: enthält das Admin-Token.
  (
    umask 077
    cat > .env <<ENVFILE
SYNC_PUBLIC_HOST=${SYNC_PUBLIC_HOST}
ALLOWED_ORIGIN=${ALLOWED_ORIGIN}
SYNC_PORT=${SYNC_PORT}
BACKUP_KEEP=${BACKUP_KEEP}
PROXY_NETWORK=${PROXY_NETWORK}
ADMIN_BACKUP_TOKEN=${NEW_ADMIN_TOKEN}
ENVFILE
  )
  say ""
  say "deploy/.env geschrieben."
fi

# --- Starten -------------------------------------------------------------------------
say ""
if [[ "$MODE" == A ]]; then
  say "Betriebsart A: eigener Caddy auf Port 80/443 (HTTPS automatisch)."
elif [[ -n "$PROXY_NETWORK" ]]; then
  say "Betriebsart B: vszw-sync im eigenen Netzwerk „${PROXY_NETWORK}“ (Alias vszw-sync, kein Host-Port)."
else
  say "Betriebsart B: vszw-sync nur auf 127.0.0.1:${SYNC_PORT}."
fi
"${COMPOSE[@]}" up -d --build

say ""
say "Warte auf den Sync-Server …"
ok=0
for _ in $(seq 1 30); do
  if docker exec vszw-sync node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
    ok=1
    break
  fi
  sleep 1
done
if [[ "$ok" == 1 ]]; then say "Sync-Server läuft."; else say "Sync-Server antwortet noch nicht – siehe: docker logs vszw-sync"; fi

# --- Eintrag im vorderen Caddy (deploy/site.caddy → Volume caddy-sites/vszw.caddy) ----
# Erst einzeln prüfen, den vorigen Eintrag als .prev behalten (endet nicht auf .caddy, wird
# also nicht importiert), dann den vorderen Caddy die ganze Konfiguration prüfen und neu laden
# lassen. Lehnt er ab, kommt der vorige Eintrag zurück und setup.sh bricht ab; der vordere
# Caddy läuft mit seinem alten Stand weiter.
SITE_IMAGE=caddy:2.11.7-alpine
SITE_NAME=vszw.caddy
SITE_RENDERED=""
EDGE_STATE=""
install_site() {
  [[ "$SYNC_PUBLIC_HOST" =~ ^[A-Za-z0-9.-]+$ ]] \
    || fail "SYNC_PUBLIC_HOST „${SYNC_PUBLIC_HOST}“ ist kein gültiger Hostname."
  # Im Ordner deploy/ statt /tmp: ein Docker aus Snap sähe /tmp des Hosts nicht.
  SITE_RENDERED="$(mktemp "$PWD/.site-XXXXXX.caddy")"
  trap 'rm -f "${SITE_RENDERED:-}"' EXIT
  # Der vordere Caddy kennt SYNC_PUBLIC_HOST nicht – den Namen fest einsetzen.
  sed "s/{\$SYNC_PUBLIC_HOST}/${SYNC_PUBLIC_HOST}/g" site.caddy > "$SITE_RENDERED"
  chmod 644 "$SITE_RENDERED"
  grep -q '{\$' "$SITE_RENDERED" \
    && fail "deploy/site.caddy enthält noch einen Platzhalter, den setup.sh nicht ersetzt."

  docker volume inspect caddy-sites >/dev/null 2>&1 || docker volume create caddy-sites >/dev/null
  docker run --rm -v caddy-sites:/sites -v "$SITE_RENDERED:/new.caddy:ro" "$SITE_IMAGE" sh -euc "
    caddy validate --config /new.caddy --adapter caddyfile >/dev/null 2>&1 || { caddy validate --config /new.caddy --adapter caddyfile; exit 1; }
    if [ -f /sites/$SITE_NAME ]; then cp /sites/$SITE_NAME /sites/$SITE_NAME.prev; else rm -f /sites/$SITE_NAME.prev; fi
    cp /new.caddy /sites/$SITE_NAME
  " || fail "deploy/site.caddy ist ungültig (siehe oben) – nichts eingespielt."
  rm -f "$SITE_RENDERED"

  local front
  front="$(docker ps -q --filter label=edge.caddy=true | head -n 1)"
  if [[ -z "$front" ]]; then
    EDGE_STATE=stored
    say ""
    say "Warnung: Noch kein vorderer Caddy mit Label edge.caddy=true. Der Eintrag liegt als"
    say "${SITE_NAME} im Volume caddy-sites und gilt, sobald dieser Caddy startet."
  elif docker exec "$front" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    docker exec "$front" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
    EDGE_STATE=loaded
    say ""
    say "Vorderer Caddy: Eintrag ${SITE_NAME} geladen."
  else
    docker exec "$front" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || true
    docker run --rm -v caddy-sites:/sites "$SITE_IMAGE" sh -euc "
      if [ -f /sites/$SITE_NAME.prev ]; then mv /sites/$SITE_NAME.prev /sites/$SITE_NAME; else rm -f /sites/$SITE_NAME; fi
    "
    fail "Der vordere Caddy lehnt deploy/site.caddy ab (siehe oben, z. B. ${SYNC_PUBLIC_HOST} doppelt);
  der vorige Eintrag ist wieder da, der vordere Caddy läuft unverändert weiter."
  fi
}
if [[ "$EDGE" == 1 ]]; then
  install_site
fi

# --- Was im vorhandenen Proxy zu tun ist ---------------------------------------------
if [[ "$MODE" == B ]]; then
  say ""
  say "================================================================================"
  if [[ "$EDGE" == 1 && -n "$PROXY_CONTAINER" && "$PROXY_IMAGE" == *caddy* ]]; then
    say "Vorhandener Caddy im Container „${PROXY_CONTAINER}“."
    say ""
    if [[ "$EDGE_STATE" == loaded ]]; then
      say "Unser Eintrag (deploy/site.caddy, ${SYNC_PUBLIC_HOST} → vszw-sync:8787) ist als"
      say "${SITE_NAME} im Volume caddy-sites und im vorderen Caddy geladen. Nichts weiter zu tun."
    else
      say "Unser Eintrag (deploy/site.caddy, ${SYNC_PUBLIC_HOST} → vszw-sync:8787) liegt als"
      say "${SITE_NAME} im Volume caddy-sites. Der vordere Caddy trägt noch nicht das Label"
      say "edge.caddy=true; das bringt das Deployment der Haushalt-App (Import von"
      say "/etc/caddy/sites/*.caddy, Netzwerk edge). Bis dahin leitet ihr alter Block in ihrer"
      say "Caddyfile weiter über das Netzwerk ${PROXY_NETWORK}."
    fi
    say ""
    say "vszw-sync hängt in ${PROXY_NETWORK} und in edge (Alias vszw-sync in beiden)."
  else
    say "Noch zu tun: im vorhandenen Reverse-Proxy einen Eintrag ergänzen, der"
    if [[ -n "$PROXY_NETWORK" ]]; then
      say "  https://${SYNC_PUBLIC_HOST}  →  http://vszw-sync:8787   (der Proxy-Container muss dafür dem"
      say "  Netzwerk ${PROXY_NETWORK} beitreten: docker network connect ${PROXY_NETWORK} <proxy-container>)"
    else
      say "  https://${SYNC_PUBLIC_HOST}  →  http://127.0.0.1:${SYNC_PORT}"
    fi
    say "weiterleitet (SSE ohne Pufferung). Fertige Blöcke für nginx, Traefik und Caddy:"
    say "  docs/KONTO.md, Abschnitt „Betriebsart B: vorhandener Reverse-Proxy“."
  fi
  say "================================================================================"
fi

say ""
if [[ "$EDGE" == 1 ]]; then
  say "Spätere Updates: erneut ./setup.sh (spielt auch den Eintrag im vorderen Caddy ein)."
  say "Nur die Container neu bauen:  ${COMPOSE[*]} up -d --build"
else
  say "Spätere Updates mit demselben Befehl:  ${COMPOSE[*]} up -d --build"
fi
say ""
say "Als Repository-Variable VITE_SYNC_URL eintragen (GitHub → Settings → Secrets and"
say "variables → Actions → Variables), danach den Pages-Workflow neu starten:"
say ""
say "  VITE_SYNC_URL=https://${SYNC_PUBLIC_HOST}"
say ""
say "Test (nach dem Proxy-Eintrag bzw. dem Zertifikat): curl https://${SYNC_PUBLIC_HOST}/api/health"

# --- Sicherung außerhalb des Servers (GitHub-Workflow „Sicherung“) -------------------
if [[ -n "$NEW_ADMIN_TOKEN" ]]; then
  say ""
  say "================================================================================"
  say "Sicherung außerhalb des Servers (Anleitung: docs/KONTO.md, Abschnitt „Sicherungen“)"
  say ""
  if [[ "$ENV_EXISTS" == 0 ]]; then
    say "Ein neues ADMIN_BACKUP_TOKEN steht in deploy/.env und ist schon aktiv."
  elif [[ "$ADMIN_TOKEN_STATE" == empty ]]; then
    say "In deploy/.env steht ADMIN_BACKUP_TOKEN ohne Wert. setup.sh ändert die Datei nie –"
    say "bitte die Zeile mit einem Editor so ergänzen:"
    say ""
    say "  ADMIN_BACKUP_TOKEN=${NEW_ADMIN_TOKEN}"
    say ""
    say "und danach die Rechte einschränken und den Container neu erstellen:"
    say "  chmod 600 .env"
    say "  ${COMPOSE[*]} up -d"
  else
    say "deploy/.env hat noch kein ADMIN_BACKUP_TOKEN. setup.sh ändert die Datei nie –"
    say "bitte selbst anhängen (im Ordner deploy/) und den Container neu erstellen:"
    say ""
    say "  printf '\\nADMIN_BACKUP_TOKEN=%s\\n' '${NEW_ADMIN_TOKEN}' >> .env"
    say "  chmod 600 .env"
    say "  ${COMPOSE[*]} up -d"
  fi
  say ""
  say "Denselben Wert als Repository-Secret SYNC_BACKUP_TOKEN eintragen (GitHub → Settings →"
  say "Secrets and variables → Actions → Secrets). Das Token ist geheim – nirgends sonst ablegen."
  say "================================================================================"
fi
