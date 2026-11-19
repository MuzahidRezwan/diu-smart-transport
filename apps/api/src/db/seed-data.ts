/**
 * Sample data for local development and tests: one semester, three operators,
 * 36 buses, five routes plus the Sony shuttle, time slots and fee rules.
 * Coordinates and stops are approximate and for demonstration only.
 */
import bcrypt from 'bcryptjs';
import { ALL_PERMISSIONS, parseHHMM, type UserCategory } from '@diu/shared';
import type { DB } from './client.js';
import { adminAccounts, buses, feeRules, operators, routeStops, routes, semesters, timeSlots, users } from './schema.js';

const DSC = { name: 'DSC (Daffodil Smart City)', lat: 23.8768, lng: 90.3207 };

export const SAMPLE_ROUTES = [
  { code: 'R-01', name: 'Mirpur-10', durationMinutes: 75, early: 0, stops: [['Mirpur-10', 23.8069, 90.3687], ['Mirpur-1', 23.7957, 90.3537], ['Beribadh', 23.8290, 90.3300], ['Ashulia Bazar', 23.8975, 90.3195]] },
  { code: 'R-02', name: 'Uttara', durationMinutes: 60, early: 0, stops: [['Uttara House Building', 23.8740, 90.4007], ['Abdullahpur', 23.8797, 90.4000], ['Dhour', 23.8890, 90.3640], ['Ashulia Bazar', 23.8975, 90.3195]] },
  { code: 'R-03', name: 'Dhanmondi', durationMinutes: 95, early: 20, stops: [['Dhanmondi-27', 23.7561, 90.3740], ['Asad Gate', 23.7600, 90.3680], ['Mirpur-1', 23.7957, 90.3537], ['Beribadh', 23.8290, 90.3300]] },
  { code: 'R-04', name: 'Tongi', durationMinutes: 55, early: 0, stops: [['Tongi College Gate', 23.8935, 90.4035], ['Station Road', 23.8975, 90.4060], ['Abdullahpur', 23.8797, 90.4000], ['Ashulia Bazar', 23.8975, 90.3195]] },
  { code: 'R-05', name: 'Savar', durationMinutes: 45, early: 0, stops: [['Savar Bus Stand', 23.8450, 90.2570], ['Genda', 23.8566, 90.2620], ['Baipail', 23.9100, 90.2900]] },
  { code: 'SH-1', name: 'Sony shuttle', durationMinutes: 40, early: 0, shuttle: true, stops: [['Sony (Mirpur-2)', 23.8050, 90.3640], ['Mirpur-1', 23.7957, 90.3537], ['Beribadh', 23.8290, 90.3300]] },
] as const;

const SERVICE_DAYS = [0, 1, 2, 3, 4, 6]; // Saturday–Thursday; Friday is the weekly holiday
const WAVES = {
  student: { to_campus: ['07:00', '08:30', '10:00'], from_campus: ['13:00', '14:30', '16:30', '18:00'] },
  faculty: { to_campus: ['07:30'], from_campus: ['17:00'] },
} as const;

export const SAMPLE_FEES: Record<UserCategory, number> = {
  student_tri_semester: 4500, student_bi_semester: 6000, student_thesis_only: 3000, student_short_course: 2000,
  hall_resident: 1500, faculty: 3000, admin_staff: 2500,
};

export interface SeedResult {
  semesterId: string;
  routeIds: Record<string, string>;
  busIds: Record<string, string>;
  slotIds: Record<string, string>;
  mainAdmin: { userId: string; universityId: string; password: string };
}

