#!/usr/bin/env bash
# ==============================================================================
# Short Studio Server - online updater (host side)
# ==============================================================================
# Invoked by `short-studio update` (or the legacy `abud-shorts update` alias).
# Never called by the web application: applying
# an update requires Docker control, and the application container is
# deliberately not given the Docker socket.
#
# The sequence, in order, and what protects the customer at each point:
#
#    1 acquire the update lock          two updaters never race
#    2 read the installed version       from the installation record
#    3 check free disk space            a half-pulled image is a failed update
#    4 verify the Docker daemon
#    5 fetch the release manifest       a published release asset only
#    6 validate channel and version     stable clients stay on stable
#    7 download the client package and pull the image by digest
#    8 verify SHA-256 and image digest  nothing unverified is ever executed
#    9 create a pre-upgrade backup      database plus configuration
#   10 record the previous version      so rollback has a target
#   11 stop only app and render worker  PostgreSQL and n8n keep their data hot
#   12 switch `current` to the new release
#   13 start, which runs the migrations
#   14 wait for /health/live
#   15 wait for /health/ready
#   16 verify the reported version
#   17 verify the reported schema version
#   18 verify render worker health
#   19 mark the update successful
#   20 keep rollback metadata
#
# Any failure from step 11 onwards triggers rollback. There is no `down -v`, no
# volume removal and no prune anywhere in this file.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./abud-lib.sh
. "$SCRIPT_DIR/abud-lib.sh"

CHECK_ONLY=false
TARGET_VERSION=""
ASSUME_YES=false

while [ $# -gt 0 ]; do
  case "$1" in
    --check|--check-only) CHECK_ONLY=true; shift ;;
    --version) TARGET_VERSION="${2:-}"; shift 2 ;;
    --version=*) TARGET_VERSION="${1#*=}"; shift ;;
    --yes|-y) ASSUME_YES=true; shift ;;
    *) die "Unknown option: $1" ;;
  esac
done

MANIFEST_URL="${SHORT_STUDIO_UPDATE_MANIFEST_URL:-${ABUD_UPDATE_MANIFEST_URL:-$DEFAULT_MANIFEST_URL}}"
CHANNEL="${SHORT_STUDIO_RELEASE_CHANNEL:-${ABUD_RELEASE_CHANNEL:-stable}}"

require_docker
require_jq

# ---------------------------------------------------------------------------
# 5. Fetch the release manifest
# ---------------------------------------------------------------------------
WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
  release_update_lock
}
trap cleanup EXIT

step "Checking for updates..."
MANIFEST_FILE="$WORK_DIR/update-manifest.json"
curl -fsSL --max-time 30 --retry 2 -o "$MANIFEST_FILE" "$MANIFEST_URL" ||
  die "Could not reach the update service. Check this machine's internet connection and try again."

jq -e . "$MANIFEST_FILE" >/dev/null 2>&1 ||
  die "The update manifest is not valid JSON. Nothing has been changed."

