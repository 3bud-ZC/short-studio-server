#!/usr/bin/env bash
# ==============================================================================
# Short Studio Server - Safe Uninstaller (Linux / macOS)
# ==============================================================================
# The default removes the running software and leaves every byte the customer
# produced exactly where it is. Destroying data requires typing an explicit flag
# and confirming a second time.
# ==============================================================================

set -euo pipefail

LEGACY_ABUD_HOME="/opt/abud-shorts"
FRESH_SHORT_STUDIO_HOME="/opt/short-studio"
ABUD_HOME_EXPLICIT="${ABUD_HOME:-}"
ABUD_COMPOSE_PROJECT_EXPLICIT="${ABUD_COMPOSE_PROJECT:-}"
REMOVE_DATA=false

while [ $# -gt 0 ]; do
  case "$1" in
    --remove-data) REMOVE_DATA=true; shift ;;
    --home) ABUD_HOME_EXPLICIT="${2:-}"; shift 2 ;;
    --home=*) ABUD_HOME_EXPLICIT="${1#*=}"; shift ;;
    --compose-project) ABUD_COMPOSE_PROJECT_EXPLICIT="${2:-}"; shift 2 ;;
    --compose-project=*) ABUD_COMPOSE_PROJECT_EXPLICIT="${1#*=}"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [ -n "$ABUD_HOME_EXPLICIT" ]; then
  ABUD_HOME="$ABUD_HOME_EXPLICIT"
elif [ -f "$LEGACY_ABUD_HOME/shared/config/.env" ]; then
  ABUD_HOME="$LEGACY_ABUD_HOME"
else
  ABUD_HOME="$FRESH_SHORT_STUDIO_HOME"
fi
if [ -f "$ABUD_HOME/shared/config/.env" ] && { [ "$ABUD_HOME" = "$LEGACY_ABUD_HOME" ] || [ -n "$ABUD_HOME_EXPLICIT" ]; }; then
  # Legacy is only "true" when the .env at this root is actually the
  # ABUD_CONTAINER_PREFIX-keyed shape - see the check just below, which reads
  # it directly rather than guessing from the path alone.
  IS_LEGACY_ABUD_INSTALL=true
else
  IS_LEGACY_ABUD_INSTALL=false
fi
ABUD_SHARED="$ABUD_HOME/shared"
ABUD_ENV_FILE="$ABUD_SHARED/config/.env"
ABUD_DATA_DIR="$ABUD_SHARED/data"
COMPOSE_FILE="$ABUD_HOME/current/docker-compose.prod.yml"
if [ -f "$ABUD_ENV_FILE" ] && ! grep -qE "^ABUD_CONTAINER_PREFIX=" "$ABUD_ENV_FILE"; then
  IS_LEGACY_ABUD_INSTALL=false
fi
if [ -n "$ABUD_COMPOSE_PROJECT_EXPLICIT" ]; then
  ABUD_COMPOSE_PROJECT="$ABUD_COMPOSE_PROJECT_EXPLICIT"
elif [ "$IS_LEGACY_ABUD_INSTALL" = true ]; then
  ABUD_COMPOSE_PROJECT="abud-shorts"
else
  ABUD_COMPOSE_PROJECT="short-studio"
fi
# The real, already-existing volume/network names on a legacy installation are
# project-prefixed - the pre-2.5 compose file never set an explicit `name:`.
# A fresh Short Studio install pins an explicit `name:` instead, so its real
# names are the bare short-studio-*-data / short-studio-v2.
if [ "$IS_LEGACY_ABUD_INSTALL" = true ]; then
  POSTGRES_VOLUME_NAME="${ABUD_COMPOSE_PROJECT}_abud-shorts-postgres-data"
else
  POSTGRES_VOLUME_NAME="short-studio-postgres-data"
fi

# Fall back to the in-place layout used by a developer checkout.
if [ ! -f "$COMPOSE_FILE" ] && [ -f "docker-compose.prod.yml" ]; then
  COMPOSE_FILE="docker-compose.prod.yml"
elif [ ! -f "$COMPOSE_FILE" ] && [ -f "docker-compose.v2.yml" ]; then
  COMPOSE_FILE="docker-compose.v2.yml"
fi

echo "================================================================="
echo "  Short Studio Server - Uninstaller"
echo "================================================================="

compose() {
  export SHORT_STUDIO_DATA_DIR="$ABUD_DATA_DIR" ABUD_DATA_DIR="$ABUD_DATA_DIR"
  export SHORT_STUDIO_RELEASE_DIR="$ABUD_HOME/current" ABUD_RELEASE_DIR="$ABUD_HOME/current"
  if [ "$IS_LEGACY_ABUD_INSTALL" = true ]; then
    export ABUD_POSTGRES_VOLUME="$POSTGRES_VOLUME_NAME"
    export ABUD_N8N_VOLUME="${ABUD_COMPOSE_PROJECT}_abud-shorts-n8n-data"
    export ABUD_NETWORK="${ABUD_COMPOSE_PROJECT}_abud-shorts-v2"
  fi
  docker compose --project-name "$ABUD_COMPOSE_PROJECT" \
    ${ABUD_ENV_FILE:+--env-file "$ABUD_ENV_FILE"} \
    --file "$COMPOSE_FILE" "$@"
}

echo "[1/2] Stopping and removing the application containers..."
compose down 2>/dev/null || docker compose --project-name "$ABUD_COMPOSE_PROJECT" down 2>/dev/null || true
echo "      Containers removed."

if [ "$REMOVE_DATA" != true ]; then
  echo "[2/2] Keeping your data."
  echo ""
  echo "  PRESERVED:"
  echo "    Videos, uploads and media   $ABUD_DATA_DIR"
  echo "    Database                    Docker volume $POSTGRES_VOLUME_NAME"
  echo "    Backups                     $ABUD_SHARED/backups"
  echo "    Configuration and secrets   $ABUD_SHARED/config"
  echo ""
  echo "  Reinstalling over this directory picks everything up again."
  echo "  To erase all of it permanently: sudo ./uninstall.sh --remove-data"
  echo "================================================================="
  exit 0
fi

echo ""
echo "  WARNING - DESTRUCTIVE"
echo "  This permanently deletes every video, upload, brand, publication record,"
echo "  backup and setting on this machine. It cannot be undone."
echo ""
if [ -t 0 ]; then
  read -r -p "  Type DELETE to confirm: " reply
  [ "$reply" = "DELETE" ] || { echo "  Cancelled. Nothing was removed."; exit 1; }
else
  echo "  Refusing to delete data without an interactive confirmation." >&2
  exit 1
fi

echo "[2/2] Removing all data..."
compose down -v 2>/dev/null || true
rm -rf "$ABUD_SHARED"
rm -f /usr/local/bin/short-studio /usr/local/bin/abud-shorts
echo "      All data removed."
echo "================================================================="
