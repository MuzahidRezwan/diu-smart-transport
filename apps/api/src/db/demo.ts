/**
 * Fills a seeded development database with a realistic demo: an active SWE and
 * CSE routine, ~900 student and 40 faculty card holders with payments over the
 * last two weeks, a few requests, tickets and notices. Development only.
 *
 *   npm run db:seed && npm run db:demo
 */
import { eq, sql } from 'drizzle-orm';
import { addDays, dhakaDate } from '@diu/shared';
import { connect } from './client.js';
import {
  classSessions, dayPasses, notices, payments, routes, routineVersions, semesters, tickets, timeSlots, transportCards, userProfiles, users,
} from './schema.js';
import { MockDirectory } from '../auth/providers.js';
import { SAMPLE_FEES } from './seed-data.js';
import { encrypt, randomToken } from '../lib/crypto.js';
import { nextTicketNumber } from '../modules/tickets/routes.js';

if (process.env.NODE_ENV === 'production') { console.error('Refusing to load demo data in production.'); process.exit(1); }

let seed = 20261119;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;

const database = await connect({ databaseUrl: process.env.DATABASE_URL, pgliteDir: process.env.PGLITE_DIR ?? './.data/pglite', migrate: true });
const db = database.db;
const [sem] = await db.select().from(semesters).where(eq(semesters.isCurrent, true));
if (!sem) { console.error('Run npm run db:seed first.'); process.exit(1); }
const existing = await db.execute(sql`select count(*)::int as n from transport_cards`);
if (Number((existing as unknown as { rows: { n: number }[] }).rows[0]!.n) > 0) { console.log('Demo data already loaded.'); process.exit(0); }

if (!process.env.DATA_ENCRYPTION_KEY) { console.error('Set DATA_ENCRYPTION_KEY in .env first (the API must use the same key to read card QR secrets).'); process.exit(1); }
const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'base64');
const routeRows = await db.select().from(routes);
const regular = routeRows.filter((r) => r.kind === 'regular');
// Riders per route, roughly: busy city routes get more. Codes of the DIU timetable and of the test sample.
const weights: Record<string, number> = {
  R1: 14, R2: 12, R3: 8, R4: 14, R5: 5, R6: 6, R7: 5, R8: 8, R9: 4, R10: 5, R11: 8, R12: 5, R13: 6,
  'R-01': 26, 'R-02': 22, 'R-03': 18, 'R-04': 12, 'R-05': 10, 'SH-1': 12,
};
const weighted = routeRows.flatMap((r) => Array(weights[r.code] ?? 5).fill(r));
// The sketch's sample student rides from Mirpur-10 (R4 in the DIU timetable).
const khalilRoute = routeRows.find((r) => r.code === 'R4') ?? routeRows.find((r) => r.code === 'R-01') ?? routeRows[0]!;
// Staff live on routes that have staff trips (the 4:20 PM employee buses), when there are any.
const staffRouteIds = new Set((await db.selectDistinct({ id: timeSlots.routeId }).from(timeSlots).where(eq(timeSlots.audience, 'faculty'))).map((r) => r.id));
const staffRoutes = regular.filter((r) => staffRouteIds.has(r.id));