# 6. Select the release for this installation's channel. Both manifest shapes
# are accepted: a single release entry, or a channel map.
RELEASE="$(jq -c --arg ch "$CHANNEL" '
  if has("channels") then (.channels[$ch] // empty)
  elif (.channel == $ch) then .
  else empty end' "$MANIFEST_FILE")"

[ -n "$RELEASE" ] ||
  die "No $CHANNEL release is published yet."

field() { jq -r --arg f "$1" '.[$f] // empty' <<<"$RELEASE"; }

REL_PRODUCT="$(field product)"
REL_CHANNEL="$(field channel)"
REL_VERSION="$(field version)"
REL_SCHEMA="$(field schemaVersion)"
REL_IMAGE="$(field image)"
REL_DIGEST="$(field imageDigest)"
REL_PACKAGE_URL="$(field packageUrl)"
REL_PACKAGE_SHA="$(field packageSha256)"
REL_MIN_UPDATER="$(field minimumUpdaterVersion)"
REL_NOTES="$(field releaseUrl)"
REL_SCHEMA_COMPATIBLE="$(jq -r '.schemaBackwardsCompatible // false' <<<"$RELEASE")"

# Every field the updater acts on must be present and well formed. A truncated
# or hand-edited manifest is rejected before anything is stopped.
# Accepts either the current or the pre-rebrand product label: a manifest
# published right after the 2.5.0 cutover must still be installable by an
# ABUD Shorts Engine 2.4 install whose own updater has not run this file yet.
[ "$REL_PRODUCT" = "Short Studio Server" ] || [ "$REL_PRODUCT" = "ABUD Shorts Engine" ] ||
  die "The manifest does not describe this product."
[ "$REL_CHANNEL" = "$CHANNEL" ] || die "The published release is not on the $CHANNEL channel. Nothing has been changed."
printf '%s' "$REL_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || die "The manifest carries an invalid version."
printf '%s' "$REL_DIGEST" | grep -Eq '^sha256:[a-f0-9]{64}$' || die "The manifest carries an invalid image digest."
printf '%s' "$REL_PACKAGE_SHA" | grep -Eq '^[a-fA-F0-9]{64}$' || die "The manifest carries an invalid package checksum."
[ -n "$REL_IMAGE" ] && [ -n "$REL_PACKAGE_URL" ] || die "The manifest is missing the release artifacts."

# ---------------------------------------------------------------------------
# 2. Installed version
# ---------------------------------------------------------------------------
CURRENT_VERSION="$(installed_version)"
if [ -z "$CURRENT_VERSION" ]; then
  CURRENT_VERSION="$(running_version)"
fi
[ -n "$CURRENT_VERSION" ] ||
  die "Could not determine the installed version. Run 'short-studio status' first."

# Numeric semver comparison. String comparison would rank 2.10.0 below 2.9.0 and
# offer the customer a downgrade.
version_gt() {
  # version_gt A B  -> true when A is strictly newer than B
  local a="${1%%-*}" b="${2%%-*}"
  local a1 a2 a3 b1 b2 b3
  IFS=. read -r a1 a2 a3 <<<"$a"
  IFS=. read -r b1 b2 b3 <<<"$b"
  a1=${a1:-0}; a2=${a2:-0}; a3=${a3:-0}
  b1=${b1:-0}; b2=${b2:-0}; b3=${b3:-0}
  if [ "$a1" -ne "$b1" ]; then [ "$a1" -gt "$b1" ]; return; fi
  if [ "$a2" -ne "$b2" ]; then [ "$a2" -gt "$b2" ]; return; fi
  if [ "$a3" -ne "$b3" ]; then [ "$a3" -gt "$b3" ]; return; fi
  # Equal release numbers: a build without a pre-release tag outranks one with.
  local apre="" bpre=""
  case "$1" in *-*) apre="${1#*-}" ;; esac
  case "$2" in *-*) bpre="${2#*-}" ;; esac
  [ -z "$apre" ] && [ -n "$bpre" ]
}

# 25. A version-pinned update must still come from the trusted manifest.
if [ -n "$TARGET_VERSION" ] && [ "$TARGET_VERSION" != "$REL_VERSION" ]; then
  die "Version $TARGET_VERSION is not the version published on the $CHANNEL channel ($REL_VERSION). Only published releases can be installed."
fi

echo ""
echo "  Installed version: $CURRENT_VERSION"
echo "  Latest version:    $REL_VERSION ($CHANNEL)"
echo "  Release notes:     $REL_NOTES"
echo ""

if ! version_gt "$REL_VERSION" "$CURRENT_VERSION"; then
  ok "You are already running the latest version."
  exit 0
fi

if ! version_gt "$CURRENT_VERSION" "$REL_MIN_UPDATER" && [ "$CURRENT_VERSION" != "$REL_MIN_UPDATER" ]; then
  die "Version $REL_VERSION cannot be installed directly from $CURRENT_VERSION. Install $REL_MIN_UPDATER first."
