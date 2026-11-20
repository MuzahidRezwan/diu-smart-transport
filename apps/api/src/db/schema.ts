/**
 * Database schema (PostgreSQL 16, Drizzle ORM).
 *
 * Privacy boundary: personal profile fields live ONLY in `user_profiles`, which
 * is read by the rider's own /me endpoints. Authority code reads the
 * `transport_riders` view (see migrations) and transport-owned tables.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, date, doublePrecision, index, integer, jsonb, pgEnum, pgSequence, pgTable, primaryKey, smallint, text,
  timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import {
  ALLOCATION_STATUSES, AUDIENCES, BOARDING_METHODS, CALENDAR_EVENT_KINDS, CARD_SOURCES, CARD_STATUSES,
  DAY_PASS_STATUSES, DIRECTIONS, NOTICE_AUDIENCES, PAYMENT_GATEWAYS, PAYMENT_STATUSES, ROUTE_KINDS,
  ROUTINE_SOURCE_KINDS, ROUTINE_VERSION_STATUSES, TICKET_STATUSES, USER_CATEGORIES, USER_ROLES,
} from '@diu/shared';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const userRole = pgEnum('user_role', USER_ROLES);
export const userCategory = pgEnum('user_category', USER_CATEGORIES);
export const direction = pgEnum('direction', DIRECTIONS);
export const audience = pgEnum('audience', AUDIENCES);
export const routeKind = pgEnum('route_kind', ROUTE_KINDS);
export const allocationStatus = pgEnum('allocation_status', ALLOCATION_STATUSES);
export const cardStatus = pgEnum('card_status', CARD_STATUSES);
export const cardSource = pgEnum('card_source', CARD_SOURCES);
export const dayPassStatus = pgEnum('day_pass_status', DAY_PASS_STATUSES);
export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUSES);
export const paymentGateway = pgEnum('payment_gateway', PAYMENT_GATEWAYS);
export const noticeAudience = pgEnum('notice_audience', NOTICE_AUDIENCES);
export const ticketStatus = pgEnum('ticket_status', TICKET_STATUSES);
export const ticketKind = pgEnum('ticket_kind', ['complaint', 'suggestion', 'help']);
export const calendarEventKind = pgEnum('calendar_event_kind', CALENDAR_EVENT_KINDS);
export const boardingMethod = pgEnum('boarding_method', BOARDING_METHODS);
export const routineVersionStatus = pgEnum('routine_version_status', ROUTINE_VERSION_STATUSES);
export const routineSourceKind = pgEnum('routine_source_kind', ROUTINE_SOURCE_KINDS);

/* ---------------- people ---------------- */