/* ---------- routines ---------- */
const STARTS = [510, 600, 690, 780, 870, 960];
const TEACHERS = ['MRH', 'NRS', 'TBR', 'KMR', 'ABK', 'SAK', 'FIS', 'MHK', 'RBA', 'JNT', 'SMA', 'AKZ', 'NZH', 'MTI', 'RKH', 'SHB', 'TAR', 'MNA', 'KRS', 'FHM'];
const DAYS = [0, 1, 2, 3, 4, 5, 6]; // 5 = Friday: DIU runs Friday buses, and some sections have Friday classes
for (const [dept, batches] of [['SWE', [39, 40, 41, 42, 43, 44, 45]], ['CSE', [55, 56, 57, 58, 59, 60, 61, 62, 63]]] as const) {
  const [v] = await db.insert(routineVersions).values({ department: dept, fileName: `${dept.toLowerCase()}-routine-demo.csv`, contentHash: `demo-${dept}`, status: 'active', activatedAt: new Date() }).returning();
  const rows = [];
  for (const b of batches) for (const s of 'ABCDEFGH') for (const wd of DAYS) {
    const friday = wd === 5;
    if (rnd() < (friday ? 0.75 : 0.25)) continue; // free day; most sections have no Friday class
    const first = friday ? 1 + Math.floor(rnd() * 2) : Math.floor(rnd() * 4); // Friday classes start at 10:00 or later
    const n = 1 + Math.floor(rnd() * (friday ? 2 : 3));
    for (let k = 0; k < n && first + k < STARTS.length; k++) {
      rows.push({ routineVersionId: v!.id, department: dept, batch: String(b), section: s, teacherInitial: pick(TEACHERS), weekday: wd, startMinutes: STARTS[first + k]!, endMinutes: STARTS[first + k]! + 90, courseCode: `${dept}${300 + Math.floor(rnd() * 200)}`, room: `AB4-${600 + Math.floor(rnd() * 20)}` });
    }
  }
  for (let i = 0; i < rows.length; i += 500) await db.insert(classSessions).values(rows.slice(i, i + 500));
  await db.update(routineVersions).set({ sessionCount: rows.length }).where(eq(routineVersions.id, v!.id));
}

/* ---------- riders with paid cards ---------- */
const directory = new MockDirectory();
const today = dhakaDate();
const METHODS = ['bKash', 'bKash', 'bKash', 'Nagad', 'Nagad', 'Card', 'Rocket'];
const ids = new Set<string>(['232-35-797']);
const deptOf = new Map<string, 'SWE' | 'CSE'>([['232-35-797', 'SWE']]);
while (ids.size < 900) {
  const swe = rnd() < 0.55;
  const uid = `${pick(['22', '23', '24'])}${1 + Math.floor(rnd() * 3)}-${swe ? '35' : '15'}-${String(Math.floor(rnd() * 999)).padStart(3, '0')}`;
  if (!ids.has(uid)) { ids.add(uid); deptOf.set(uid, swe ? 'SWE' : 'CSE'); }
}
/** Keep every demo rider inside a batch that the demo routine has. */
function demoBatch(uid: string, fromDirectory?: string): string {
  if (uid === '232-35-797') return '41';
  if (deptOf.get(uid) === 'CSE') return String(55 + Math.floor(rnd() * 9));
  const b = Number(fromDirectory);
  return b >= 39 && b <= 45 ? String(b) : String(39 + Math.floor(rnd() * 7));
}
let tranN = 1;
for (const uid of ids) {
  const p = (await directory.lookup(uid))!;
  const route = uid === '232-35-797' ? khalilRoute : pick(weighted);
  const category = uid === '232-35-797' ? 'student_tri_semester' : p.category === 'hall_resident' && route.kind !== 'shuttle' ? 'student_tri_semester' : p.category;
  const [u] = await db.insert(users).values({ universityId: uid, name: p.name, role: 'student', category, homeRouteId: route.id }).returning({ id: users.id });
  await db.insert(userProfiles).values({ userId: u!.id, department: deptOf.get(uid) === 'CSE' ? 'Computer Science and Engineering' : 'Software Engineering', batch: demoBatch(uid, p.batch), section: uid === '232-35-797' ? 'G' : p.section, phone: p.phone, email: p.email });
  const paidOn = addDays(today, -Math.floor(rnd() * 14));
  let paidAt = new Date(`${paidOn}T${String(8 + Math.floor(rnd() * 14)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00+06:00`);
  if (paidAt > new Date()) paidAt = new Date(Date.now() - Math.floor(rnd() * 6 * 3600_000)); // no payments in the future
  const [card] = await db.insert(transportCards).values({ userId: u!.id, semesterId: sem.id, routeId: route.id, status: 'active', source: 'payment', issuedAt: paidAt, expiresOn: sem.endsOn, qrSecretEnc: encrypt(key, randomToken(32)) }).returning({ id: transportCards.id });
  const amount = SAMPLE_FEES[category];
  if (rnd() < 0.05) {
    await db.insert(payments).values({ userId: u!.id, cardId: card!.id, semesterId: sem.id, amountBdt: amount, gateway: 'sslcommerz', tranId: `DIU-TC-${paidOn.slice(2).replace(/-/g, '')}-F${String(tranN++).padStart(4, '0')}`, status: 'failed', method: 'bKash', failureReason: 'Insufficient balance', createdAt: new Date(paidAt.getTime() - 600_000) });
  }
  await db.insert(payments).values({ userId: u!.id, cardId: card!.id, semesterId: sem.id, amountBdt: amount, gateway: 'sslcommerz', tranId: `DIU-TC-${paidOn.slice(2).replace(/-/g, '')}-${String(tranN++).padStart(5, '0')}`, status: 'success', method: pick(METHODS), createdAt: paidAt, paidAt });
}

