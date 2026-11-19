CREATE TYPE "public"."allocation_status" AS ENUM('draft', 'published', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."audience" AS ENUM('student', 'faculty');--> statement-breakpoint
CREATE TYPE "public"."boarding_method" AS ENUM('qr', 'nfc', 'manual');--> statement-breakpoint
CREATE TYPE "public"."calendar_event_kind" AS ENUM('holiday', 'exam', 'registration', 'closure', 'special');--> statement-breakpoint
CREATE TYPE "public"."card_source" AS ENUM('payment', 'authority_grant', 'manual_approval');--> statement-breakpoint
CREATE TYPE "public"."card_status" AS ENUM('pending_payment', 'pending_approval', 'active', 'rejected', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."day_pass_status" AS ENUM('approved', 'pending', 'rejected', 'used', 'expired');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('to_campus', 'from_campus');--> statement-breakpoint
CREATE TYPE "public"."notice_audience" AS ENUM('all', 'students', 'faculty', 'route');--> statement-breakpoint
CREATE TYPE "public"."payment_gateway" AS ENUM('sslcommerz', 'bkash', 'nagad', 'mock');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('initiated', 'success', 'failed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."route_kind" AS ENUM('regular', 'shuttle');--> statement-breakpoint
CREATE TYPE "public"."routine_source_kind" AS ENUM('html', 'pdf', 'xlsx', 'csv', 'upload');--> statement-breakpoint
CREATE TYPE "public"."routine_version_status" AS ENUM('pending_review', 'active', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."ticket_kind" AS ENUM('complaint', 'suggestion', 'help');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."user_category" AS ENUM('student_tri_semester', 'student_bi_semester', 'student_thesis_only', 'student_short_course', 'hall_resident', 'faculty', 'admin_staff');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'faculty', 'staff', 'supervisor', 'authority');--> statement-breakpoint
CREATE TABLE "admin_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"designation" text NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"is_main_admin" boolean DEFAULT false NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_attempts" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocation_buses" (
	"allocation_id" uuid NOT NULL,
	"bus_id" uuid NOT NULL,
	"service_date" date NOT NULL,
	"window_start" integer NOT NULL,
	"window_end" integer NOT NULL,
	CONSTRAINT "allocation_buses_allocation_id_bus_id_pk" PRIMARY KEY("allocation_id","bus_id")
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_date" date NOT NULL,
	"time_slot_id" uuid NOT NULL,
	"status" "allocation_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"updated_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"subject_user_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"key_hash" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_handoffs_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "boarding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"card_id" uuid,
	"day_pass_id" uuid,
	"bus_id" uuid NOT NULL,
	"time_slot_id" uuid,
	"service_date" date NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"method" "boarding_method" NOT NULL,
	"scanned_by" uuid,
	"valid" boolean NOT NULL,
	"reject_reason" text
);
--> statement-breakpoint
CREATE TABLE "bus_unavailability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bus_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"operator_id" uuid NOT NULL,
	"seat_capacity" integer NOT NULL,
	"registration_number" text,
	"driver_name" text,
	"driver_phone" text,
	"gps_device_id" text,
	"device_key_enc" text,
	"pool" "audience" DEFAULT 'student' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buses_code_unique" UNIQUE("code"),
	CONSTRAINT "buses_gps_device_id_unique" UNIQUE("gps_device_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"kind" "calendar_event_kind" NOT NULL,
	"title" text NOT NULL,
	"cancels_service" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_version_id" uuid NOT NULL,
	"department" text NOT NULL,
	"batch" text,
	"section" text,
	"teacher_initial" text,
	"weekday" smallint NOT NULL,
	"start_minutes" integer NOT NULL,
	"end_minutes" integer NOT NULL,
	"course_code" text,
	"room" text
);
--> statement-breakpoint
CREATE TABLE "day_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"travel_date" date NOT NULL,
	"status" "day_pass_status" NOT NULL,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"decided_by" uuid,
	"reason" text,
	"qr_secret_enc" text,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "fee_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"semester_id" uuid NOT NULL,
	"category" "user_category" NOT NULL,
	"amount_bdt" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gps_pings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bus_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"speed_kmh" double precision,
	"heading" double precision,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"audience" "notice_audience" NOT NULL,
	"route_id" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_phone" text,
	CONSTRAINT "operators_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid,
	"semester_id" uuid NOT NULL,
	"amount_bdt" integer NOT NULL,
	"currency" text DEFAULT 'BDT' NOT NULL,
	"gateway" "payment_gateway" NOT NULL,
	"tran_id" text NOT NULL,
	"status" "payment_status" DEFAULT 'initiated' NOT NULL,
	"method" text,
	"failure_reason" text,
	"gateway_val_id" text,
	"gateway_bank_tran_id" text,
	"raw_ipn" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	CONSTRAINT "payments_tran_id_unique" UNIQUE("tran_id")
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_date" date NOT NULL,
	"time_slot_id" uuid NOT NULL,
	"expected_max" integer NOT NULL,
	"predicted" integer NOT NULL,
	"p90" integer NOT NULL,
	"model_version" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "route_kind" DEFAULT 'regular' NOT NULL,
	"duration_minutes" integer NOT NULL,
	"turnaround_minutes" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "routes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "routine_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department" text NOT NULL,
	"url" text NOT NULL,
	"kind" "routine_source_kind" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_hash" text,
	"last_checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "routine_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"department" text NOT NULL,
	"file_name" text,
	"content_hash" text NOT NULL,
	"status" "routine_version_status" DEFAULT 'pending_review' NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uploaded_by" uuid,
	"reviewed_by" uuid,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semesters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	CONSTRAINT "semesters_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_type" text NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"kind" "ticket_kind" NOT NULL,
	"category" text,
	"subject" text,
	"user_id" uuid NOT NULL,
	"route_id" uuid,
	"bus_code" text,
	"body" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"read_by_staff" boolean DEFAULT false NOT NULL,
	"hide_identity_from_driver" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "time_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"direction" "direction" NOT NULL,
	"audience" "audience" NOT NULL,
	"departure_minutes" integer NOT NULL,
	"weekdays" smallint[] NOT NULL,
	"semester_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"status" "card_status" NOT NULL,
	"source" "card_source",
	"reason" text,
	"decided_by" uuid,
	"issued_at" timestamp with time zone,
	"expires_on" date,
	"qr_secret_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"department" text,
	"program" text,
	"batch" text,
	"section" text,
	"teacher_initial" text,
	"designation" text,
	"phone" text,
	"email" text,
	"photo_url" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" text NOT NULL,
	"role" "user_role" NOT NULL,
	"category" "user_category",
	"name" text NOT NULL,
	"home_route_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_university_id_unique" UNIQUE("university_id")
);
--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD CONSTRAINT "admin_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_buses" ADD CONSTRAINT "allocation_buses_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_buses" ADD CONSTRAINT "allocation_buses_bus_id_buses_id_fk" FOREIGN KEY ("bus_id") REFERENCES "public"."buses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_time_slot_id_time_slots_id_fk" FOREIGN KEY ("time_slot_id") REFERENCES "public"."time_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_events" ADD CONSTRAINT "boarding_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_events" ADD CONSTRAINT "boarding_events_card_id_transport_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."transport_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_events" ADD CONSTRAINT "boarding_events_day_pass_id_day_passes_id_fk" FOREIGN KEY ("day_pass_id") REFERENCES "public"."day_passes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_events" ADD CONSTRAINT "boarding_events_bus_id_buses_id_fk" FOREIGN KEY ("bus_id") REFERENCES "public"."buses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_events" ADD CONSTRAINT "boarding_events_time_slot_id_time_slots_id_fk" FOREIGN KEY ("time_slot_id") REFERENCES "public"."time_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bus_unavailability" ADD CONSTRAINT "bus_unavailability_bus_id_buses_id_fk" FOREIGN KEY ("bus_id") REFERENCES "public"."buses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buses" ADD CONSTRAINT "buses_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_routine_version_id_routine_versions_id_fk" FOREIGN KEY ("routine_version_id") REFERENCES "public"."routine_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_passes" ADD CONSTRAINT "day_passes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_passes" ADD CONSTRAINT "day_passes_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_passes" ADD CONSTRAINT "day_passes_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_pings" ADD CONSTRAINT "gps_pings_bus_id_buses_id_fk" FOREIGN KEY ("bus_id") REFERENCES "public"."buses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_card_id_transport_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."transport_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_time_slot_id_time_slots_id_fk" FOREIGN KEY ("time_slot_id") REFERENCES "public"."time_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_versions" ADD CONSTRAINT "routine_versions_source_id_routine_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."routine_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_slots" ADD CONSTRAINT "time_slots_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_slots" ADD CONSTRAINT "time_slots_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_cards" ADD CONSTRAINT "transport_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_cards" ADD CONSTRAINT "transport_cards_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_cards" ADD CONSTRAINT "transport_cards_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_route_id_routes_id_fk" FOREIGN KEY ("home_route_id") REFERENCES "public"."routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocation_buses_bus_date_idx" ON "allocation_buses" USING btree ("bus_id","service_date");--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_date_slot_uq" ON "allocations" USING btree ("service_date","time_slot_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_subject_idx" ON "audit_logs" USING btree ("subject_user_id");--> statement-breakpoint
CREATE INDEX "boarding_events_date_slot_idx" ON "boarding_events" USING btree ("service_date","time_slot_id");--> statement-breakpoint
CREATE INDEX "bus_unavailability_bus_idx" ON "bus_unavailability" USING btree ("bus_id","from_date");--> statement-breakpoint
CREATE INDEX "calendar_events_date_idx" ON "calendar_events" USING btree ("date");--> statement-breakpoint
CREATE INDEX "class_sessions_version_idx" ON "class_sessions" USING btree ("routine_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "day_passes_user_date_uq" ON "day_passes" USING btree ("user_id","travel_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_rules_semester_category_uq" ON "fee_rules" USING btree ("semester_id","category");--> statement-breakpoint
CREATE INDEX "gps_pings_bus_time_idx" ON "gps_pings" USING btree ("bus_id","recorded_at");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_created_idx" ON "payments" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "predictions_date_slot_uq" ON "predictions" USING btree ("service_date","time_slot_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "route_stops_route_seq_uq" ON "route_stops" USING btree ("route_id","seq");--> statement-breakpoint
CREATE INDEX "time_slots_route_idx" ON "time_slots" USING btree ("route_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_cards_user_semester_uq" ON "transport_cards" USING btree ("user_id","semester_id");