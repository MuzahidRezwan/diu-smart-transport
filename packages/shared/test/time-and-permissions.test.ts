import { describe, expect, it } from 'vitest';
import { addDays, busyWindow, formatClock, parseHHMM, toHHMM, weekdayOf, windowsOverlap } from '../src/time.js';
import { ALL_PERMISSIONS, hasPermission, isPermission } from '../src/permissions.js';
import { adminCreateSchema, noticeCreateSchema, paymentsQuerySchema, universityId } from '../src/schemas.js';

describe('time helpers', () => {
  it('parses and formats clock times', () => {
    expect(parseHHMM('07:30')).toBe(450);
    expect(toHHMM(450)).toBe('07:30');
    expect(formatClock(13 * 60 + 5)).toBe('1:05 PM');
    expect(formatClock(0)).toBe('12:00 AM');
    expect(() => parseHHMM('24:00')).toThrow();
  });

  it('treats back-to-back windows as not overlapping', () => {
    expect(windowsOverlap({ start: 420, end: 510 }, { start: 510, end: 600 })).toBe(false);
    expect(windowsOverlap({ start: 420, end: 511 }, { start: 510, end: 600 })).toBe(true);
  });

  it('keeps a from-campus bus busy until it is back at DSC', () => {
    expect(busyWindow('from_campus', 16 * 60 + 30, 75)).toEqual({ start: 990, end: 1140 });
    expect(busyWindow('to_campus', 7 * 60, 75, 30)).toEqual({ start: 420, end: 525 });
  });

  it('does date arithmetic on plain dates', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(weekdayOf('2026-11-20')).toBe(5); // Friday
  });
});

describe('permissions', () => {
  it('has no permission to read or impersonate rider profiles', () => {
    for (const p of ALL_PERMISSIONS) {
      expect(p).not.toMatch(/profile|impersonat|users\.(read|edit|view)|login_as/);
    }
  });

  it('gives main admins everything and co-admins only what they hold', () => {
    expect(hasPermission({ isMainAdmin: true, permissions: [] }, 'payments.export')).toBe(true);
    expect(hasPermission({ isMainAdmin: false, permissions: ['cards.approve'] }, 'payments.export')).toBe(false);
    expect(isPermission('allocation.publish')).toBe(true);
    expect(isPermission('users.read_profile')).toBe(false);
  });

  it('rejects unknown permissions when creating a co-admin', () => {
    const bad = adminCreateSchema.safeParse({ universityId: '710233', name: 'Rafiqul Islam', designation: 'Officer', permissions: ['users.read_profile'] });
    expect(bad.success).toBe(false);
  });
});

describe('schemas', () => {
  it('accepts only full university IDs', () => {
    expect(universityId.safeParse('232-35-797').success).toBe(true);
    expect(universityId.safeParse('710215').success).toBe(true);
    expect(universityId.safeParse('232-35').success).toBe(false);
    expect(universityId.safeParse('Khalil').success).toBe(false);
  });

  it('requires a route for route notices', () => {
    expect(noticeCreateSchema.safeParse({ title: 'Delay on 4:30 PM', audience: 'route' }).success).toBe(false);
  });

  it('limits payment reports to 93 days', () => {
    expect(paymentsQuerySchema.safeParse({ from: '2026-09-01', to: '2026-11-19' }).success).toBe(true);
    expect(paymentsQuerySchema.safeParse({ from: '2026-01-01', to: '2026-11-19' }).success).toBe(false);
  });
});
