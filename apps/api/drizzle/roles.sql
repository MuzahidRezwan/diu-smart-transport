-- Production database roles. Run once as a superuser AFTER migrations
-- (not part of the automatic migrations, because managed Postgres providers
-- handle roles differently). Passwords are set out of band, never in git.
--
--   psql "$SUPERUSER_URL" -v app_db=diu_transport -f drizzle/roles.sql
--
-- diu_app          rider-facing API code (DATABASE_URL)
-- transport_admin  authority dashboard code (ADMIN_DATABASE_URL): no access to user_profiles
-- diu_migrator     runs migrations (DDL)
-- diu_reporting    read-only reporting replica

CREATE ROLE diu_app LOGIN;
CREATE ROLE transport_admin LOGIN;
CREATE ROLE diu_migrator LOGIN;
CREATE ROLE diu_reporting LOGIN;

GRANT USAGE ON SCHEMA public TO diu_app, transport_admin, diu_reporting;

-- Rider-facing code: everything except changing history.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO diu_app;
REVOKE UPDATE, DELETE ON audit_logs FROM diu_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO diu_app;

-- Authority code: transport-owned tables only.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  operators, buses, bus_unavailability, routes, route_stops, time_slots,
  allocations, allocation_buses, predictions, routine_sources, routine_versions, class_sessions,
  fee_rules, semesters, calendar_events, transport_cards, day_passes, notices,
  tickets, ticket_messages, settings, admin_accounts, refresh_tokens, auth_handoffs, gps_pings
TO transport_admin;
GRANT SELECT, UPDATE ON payments TO transport_admin;
GRANT SELECT ON boarding_events, transport_riders TO transport_admin;
GRANT SELECT, INSERT ON audit_logs TO transport_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO transport_admin;
-- Identity columns only (needed for names on payment reports and the co-admin list).
GRANT SELECT (id, university_id, name, role, category, home_route_id, is_active) ON users TO transport_admin;
GRANT INSERT (university_id, name, role, is_active) ON users TO transport_admin;
-- Deliberately nothing on user_profiles or device_tokens.
REVOKE ALL ON user_profiles, device_tokens FROM transport_admin;

-- Reporting: aggregates and the privacy view only.
GRANT SELECT ON allocations, allocation_buses, predictions, boarding_events, payments, routes, time_slots, buses, transport_riders TO diu_reporting;