export async function seed(db: DB, opts: { adminPassword: string; semester?: { code: string; name: string; startsOn: string; endsOn: string } }): Promise<SeedResult> {
  const sem = opts.semester ?? { code: 'FALL-2026', name: 'Fall 2026', startsOn: '2026-09-01', endsOn: '2026-12-31' };
  const [semester] = await db.insert(semesters).values({ ...sem, isCurrent: true }).returning();

  const ops = await db.insert(operators).values([
    { code: 'H', name: 'Hanif' }, { code: 'M', name: 'Monir' }, { code: 'S', name: 'Surjomukhi' },
  ]).returning();
  const opId = Object.fromEntries(ops.map((o) => [o.code, o.id]));
  const fleet: { code: string; op: string; cap: number; pool: 'student' | 'faculty' }[] = [
    ...[10, 12, 14, 15, 16, 18, 20, 22, 24, 25, 27, 29].map((n) => ({ code: `H-${n}`, op: 'H', cap: 40, pool: 'student' as const })),
    ...[30, 31, 33].map((n) => ({ code: `H-${n}`, op: 'H', cap: 40, pool: 'faculty' as const })),
    ...[3, 5, 8, 10, 11, 12, 13, 15, 17, 19].map((n) => ({ code: `M-${String(n).padStart(2, '0')}`, op: 'M', cap: 36, pool: 'student' as const })),
    ...[20, 21, 22].map((n) => ({ code: `M-${n}`, op: 'M', cap: 36, pool: 'faculty' as const })),
    ...[1, 2, 3, 5, 7, 9, 11, 12].map((n) => ({ code: `S-${String(n).padStart(2, '0')}`, op: 'S', cap: 30, pool: 'student' as const })),
  ];
  const busRows = await db.insert(buses).values(fleet.map((b, i) => ({
    code: b.code, operatorId: opId[b.op]!, seatCapacity: b.cap, pool: b.pool, driverName: `Driver ${i + 1}`, driverPhone: `0171${String(1000000 + i * 37).slice(0, 7)}`,
  }))).returning({ id: buses.id, code: buses.code });

  const routeIds: Record<string, string> = {};
  const slotIds: Record<string, string> = {};
  for (const r of SAMPLE_ROUTES) {
    const shuttle = 'shuttle' in r && r.shuttle;
    const [row] = await db.insert(routes).values({ code: r.code, name: r.name, kind: shuttle ? 'shuttle' : 'regular', durationMinutes: r.durationMinutes }).returning();
    routeIds[r.code] = row!.id;
    await db.insert(routeStops).values([...r.stops.map(([name, lat, lng]) => ({ name, lat, lng })), DSC].map((s, i) => ({ routeId: row!.id, seq: i + 1, ...s })));
    for (const aud of ['student', 'faculty'] as const) {
      if (aud === 'faculty' && (shuttle || r.code === 'R-05')) continue;
      for (const dir of ['to_campus', 'from_campus'] as const) {
        for (const wave of WAVES[aud][dir]) {
          let dep = parseHHMM(wave);
          if (dir === 'to_campus') dep -= r.early;
          if (shuttle) dep += 15;
          const [slot] = await db.insert(timeSlots).values({ routeId: row!.id, direction: dir, audience: aud, departureMinutes: dep, weekdays: SERVICE_DAYS, semesterId: semester!.id }).returning({ id: timeSlots.id });
          slotIds[`${r.code}|${aud}|${dir}|${wave}`] = slot!.id;
        }
      }
    }
  }

  await db.insert(feeRules).values(Object.entries(SAMPLE_FEES).map(([category, amountBdt]) => ({ semesterId: semester!.id, category: category as UserCategory, amountBdt })));

  const [admin] = await db.insert(users).values({ universityId: '710215', name: 'Mr. Anisur Rahman', role: 'authority' }).returning({ id: users.id });
  await db.insert(adminAccounts).values({
    userId: admin!.id, designation: 'Transport Head', passwordHash: await bcrypt.hash(opts.adminPassword, 10), isMainAdmin: true,
    mustChangePassword: false, permissions: [...ALL_PERMISSIONS],
  });

  return {
    semesterId: semester!.id,
    routeIds,
    busIds: Object.fromEntries(busRows.map((b) => [b.code, b.id])),
    slotIds,
    mainAdmin: { userId: admin!.id, universityId: '710215', password: opts.adminPassword },
  };
}
