#!/usr/bin/env bash
# ==============================================================================
# Short Studio Server - Client Installer (Linux / macOS)
# ==============================================================================
# One command, then a browser. Nothing here compiles source, edits YAML by hand
# or asks the customer to know Docker.
#
#   sudo ./install.sh
#   sudo ./install.sh --url https://shorts.example.com
#   sudo ./install.sh --port 3131
#
# What a fresh install produces:
#
#   /opt/short-studio/
#     current -> releases/<version>    the code
#     releases/<version>/              this release, and every earlier one
#     shared/                          EVERYTHING THE CUSTOMER OWNS
#       data/ config/ backups/ logs/ state/ installation.json
#
# Re-running this installer on a machine that already has an ABUD Shorts
# Engine 2.4 installation (/opt/abud-shorts) is an upgrade, not a fresh
# install: it keeps operating out of that same existing root instead of
# creating a new short-studio one, so the owner account, jobs, videos,
# Provider Vault and backups are never orphaned. See the detection below.
#
# Upgrading replaces a release directory. It never writes inside shared/, which
# is why videos, uploads, brands, settings and backups survive every update.
# ==============================================================================

set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LEGACY_ABUD_HOME="/opt/abud-shorts"
FRESH_SHORT_STUDIO_HOME="/opt/short-studio"
# Only an explicit ABUD_HOME env var or --home flag counts as "the caller
# chose this" - both are resolved after option parsing below, so --home
# always wins over the auto-detected default regardless of argument order.
ABUD_HOME_EXPLICIT="${ABUD_HOME:-}"
HOST_PORT=3130
PUBLIC_URL=""
IMAGE_OVERRIDE=""
TRUSTED_PROXY_VALUE=""
ABUD_COMPOSE_PROJECT_EXPLICIT="${ABUD_COMPOSE_PROJECT:-}"
ABUD_HOME=""
ABUD_COMPOSE_PROJECT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --port) HOST_PORT="${2:-3130}"; shift 2 ;;
    --port=*) HOST_PORT="${1#*=}"; shift ;;
    --url) PUBLIC_URL="${2:-}"; shift 2 ;;
    --url=*) PUBLIC_URL="${1#*=}"; shift ;;
    --home) ABUD_HOME_EXPLICIT="${2:-}"; shift 2 ;;
    --home=*) ABUD_HOME_EXPLICIT="${1#*=}"; shift ;;
    --image) IMAGE_OVERRIDE="${2:-}"; shift 2 ;;
    --image=*) IMAGE_OVERRIDE="${1#*=}"; shift ;;
    --compose-project) ABUD_COMPOSE_PROJECT_EXPLICIT="${2:-}"; shift 2 ;;
    --compose-project=*) ABUD_COMPOSE_PROJECT_EXPLICIT="${1#*=}"; shift ;;
    --behind-proxy) TRUSTED_PROXY_VALUE="1"; shift ;;
    -h|--help)
      sed -n '2,28p' "${BASH_SOURCE[0]}"
      exit 0 ;;
    # A bare port keeps the old `./install.sh 3131` form working.
    [0-9]*) HOST_PORT="$1"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [ -n "$ABUD_HOME_EXPLICIT" ]; then
  ABUD_HOME="$ABUD_HOME_EXPLICIT"
elif [ -f "$LEGACY_ABUD_HOME/shared/config/.env" ]; then
  # An ABUD Shorts Engine 2.4 installation already lives here. Moving its
  # data to a new root would itself be a risky migration this installer does
  # not perform - the safe move is to keep operating where the real data
  # already is.
  ABUD_HOME="$LEGACY_ABUD_HOME"
else
  ABUD_HOME="$FRESH_SHORT_STUDIO_HOME"
fi
if [ -z "$ABUD_HOME_EXPLICIT" ] && [ "$ABUD_HOME" = "$LEGACY_ABUD_HOME" ] && [ -f "$LEGACY_ABUD_HOME/shared/config/.env" ]; then
  IS_LEGACY_ABUD_INSTALL=true
