/**
 * Request schemas shared by the API (validation) and the web/mobile apps (forms).
 * Unknown keys are stripped by zod's default object behaviour.
 */
import { z } from 'zod';
import {
  AUDIENCES, BOARDING_METHODS, CALENDAR_EVENT_KINDS, COMPLAINT_CATEGORIES, COMPLAINT_KINDS, DIRECTIONS,
  NOTICE_AUDIENCES, PAYMENT_STATUSES, ROUTE_KINDS, TICKET_STATUSES, USER_CATEGORIES,
} from './enums.js';
import { ALL_PERMISSIONS, type Permission } from './permissions.js';

export const uuid = z.string().uuid();
/** Student IDs look like 232-35-797; faculty/staff IDs are 5–8 digits. */
export const universityId = z.string().trim().regex(/^(\d{3}-\d{2}-\d{3,5}|\d{5,8})$/, 'Enter a full university ID');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
export const bdPhone = z.string().regex(/^(\+?880|0)1[3-9]\d{8}$/, 'Enter a Bangladeshi mobile number');
const reason = z.string().trim().min(5, 'Write a reason (at least 5 characters)').max(500);

/* ---------- auth ---------- */
export const authorityLoginSchema = z.object({
  universityId,
  password: z.string().min(1).max(200),
});
export const totpVerifySchema = z.object({
  challengeId: uuid,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export const ssoCallbackSchema = z.object({ code: z.string().min(1).max(2048), state: z.string().min(16).max(256) });
export const refreshSchema = z.object({ refreshToken: z.string().min(32).max(256).optional() });

/* ---------- fleet & routes ---------- */
export const operatorSchema = z.object({
  code: z.string().regex(/^[A-Z]{1,3}$/, 'One to three capital letters, e.g. H'),
  name: z.string().trim().min(2).max(80),
  contactPhone: bdPhone.optional(),
});
export const busCreateSchema = z.object({
  code: z.string().regex(/^[A-Z]{1,3}-\d{1,3}$/, 'Bus code like H-10'),
  operatorId: uuid,
  seatCapacity: z.number().int().min(10).max(90),
  registrationNumber: z.string().trim().max(40).optional(),
  driverName: z.string().trim().max(80).optional(),
  driverPhone: bdPhone.optional(),
  gpsDeviceId: z.string().trim().max(64).optional(),
  pool: z.enum(AUDIENCES).default('student'),
  isActive: z.boolean().default(true),
});
export const busUpdateSchema = busCreateSchema.partial();
export const busUnavailabilitySchema = z.object({
  fromDate: isoDate,
  toDate: isoDate,
  reason: z.string().trim().min(3).max(200),
}).refine((v) => v.fromDate <= v.toDate, { message: 'fromDate must be on or before toDate', path: ['toDate'] });

export const routeStopSchema = z.object({
  name: z.string().trim().min(2).max(80),
  lat: z.number().min(20).max(27),
  lng: z.number().min(88).max(93),
});
export const routeCreateSchema = z.object({
  code: z.string().regex(/^[A-Z]{1,3}-\d{1,3}$/, 'Route code like R-01'),
  name: z.string().trim().min(2).max(80),
  kind: z.enum(ROUTE_KINDS).default('regular'),
  durationMinutes: z.number().int().min(5).max(240),
  turnaroundMinutes: z.number().int().min(0).max(120).default(30),
  isActive: z.boolean().default(true),
  stops: z.array(routeStopSchema).min(2).max(40),
});
export const routeUpdateSchema = routeCreateSchema.partial();

export const timeSlotCreateSchema = z.object({
  routeId: uuid,
  direction: z.enum(DIRECTIONS),
  audience: z.enum(AUDIENCES),
  departureTime: hhmm,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  semesterId: uuid.optional(),
  isActive: z.boolean().default(true),
});
export const timeSlotUpdateSchema = timeSlotCreateSchema.partial();

/* ---------- allocation ---------- */
export const allocationUpsertSchema = z.object({
  serviceDate: isoDate,
  timeSlotId: uuid,
  busIds: z.array(uuid).min(1).max(20),
  status: z.enum(['draft', 'published']).default('draft'),
  notes: z.string().trim().max(500).optional(),
});
export const publishDaySchema = z.object({ serviceDate: isoDate });
export const suggestAllocationSchema = z.object({ serviceDate: isoDate, onlyEmpty: z.boolean().default(true) });

/* ---------- cards, passes, fees ---------- */
export const cardApplySchema = z.object({
  routeId: uuid,
  gateway: z.enum(['sslcommerz', 'mock']).default('sslcommerz'),
});
export const cardDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: reason.optional(),
});
export const grantAccessSchema = z.object({ routeId: uuid.optional(), reason });
export const revokeAccessSchema = z.object({ reason });

