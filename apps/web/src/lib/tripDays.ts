import { useQueries } from '@tanstack/react-query';
import { api } from './api';
import { addDays } from './format';

export interface TripDay { date: string; trips: number; closed: string | null }

/**
 * How many trips run on each of `days` days from `from`, read from the published
 * timetable (and holidays), so no weekday is assumed to be off.
 */
export function useTripDays(from: string, days: number) {
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const results = useQueries({
    queries: dates.map((date) => ({
      queryKey: ['schedule-day', date],
      queryFn: () => api<{ closed: string | null; slots: unknown[] }>('/schedule', { query: { date } }),
      staleTime: 5 * 60_000,
    })),
  });
  const byDate = new Map<string, TripDay>();
  results.forEach((r, i) => { if (r.data) byDate.set(dates[i]!, { date: dates[i]!, trips: r.data.slots.length, closed: r.data.closed }); });
  const loaded = results.every((r) => r.isSuccess);
  /** First day from `from` that has trips (or `from` itself until everything has loaded). */
  const firstWithTrips = loaded ? (dates.find((d) => (byDate.get(d)?.trips ?? 0) > 0) ?? from) : from;
  return { byDate, loaded, firstWithTrips };
}