fi

if [ "$CHECK_ONLY" = true ]; then
  ok "An update is available: $REL_VERSION"
  echo "  Install it with: sudo short-studio update"
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Lock, and 23. interrupted-run recovery
# ---------------------------------------------------------------------------
require_root_for_write
acquire_update_lock

PREVIOUS_STATE="$(current_transaction_state)"
if [ -n "$PREVIOUS_STATE" ]; then
  warn "A previous update stopped in state $PREVIOUS_STATE without finishing."
  PREV_TO="$(current_transaction_field toVersion)"
  PREV_BACKUP="$(current_transaction_field backupId)"
  echo "    Interrupted update: ${PREV_TO:-unknown version}"
  [ -n "$PREV_BACKUP" ] && echo "    Its pre-upgrade backup is kept as: $PREV_BACKUP"
  echo "    This run starts a fresh, verified update and finishes with a health check."
  echo "    If it fails, the installation is rolled back to $CURRENT_VERSION."
  if [ "$ASSUME_YES" != true ] && [ -t 0 ]; then
    read -r -p "  Continue? [y/N] " reply
    case "$reply" in y|Y|yes|YES) ;; *) die "Cancelled. Nothing has been changed." ;; esac
  fi
fi

ABUD_TXN_ID="upd_$(date -u +%Y%m%d%H%M%S)_$$"
ABUD_TXN_CHANNEL="$CHANNEL"
ABUD_TXN_FROM="$CURRENT_VERSION"
ABUD_TXN_TO="$REL_VERSION"
ABUD_TXN_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export ABUD_TXN_ID ABUD_TXN_CHANNEL ABUD_TXN_FROM ABUD_TXN_TO ABUD_TXN_STARTED

txn_set schemaVersion "$REL_SCHEMA"
txn_set imageDigest "$REL_DIGEST"
txn_set packageSha256 "$REL_PACKAGE_SHA"
write_transaction PREPARING

# ---------------------------------------------------------------------------
# 3. Disk space
# ---------------------------------------------------------------------------
step "[1/9] Checking this machine..."
AVAILABLE_GB=$(( $(df -Pk "$ABUD_HOME" | awk 'NR==2 {print $4}') / 1024 / 1024 ))
if [ "$AVAILABLE_GB" -lt 8 ]; then
  txn_set error "Not enough free disk space (${AVAILABLE_GB} GB available, 8 GB required)."
  write_transaction FAILED
  die "Not enough free disk space: ${AVAILABLE_GB} GB available, at least 8 GB is needed to install an update. Nothing has been changed."
fi
ok "Docker is running and there is ${AVAILABLE_GB} GB free."

# ---------------------------------------------------------------------------
# 7 + 8. Download and verify BEFORE anything is stopped
# ---------------------------------------------------------------------------
step "[2/9] Downloading version $REL_VERSION..."
PACKAGE_FILE="$WORK_DIR/package.tar.gz"
curl -fsSL --max-time 900 --retry 2 -o "$PACKAGE_FILE" "$REL_PACKAGE_URL" || {
  txn_set error "The release package could not be downloaded."
  write_transaction FAILED
  die "The update could not be downloaded. Nothing has been changed."
}

step "[3/9] Verifying the download..."
verify_sha256 "$PACKAGE_FILE" "$REL_PACKAGE_SHA"
ok "Checksum verified."

# Pulling by digest rather than by tag is what makes the image immutable: a tag
# can be moved, a digest cannot.
# Strip the tag, and only the tag. A registry host may carry a port
# (registry.example.com:5000/abud/app:2.2.1), and that colon does not introduce
# a tag - cutting at the first colon would turn the reference into the bare
# hostname and the pull would fail.
image_repository() {
  local reference="$1"
  local suffix="${reference##*:}"
  if [ "$suffix" = "$reference" ]; then
    printf '%s' "$reference"          # no colon at all
  elif [ "${suffix#*/}" != "$suffix" ]; then
    printf '%s' "$reference"          # the colon was a port, not a tag
  else
    printf '%s' "${reference%:*}"
  fi
}

