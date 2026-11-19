-- Privacy boundary: what the transport office may see about a rider.
-- No phone, email, department, batch, section, teacher initial or photo.
CREATE VIEW "transport_riders" AS
SELECT
  u."id" AS "user_id",
  u."university_id",
  u."name",
  u."role" AS "rider_type",
  u."category",
  r."name" AS "home_route",
  COALESCE((
    SELECT c."status"::text
    FROM "transport_cards" c
    JOIN "semesters" s ON s."id" = c."semester_id" AND s."is_current"
    WHERE c."user_id" = u."id"
    LIMIT 1
  ), 'none') AS "card_status"
FROM "users" u
LEFT JOIN "routes" r ON r."id" = u."home_route_id"
WHERE u."role" IN ('student', 'faculty', 'staff');
--> statement-breakpoint
-- The audit log is append-only, enforced by the database itself.
CREATE FUNCTION "audit_logs_block_changes"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_logs_no_update" BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_changes"();
