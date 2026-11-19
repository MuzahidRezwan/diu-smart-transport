import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { settings } from '../db/schema.js';

export interface AppSettings {
  dayPassLimitPerSemester: number;
  dayPassOverLimit: 'reject' | 'manual';
  allocationBufferPct: number;
  defaultTurnaroundMinutes: number;
  attendanceFactorColdStart: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  dayPassLimitPerSemester: 1,
  dayPassOverLimit: 'manual',
  allocationBufferPct: 0.1,
  defaultTurnaroundMinutes: 30,
  attendanceFactorColdStart: 0.85,
};

export async function getSettings(db: DB): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULT_SETTINGS, ...stored } as AppSettings;
}

export async function putSettings(db: DB, patch: Partial<AppSettings>, actorId: string): Promise<AppSettings> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = await db.select().from(settings).where(eq(settings.key, key));
    if (existing.length) await db.update(settings).set({ value: value as unknown as object, updatedBy: actorId, updatedAt: new Date() }).where(eq(settings.key, key));
    else await db.insert(settings).values({ key, value: value as unknown as object, updatedBy: actorId });
  }
  return getSettings(db);
}
