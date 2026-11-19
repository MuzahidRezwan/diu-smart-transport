#!/usr/bin/env bash
# Restore an encrypted backup made by backup-db.sh.
#
#   scripts/restore-db.sh backups/diu_transport_2026-11-19_0230.dump.gpg            # into a scratch database (drill)
#   scripts/restore-db.sh backups/diu_transport_2026-11-19_0230.dump.gpg --live     # over the live database
#
# Run the drill once a month: a backup that has never been restored is not a backup.
# Needs the backup private key in this machine's gpg keyring.
set -euo pipefail
cd "$(dirname "$0")/.."

file="${1:?usage: restore-db.sh <backup.dump.gpg> [--live]}"
target="diu_transport_restore_test"
if [ "${2:-}" = "--live" ]; then
  target="diu_transport"
  read -r -p "This replaces the LIVE database. Stop api and jobs first. Type RESTORE to continue: " answer
  [ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
fi

psql() { docker compose exec -T postgres psql -U diu -v ON_ERROR_STOP=1 "$@"; }
psql -d postgres -c "DROP DATABASE IF EXISTS \"$target\" WITH (FORCE);"
psql -d postgres -c "CREATE DATABASE \"$target\";"

# With the least-privilege roles, the new database needs roles.sql again (its
# database-level grants and default privileges), and the tables must belong to
# diu_migrator so the API can keep migrating and granting.
owner=()
if [ "$(psql -d postgres -At -c "select count(*) from pg_roles where rolname = 'diu_migrator'")" = "1" ]; then
  psql -d "$target" -q -f - < apps/api/drizzle/roles.sql
  owner=(--role=diu_migrator)
fi

gpg --batch --decrypt "$file" \
  | docker compose exec -T postgres pg_restore -U diu -d "$target" --no-owner "${owner[@]}" --exit-on-error

# Restored tables pick up the default privileges, which are wider than the
# real grants (e.g. DELETE on audit_logs for diu_app). Put the real ones back now
# instead of waiting for the next API start.
if [ "${#owner[@]}" -gt 0 ]; then
  psql -d "$target" -q -f - < apps/api/drizzle/grants.sql
fi

psql -d "$target" -At -c \
  "select 'users=' || count(*) from users union all select 'payments=' || count(*) from payments union all select 'audit_logs=' || count(*) from audit_logs;"
echo "restored into $target"
