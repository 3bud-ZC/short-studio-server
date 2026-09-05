#!/usr/bin/env bash
# ==============================================================================
# Short Studio Server - shared host-side helpers
# ==============================================================================
# Sourced by short-studio.sh (the operator CLI) and abud-update.sh (the updater).
# These run on the HOST, not inside a container: applying an update means
# controlling Docker, and the web application is deliberately never given that
# privilege.
# ==============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Installation layout
# ---------------------------------------------------------------------------
# ABUD_HOME/
#   current -> releases/<version>     the code that is running now
#   releases/<version>/               one directory per installed version
#   shared/                           EVERYTHING THE CUSTOMER OWNS
#     data/                           videos, uploads, media, models, logs
#     config/.env                     secrets and installation configuration
#     backups/                        pre-upgrade database snapshots
#     state/                          update transaction record and lock
#     installation.json               which version is current, and history
#
# The invariant the whole delivery model rests on: a release directory may be
# replaced or deleted, shared/ may not.
ABUD_HOME="${ABUD_HOME:-/opt/abud-shorts}"
ABUD_SHARED="$ABUD_HOME/shared"
ABUD_RELEASES="$ABUD_HOME/releases"
ABUD_CURRENT="$ABUD_HOME/current"
ABUD_DATA_DIR="${ABUD_DATA_DIR:-$ABUD_SHARED/data}"
ABUD_CONFIG_DIR="$ABUD_SHARED/config"
ABUD_ENV_FILE="$ABUD_CONFIG_DIR/.env"
ABUD_BACKUP_DIR="$ABUD_SHARED/backups"
ABUD_STATE_DIR="$ABUD_SHARED/state"
ABUD_INSTALLATION_FILE="$ABUD_SHARED/installation.json"
ABUD_LOCK_FILE="$ABUD_STATE_DIR/update.lock"
# The application reads this file to populate Settings -> Updates. It lives in
# the data directory because that is the one path both the host and the
# container can see.
ABUD_UPDATE_STATE_FILE="$ABUD_DATA_DIR/updates/update-state.json"
ABUD_COMPOSE_PROJECT="${ABUD_COMPOSE_PROJECT:-abud-shorts}"
ABUD_CONTAINER_PREFIX="${ABUD_CONTAINER_PREFIX:-$ABUD_COMPOSE_PROJECT}"