elif [ -n "$ABUD_HOME_EXPLICIT" ] && [ -f "$ABUD_HOME_EXPLICIT/shared/config/.env" ]; then
  # An explicit --home can also point at an existing legacy installation
  # (e.g. a rehearsal harness cloning a real one into a test path).
  IS_LEGACY_ABUD_INSTALL=true
else
  IS_LEGACY_ABUD_INSTALL=false
fi
if [ -n "$ABUD_COMPOSE_PROJECT_EXPLICIT" ]; then
  ABUD_COMPOSE_PROJECT="$ABUD_COMPOSE_PROJECT_EXPLICIT"
elif [ "$IS_LEGACY_ABUD_INSTALL" = true ]; then
  ABUD_COMPOSE_PROJECT="abud-shorts"
else
  ABUD_COMPOSE_PROJECT="short-studio"
fi

export ABUD_HOME
ABUD_SHARED="$ABUD_HOME/shared"
ABUD_RELEASES="$ABUD_HOME/releases"
ABUD_CURRENT="$ABUD_HOME/current"
ABUD_DATA_DIR="$ABUD_SHARED/data"
ABUD_CONFIG_DIR="$ABUD_SHARED/config"
ABUD_ENV_FILE="$ABUD_CONFIG_DIR/.env"

echo "================================================================="
echo "  Short Studio Server - Installer"
echo "================================================================="
echo ""

# ---------------------------------------------------------------------------
# 1. Docker
# ---------------------------------------------------------------------------
echo "[1/9] Checking Docker..."
command -v docker >/dev/null 2>&1 || {
  echo "Error: Docker is not installed." >&2
  echo "Install it first: https://docs.docker.com/engine/install/" >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "Error: the Docker service is not running, or this user cannot reach it." >&2
  echo "Start Docker, or run this installer with sudo." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "Error: the Docker Compose plugin is missing." >&2
  echo "Install it: https://docs.docker.com/compose/install/" >&2
  exit 1
}
echo "      Docker is running."

# jq is what the updater uses to read a release manifest. Installing it now
# means the customer never meets a missing dependency mid-update.
if ! command -v jq >/dev/null 2>&1; then
  echo "      Installing the 'jq' helper the updater needs..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq jq >/dev/null 2>&1 || true
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q jq >/dev/null 2>&1 || true
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q jq >/dev/null 2>&1 || true
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache jq >/dev/null 2>&1 || true
  elif command -v brew >/dev/null 2>&1; then
    brew install jq >/dev/null 2>&1 || true
  fi
fi
command -v jq >/dev/null 2>&1 || {
  echo "Error: 'jq' could not be installed automatically." >&2
  echo "Install it manually, then run this installer again: sudo apt-get install -y jq" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# 2. Disk
# ---------------------------------------------------------------------------
echo "[2/9] Checking disk space..."
mkdir -p "$ABUD_HOME"
AVAILABLE_GB=$(( $(df -Pk "$ABUD_HOME" | awk 'NR==2 {print $4}') / 1024 / 1024 ))
if [ "$AVAILABLE_GB" -lt 15 ]; then
  echo "Error: ${AVAILABLE_GB} GB free. Short Studio needs at least 15 GB to install." >&2
  exit 1
fi
echo "      ${AVAILABLE_GB} GB available."

# ---------------------------------------------------------------------------
# 3. Address
# ---------------------------------------------------------------------------
echo "[3/9] Checking the address this installation will serve..."
if command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 "$HOST_PORT" >/dev/null 2>&1; then
  # The port being busy is only a problem if something ELSE has it. Re-running
  # the installer over an existing installation - to repair it, or to move it
  # to a newer package - is a legitimate action, and it must not be refused
  # just because that installation is currently running. Matches both brands.
  if curl -fsS --max-time 5 "http://127.0.0.1:$HOST_PORT/api/v2/system/info" 2>/dev/null |
       grep -qE "Short Studio|ABUD Shorts Engine"; then
    echo "      Port $HOST_PORT is serving an existing installation; reinstalling over it."
    echo "      Your videos, settings and backups are not touched."
  else
    echo "Error: port $HOST_PORT is already in use by another program on this machine." >&2
    echo "Choose another one: sudo ./install.sh --port 3131" >&2
    exit 1
  fi
fi
if [ -z "$PUBLIC_URL" ]; then
  PUBLIC_URL="http://localhost:$HOST_PORT"
  echo "      Local installation: $PUBLIC_URL"
  echo "      For a server with a domain, rerun with: --url https://shorts.example.com"
else
  case "$PUBLIC_URL" in
    http://*|https://*) ;;
    *) echo "Error: --url must start with http:// or https://" >&2; exit 1 ;;
  esac
  PUBLIC_URL="${PUBLIC_URL%/}"
  echo "      Public address: $PUBLIC_URL"
  if [ -z "$TRUSTED_PROXY_VALUE" ]; then
    echo "      Forwarded proxy headers will stay ignored. Add --behind-proxy only when a trusted reverse proxy is in front."
  fi