IMAGE_REPO="$(image_repository "$REL_IMAGE")"
PINNED_IMAGE="${IMAGE_REPO}@${REL_DIGEST}"
docker pull --quiet "$PINNED_IMAGE" >/dev/null || {
  txn_set error "The application image could not be downloaded."
  write_transaction FAILED
  die "The application image could not be downloaded. Nothing has been changed."
}

PULLED_DIGEST="$(docker image inspect --format '{{.Id}}' "$PINNED_IMAGE" 2>/dev/null || true)"
[ -n "$PULLED_DIGEST" ] || {
  txn_set error "The downloaded image could not be inspected."
  write_transaction FAILED
  die "The downloaded application image could not be verified. Nothing has been changed."
}
ok "Application image verified by digest."

# The package must look like a client package, not an arbitrary archive.
EXTRACT_DIR="$WORK_DIR/extract"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$PACKAGE_FILE" -C "$EXTRACT_DIR" || {
  txn_set error "The release package could not be extracted."
  write_transaction FAILED
  die "The downloaded update could not be opened. Nothing has been changed."
}
PACKAGE_ROOT="$EXTRACT_DIR"
if [ "$(find "$EXTRACT_DIR" -maxdepth 1 -mindepth 1 -type d | wc -l)" = "1" ] &&
   [ "$(find "$EXTRACT_DIR" -maxdepth 1 -mindepth 1 | wc -l)" = "1" ]; then
  PACKAGE_ROOT="$(find "$EXTRACT_DIR" -maxdepth 1 -mindepth 1 -type d)"
fi
for required in docker-compose.prod.yml scripts/host/short-studio.sh; do
  [ -e "$PACKAGE_ROOT/$required" ] || {
    txn_set error "The release package is missing $required."
    write_transaction FAILED
    die "The downloaded update is not a valid Short Studio client package. Nothing has been changed."
  }
done
ok "Package contents verified."

# ---------------------------------------------------------------------------
# 9. Pre-upgrade backup
# ---------------------------------------------------------------------------
step "[4/9] Creating a safety backup..."
BACKUP_ID="pre-upgrade-${CURRENT_VERSION}-to-${REL_VERSION}-$(date -u +%Y%m%d%H%M%S)"
if BACKUP_PATH="$(create_pre_upgrade_backup "$BACKUP_ID")"; then
  ok "Backup saved: $(basename "$BACKUP_PATH")"
  txn_set backupId "$BACKUP_ID"
  write_transaction BACKED_UP
else
  txn_set error "The pre-upgrade backup could not be created."
  write_transaction FAILED
  die "A safety backup could not be created, so the update was stopped. Nothing has been changed."
fi

# ---------------------------------------------------------------------------
# 10-12. Switch version
# ---------------------------------------------------------------------------
step "[5/9] Installing version $REL_VERSION..."
PREVIOUS_RELEASE_DIR="$(readlink -f "$ABUD_CURRENT" 2>/dev/null || true)"
PREVIOUS_IMAGE="$(installation_field image)"
# The version that preceded the one running now. Kept so a rollback can restore
# the record exactly as it was, rather than leaving `short-studio rollback` with
# no target even though that release is still on disk.
PRIOR_VERSION="$(previous_version)"
NEW_RELEASE_DIR="$ABUD_RELEASES/$REL_VERSION"

