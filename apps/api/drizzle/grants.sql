-- Table grants for the production roles (see roles.sql).
-- The API runs this after every migration run, as the table owner, and only
-- when the roles exist (they do not in development or tests). Idempotent.

-- Rider-facing code: everything except changing history.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO diu_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM diu_app;
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
-- users holds identity only (no contact or academic data). The office reads
-- these columns for names on reports and lists (last_login_at for the co-admin
-- list), adds people when it grants free access or creates a co-admin, and sets
-- the home route on a granted card.
GRANT SELECT (id, university_id, name, role, category, home_route_id, is_active, last_login_at) ON users TO transport_admin;
GRANT INSERT ON users TO transport_admin;
GRANT UPDATE (home_route_id) ON users TO transport_admin;
-- Deliberately nothing on user_profiles or device_tokens.
REVOKE ALL ON user_profiles, device_tokens FROM transport_admin;

-- Reporting: aggregates and the privacy view only.
GRANT SELECT ON allocations, allocation_buses, predictions, boarding_events, payments, routes, time_slots, buses, transport_riders TO diu_reporting;