DEFAULT_MANIFEST_URL="https://github.com/3bud-ZC/Abud-Shorts-Engine/releases/latest/download/update-manifest.json"

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'; C_CYAN=$'\033[36m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_CYAN=""; C_DIM=""
fi

log()      { printf '%s\n' "$*"; }
info()     { printf '%s\n' "$*"; }
step()     { printf '%s%s%s\n' "$C_CYAN" "$*" "$C_RESET"; }
ok()       { printf '%s  %s%s\n' "$C_GREEN" "$*" "$C_RESET"; }
warn()     { printf '%s  %s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2; }
fail()     { printf '%s  %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; }
dim()      { printf '%s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }

die() {
  fail "$*"
  exit 1
}

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
require_docker() {
  command -v docker >/dev/null 2>&1 ||
    die "Docker is not installed. Install Docker Engine, then run this again."
  docker info >/dev/null 2>&1 ||
    die "The Docker service is not running, or this user cannot reach it. Start Docker (or run with sudo) and try again."
}

require_jq() {
  command -v jq >/dev/null 2>&1 ||
    die "The 'jq' tool is required to read the update manifest. Install it with: sudo apt-get install -y jq"
}

require_root_for_write() {
  if [ ! -w "$ABUD_HOME" ]; then
    die "This command needs write access to $ABUD_HOME. Run it with sudo."
  fi
}

# ---------------------------------------------------------------------------
# Installation record
# ---------------------------------------------------------------------------
installed_version() {
  if [ -f "$ABUD_INSTALLATION_FILE" ]; then
    jq -r '.currentVersion // empty' "$ABUD_INSTALLATION_FILE" 2>/dev/null || true
  fi
}

previous_version() {
  if [ -f "$ABUD_INSTALLATION_FILE" ]; then
    jq -r '.previousVersion // empty' "$ABUD_INSTALLATION_FILE" 2>/dev/null || true
  fi
}

installation_field() {
  local field="$1"
  if [ -f "$ABUD_INSTALLATION_FILE" ]; then
    jq -r --arg f "$field" '.[$f] // empty' "$ABUD_INSTALLATION_FILE" 2>/dev/null || true
  fi
}

write_installation_record() {
  # write_installation_record <currentVersion> <previousVersion> <image> <channel>
  local current="$1" previous="$2" image="$3" channel="$4"
  mkdir -p "$(dirname "$ABUD_INSTALLATION_FILE")"
  local tmp
  tmp="$(mktemp)"
  jq -n \
    --arg current "$current" \
    --arg previous "$previous" \
    --arg image "$image" \
    --arg channel "$channel" \
    --arg updatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg home "$ABUD_HOME" \
    '{
       product: "Short Studio Server",
       currentVersion: $current,
       previousVersion: (if $previous == "" then null else $previous end),
       image: $image,
       channel: $channel,
       installRoot: $home,
       updatedAt: $updatedAt
     }' > "$tmp"
  mv "$tmp" "$ABUD_INSTALLATION_FILE"
  chmod 600 "$ABUD_INSTALLATION_FILE"
}

# ---------------------------------------------------------------------------
# Compose
# ---------------------------------------------------------------------------
compose_file() {
  echo "$ABUD_CURRENT/docker-compose.prod.yml"
}

# Runs docker compose against the current release with the installation's own
# environment file. Never uses -v, never prunes.
compose() {
  local file
  file="$(compose_file)"
  [ -f "$file" ] || die "This installation is incomplete: $file is missing."
  ABUD_DATA_DIR="$ABUD_DATA_DIR" \
  ABUD_RELEASE_DIR="$(readlink -f "$ABUD_CURRENT")" \
  ABUD_CONTAINER_PREFIX="$ABUD_CONTAINER_PREFIX" \
  docker compose \
    --project-name "$ABUD_COMPOSE_PROJECT" \
    --env-file "$ABUD_ENV_FILE" \
    --file "$file" \
    "$@"
}

container_name() {
  printf '%s-%s\n' "$ABUD_CONTAINER_PREFIX" "$1"
}

host_port() {
  local port
  port="$(grep -E '^HOST_PORT=' "$ABUD_ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  echo "${port:-3130}"
}

app_base_url() {
  echo "http://127.0.0.1:$(host_port)"
}

# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
wait_for_endpoint() {
  # wait_for_endpoint <url> <attempts> <label>
  local url="$1" attempts="${2:-60}" label="${3:-service}" i=0
  while [ "$i" -lt "$attempts" ]; do
    i=$((i + 1))
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  warn "$label did not respond at $url after $((attempts * 2))s."
  return 1
}

container_health() {
  # Prints healthy | unhealthy | starting | missing
  local name="$1" state
  state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo missing)"
  echo "$state"
}

# Waits, briefly, for the application container health to settle.
#
# The app answers /health/ready as soon as it is up, but Docker only re-runs its
# own healthcheck on an interval. Without this pause the summary printed straight
# after a state change reports "Short Studio: Problem" on an installation that is
# in fact healthy, which reads as a failed update to the operator.
wait_for_container_settle() {
  local attempts="${1:-20}" i=0
  while [ "$i" -lt "$attempts" ]; do
    i=$((i + 1))
    [ "$(container_health "$(container_name app)")" = "healthy" ] && return 0
    sleep 2
  done
  return 0
}

# The customer-facing summary. Never dumps raw Docker JSON.
print_health_summary() {
  local app worker db automation overall url
  app="$(container_health "$(container_name app)")"
  worker="$(container_health "$(container_name render-worker)")"
  db="$(container_health "$(container_name postgres)")"
  automation="$(container_health "$(container_name n8n)")"

  friendly() {
    case "$1" in
      healthy|running) echo "Healthy" ;;
      starting)        echo "Starting" ;;
      missing)         echo "Not installed" ;;
      *)               echo "Problem" ;;
    esac
  }

  overall="Healthy"
  for state in "$app" "$worker" "$db" "$automation"; do
    case "$state" in
      healthy|running) ;;
      *) overall="Problem" ;;
    esac
  done

  url="$(installation_field publicUrl)"
  [ -n "$url" ] || url="$(app_base_url)"

  echo ""
  echo "  Short Studio:  $overall"
  echo "  Application:   $(friendly "$app")"
  echo "  Video Engine:  $(friendly "$worker")"
  echo "  Database:      $(friendly "$db")"
  echo "  Automation:    $(friendly "$automation")"
  echo "  URL:           $url"
  echo ""

  [ "$overall" = "Healthy" ]
}

