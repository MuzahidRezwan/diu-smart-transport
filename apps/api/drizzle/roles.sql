-- Production database roles. Run as a superuser, connected to the app database,
-- BEFORE the first migration. Safe to run again (it skips what already exists).
-- Passwords are set out of band (\password in psql, or the provider's console), never in git.
--
--   psql "postgres://<superuser>@<host>/diu_transport" -f drizzle/roles.sql
--
-- diu_migrator     owns the schema and runs migrations      (MIGRATION_DATABASE_URL)
-- diu_app          rider-facing API code                    (DATABASE_URL)
-- transport_admin  authority dashboard code                 (ADMIN_DATABASE_URL), never sees user_profiles
-- diu_reporting    read-only reporting
--
-- Table-level grants are in grants.sql. The API applies that file after every
-- migration run, so new tables never depend on someone remembering a script.
--
-- Managed Postgres (RDS, Cloud SQL, …): the admin user is not a true superuser.
-- Run "GRANT diu_migrator TO <admin user>;" after the roles exist, or
-- ALTER DEFAULT PRIVILEGES below is refused.

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['diu_migrator', 'diu_app', 'transport_admin', 'diu_reporting'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN', r);
    END IF;
  END LOOP;
  -- The migrator creates the "drizzle" bookkeeping schema and every table, so it owns them.
  EXECUTE format('GRANT CREATE ON DATABASE %I TO diu_migrator', current_database());
END $$;

GRANT USAGE, CREATE ON SCHEMA public TO diu_migrator;
GRANT USAGE ON SCHEMA public TO diu_app, transport_admin, diu_reporting;

-- Tables the migrator creates later are open to rider-facing code at once.
-- The authority role gets nothing by default: deny unless grants.sql says so.
ALTER DEFAULT PRIVILEGES FOR ROLE diu_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO diu_app;
ALTER DEFAULT PRIVILEGES FOR ROLE diu_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO diu_app;
