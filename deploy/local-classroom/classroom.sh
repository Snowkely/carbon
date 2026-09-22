#!/bin/bash
set -euo pipefail
ACTION="${1:-status}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/deploy/.env.classroom"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/docker-compose.classroom.yml")

private_ips() {
  for interface in en0 en1 en2; do ipconfig getifaddr "$interface" 2>/dev/null || true; done
  ifconfig 2>/dev/null | awk '/inet / {print $2}' | grep -Ev '^(127\.|169\.254\.)' || true
}
select_ip() {
  mapfile_compat=()
  while IFS= read -r ip; do [[ -n "$ip" ]] && mapfile_compat+=("$ip"); done < <(private_ips | sort -u)
  [[ ${#mapfile_compat[@]} -gt 0 ]] || { echo "No active LAN IPv4 address found. Connect to classroom Wi-Fi and retry." >&2; exit 1; }
  if [[ ${#mapfile_compat[@]} -eq 1 ]]; then LAN_IP="${mapfile_compat[0]}"; return; fi
  echo "Available LAN addresses:"
  select ip in "${mapfile_compat[@]}"; do [[ -n "$ip" ]] && { LAN_IP="$ip"; return; }; done
}
secret_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
set_env() {
  local key="$1" value="$2" temp="${ENV_FILE}.tmp"
  awk -v key="$key" -v value="$value" 'BEGIN{found=0} $0 ~ "^"key"=" {print key"="value;found=1;next} {print} END{if(!found)print key"="value}' "$ENV_FILE" > "$temp"
  mv "$temp" "$ENV_FILE"
}
load_env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1; }

if [[ "$ACTION" != "start" ]]; then
  [[ -f "$ENV_FILE" ]] || { echo "Run CarbonTrader-Start.command first." >&2; exit 1; }
  case "$ACTION" in
    stop) "${COMPOSE[@]}" stop; echo "Classroom stopped; volumes and data were preserved." ;;
    logs) "${COMPOSE[@]}" logs --follow --tail 200 ;;
    status) "${COMPOSE[@]}" ps -a; PORT="$(load_env_value CLASSROOM_PORT)"; IP="$(load_env_value CLASSROOM_LAN_IP)"; curl -fsS "http://$IP:$PORT/health" >/dev/null && echo "Health ........ OK" || echo "Health ........ Unavailable"; curl -fsS "http://$IP:$PORT/ready" >/dev/null && echo "Readiness ..... OK" || echo "Readiness ..... Unavailable"; curl -fsS "http://$IP:$PORT/student" >/dev/null && echo "Student Web ... OK" || echo "Student Web ... Unavailable" ;;
    *) echo "Unknown action" >&2; exit 1 ;;
  esac
  exit
fi

echo "CARBON TRADER I - Classroom Launcher"
command -v docker >/dev/null || { echo "Docker Desktop is required." >&2; exit 1; }
docker version >/dev/null 2>&1 || { echo "Start Docker Desktop and retry." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required." >&2; exit 1; }
echo "Docker Desktop ............ OK"
select_ip
PORT="${CLASSROOM_PORT_OVERRIDE:-8088}"
PROJECT_NAME="${CLASSROOM_PROJECT_NAME:-carbon-trader-classroom}"
if [[ ! -f "$ENV_FILE" ]]; then
  DB_SECRET="$(secret_hex 32)"; ACCESS_SECRET="$(secret_hex 48)"; REFRESH_SECRET="$(secret_hex 48)"
  cat > "$ENV_FILE" <<EOF
COMPOSE_PROJECT_NAME=$PROJECT_NAME
CLASSROOM_PORT=$PORT
CLASSROOM_LAN_IP=$LAN_IP
POSTGRES_USER=carbon
POSTGRES_PASSWORD=$DB_SECRET
POSTGRES_DB=carbon_trader
DATABASE_URL=postgresql://carbon:$DB_SECRET@postgres:5432/carbon_trader?schema=public
REDIS_URL=redis://redis:6379
JWT_ACCESS_SECRET=$ACCESS_SECRET
JWT_REFRESH_SECRET=$REFRESH_SECRET
CORS_ALLOWED_ORIGINS=http://$LAN_IP:$PORT
NEXT_PUBLIC_API_URL=/v1
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=7
PRESENCE_OFFLINE_SECONDS=30
HEALTH_TIMEOUT_MS=1500
ANDROID_APP_INSTALL_URL=
ANDROID_APP_VERSION=
IOS_APP_INSTALL_URL=
EOF
  chmod 600 "$ENV_FILE"
  echo "Runtime configuration ..... Created with random secrets"
else
  PORT="$(load_env_value CLASSROOM_PORT)"; set_env CLASSROOM_LAN_IP "$LAN_IP"; set_env CORS_ALLOWED_ORIGINS "http://$LAN_IP:$PORT"
  echo "Runtime configuration ..... Reused; LAN address refreshed"
fi
APP_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/apps/mobile/package.json" | head -n 1)"
if [[ -f "$ROOT/deploy/local-classroom/downloads/CarbonTrader.apk" ]]; then
  set_env ANDROID_APP_INSTALL_URL "/downloads/CarbonTrader.apk"; set_env ANDROID_APP_VERSION "$APP_VERSION"
else
  set_env ANDROID_APP_INSTALL_URL ""; set_env ANDROID_APP_VERSION ""
fi
echo "LAN Address ............... $LAN_IP"
"${COMPOSE[@]}" up -d --build
BASE="http://$LAN_IP:$PORT"
for _ in $(seq 1 150); do curl -fsS "$BASE/health" >/dev/null 2>&1 && curl -fsS "$BASE/ready" >/dev/null 2>&1 && curl -fsS "$BASE/classroom" >/dev/null 2>&1 && curl -fsS "$BASE/student" >/dev/null 2>&1 && READY=1 && break; sleep 4; done
[[ "${READY:-0}" == 1 ]] || { "${COMPOSE[@]}" ps -a; echo "Services did not become healthy. Review CarbonTrader-Logs.command." >&2; exit 1; }
set +e; "${COMPOSE[@]}" run --rm admin-owner-status >/dev/null 2>&1; OWNER_STATUS=$?; set -e
if [[ $OWNER_STATUS -eq 10 ]]; then
  echo "Create the first OWNER"
  read -r -p "Username: " ADMIN_OWNER_USERNAME
  read -r -p "Display name: " ADMIN_OWNER_DISPLAY_NAME
  read -r -s -p "Password (8-128 characters): " ADMIN_OWNER_PASSWORD; echo
  export ADMIN_OWNER_USERNAME ADMIN_OWNER_DISPLAY_NAME ADMIN_OWNER_PASSWORD
  "${COMPOSE[@]}" run --rm admin-create-owner
  unset ADMIN_OWNER_USERNAME ADMIN_OWNER_DISPLAY_NAME ADMIN_OWNER_PASSWORD
elif [[ $OWNER_STATUS -ne 0 ]]; then echo "Could not verify first OWNER state." >&2; exit 1; fi
echo "PostgreSQL/Redis/Migration/API/Teacher Web/Student Web/Gateway .... Healthy"
echo "Teacher Web:   $BASE"
echo "Student Web:   $BASE/student"
echo "Classroom Setup: $BASE/classroom"
echo "Student API:   $BASE/v1"
echo "If devices cannot connect, allow Docker Desktop and inbound TCP $PORT on the local network."
open "$BASE"