fi

# ---------------------------------------------------------------------------
# 4. Release identity
# ---------------------------------------------------------------------------
echo "[4/9] Reading this release..."
[ -f "$PACKAGE_DIR/release.json" ] || {
  echo "Error: release.json is missing. This does not look like a Short Studio Server client package." >&2
  exit 1
}
RELEASE_VERSION="$(jq -r '.version // empty' "$PACKAGE_DIR/release.json")"
RELEASE_IMAGE="$(jq -r '.image // empty' "$PACKAGE_DIR/release.json")"
RELEASE_DIGEST="$(jq -r '.imageDigest // empty' "$PACKAGE_DIR/release.json")"
RELEASE_CHANNEL="$(jq -r '.channel // "stable"' "$PACKAGE_DIR/release.json")"
[ -n "$RELEASE_VERSION" ] || { echo "Error: this package does not declare a version." >&2; exit 1; }
[ -n "$IMAGE_OVERRIDE" ] && RELEASE_IMAGE="$IMAGE_OVERRIDE"
echo "      Version $RELEASE_VERSION ($RELEASE_CHANNEL)"

# ---------------------------------------------------------------------------
# 5. The application image: offline archive first, otherwise pull
# ---------------------------------------------------------------------------
echo "[5/9] Preparing the application..."
OFFLINE_ARCHIVE="$(find "$PACKAGE_DIR/images" -maxdepth 1 -name '*.tar*' 2>/dev/null | head -1 || true)"
if [ -n "$OFFLINE_ARCHIVE" ]; then
  echo "      Offline package: loading the bundled image (this takes a few minutes)..."
  docker load -i "$OFFLINE_ARCHIVE" >/dev/null || {
    echo "Error: the bundled application image could not be loaded." >&2
    exit 1
  }
  echo "      Image loaded from the package."
else
  # Pull by digest when the package publishes one: a tag can be moved, a digest
  # cannot, so this is what makes the installed version reproducible.
  PULL_REF="$RELEASE_IMAGE"
  if [ -n "$RELEASE_DIGEST" ] && [ "$RELEASE_DIGEST" != "null" ]; then
    PULL_REF="${RELEASE_IMAGE%%:*}@${RELEASE_DIGEST}"
  fi
  echo "      Downloading the application (this takes a few minutes)..."
  docker pull "$PULL_REF" >/dev/null || {
    echo "Error: the application image could not be downloaded." >&2
    echo "Check this machine's internet connection and try again." >&2
    exit 1
  }
  RELEASE_IMAGE="$PULL_REF"
  echo "      Application downloaded."
fi

# ---------------------------------------------------------------------------
# 6. Persistent layout
# ---------------------------------------------------------------------------
echo "[6/9] Creating the installation..."
mkdir -p \
  "$ABUD_DATA_DIR"/{videos,thumbnails,uploads,cache,models,backups,logs,updates} \
  "$ABUD_CONFIG_DIR" \
  "$ABUD_SHARED"/{backups,logs,state} \
  "$ABUD_RELEASES"

