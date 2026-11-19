/** Response shapes the web dashboard and mobile app read from the API. */
import type {
  Audience, CardStatus, DayPassStatus, Direction, PaymentStatus, RouteKind, UserCategory, UserRole,
} from './enums.js';
import type { Permission } from './permissions.js';

export interface AuthTokens {
  accessToken: string;
  /** Only returned to the mobile app; the web gets an HttpOnly cookie. */
  refreshToken?: string;
  expiresIn: number;
}

/** The signed-in person's own profile. Only ever returned by /me. */
export interface MeResponse {
  id: string;
  universityId: string;
  role: UserRole;
  category: UserCategory | null;
  name: string;
  profile: {
    department?: string;
    batch?: string;
    section?: string;
    teacherInitial?: string;
    designation?: string;
    phone?: string;
    photoUrl?: string;
  };
  homeRouteId: string | null;
  card: { status: CardStatus; semester: string; expiresOn: string | null } | null;
  /** Authority accounts only. */
  admin?: { isMainAdmin: boolean; permissions: Permission[] };
}

/** What the transport office sees about a rider: no profile fields. */
export interface TransportRiderView {
  universityId: string;
  name: string;
  riderType: UserRole;
  category: UserCategory | null;
  homeRoute: string | null;
  cardStatus: CardStatus | 'none';
}

export interface RouteSummary {
  id: string;
  code: string;
  name: string;
  kind: RouteKind;
  durationMinutes: number;
  stops: { name: string; lat: number; lng: number }[];
}

export interface BusChip {
  id: string;
  code: string;
  operatorCode: string;
  capacity: number;
}

/** One departure as riders see it. `buses` is empty until the authority publishes. */
export interface ScheduleEntry {
  timeSlotId: string;
  routeId: string;
  direction: Direction;
  audience: Audience;
  departure: string;
  buses: BusChip[];
  published: boolean;
}

export interface SlotDemand {
  timeSlotId: string;
  routeId: string;
  routeCode: string;
  routeName: string;
  direction: Direction;
  audience: Audience;
  departure: string;
  /** Everyone whose routine says they need this trip. */
  expectedMax: number;
  /** Model's best estimate of riders. */
  predicted: number;
  /** 90th percentile: allocate seats for this. */
  p90: number;
  modelVersion: string;
}

export interface AllocationView {
  id: string;
  serviceDate: string;
  timeSlotId: string;
  status: 'draft' | 'published' | 'cancelled';
  buses: BusChip[];
  seats: number;
  updatedBy: string;
  updatedAt: string;
}

export interface PaymentRow {
  paidAt: string;
  tranId: string;
  universityId: string;
  name: string;
  category: UserCategory | null;
  route: string | null;
  semester: string;
  amountBdt: number;
  method: string | null;
  status: PaymentStatus;
}

export interface PaymentSummary {
  from: string;
  to: string;
  ridersPaid: number;
  totalBdt: number;
  failedOrPending: number;
  refunded: number;
  byMethod: { method: string; count: number; amountBdt: number }[];
  byCategory: { category: string; count: number; amountBdt: number }[];
}

export interface DayPassView {
  id: string;
  travelDate: string;
  routeId: string;
  status: DayPassStatus;
  autoApproved: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; details?: unknown };
}
