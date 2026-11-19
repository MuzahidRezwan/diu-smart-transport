/**
 * Domain enums shared by the API, web dashboard and mobile app.
 * Each enum is a readonly tuple so it can feed zod, Drizzle pgEnum and UI selects.
 */

export const USER_ROLES = ['student', 'faculty', 'staff', 'supervisor', 'authority'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Fee category. Each one can have a different semester fee. */
export const USER_CATEGORIES = [
  'student_tri_semester',
  'student_bi_semester',
  'student_thesis_only',
  'student_short_course',
  'hall_resident',
  'faculty',
  'admin_staff',
] as const;
export type UserCategory = (typeof USER_CATEGORIES)[number];

export const USER_CATEGORY_LABELS: Record<UserCategory, string> = {
  student_tri_semester: 'Student (3 semesters/year)',
  student_bi_semester: 'Student (2 semesters/year)',
  student_thesis_only: 'Student (thesis only)',
  student_short_course: 'Short-course student',
  hall_resident: 'Hall resident',
  faculty: 'Faculty',
  admin_staff: 'Admin staff',
};

export const DIRECTIONS = ['to_campus', 'from_campus'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Which service a slot or bus belongs to. */
export const AUDIENCES = ['student', 'faculty'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const ROUTE_KINDS = ['regular', 'shuttle'] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

export const ALLOCATION_STATUSES = ['draft', 'published', 'cancelled'] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const CARD_STATUSES = [
  'pending_payment',
  'pending_approval',
  'active',
  'rejected',
  'revoked',
  'expired',
] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const CARD_SOURCES = ['payment', 'authority_grant', 'manual_approval'] as const;
export type CardSource = (typeof CARD_SOURCES)[number];

export const DAY_PASS_STATUSES = ['approved', 'pending', 'rejected', 'used', 'expired'] as const;
export type DayPassStatus = (typeof DAY_PASS_STATUSES)[number];

export const PAYMENT_STATUSES = ['initiated', 'success', 'failed', 'cancelled', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_GATEWAYS = ['sslcommerz', 'bkash', 'nagad', 'mock'] as const;
export type PaymentGateway = (typeof PAYMENT_GATEWAYS)[number];

export const NOTICE_AUDIENCES = ['all', 'students', 'faculty', 'route'] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const COMPLAINT_KINDS = ['complaint', 'suggestion'] as const;
export type ComplaintKind = (typeof COMPLAINT_KINDS)[number];

export const COMPLAINT_CATEGORIES = [
  'late_bus',
  'overcrowding',
  'driver_behaviour',
  'cleanliness',
  'safety',
  'app_issue',
  'payment',
  'other',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const ROUTINE_VERSION_STATUSES = ['pending_review', 'active', 'rejected', 'superseded'] as const;
export type RoutineVersionStatus = (typeof ROUTINE_VERSION_STATUSES)[number];

export const ROUTINE_SOURCE_KINDS = ['html', 'pdf', 'xlsx', 'csv', 'upload'] as const;
export type RoutineSourceKind = (typeof ROUTINE_SOURCE_KINDS)[number];

export const CALENDAR_EVENT_KINDS = ['holiday', 'exam', 'registration', 'closure', 'special'] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

export const BOARDING_METHODS = ['qr', 'nfc', 'manual'] as const;
export type BoardingMethod = (typeof BOARDING_METHODS)[number];

/** Weekday numbers follow JavaScript: 0 = Sunday ... 6 = Saturday. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