RELEASE_DIR="$ABUD_RELEASES/$RELEASE_VERSION"
rm -rf "$RELEASE_DIR.incoming"
mkdir -p "$RELEASE_DIR.incoming"
# The image archive is not copied into the release directory: it is many
# gigabytes and Docker already holds it.
tar -c --exclude='./images' -C "$PACKAGE_DIR" . | tar -x -C "$RELEASE_DIR.incoming"
rm -rf "$RELEASE_DIR"
mv "$RELEASE_DIR.incoming" "$RELEASE_DIR"
chmod +x "$RELEASE_DIR"/scripts/host/*.sh 2>/dev/null || true
ln -sfn "$RELEASE_DIR" "$ABUD_CURRENT"
echo "      Installed to $RELEASE_DIR"

# ---------------------------------------------------------------------------
# 7. Configuration and secrets
# ---------------------------------------------------------------------------
echo "[7/9] Configuring..."
update_env() {
  if grep -qE "^$1=" "$ABUD_ENV_FILE"; then
    sed -i "s|^$1=.*|$1=$2|" "$ABUD_ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ABUD_ENV_FILE"
  fi
}

if [ ! -f "$ABUD_ENV_FILE" ]; then
  # Never reached for an upgrade: IS_LEGACY_ABUD_INSTALL guarantees this file
  # already exists whenever a real ABUD Shorts Engine 2.4 install is present.
  # This is always a genuinely fresh installation.
  secret() { openssl rand -hex "$1"; }
  PG_PASS="short_studio_pg_$(secret 16)"
  cat > "$ABUD_ENV_FILE" <<ENVEOF
# Short Studio Server - installation configuration
# Generated by the installer. Every secret below is unique to this machine;
# there is no shared or default password anywhere in the product.

HOST_PORT=$HOST_PORT
V2_PUBLIC_URL=$PUBLIC_URL
TRUSTED_PROXY=$TRUSTED_PROXY_VALUE

SHORT_STUDIO_IMAGE=$RELEASE_IMAGE
SHORT_STUDIO_RELEASE_CHANNEL=$RELEASE_CHANNEL
SHORT_STUDIO_HOST_PLATFORM=linux
SHORT_STUDIO_INSTALL_TYPE=docker_linux
SHORT_STUDIO_COMPOSE_PROJECT=$ABUD_COMPOSE_PROJECT
SHORT_STUDIO_CONTAINER_PREFIX=$ABUD_COMPOSE_PROJECT

NODE_ENV=production
V2_ENABLED=true
LOG_LEVEL=info
GENERIC_TIMEZONE=Africa/Cairo
WHISPER_MODEL=small
KOKORO_MODEL_PRECISION=q4

POSTGRES_DB=short_studio
POSTGRES_USER=short_studio
POSTGRES_PASSWORD=$PG_PASS

INTERNAL_SERVICE_TOKEN=short_studio_sec_$(secret 32)
N8N_ENCRYPTION_KEY=$(secret 16)
SESSION_SECRET=$(secret 32)
PROVIDER_VAULT_MASTER_KEY=$(secret 32)
WEBHOOK_SIGNING_SECRET=whsec_$(secret 24)

# Arabic/Egyptian narration defaults to Local Voice (VoiceTut/KemeTone, set up
# by the app's Providers page or the local-voice CLI command). ElevenLabs is
# an optional premium alternative, configured from the app: Providers ->
# ElevenLabs -> Configure. The key is held encrypted in the provider vault,
# so editing this file is not required.
ELEVENLABS_API_KEY=
ELEVENLABS_DEFAULT_VOICE_ID=
PEXELS_API_KEY=
ENVEOF
  chmod 600 "$ABUD_ENV_FILE"
  echo "      Generated a unique configuration with fresh secrets."
else
  # An existing installation keeps its secrets and its data. Only the version
  # pointers move - and, for an install upgraded from ABUD Shorts Engine 2.4,
  # the compose identity variables that keep it attached to its real,
  # already-running containers and volumes instead of creating empty new ones.
  if grep -qE "^ABUD_CONTAINER_PREFIX=" "$ABUD_ENV_FILE"; then
    update_env ABUD_IMAGE "$RELEASE_IMAGE"
    update_env ABUD_RELEASE_CHANNEL "$RELEASE_CHANNEL"
    update_env ABUD_COMPOSE_PROJECT "$ABUD_COMPOSE_PROJECT"
    update_env ABUD_CONTAINER_PREFIX "$ABUD_COMPOSE_PROJECT"
    # The pre-2.5 compose file never set an explicit external `name:` on
    # these, so Docker Compose applied its own default: "<project>_<key>".
    # The real, already-existing volumes/network are therefore prefixed by
    # this installation's actual compose project name - NOT the bare key.
    # Getting this wrong is the one mistake that would silently create empty
    # replacement volumes instead of reattaching.
    grep -qE "^ABUD_POSTGRES_VOLUME=" "$ABUD_ENV_FILE" || update_env ABUD_POSTGRES_VOLUME "${ABUD_COMPOSE_PROJECT}_abud-shorts-postgres-data"
    grep -qE "^ABUD_N8N_VOLUME=" "$ABUD_ENV_FILE" || update_env ABUD_N8N_VOLUME "${ABUD_COMPOSE_PROJECT}_abud-shorts-n8n-data"
    grep -qE "^ABUD_NETWORK=" "$ABUD_ENV_FILE" || update_env ABUD_NETWORK "${ABUD_COMPOSE_PROJECT}_abud-shorts-v2"
  else
    update_env SHORT_STUDIO_IMAGE "$RELEASE_IMAGE"
    update_env SHORT_STUDIO_RELEASE_CHANNEL "$RELEASE_CHANNEL"
    update_env SHORT_STUDIO_COMPOSE_PROJECT "$ABUD_COMPOSE_PROJECT"
    update_env SHORT_STUDIO_CONTAINER_PREFIX "$ABUD_COMPOSE_PROJECT"
  fi
  echo "      Existing configuration kept; secrets and data untouched."
fi

PRIOR_INSTALLATION_JSON="$ABUD_SHARED/installation.json"
PRIOR_PRODUCT=""
PRIOR_VERSION=""
if [ -f "$PRIOR_INSTALLATION_JSON" ]; then
  PRIOR_PRODUCT="$(jq -r '.product // empty' "$PRIOR_INSTALLATION_JSON" 2>/dev/null || true)"
  PRIOR_VERSION="$(jq -r '.currentVersion // empty' "$PRIOR_INSTALLATION_JSON" 2>/dev/null || true)"
fi
PREVIOUS_PRODUCT_VALUE=""
if [ "$IS_LEGACY_ABUD_INSTALL" = true ] && [ "$PRIOR_PRODUCT" = "ABUD Shorts Engine" ]; then
  PREVIOUS_PRODUCT_VALUE="ABUD Shorts Engine $PRIOR_VERSION"
fi
jq -n \
  --arg current "$RELEASE_VERSION" \
  --arg previous "$PRIOR_VERSION" \
  --arg previousProduct "$PREVIOUS_PRODUCT_VALUE" \
  --arg image "$RELEASE_IMAGE" \
  --arg channel "$RELEASE_CHANNEL" \
  --arg url "$PUBLIC_URL" \
  --arg home "$ABUD_HOME" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{product: "Short Studio Server",
    previousProduct: (if $previousProduct == "" then null else $previousProduct end),
    currentVersion: $current, previousVersion: (if $previous == "" then null else $previous end),
    image: $image, channel: $channel, publicUrl: $url, installRoot: $home, updatedAt: $at}' \
  > "$ABUD_SHARED/installation.json"
chmod 600 "$ABUD_SHARED/installation.json"

# ---------------------------------------------------------------------------
# 8. Start
# ---------------------------------------------------------------------------
echo "[8/9] Starting Short Studio Server..."
# Set both the new and legacy variable names directly - docker-compose.prod.yml
# resolves the same real values regardless of which tier of its fallback
# interpolation ends up matching, and an upgraded install's .env may only
# define the ABUD_* keys (see the config step above).
LEGACY_VOLUME_ENV=""
if [ "$IS_LEGACY_ABUD_INSTALL" = true ]; then
  # Pins compose to the real, already-existing volumes/network from the
  # pre-2.5 compose file (Docker Compose's own default "<project>_<key>"
  # naming, since that file never set an explicit `name:`).
  LEGACY_VOLUME_ENV="ABUD_POSTGRES_VOLUME=${ABUD_COMPOSE_PROJECT}_abud-shorts-postgres-data ABUD_N8N_VOLUME=${ABUD_COMPOSE_PROJECT}_abud-shorts-n8n-data ABUD_NETWORK=${ABUD_COMPOSE_PROJECT}_abud-shorts-v2"
fi
env $LEGACY_VOLUME_ENV \
  SHORT_STUDIO_DATA_DIR="$ABUD_DATA_DIR" ABUD_DATA_DIR="$ABUD_DATA_DIR" \
  SHORT_STUDIO_RELEASE_DIR="$RELEASE_DIR" ABUD_RELEASE_DIR="$RELEASE_DIR" \
  SHORT_STUDIO_CONTAINER_PREFIX="$ABUD_COMPOSE_PROJECT" ABUD_CONTAINER_PREFIX="$ABUD_COMPOSE_PROJECT" \
docker compose \
  --project-name "$ABUD_COMPOSE_PROJECT" \
  --env-file "$ABUD_ENV_FILE" \
  --file "$RELEASE_DIR/docker-compose.prod.yml" \
  up -d --remove-orphans

# The operator command. After this the customer never needs a Docker command.
# short-studio is canonical; abud-shorts is kept working as a legacy alias for
# an installation upgraded from ABUD Shorts Engine 2.4, but is not advertised.
install -m 0755 "$RELEASE_DIR/scripts/host/short-studio.sh" /usr/local/bin/short-studio 2>/dev/null || {
  echo "      Note: /usr/local/bin is not writable, so the 'short-studio' command was not installed."
  echo "      Run it from: $ABUD_CURRENT/scripts/host/short-studio.sh"
}
install -m 0755 "$RELEASE_DIR/scripts/host/abud-shorts.sh" /usr/local/bin/abud-shorts 2>/dev/null || true

echo "[9/9] Waiting for the system to become ready..."
READY=false
for attempt in $(seq 1 90); do
  if curl -fsS --max-time 5 "http://127.0.0.1:$HOST_PORT/health/ready" >/dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 2
done

# ---------------------------------------------------------------------------
# Health summary
# ---------------------------------------------------------------------------
health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo missing
}
friendly() {
  case "$1" in healthy|running) echo "Healthy" ;; starting) echo "Starting" ;; *) echo "Problem" ;; esac
}

echo ""
echo "================================================================="
if [ "$READY" = true ]; then
  echo "  Short Studio Server $RELEASE_VERSION is installed and running"
else
  echo "  Short Studio Server $RELEASE_VERSION is installed"
fi
if [ -n "$PREVIOUS_PRODUCT_VALUE" ]; then
  echo "  Upgraded from $PREVIOUS_PRODUCT_VALUE"
fi
echo "================================================================="
echo ""
echo "  Short Studio:  $([ "$READY" = true ] && echo Healthy || echo "Still starting")"
echo "  Application:   $(friendly "$(health "$ABUD_COMPOSE_PROJECT-app")")"
echo "  Video Engine:  $(friendly "$(health "$ABUD_COMPOSE_PROJECT-render-worker")")"
echo "  Database:      $(friendly "$(health "$ABUD_COMPOSE_PROJECT-postgres")")"
echo "  Automation:    $(friendly "$(health "$ABUD_COMPOSE_PROJECT-n8n")")"
echo "  URL:           $PUBLIC_URL"
echo ""
echo "  Next step - open this address and create your administrator account:"
echo "      $PUBLIC_URL/setup"
echo ""
echo "  Day-to-day commands:"
echo "      short-studio status      Health and version"
echo "      short-studio update      Install the latest version, safely"
echo "      short-studio backup      Create a backup now"
echo ""
if [ "$READY" != true ]; then
  echo "  The system is taking longer than usual to start. Check it with:"
  echo "      short-studio status"
  echo ""
fi
