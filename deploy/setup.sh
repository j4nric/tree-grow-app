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
#   5. nennt die URL für die Repository-Variable VITE_SYNC_URL.
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

# Werte aus der Umgebung haben Vorrang vor einer vorhandenen deploy/.env.
ENV_SYNC_PUBLIC_HOST="${SYNC_PUBLIC_HOST:-}"
ENV_PROXY_NETWORK="${PROXY_NETWORK:-}"
ENV_SYNC_PORT="${SYNC_PORT:-}"
DEFAULT_PROXY_NETWORK=vszw-proxy
ENV_EXISTS=0
[[ -f .env ]] && ENV_EXISTS=1
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
  SYNC_PUBLIC_HOST="${IP//./-}.sslip.io"
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
if [[ "$MODE" == A ]]; then
  COMPOSE+=(--profile caddy)
elif [[ -n "$PROXY_NETWORK" ]]; then
  COMPOSE+=(-f docker-compose.yml -f docker-compose.proxy-net.yml)
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
  cat > .env <<ENVFILE
SYNC_PUBLIC_HOST=${SYNC_PUBLIC_HOST}
ALLOWED_ORIGIN=${ALLOWED_ORIGIN}
SYNC_PORT=${SYNC_PORT}
BACKUP_KEEP=${BACKUP_KEEP}
PROXY_NETWORK=${PROXY_NETWORK}
ENVFILE
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

# --- Was im vorhandenen Proxy zu tun ist ---------------------------------------------
if [[ "$MODE" == B ]]; then
  say ""
  say "================================================================================"
  if [[ -n "$PROXY_CONTAINER" && "$PROXY_IMAGE" == *caddy* ]]; then
    CADDYFILE="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$PROXY_CONTAINER" || true)"
    if [[ -z "$CADDYFILE" ]]; then
      dir="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$PROXY_CONTAINER" || true)"
      [[ -n "$dir" ]] && CADDYFILE="${dir}/Caddyfile"
    fi
    say "Vorhandener Caddy im Container „${PROXY_CONTAINER}“. Noch zu tun (nichts davon automatisch):"
    say ""
    say "1) Der Caddy-Container tritt dem Netzwerk ${PROXY_NETWORK} bei – dauerhaft im Compose der"
    say "   anderen App (networks: ${PROXY_NETWORK}: external: true), dann deren Deployment."
    say "   Übergangsweise von Hand (geht beim Neuerstellen des Containers verloren):"
    say "     docker network connect ${PROXY_NETWORK} ${PROXY_CONTAINER}"
    say ""
    say "2) Dieser Block in seine Caddyfile:"
    say ""
    say "${SYNC_PUBLIC_HOST} {"
    say "	reverse_proxy vszw-sync:8787 {"
    say "		flush_interval -1"
    say "	}"
    say "}"
    say ""
    say "So spielst du ihn sicher ein (Caddyfile auf dem Host: ${CADDYFILE:-<Pfad unbekannt – docker inspect ${PROXY_CONTAINER}>}):"
    say ""
    say "  CADDYFILE='${CADDYFILE:-/pfad/zur/Caddyfile}'"
    say "  BACKUP=\"\$CADDYFILE.bak-\$(date +%Y%m%d-%H%M%S)\""
    say "  sudo cp \"\$CADDYFILE\" \"\$BACKUP\""
    say "  printf '\\n%s {\\n\\treverse_proxy vszw-sync:8787 {\\n\\t\\tflush_interval -1\\n\\t}\\n}\\n' '${SYNC_PUBLIC_HOST}' | sudo tee -a \"\$CADDYFILE\" >/dev/null"
    say "  docker exec ${PROXY_CONTAINER} caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile"
    say "  docker exec ${PROXY_CONTAINER} caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile"
    say ""
    say "Rückgängig (falls validate oder reload scheitert):"
    say "  sudo cp \"\$BACKUP\" \"\$CADDYFILE\""
    say "  docker exec ${PROXY_CONTAINER} caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile"
    say ""
    say "(cp und tee -a behalten die Datei bei – wichtig, wenn sie einzeln in den Container"
    say " eingebunden ist. Nicht mit sed -i oder einem Editor bearbeiten, der sie ersetzt.)"
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
say "Spätere Updates mit demselben Befehl:  ${COMPOSE[*]} up -d --build"
say ""
say "Als Repository-Variable VITE_SYNC_URL eintragen (GitHub → Settings → Secrets and"
say "variables → Actions → Variables), danach den Pages-Workflow neu starten:"
say ""
say "  VITE_SYNC_URL=https://${SYNC_PUBLIC_HOST}"
say ""
say "Test (nach dem Proxy-Eintrag bzw. dem Zertifikat): curl https://${SYNC_PUBLIC_HOST}/api/health"