rm -rf "$NEW_RELEASE_DIR.incoming"
mkdir -p "$NEW_RELEASE_DIR.incoming"
cp -R "$PACKAGE_ROOT/." "$NEW_RELEASE_DIR.incoming/"
rm -rf "$NEW_RELEASE_DIR"
mv "$NEW_RELEASE_DIR.incoming" "$NEW_RELEASE_DIR"
chmod +x "$NEW_RELEASE_DIR"/scripts/host/*.sh 2>/dev/null || true

# Each release directory records the exact image it runs, so `short-studio
# rollback` can restore a version without consulting the network.
jq -n \
  --arg version "$REL_VERSION" \
  --arg image "$PINNED_IMAGE" \
  --arg digest "$REL_DIGEST" \
  --arg schemaVersion "$REL_SCHEMA" \
  --arg channel "$CHANNEL" \
  --arg installedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson schemaBackwardsCompatible "$REL_SCHEMA_COMPATIBLE" \
  '{version: $version, image: $image, imageDigest: $digest, schemaVersion: $schemaVersion,
    channel: $channel, installedAt: $installedAt,
    schemaBackwardsCompatible: $schemaBackwardsCompatible}' \
  > "$NEW_RELEASE_DIR/release.json"

write_transaction APPLYING

# Only the two services whose image changes are stopped. PostgreSQL and n8n keep
# running, so no data volume is detached at any point.
compose stop short-studio-app short-studio-render-worker >/dev/null 2>&1 || true

# The image reference lives in the environment file, so a rollback is a matter of
# putting the previous value back.
set_env_value() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$ABUD_ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ABUD_ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ABUD_ENV_FILE"
  fi
}
set_env_value SHORT_STUDIO_IMAGE "$PINNED_IMAGE"
set_env_value ABUD_IMAGE "$PINNED_IMAGE"

ln -sfn "$NEW_RELEASE_DIR" "$ABUD_CURRENT"
write_installation_record "$REL_VERSION" "$CURRENT_VERSION" "$PINNED_IMAGE" "$CHANNEL"

# ---------------------------------------------------------------------------
# Rollback, used by every failure path below
# ---------------------------------------------------------------------------
rollback() {
  local reason="$1"
  fail "$reason"
  step "[!] Rolling back to version $CURRENT_VERSION..."
  write_transaction ROLLING_BACK

  local db_restored=false rollback_result="failed"

  if [ -n "$PREVIOUS_RELEASE_DIR" ] && [ -d "$PREVIOUS_RELEASE_DIR" ]; then
    ln -sfn "$PREVIOUS_RELEASE_DIR" "$ABUD_CURRENT"
  fi
  if [ -n "$PREVIOUS_IMAGE" ]; then
    set_env_value SHORT_STUDIO_IMAGE "$PREVIOUS_IMAGE"
    set_env_value ABUD_IMAGE "$PREVIOUS_IMAGE"
  fi
  write_installation_record "$CURRENT_VERSION" "${PRIOR_VERSION:-}" "${PREVIOUS_IMAGE:-}" "$CHANNEL"

  # A release whose migrations are not backwards compatible cannot be undone by
  # putting the old code back: the old application would meet a schema it does
  # not understand. In that case the pre-upgrade database snapshot is restored
  # as well, and that fact is recorded rather than glossed over.
  if [ "$REL_SCHEMA_COMPATIBLE" != "true" ]; then
    warn "This release changed the database in a way the previous version cannot read."
    step "    Restoring the pre-upgrade database backup..."
    compose stop short-studio-app short-studio-render-worker >/dev/null 2>&1 || true
    if restore_pre_upgrade_backup "$BACKUP_ID"; then
      db_restored=true
      ok "Database restored from the pre-upgrade backup."
    else
      fail "The database could not be restored automatically."
    fi
  fi

  compose up -d >/dev/null 2>&1 || true

  if wait_for_endpoint "$(app_base_url)/health/ready" 60 "Short Studio"; then
    rollback_result="succeeded"
    ok "Rolled back to version $CURRENT_VERSION and the system is healthy again."
    # Same reason as after a successful update: Docker re-runs its own
    # healthcheck on an interval, so without this the summary below can report a
    # Problem on an installation that has in fact just been restored and
    # answered /health/ready.
    wait_for_container_settle
  else
    fail "Rollback finished but the system is not reporting healthy."
  fi

  txn_set error "$reason"
  txn_set_json rollback "$(jq -c -n \
    --arg result "$rollback_result" \
    --arg restoredVersion "$CURRENT_VERSION" \
    --argjson databaseRestored "$db_restored" \
    --arg message "$reason" \
    '{attempted: true, result: $result, restoredVersion: $restoredVersion,
      databaseRestored: $databaseRestored, message: $message}')"
  write_transaction ROLLED_BACK

  print_health_summary || true
  echo "  A safety backup of the state before this update is kept as: $BACKUP_ID"
  echo "  Support bundle: Settings -> System -> Download Support Bundle"
  exit 1
}

# ---------------------------------------------------------------------------
# 13. Start with migrations
# ---------------------------------------------------------------------------
step "[6/9] Starting version $REL_VERSION..."
compose up -d >/dev/null 2>&1 ||
  rollback "Version $REL_VERSION could not be started."

write_transaction VERIFYING

# ---------------------------------------------------------------------------
# 14-15. Health
# ---------------------------------------------------------------------------
step "[7/9] Waiting for the system to come back..."
wait_for_endpoint "$(app_base_url)/health/live" 90 "Short Studio" ||
  rollback "Version $REL_VERSION never finished starting."
wait_for_endpoint "$(app_base_url)/health/ready" 90 "Short Studio" ||
  rollback "Version $REL_VERSION started but never became ready."
ok "The application is live and ready."

# ---------------------------------------------------------------------------
# 16-17. Version and schema verification
# ---------------------------------------------------------------------------
step "[8/9] Verifying the installed version..."
REPORTED_VERSION="$(running_version)"
[ "$REPORTED_VERSION" = "$REL_VERSION" ] ||
  rollback "The system reports version ${REPORTED_VERSION:-unknown} after the update, not $REL_VERSION."

REPORTED_SCHEMA="$(running_schema_version)"
[ "$REPORTED_SCHEMA" = "$REL_SCHEMA" ] ||
  rollback "The database schema reports ${REPORTED_SCHEMA:-unknown} after the update, not $REL_SCHEMA."
ok "Version $REL_VERSION and database schema $REL_SCHEMA confirmed."

# ---------------------------------------------------------------------------
# 18. Worker health
# ---------------------------------------------------------------------------
step "[9/9] Verifying the video engine..."
WORKER_ATTEMPTS=0
while [ "$WORKER_ATTEMPTS" -lt 45 ]; do
  WORKER_ATTEMPTS=$((WORKER_ATTEMPTS + 1))
  case "$(container_health "$(container_name render-worker)")" in
    healthy) break ;;
    missing) rollback "The video engine is not running after the update." ;;
  esac
  sleep 2
done
[ "$(container_health "$(container_name render-worker)")" = "healthy" ] ||
  rollback "The video engine did not become healthy after the update."
ok "Video engine healthy."

# The application answered /health/ready several steps ago, but Docker only
# re-runs its own healthcheck on an interval, so the container can still be
# marked "starting" here. Without this wait the success banner prints
# "Short Studio: Problem" immediately after a verified successful update, which
# reads as a failure to the operator.
wait_for_container_settle

# ---------------------------------------------------------------------------
# 19-20. Success
# ---------------------------------------------------------------------------
txn_set_json rollback '{"attempted": false, "result": "not_required"}'
write_transaction SUCCESS

echo ""
echo "================================================================="
echo "  Short Studio Server updated to version $REL_VERSION"
echo "================================================================="
print_health_summary || true
echo "  Previous version $CURRENT_VERSION is kept for rollback:"
echo "      sudo short-studio rollback"
echo "  Pre-update backup: $BACKUP_ID"
echo ""