# ---------------------------------------------------------------------------
# Update lock
# ---------------------------------------------------------------------------
# A second updater must refuse rather than race a first one into two concurrent
# `docker compose up` calls. flock is used when available because it releases
# automatically if the process is killed; the PID file is the fallback.
ABUD_LOCK_FD=""

acquire_update_lock() {
  mkdir -p "$ABUD_STATE_DIR"
  if command -v flock >/dev/null 2>&1; then
    exec {ABUD_LOCK_FD}>>"$ABUD_LOCK_FILE"
    if ! flock -n "$ABUD_LOCK_FD"; then
      die "Update already in progress. Wait for the running update to finish, then try again."
    fi
    printf '%s\n' "$$" >&"$ABUD_LOCK_FD"
    return 0
  fi

  if [ -f "$ABUD_LOCK_FILE" ]; then
    local holder
    holder="$(head -1 "$ABUD_LOCK_FILE" 2>/dev/null || true)"
    if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
      die "Update already in progress (process $holder). Wait for it to finish, then try again."
    fi
    warn "Clearing a stale update lock left by process ${holder:-unknown}."
  fi
  printf '%s\n' "$$" > "$ABUD_LOCK_FILE"
}

release_update_lock() {
  if [ -n "$ABUD_LOCK_FD" ]; then
    flock -u "$ABUD_LOCK_FD" 2>/dev/null || true
    eval "exec ${ABUD_LOCK_FD}>&-" 2>/dev/null || true
    ABUD_LOCK_FD=""
  fi
  rm -f "$ABUD_LOCK_FILE" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Update transaction state
# ---------------------------------------------------------------------------
# Persisted after every phase so an interrupted run - closed terminal, dropped
# SSH session, host reboot - is detectable on the next invocation instead of
# leaving the installation silently half-switched.

# Extra fields accumulated across the run (backupId, imageDigest, error, ...).
# Kept as a JSON document so each phase adds to the record rather than replacing
# what an earlier phase already established.
ABUD_TXN_EXTRA='{}'
# Whether this transaction is an update or an administrator asking to go back.
# Both can end in ROLLED_BACK, but only one of them is a failure, and the Update
# Center must not describe a deliberate rollback as an update that did not
# complete.
ABUD_TXN_KIND="${ABUD_TXN_KIND:-update}"

txn_set() {
  # txn_set <key> <value>  - records a string field on the transaction
  ABUD_TXN_EXTRA="$(jq -c --arg k "$1" --arg v "$2" '. + {($k): $v}' <<<"$ABUD_TXN_EXTRA")"
}

txn_set_json() {
  # txn_set_json <key> <json>  - records a structured field, e.g. the rollback result
  ABUD_TXN_EXTRA="$(jq -c --arg k "$1" --argjson v "$2" '. + {($k): $v}' <<<"$ABUD_TXN_EXTRA")"
}

write_transaction() {
  # write_transaction <state>
  local state="$1"
  mkdir -p "$(dirname "$ABUD_UPDATE_STATE_FILE")"
  [ -f "$ABUD_UPDATE_STATE_FILE" ] || echo '{"history":[]}' > "$ABUD_UPDATE_STATE_FILE"

  local terminal=false
  case "$state" in SUCCESS|FAILED|ROLLED_BACK) terminal=true ;; esac

  local now txn tmp
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  txn="$(jq -c -n \
    --arg transactionId "$ABUD_TXN_ID" \
    --arg state "$state" \
    --arg kind "$ABUD_TXN_KIND" \
    --arg channel "$ABUD_TXN_CHANNEL" \
    --arg fromVersion "$ABUD_TXN_FROM" \
    --arg toVersion "$ABUD_TXN_TO" \
    --arg startedAt "$ABUD_TXN_STARTED" \
    --arg updatedAt "$now" \
    --argjson extra "$ABUD_TXN_EXTRA" \
    --argjson terminal "$terminal" \
    '{transactionId: $transactionId, state: $state, kind: $kind, channel: $channel,
      fromVersion: $fromVersion, toVersion: $toVersion,
      startedAt: $startedAt, updatedAt: $updatedAt}
     + $extra
     + (if $terminal then {finishedAt: $updatedAt} else {} end)')"

  tmp="$(mktemp)"
  if jq --argjson txn "$txn" --argjson terminal "$terminal" '
        .history = ((.history // [])
                    | map(select(.transactionId != $txn.transactionId))
                    + [$txn]
                    | .[-20:])
        | .lastSuccessful = (if $txn.state == "SUCCESS" then $txn else .lastSuccessful end)
        | if $terminal then del(.current) else .current = $txn end
      ' "$ABUD_UPDATE_STATE_FILE" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$ABUD_UPDATE_STATE_FILE"
  else
    # Never fabricate a record. If it cannot be written, say so and continue -
    # the update itself is not made safer by aborting on a bookkeeping failure.
    rm -f "$tmp"
    warn "Could not write the update transaction record."
  fi
}

