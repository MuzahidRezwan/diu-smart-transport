#!/bin/sh
# Runs once, when the postgres volume is first created (official postgres image
# runs everything in /docker-entrypoint-initdb.d). Creates the least-privilege
# roles from apps/api/drizzle/roles.sql and sets their passwords from .env.
set -eu

: "${MIGRATOR_DB_PASSWORD:?}" "${APP_DB_PASSWORD:?}" "${ADMIN_DB_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /roles.sql

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v mig="$MIGRATOR_DB_PASSWORD" -v app="$APP_DB_PASSWORD" -v adm="$ADMIN_DB_PASSWORD" <<'SQL'
ALTER ROLE diu_migrator PASSWORD :'mig';
ALTER ROLE diu_app PASSWORD :'app';
ALTER ROLE transport_admin PASSWORD :'adm';
SQL
