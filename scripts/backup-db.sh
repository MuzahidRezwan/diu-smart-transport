#!/usr/bin/env bash
# Encrypted backup of the docker-compose database.
#
#   BACKUP_GPG_RECIPIENT=<key id> scripts/backup-db.sh
#
# Host cron, every night at 02:30 Dhaka time:
#   30 2 * * * cd /srv/diu-transport && BACKUP_GPG_RECIPIENT=transport-backup scripts/backup-db.sh >> /var/log/diu-backup.log 2>&1
#
# The dump holds personal data and payments, so it is encrypted to a public
# key before it touches the disk; the private key is kept offline by IT.
# Keeps 14 days here. Copy backups/ to off-site storage with your own tool.
set -euo pipefail
umask 077   # backups are readable by this user only
cd "$(dirname "$0")/.."

: "${BACKUP_GPG_RECIPIENT:?set BACKUP_GPG_RECIPIENT to the backup public key ID}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p backups
chmod 700 backups
out="backups/diu_transport_$(date +%Y-%m-%d_%H%M).dump.gpg"

docker compose exec -T postgres pg_dump -U diu -d diu_transport --format=custom \
  | gpg --batch --yes --trust-model always --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$out"

# An almost empty file means pg_dump wrote nothing useful.
if [ "$(wc -c < "$out")" -lt 1024 ]; then
  echo "backup FAILED: $out is too small" >&2
  exit 1
fi

find backups -name 'diu_transport_*.dump.gpg' -mtime +"$KEEP_DAYS" -delete
echo "backup ok: $out ($(du -h "$out" | cut -f1))"
