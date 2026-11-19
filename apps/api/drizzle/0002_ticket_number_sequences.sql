CREATE SEQUENCE "public"."ticket_complaint_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."ticket_help_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;--> statement-breakpoint
-- Continue after numbers already given out by the old count-based numbering.
SELECT setval('ticket_complaint_seq', COALESCE((SELECT max(substring("number" from 3)::int) FROM "tickets" WHERE "number" ~ '^C-[0-9]+$'), 1000) + 1, false);--> statement-breakpoint
SELECT setval('ticket_help_seq', COALESCE((SELECT max(substring("number" from 3)::int) FROM "tickets" WHERE "number" ~ '^H-[0-9]+$'), 1000) + 1, false);
