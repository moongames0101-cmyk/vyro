#!/bin/sh
# Starts the online VYRO server (used by the Dockerfile on Render).
#
# With the BACKUP_* variables set, Litestream first brings the database back
# from Backblaze B2 (if this is a fresh start), then runs VYRO and copies every
# change to the bucket while it runs. Without them, VYRO runs on its own and
# everything is lost the next time the server restarts.
set -eu

export VYRO_DATA_DIR="${VYRO_DATA_DIR:-/app/data}"
mkdir -p "$VYRO_DATA_DIR"
cd "$(dirname "$0")/.."

BACKUP_BUCKET="${BACKUP_BUCKET:-}"
BACKUP_ENDPOINT="${BACKUP_ENDPOINT:-}"
BACKUP_KEY_ID="${BACKUP_KEY_ID:-}"
BACKUP_APP_KEY="${BACKUP_APP_KEY:-}"

if [ -z "${VYRO_SECRET:-}" ]; then
  echo "WARNING: VYRO_SECRET is not set, so everyone gets signed out whenever the server restarts."
fi

if [ -z "$BACKUP_BUCKET" ] || [ -z "$BACKUP_ENDPOINT" ] || [ -z "$BACKUP_KEY_ID" ] || [ -z "$BACKUP_APP_KEY" ]; then
  echo "WARNING: backups are off. Set BACKUP_BUCKET, BACKUP_ENDPOINT, BACKUP_KEY_ID and BACKUP_APP_KEY,"
  echo "         or every account and message is lost the next time the server restarts."
  exec node server/index.js
fi

# Backblaze shows the endpoint as "s3.<region>.backblazeb2.com"; Litestream wants https:// in front.
case "$BACKUP_ENDPOINT" in
  http://*|https://*) ;;
  *) BACKUP_ENDPOINT="https://$BACKUP_ENDPOINT" ;;
esac
BACKUP_ENDPOINT="${BACKUP_ENDPOINT%/}"

# The region is the middle part of a Backblaze endpoint, e.g. eu-central-003.
if [ -z "${BACKUP_REGION:-}" ]; then
  BACKUP_REGION="$(printf '%s' "$BACKUP_ENDPOINT" | sed -n 's#^https\{0,1\}://s3\.\([^.]*\)\.backblazeb2\.com.*#\1#p')"
fi
BACKUP_REGION="${BACKUP_REGION:-us-east-1}"

export BACKUP_BUCKET BACKUP_ENDPOINT BACKUP_REGION BACKUP_KEY_ID BACKUP_APP_KEY

echo "Backups on: bucket $BACKUP_BUCKET at $BACKUP_ENDPOINT ($BACKUP_REGION)"
exec litestream replicate -config deploy/litestream.yml -restore-if-db-not-exists -exec "node server/index.js"
