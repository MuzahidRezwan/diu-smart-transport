/** Shapes of authority/rider endpoints as the web app uses them. */
export interface PredictionRow {
  serviceDate: string;
  timeSlotId: string;
  expectedMax: number;
  predicted: number;
  p90: number;
  modelVersion: string;
  routeId: string;
  routeCode: string;
  routeName: string;
  routeKind: 'regular' | 'shuttle';
  direction: 'to_campus' | 'from_campus';
  audience: 'student' | 'faculty';
  /** e.g. "Goes up to Polashbari U-turn only" */
  note?: string | null;
  departureMinutes: number;
  departure: string;
}

export interface BusLite { id: string; code: string; operatorCode: string; capacity: number }

export interface Allocation {
  id: string;
  serviceDate: string;
  timeSlotId: string;
  status: 'draft' | 'published' | 'cancelled';
  buses: BusLite[];
  seats: number;
  updatedAt: string;
  publishedAt: string | null;
}

export interface BusRow {
  id: string;
  code: string;
  operatorCode: string;
  operatorName: string;
  seatCapacity: number;
  registrationNumber: string | null;
  driverName: string | null;
  driverPhone: string | null;
  gpsDeviceId: string | null;
  pool: 'student' | 'faculty';
  isActive: boolean;
}

export interface AvailabilityDay { date: string; total: number; unavailable: { code: string; reason: string }[]; available: number; allocated: number }

export interface BusOption { id: string; code: string; operatorCode: string; capacity: number; pool: 'student' | 'faculty'; samePool: boolean; blockedReason: string | null }

export interface FeedItem { at: string; kind: 'ok' | 'info' | 'warn' | 'crit' | 'none'; text: string; by: string }

export interface CardRequest {
  cardId: string; universityId: string; name: string; category: string | null; route: string; status: string; note: string | null; requestedAt: string;
  lastPayment: { status: string; createdAt: string } | null;
}

export interface DayPassRequest { id: string; universityId: string; name: string; travelDate: string; route: string; status: string; autoApproved: boolean }

export interface Ticket {
  id: string; number: string; kind: 'complaint' | 'suggestion' | 'help'; category: string | null; subject: string | null; route: string | null;
  busCode: string | null; body: string; status: string; readByStaff: boolean; createdAt: string;
  messages?: { authorType: string; body: string; createdAt: string }[];
}

export interface Notice { id: string; title: string; body: string; audience: string; routeName?: string | null; publishedAt: string }

export interface RouteInfo { id: string; code: string; name: string; kind: string; durationMinutes: number; stops: { name: string; lat: number; lng: number }[] }

export interface LivePosition {
  busId: string; code: string; operatorCode: string; lat: number; lng: number; recordedAt: string;
  trip: { routeId: string; routeCode: string; routeName: string; direction: string; departureMinutes: number } | null;
}

export interface PaymentsReport {
  summary: { from: string; to: string; ridersPaid: number; totalBdt: number; failedOrPending: number; refunded: number; byMethod: { method: string; count: number; amountBdt: number }[]; byCategory: { category: string; count: number; amountBdt: number }[] };
  rows: { createdAt: string; paidAt: string | null; day: string; tranId: string; universityId: string; name: string; category: string | null; route: string | null; semester: string; amountBdt: number; method: string | null; status: string; failureReason: string | null }[];
}

export interface AccessLookup {
  rider: { universityId: string; name: string; riderType: string; category: string | null; homeRoute: string | null; cardStatus: string };
  history: {
    summary: { totalPaidBdt: number; payments: number; semestersPaid: number; lastPaid: { at: string; amountBdt: number; method: string | null; semester: string } | null };
    cards: { id: string; semester: string; semesterName: string; route: string; status: string; source: string | null; reason: string | null; issuedAt: string | null; expiresOn: string | null }[];
    payments: { tranId: string; semester: string; amountBdt: number; method: string | null; status: string; failureReason: string | null; createdAt: string; paidAt: string | null }[];
    dayPasses: { travelDate: string; route: string; status: string; autoApproved: boolean; reason: string | null }[];
    accessChanges: { at: string; action: string; reason: string | null; actorName: string | null }[];
  };
}

export interface AdminRow { userId: string; universityId: string; name: string; designation: string; isMainAdmin: boolean; permissions: string[]; isActive: boolean; totpEnabled: boolean; lastLoginAt: string | null }

export interface RoutineVersion { id: string; department: string; fileName: string | null; status: string; sessionCount: number; warnings: string[]; createdAt: string; activatedAt: string | null }

export interface ScheduleSlot {
  timeSlotId: string; routeId: string; routeCode: string; routeName: string; routeKind: string; direction: 'to_campus' | 'from_campus';
  audience: 'student' | 'faculty'; departure: string; departureMinutes: number; published?: boolean; buses?: BusLite[];
  note?: string | null;
}