export const dayPassRequestSchema = z.object({ travelDate: isoDate, routeId: uuid });
export const dayPassDecisionSchema = z.object({ decision: z.enum(['approve', 'reject']), reason: reason.optional() });

export const feeRuleSchema = z.object({
  semesterId: uuid,
  category: z.enum(USER_CATEGORIES),
  amountBdt: z.number().int().min(0).max(100000),
  isActive: z.boolean().default(true),
});
export const semesterSchema = z.object({
  code: z.string().regex(/^(SPRING|SUMMER|FALL)-\d{4}$/, 'Like FALL-2026'),
  name: z.string().trim().min(3).max(40),
  startsOn: isoDate,
  endsOn: isoDate,
  isCurrent: z.boolean().default(false),
}).refine((v) => v.startsOn < v.endsOn, { message: 'startsOn must be before endsOn', path: ['endsOn'] });
export const calendarEventSchema = z.object({
  date: isoDate,
  kind: z.enum(CALENDAR_EVENT_KINDS),
  title: z.string().trim().min(3).max(120),
  cancelsService: z.boolean().default(false),
});

/* ---------- payments ---------- */
export const paymentsQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  status: z.enum([...PAYMENT_STATUSES, 'all'] as [string, ...string[]]).default('success'),
  method: z.string().trim().max(30).optional(),
}).refine((v) => v.from <= v.to, { message: 'from must be on or before to', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 93, { message: 'At most 93 days per report', path: ['to'] });

/* ---------- communication ---------- */
export const noticeCreateSchema = z.object({
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().max(2000).default(''),
  audience: z.enum(NOTICE_AUDIENCES),
  routeId: uuid.optional(),
}).refine((v) => v.audience !== 'route' || Boolean(v.routeId), { message: 'Choose a route', path: ['routeId'] });

export const complaintCreateSchema = z.object({
  kind: z.enum(COMPLAINT_KINDS),
  category: z.enum(COMPLAINT_CATEGORIES),
  body: z.string().trim().min(10).max(2000),
  routeId: uuid.optional(),
  busCode: z.string().regex(/^[A-Z]{1,3}-\d{1,3}$/).optional(),
  hideIdentityFromDriver: z.boolean().default(true),
});
export const helpCreateSchema = z.object({
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(2000),
});
export const ticketReplySchema = z.object({
  body: z.string().trim().min(2).max(2000),
  status: z.enum(TICKET_STATUSES).optional(),
});

/* ---------- admins & settings ---------- */
const permissionList = z.array(z.string()).max(ALL_PERMISSIONS.length)
  .refine((list) => list.every((p) => (ALL_PERMISSIONS as readonly string[]).includes(p)), { message: 'Unknown permission' })
  .transform((list) => [...new Set(list)] as Permission[]);

export const adminCreateSchema = z.object({
  universityId,
  name: z.string().trim().min(3).max(80),
  designation: z.string().trim().min(2).max(80),
  permissions: permissionList,
});
export const adminUpdateSchema = z.object({
  permissions: permissionList.optional(),
  isActive: z.boolean().optional(),
});
export const settingsSchema = z.object({
  dayPassLimitPerSemester: z.number().int().min(0).max(10),
  dayPassOverLimit: z.enum(['reject', 'manual']),
  allocationBufferPct: z.number().min(0).max(0.5),
  defaultTurnaroundMinutes: z.number().int().min(0).max(120),
  attendanceFactorColdStart: z.number().min(0.3).max(1),
}).partial();

/* ---------- devices ---------- */
export const gpsPingSchema = z.object({
  lat: z.number().min(20).max(27),
  lng: z.number().min(88).max(93),
  speedKmh: z.number().min(0).max(150).optional(),
  heading: z.number().min(0).max(360).optional(),
  recordedAt: z.string().datetime(),
});
export const boardingScanSchema = z.object({
  qrToken: z.string().min(20).max(512),
  busId: uuid,
  timeSlotId: uuid.optional(),
  method: z.enum(BOARDING_METHODS).default('qr'),
  scannedAt: z.string().datetime(),
});

export const predictionQuerySchema = z.object({
  from: isoDate,
  days: z.coerce.number().int().min(1).max(8).default(1),
});

export type AuthorityLoginInput = z.infer<typeof authorityLoginSchema>;
export type BusCreateInput = z.infer<typeof busCreateSchema>;
export type RouteCreateInput = z.infer<typeof routeCreateSchema>;
export type TimeSlotCreateInput = z.infer<typeof timeSlotCreateSchema>;
export type AllocationUpsertInput = z.infer<typeof allocationUpsertSchema>;
export type NoticeCreateInput = z.infer<typeof noticeCreateSchema>;
export type ComplaintCreateInput = z.infer<typeof complaintCreateSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type PaymentsQuery = z.infer<typeof paymentsQuerySchema>;
