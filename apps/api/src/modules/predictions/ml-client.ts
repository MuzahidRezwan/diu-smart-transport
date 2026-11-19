/**
 * Client for the Python ML service (services/ml). The ML service is stateless:
 * the API sends it everything it needs and stores what comes back.
 */

export interface ForecastRequest {
  dates: string[];
  riders: { riderKey: string; audience: 'student' | 'faculty'; routeId: string; department: string | null; batch: string | null; section: string | null; teacherInitial: string | null }[];
  sessions: { department: string; batch: string | null; section: string | null; teacherInitial: string | null; weekday: number; startMinutes: number; endMinutes: number }[];
  slots: { timeSlotId: string; routeId: string; direction: 'to_campus' | 'from_campus'; audience: 'student' | 'faculty'; departureMinutes: number; durationMinutes: number; weekdays: number[] }[];
  calendar: { date: string; kind: string; cancelsService: boolean }[];
  history: { date: string; timeSlotId: string; boarded: number }[];
  attendanceFactorColdStart: number;
}

export interface ForecastRow {
  date: string;
  timeSlotId: string;
  expectedMax: number;
  predicted: number;
  p90: number;
}

export interface ForecastResponse {
  modelVersion: string;
  rows: ForecastRow[];
}

export interface PlanRequest {
  date: string;
  slots: { timeSlotId: string; demand: number; windowStart: number; windowEnd: number; audience: 'student' | 'faculty' }[];
  buses: { busId: string; code: string; operatorCode: string; capacity: number; pool: 'student' | 'faculty' }[];
  /** Buses already fixed by the authority: they stay where they are. */
  fixed: { timeSlotId: string; busIds: string[] }[];
  bufferPct: number;
}

export interface PlanResponse {
  status: 'optimal' | 'feasible' | 'partial' | 'greedy';
  assignments: { timeSlotId: string; busIds: string[]; seats: number; shortfall: number }[];
}

export interface ParsedRoutine {
  contentHash: string;
  department: string;
  sessions: (ForecastRequest['sessions'][number] & { courseCode?: string | null; room?: string | null })[];
  warnings: string[];
}

export interface MlClient {
  forecast(req: ForecastRequest): Promise<ForecastResponse>;
  plan(req: PlanRequest): Promise<PlanResponse>;
  parseRoutine(file: { name: string; bytes: Buffer }, department: string): Promise<ParsedRoutine>;
  fetchRoutine(url: string, department: string): Promise<ParsedRoutine>;
}

export class HttpMlClient implements MlClient {
  constructor(private readonly baseUrl: string, private readonly token?: string) {}

  private headers(extra: Record<string, string> = {}) {
    return { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...extra };
  }

  private async post<T>(path: string, body: unknown, timeoutMs = 60_000): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`ML service ${path} failed: ${res.status} ${await res.text().catch(() => '')}`.trim());
    return (await res.json()) as T;
  }

  forecast(req: ForecastRequest) { return this.post<ForecastResponse>('/v1/forecast', req, 120_000); }
  plan(req: PlanRequest) { return this.post<PlanResponse>('/v1/allocation/plan', req); }
  fetchRoutine(url: string, department: string) { return this.post<ParsedRoutine>('/v1/routines/fetch', { url, department }); }

  async parseRoutine(file: { name: string; bytes: Buffer }, department: string): Promise<ParsedRoutine> {
    const form = new FormData();
    form.set('department', department);
    form.set('file', new Blob([new Uint8Array(file.bytes)]), file.name);
    const res = await fetch(`${this.baseUrl}/v1/routines/parse`, { method: 'POST', headers: this.headers(), body: form, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`ML service /v1/routines/parse failed: ${res.status}`);
    return (await res.json()) as ParsedRoutine;
  }
}