/** Identity only. No contact or academic details here. */
export const users = pgTable('users', {
  id: id(),
  universityId: text('university_id').notNull().unique(),
  role: userRole('role').notNull(),
  category: userCategory('category'),
  name: text('name').notNull(),
  homeRouteId: uuid('home_route_id').references(() => routes.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Personal profile synced from the university. Read only by the rider themself. */
export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  department: text('department'),
  program: text('program'),
  batch: text('batch'),
  section: text('section'),
  teacherInitial: text('teacher_initial'),
  designation: text('designation'),
  phone: text('phone'),
  email: text('email'),
  photoUrl: text('photo_url'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});

export const adminAccounts = pgTable('admin_accounts', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  designation: text('designation').notNull(),
  passwordHash: text('password_hash').notNull(),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  isMainAdmin: boolean('is_main_admin').notNull().default(false),
  permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
  isActive: boolean('is_active').notNull().default(true),
  failedAttempts: smallint('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  familyId: uuid('family_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  userAgent: text('user_agent'),
  ip: text('ip'),
  createdAt: createdAt(),
}, (t) => [index('refresh_tokens_user_idx').on(t.userId), index('refresh_tokens_family_idx').on(t.familyId)]);

/** Short-lived one-time values: OAuth state, login hand-off codes, 2FA challenges. Stored hashed. */
export const authHandoffs = pgTable('auth_handoffs', {
  id: id(),
  kind: text('kind').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const deviceTokens = pgTable('device_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  platform: text('platform').notNull(),
  createdAt: createdAt(),
});

/* ---------------- academic calendar ---------------- */

export const semesters = pgTable('semesters', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  isCurrent: boolean('is_current').notNull().default(false),
});

export const calendarEvents = pgTable('calendar_events', {
  id: id(),
  date: date('date').notNull(),
  kind: calendarEventKind('kind').notNull(),
  title: text('title').notNull(),
  cancelsService: boolean('cancels_service').notNull().default(false),
}, (t) => [index('calendar_events_date_idx').on(t.date)]);

/* ---------------- fleet & routes ---------------- */

export const operators = pgTable('operators', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  contactPhone: text('contact_phone'),
});

export const buses = pgTable('buses', {
  id: id(),
  code: text('code').notNull().unique(),
  operatorId: uuid('operator_id').notNull().references(() => operators.id),
  seatCapacity: integer('seat_capacity').notNull(),
  registrationNumber: text('registration_number'),
  driverName: text('driver_name'),
  driverPhone: text('driver_phone'),
  gpsDeviceId: text('gps_device_id').unique(),
  deviceKeyEnc: text('device_key_enc'),
  pool: audience('pool').notNull().default('student'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

export const busUnavailability = pgTable('bus_unavailability', {
  id: id(),
  busId: uuid('bus_id').notNull().references(() => buses.id, { onDelete: 'cascade' }),
  fromDate: date('from_date').notNull(),
  toDate: date('to_date').notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
}, (t) => [index('bus_unavailability_bus_idx').on(t.busId, t.fromDate)]);

export const routes = pgTable('routes', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  kind: routeKind('kind').notNull().default('regular'),
  durationMinutes: integer('duration_minutes').notNull(),
  turnaroundMinutes: integer('turnaround_minutes').notNull().default(30),
  isActive: boolean('is_active').notNull().default(true),
});

export const routeStops = pgTable('route_stops', {
  id: id(),
  routeId: uuid('route_id').notNull().references(() => routes.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  name: text('name').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
}, (t) => [uniqueIndex('route_stops_route_seq_uq').on(t.routeId, t.seq)]);

export const timeSlots = pgTable('time_slots', {
  id: id(),
  routeId: uuid('route_id').notNull().references(() => routes.id, { onDelete: 'cascade' }),
  direction: direction('direction').notNull(),
  audience: audience('audience').notNull(),
  departureMinutes: integer('departure_minutes').notNull(),
  weekdays: smallint('weekdays').array().notNull(),
  semesterId: uuid('semester_id').references(() => semesters.id),
  isActive: boolean('is_active').notNull().default(true),
  /** Shown to riders, e.g. "Goes up to Polashbari U-turn only", "One bus assigned only". */
  note: text('note'),
}, (t) => [index('time_slots_route_idx').on(t.routeId)]);

/* ---------------- allocation & prediction ---------------- */

export const allocations = pgTable('allocations', {
  id: id(),
  serviceDate: date('service_date').notNull(),
  timeSlotId: uuid('time_slot_id').notNull().references(() => timeSlots.id, { onDelete: 'cascade' }),
  status: allocationStatus('status').notNull().default('draft'),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('allocations_date_slot_uq').on(t.serviceDate, t.timeSlotId)]);

/** One row per bus per allocation, with the bus's busy window (minutes) for conflict checks. */
export const allocationBuses = pgTable('allocation_buses', {
  allocationId: uuid('allocation_id').notNull().references(() => allocations.id, { onDelete: 'cascade' }),
  busId: uuid('bus_id').notNull().references(() => buses.id),
  serviceDate: date('service_date').notNull(),
  windowStart: integer('window_start').notNull(),
  windowEnd: integer('window_end').notNull(),
}, (t) => [primaryKey({ columns: [t.allocationId, t.busId] }), index('allocation_buses_bus_date_idx').on(t.busId, t.serviceDate)]);

export const predictions = pgTable('predictions', {
  id: id(),
  serviceDate: date('service_date').notNull(),
  timeSlotId: uuid('time_slot_id').notNull().references(() => timeSlots.id, { onDelete: 'cascade' }),
  expectedMax: integer('expected_max').notNull(),
  predicted: integer('predicted').notNull(),
  p90: integer('p90').notNull(),
  modelVersion: text('model_version').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('predictions_date_slot_uq').on(t.serviceDate, t.timeSlotId)]);

/* ---------------- routines ---------------- */

export const routineSources = pgTable('routine_sources', {
  id: id(),
  department: text('department').notNull(),
  url: text('url').notNull(),
  kind: routineSourceKind('kind').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  lastHash: text('last_hash'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
});

export const routineVersions = pgTable('routine_versions', {
  id: id(),
  sourceId: uuid('source_id').references(() => routineSources.id),
  department: text('department').notNull(),
  fileName: text('file_name'),
  contentHash: text('content_hash').notNull(),
  status: routineVersionStatus('status').notNull().default('pending_review'),
  sessionCount: integer('session_count').notNull().default(0),
  warnings: jsonb('warnings').notNull().default(sql`'[]'::jsonb`),
  uploadedBy: uuid('uploaded_by'),
  reviewedBy: uuid('reviewed_by'),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const classSessions = pgTable('class_sessions', {
  id: id(),
  routineVersionId: uuid('routine_version_id').notNull().references(() => routineVersions.id, { onDelete: 'cascade' }),
  department: text('department').notNull(),
  batch: text('batch'),
  section: text('section'),
  teacherInitial: text('teacher_initial'),
  weekday: smallint('weekday').notNull(),
  startMinutes: integer('start_minutes').notNull(),
  endMinutes: integer('end_minutes').notNull(),
  courseCode: text('course_code'),
  room: text('room'),
}, (t) => [index('class_sessions_version_idx').on(t.routineVersionId)]);

/* ---------------- cards, passes, payments ---------------- */

export const feeRules = pgTable('fee_rules', {
  id: id(),
  semesterId: uuid('semester_id').notNull().references(() => semesters.id),
  category: userCategory('category').notNull(),
  amountBdt: integer('amount_bdt').notNull(),
  isActive: boolean('is_active').notNull().default(true),
}, (t) => [uniqueIndex('fee_rules_semester_category_uq').on(t.semesterId, t.category)]);

export const transportCards = pgTable('transport_cards', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  semesterId: uuid('semester_id').notNull().references(() => semesters.id),
  routeId: uuid('route_id').notNull().references(() => routes.id),
  status: cardStatus('status').notNull(),
  source: cardSource('source'),
  reason: text('reason'),
  decidedBy: uuid('decided_by'),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  expiresOn: date('expires_on'),
  qrSecretEnc: text('qr_secret_enc'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('transport_cards_user_semester_uq').on(t.userId, t.semesterId)]);

export const dayPasses = pgTable('day_passes', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  semesterId: uuid('semester_id').notNull().references(() => semesters.id),
  routeId: uuid('route_id').notNull().references(() => routes.id),
  travelDate: date('travel_date').notNull(),
  status: dayPassStatus('status').notNull(),
  autoApproved: boolean('auto_approved').notNull().default(false),
  decidedBy: uuid('decided_by'),
  reason: text('reason'),
  qrSecretEnc: text('qr_secret_enc'),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('day_passes_user_date_uq').on(t.userId, t.travelDate)]);

export const payments = pgTable('payments', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  cardId: uuid('card_id').references(() => transportCards.id),
  semesterId: uuid('semester_id').notNull().references(() => semesters.id),
  amountBdt: integer('amount_bdt').notNull(),
  currency: text('currency').notNull().default('BDT'),
  gateway: paymentGateway('gateway').notNull(),
  tranId: text('tran_id').notNull().unique(),
  status: paymentStatus('status').notNull().default('initiated'),
  method: text('method'),
  failureReason: text('failure_reason'),
  gatewayValId: text('gateway_val_id'),
  gatewayBankTranId: text('gateway_bank_tran_id'),
  rawIpn: jsonb('raw_ipn'),
  createdAt: createdAt(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
}, (t) => [index('payments_user_idx').on(t.userId), index('payments_created_idx').on(t.createdAt)]);

/* ---------------- operations ---------------- */

export const boardingEvents = pgTable('boarding_events', {
  id: id(),
  userId: uuid('user_id').references(() => users.id),
  cardId: uuid('card_id').references(() => transportCards.id),
  dayPassId: uuid('day_pass_id').references(() => dayPasses.id),
  busId: uuid('bus_id').notNull().references(() => buses.id),
  timeSlotId: uuid('time_slot_id').references(() => timeSlots.id),
  serviceDate: date('service_date').notNull(),
  scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull(),
  method: boardingMethod('method').notNull(),
  scannedBy: uuid('scanned_by'),
  valid: boolean('valid').notNull(),
  rejectReason: text('reject_reason'),
}, (t) => [index('boarding_events_date_slot_idx').on(t.serviceDate, t.timeSlotId)]);

export const gpsPings = pgTable('gps_pings', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  busId: uuid('bus_id').notNull().references(() => buses.id),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  speedKmh: doublePrecision('speed_kmh'),
  heading: doublePrecision('heading'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
}, (t) => [index('gps_pings_bus_time_idx').on(t.busId, t.recordedAt)]);

export const notices = pgTable('notices', {
  id: id(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  audience: noticeAudience('audience').notNull(),
  routeId: uuid('route_id').references(() => routes.id),
  publishedBy: uuid('published_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Ticket numbers (C-1001, H-1001). Sequences stay unique when many riders write at once. */
export const ticketComplaintSeq = pgSequence('ticket_complaint_seq', { startWith: 1001 });
export const ticketHelpSeq = pgSequence('ticket_help_seq', { startWith: 1001 });

/** Complaints, suggestions and help requests. Staff see them by number and route only. */
export const tickets = pgTable('tickets', {
  id: id(),
  number: text('number').notNull().unique(),
  kind: ticketKind('kind').notNull(),
  category: text('category'),
  subject: text('subject'),
  userId: uuid('user_id').notNull().references(() => users.id),
  routeId: uuid('route_id').references(() => routes.id),
  busCode: text('bus_code'),
  body: text('body').notNull(),
  status: ticketStatus('status').notNull().default('open'),
  readByStaff: boolean('read_by_staff').notNull().default(false),
  hideIdentityFromDriver: boolean('hide_identity_from_driver').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const ticketMessages = pgTable('ticket_messages', {
  id: id(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  authorType: text('author_type').notNull(),
  authorId: uuid('author_id'),
  body: text('body').notNull(),
  createdAt: createdAt(),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: updatedAt(),
});

/** Append-only. The app's DB role has INSERT/SELECT only on this table. */
export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  subjectUserId: uuid('subject_user_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  reason: text('reason'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
}, (t) => [index('audit_logs_created_idx').on(t.createdAt), index('audit_logs_subject_idx').on(t.subjectUserId)]);