/* ---------- faculty riders who teach in those routines ---------- */
for (let i = 0; i < 40; i++) {
  const initial = TEACHERS[i % TEACHERS.length]!;
  const uid = `7104${String(10 + i).padStart(2, '0')}`;
  const route = pick(staffRoutes.length ? staffRoutes : regular);
  const [u] = await db.insert(users).values({ universityId: uid, name: `Faculty ${initial}`, role: 'faculty', category: 'faculty', homeRouteId: route.id }).returning({ id: users.id });
  await db.insert(userProfiles).values({ userId: u!.id, department: 'Software Engineering', teacherInitial: initial, designation: 'Lecturer' });
  await db.insert(transportCards).values({ userId: u!.id, semesterId: sem.id, routeId: route.id, status: 'active', source: 'payment', issuedAt: new Date(), expiresOn: sem.endsOn, qrSecretEnc: encrypt(key, randomToken(32)) });
}

/* ---------- things waiting for the transport office ---------- */
for (const [uid, note] of [['232-35-812', 'Sports quota, letter from the Proctor'], ['241-11-205', 'Payment failed twice, asking to pay in cash']] as const) {
  const p = (await directory.lookup(uid))!;
  const r = pick(regular);
  const [u] = await db.insert(users).values({ universityId: uid, name: p.name, role: 'student', category: p.category, homeRouteId: r.id }).returning({ id: users.id });
  await db.insert(userProfiles).values({ userId: u!.id, department: p.department, batch: p.batch, section: p.section, phone: p.phone });
  await db.insert(transportCards).values({ userId: u!.id, semesterId: sem.id, routeId: r.id, status: 'pending_approval', reason: note });
}
const passUser = (await directory.lookup('233-15-020'))!;
const [pu] = await db.insert(users).values({ universityId: '233-15-020', name: passUser.name, role: 'student', category: 'student_tri_semester', homeRouteId: regular[1]!.id }).returning({ id: users.id });
const next = addDays(today, 1);
await db.insert(dayPasses).values([
  { userId: pu!.id, semesterId: sem.id, routeId: regular[1]!.id, travelDate: addDays(today, -7), status: 'used', autoApproved: true },
  { userId: pu!.id, semesterId: sem.id, routeId: regular[1]!.id, travelDate: next, status: 'pending', autoApproved: false },
]);

const any = await db.select({ id: users.id }).from(users).where(eq(users.role, 'student')).limit(3);
// Numbers come from the ticket sequences, so riders' new tickets never collide with these.
await db.insert(tickets).values([
  { number: await nextTicketNumber(db, 'complaint'), kind: 'complaint', category: 'overcrowding', userId: any[0]!.id, routeId: regular[1]!.id, body: 'The 2:30 PM Uttara bus left about 20 people at DSC.' },
  { number: await nextTicketNumber(db, 'suggestion'), kind: 'suggestion', category: 'other', userId: any[1]!.id, routeId: regular[2]!.id, body: 'Please add a 9:15 AM bus from Dhanmondi for 10:30 classes.' },
  { number: await nextTicketNumber(db, 'help'), kind: 'help', subject: 'Card not showing', userId: any[2]!.id, body: 'I paid this morning but My Card still says pending.' },
]);
await db.insert(notices).values([
  { title: 'Friday bus schedule', body: 'On Fridays buses leave for DSC at 7:30 AM and return at 11:30 AM and 4:30 PM (Savar route 11:50 AM and 4:50 PM).', audience: 'all' },
  { title: `${sem.name} transport card renewal is open`, body: 'Renew from the app to keep riding next semester.', audience: 'all' },
]);

console.log(`Demo loaded: ${ids.size} students and 40 faculty with active cards, 2 routines, requests, tickets and notices.`);
await database.close();
