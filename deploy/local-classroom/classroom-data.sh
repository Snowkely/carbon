#!/bin/bash
set -euo pipefail
ACTION="${1:?backup or restore required}"; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; ENV_FILE="$ROOT/deploy/.env.classroom"
[[ -f "$ENV_FILE" ]] || { echo "Run CarbonTrader-Start.command first." >&2; exit 1; }
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/docker-compose.classroom.yml")
if [[ "$ACTION" == backup ]]; then
  read -r -p "Backup folder (blank for ./backups): " FOLDER; FOLDER="${FOLDER:-$ROOT/backups}"; mkdir -p "$FOLDER"
  TARGET="$FOLDER/CarbonTrader-Classroom-$(date +%Y%m%d-%H%M%S).dump"; [[ ! -e "$TARGET" ]] || { echo "Refusing to overwrite $TARGET" >&2; exit 1; }
  "${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --file=/tmp/classroom.dump'
  "${COMPOSE[@]}" cp postgres:/tmp/classroom.dump "$TARGET"; "${COMPOSE[@]}" exec -T postgres rm -f /tmp/classroom.dump
  echo "Sensitive backup created: $TARGET"; echo "SHA-256: $(shasum -a 256 "$TARGET" | awk '{print $1}')"; exit
fi
read -r -p "Full path to .dump backup: " SOURCE; [[ -f "$SOURCE" && "$SOURCE" == *.dump ]] || { echo "Valid .dump required" >&2; exit 1; }
echo "WARNING: this replaces ONLY the dedicated classroom database."
read -r -p "Type RESTORE CLASSROOM to continue: " CONFIRM; [[ "$CONFIRM" == "RESTORE CLASSROOM" ]] || { echo "Restore cancelled"; exit 1; }
"${COMPOSE[@]}" stop reverse-proxy teacher-web api; "${COMPOSE[@]}" cp "$SOURCE" postgres:/tmp/classroom-restore.dump
"${COMPOSE[@]}" exec -T postgres sh -c 'psql --username="$POSTGRES_USER" --dbname=postgres --set=ON_ERROR_STOP=1 --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ''$POSTGRES_DB'' AND pid <> pg_backend_pid();" --command="DROP DATABASE IF EXISTS \"$POSTGRES_DB\";" --command="CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";"'
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_restore --exit-on-error --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" /tmp/classroom-restore.dump'
"${COMPOSE[@]}" exec -T postgres rm -f /tmp/classroom-restore.dump; "${COMPOSE[@]}" run --rm migrate; "${COMPOSE[@]}" up -d
echo "Restore complete. Run CarbonTrader-Status.command to verify readiness."
