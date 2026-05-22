// V030-004: weekly fill strategy.
//
// The pipeline's main aim is to fill the entire current N-day window
// (default 7) with scheduled posts before moving on. The daemon already
// had a "target met" check baked into the continuous-mode sleep block,
// but the logic was inline and the per-day target was hardcoded at 2.
// Pulling it out to a pure helper lets:
//   1. the daemon and the UI agree on what "filled" means
//   2. tests exercise the math without spinning up React
//   3. a future change to the target formula (e.g. variable by day of
//      week) lands in one place
//
// Deliberately pure — no Date.now() reads inside; the caller passes
// `now` so tests can pin it.

import type { ScheduledPost } from '../types/mashup';
import { formatLocalDate } from './local-date';

export interface DayFill {
  /** YYYY-MM-DD in the caller's local timezone. */
  date: string;
  /** Weekday short name: 'Mon' | 'Tue' | … | 'Sun'. */
  dayLabel: string;
  /** Count of `status==='scheduled'` posts on this day (counted toward fill). */
  scheduledCount: number;
  /** Per-day target (currently uniform, may vary per day in future). */
  target: number;
  /** target minus scheduledCount, floored at 0. */
  gap: number;
  /**
   * Count of `status==='pending_approval'` posts on this day. Tracked
   * separately so the daemon can decide whether to keep generating
   * (pending approvals don't publish, so they shouldn't satisfy the
   * weekly fill check) — see continuous-mode block in usePipelineDaemon.
   */
  pendingApprovalCount: number;
}

export interface WeekFillStatus {
  /** N-day horizon the status was computed for. */
  targetDays: number;
  /** Per-day target used for the math. */
  postsPerDay: number;
  /**
   * Sum of `min(day.scheduledCount, day.target)` per day. Each day
   * contributes at most `postsPerDay` slots so the aggregate is a
   * "filled slots" measure, not a raw post count, and is guaranteed
   * to satisfy `scheduledTotal <= targetTotal`. Use a per-day
   * `scheduledCount` if you need the raw number on a single day.
   */
  scheduledTotal: number;
  /** targetDays * postsPerDay. */
  targetTotal: number;
  /** true iff scheduledTotal >= targetTotal. */
  filled: boolean;
  /** Percentage 0..100, rounded to the nearest int for UI use. */
  percent: number;
  /** Ordered from today forward (days.length === targetDays). */
  days: DayFill[];
  /**
   * Sum of `pending_approval` posts across all days in the horizon.
   * Used by continuous mode: when `filled === true` but this is > 0,
   * the daemon keeps cycling instead of sleeping — pending approvals
   * are not publishable slots.
   */
  pendingApprovalTotal: number;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Build a per-day breakdown of `scheduled` and `pending_approval` posts
 * in each of the next `targetDays` days, starting from TODAY (was tomorrow
 * excluded — matches `findBestSlots` in smartScheduler.ts which also
 * schedules from tomorrow, so the daemon's "filled?" check and the
 * scheduler's slot-pick agree on which days count). Posts in the past
 * are filtered out.
 *
 * Terminal statuses (`posted`, `failed`, `rejected`) are excluded — they
 * don't contribute to "still to be published" capacity planning.
 *
 * Only `status === 'scheduled'` posts count toward `scheduledCount` /
 * `scheduledTotal` / `filled`. `pending_approval` posts are tracked
 * separately on `pendingApprovalCount` / `pendingApprovalTotal`: they're
 * real work in flight but not publishable slots, so the daemon should
 * keep generating until enough get approved to actually fill the week.
 */
export function computeWeekFillStatus(
  posts: ScheduledPost[] | undefined,
  targetDays: number,
  postsPerDay: number,
  now: Date = new Date(),
): WeekFillStatus {
  const days: DayFill[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  // INCLUDE-TODAY (2026-05-22): the per-day breakdown now starts from
  // TODAY instead of tomorrow. findBestSlots was updated to consider
  // today's remaining hours as candidate slots; this anchor change
  // keeps the daemon's "filled?" check aligned with what the scheduler
  // actually picks. Posts in the past are still filtered by the
  // `ts < now.getTime()` guard below, so today's already-elapsed hours
  // don't inflate the scheduled count.

  const scheduledCounts = new Map<string, number>();
  const pendingCounts = new Map<string, number>();
  if (posts && posts.length > 0) {
    for (const p of posts) {
      if (p.status === 'posted' || p.status === 'failed' || p.status === 'rejected') continue;
      // Treat malformed date/time strings as "skip" rather than throwing —
      // callers include user-edited settings that may be half-filled.
      const ts = new Date(`${p.date}T${p.time}:00`).getTime();
      if (!Number.isFinite(ts)) continue;
      if (ts < now.getTime()) continue;
      if (p.status === 'pending_approval') {
        pendingCounts.set(p.date, (pendingCounts.get(p.date) ?? 0) + 1);
      } else {
        // Treat undefined / 'scheduled' as scheduled — same convention as
        // countFutureScheduledPosts which treats undefined as in-flight.
        scheduledCounts.set(p.date, (scheduledCounts.get(p.date) ?? 0) + 1);
      }
    }
  }

  for (let i = 0; i < targetDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = formatLocalDate(d);
    const scheduledCount = scheduledCounts.get(dateStr) ?? 0;
    const pendingApprovalCount = pendingCounts.get(dateStr) ?? 0;
    days.push({
      date: dateStr,
      dayLabel: DAY_LABELS[d.getDay()],
      scheduledCount,
      target: postsPerDay,
      gap: Math.max(0, postsPerDay - scheduledCount),
      pendingApprovalCount,
    });
  }

  // Cap each day's contribution at its target so the aggregate is
  // bounded by targetTotal — over-scheduling on one day must not
  // make the week look "120%" full when other days are still empty.
  // Per-day `scheduledCount` remains the raw count for tooltips.
  const scheduledTotal = days.reduce(
    (sum, d) => sum + Math.min(d.scheduledCount, d.target),
    0,
  );
  const pendingApprovalTotal = days.reduce(
    (sum, d) => sum + d.pendingApprovalCount,
    0,
  );
  const targetTotal = targetDays * postsPerDay;
  const percent = targetTotal === 0
    ? 0
    : Math.min(100, Math.round((scheduledTotal / targetTotal) * 100));

  return {
    targetDays,
    postsPerDay,
    scheduledTotal,
    targetTotal,
    filled: scheduledTotal >= targetTotal,
    percent,
    days,
    pendingApprovalTotal,
  };
}