current_transaction_state() {
  [ -f "$ABUD_UPDATE_STATE_FILE" ] || { echo ""; return 0; }
  jq -r '.current.state // empty' "$ABUD_UPDATE_STATE_FILE" 2>/dev/null || echo ""
}

current_transaction_field() {
  local field="$1"
  [ -f "$ABUD_UPDATE_STATE_FILE" ] || { echo ""; return 0; }
  jq -r --arg f "$field" '.current[$f] // empty' "$ABUD_UPDATE_STATE_FILE" 2>/dev/null || echo ""
}

# ---------------------------------------------------------------------------
# Integrity
# ---------------------------------------------------------------------------
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "No SHA-256 tool found (sha256sum or shasum). Cannot verify the download."
  fi
}

verify_sha256() {
  # verify_sha256 <file> <expected>
  local actual
  actual="$(sha256_of "$1")"
  if [ "$(printf '%s' "$actual" | tr 'A-F' 'a-f')" != "$(printf '%s' "$2" | tr 'A-F' 'a-f')" ]; then
    die "Download verification failed: the file does not match the checksum published for this release. Nothing has been changed."
  fi
}

# The digest of an image already present locally, as Docker recorded it at pull
# time. Comparing this with the manifest is what makes the image immutable in
# practice rather than only by convention.
local_image_digest() {
  docker image inspect --format '{{index .RepoDigests 0}}' "$1" 2>/dev/null |
    sed -n 's/.*@\(sha256:[a-f0-9]\{64\}\).*/\1/p'
}

# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------
# A pre-upgrade snapshot taken directly from PostgreSQL. It does not depend on
# the application being reachable or on an API token, which matters precisely in
# the case it exists for: restoring after an update that broke the app.
create_pre_upgrade_backup() {
  # create_pre_upgrade_backup <backup-id>
  local backup_id="$1"
  local target="$ABUD_BACKUP_DIR/$backup_id.sql.gz"
  mkdir -p "$ABUD_BACKUP_DIR"

  local pg_user pg_db
  pg_user="$(grep -E '^POSTGRES_USER=' "$ABUD_ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  pg_db="$(grep -E '^POSTGRES_DB=' "$ABUD_ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  pg_user="${pg_user:-abud_shorts}"
  pg_db="${pg_db:-abud_shorts}"

  if ! docker exec "$(container_name postgres)" pg_dump -U "$pg_user" -d "$pg_db" 2>/dev/null | gzip > "$target"; then
    rm -f "$target"
    return 1
  fi
  [ -s "$target" ] || { rm -f "$target"; return 1; }

  # The configuration file holds the installation's secrets, so the copy is
  # readable only by its owner and never leaves the machine.
  cp "$ABUD_ENV_FILE" "$ABUD_BACKUP_DIR/$backup_id.env"
  chmod 600 "$ABUD_BACKUP_DIR/$backup_id.env" "$target"
  echo "$target"
}

restore_pre_upgrade_backup() {
  # restore_pre_upgrade_backup <backup-id>
  local backup_id="$1"
  local source="$ABUD_BACKUP_DIR/$backup_id.sql.gz"
  [ -f "$source" ] || return 1

  local pg_user pg_db
  pg_user="$(grep -E '^POSTGRES_USER=' "$ABUD_ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  pg_db="$(grep -E '^POSTGRES_DB=' "$ABUD_ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  pg_user="${pg_user:-abud_shorts}"
  pg_db="${pg_db:-abud_shorts}"

  gunzip -c "$source" | docker exec -i "$(container_name postgres)" psql -U "$pg_user" -d "$pg_db" -v ON_ERROR_STOP=0 >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Version reporting from the running application
# ---------------------------------------------------------------------------
running_version() {
  curl -fsS --max-time 10 "$(app_base_url)/api/v2/system/info" 2>/dev/null |
    jq -r '.version // empty' 2>/dev/null || true
}

running_schema_version() {
  curl -fsS --max-time 10 "$(app_base_url)/api/v2/system/info" 2>/dev/null |
    jq -r '.schemaVersion // empty' 2>/dev/null || true
}
