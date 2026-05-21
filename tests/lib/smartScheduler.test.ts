import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  findBestSlot,
  findBestSlots,
  loadEngagementData,
  saveEngagementData,
  type CachedEngagement,
  type ExistingPost,
} from '@/lib/smartScheduler';

function makeEngagement(): CachedEngagement {
  return {
    hours: [
      { hour: 12, weight: 0.5 },
      { hour: 18, weight: 0.85 },
      { hour: 20, weight: 0.95 },
    ],
    days: [
      { day: 0, multiplier: 0.9 },
      { day: 1, multiplier: 0.7 },
      { day: 2, multiplier: 0.75 },
      { day: 3, multiplier: 0.8 },
      { day: 4, multiplier: 0.85 },
      { day: 5, multiplier: 0.95 },
      { day: 6, multiplier: 1.0 },
    ],
    fetchedAt: Date.now(),
    source: 'default',
  };
}

function setupLocalStorageStub() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
  return store;
}

describe('findBestSlots', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin to a fixed Wednesday so weekend bonuses and day rotations
    // are deterministic across CI/local runs.
    vi.setSystemTime(new Date('2026-04-15T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns the requested count of slots', () => {
    const slots = findBestSlots([], 3, makeEngagement());
    expect(slots).toHaveLength(3);
  });

  it('skips slots that are already taken', () => {
    const eng = makeEngagement();
    const all = findBestSlots([], 1, eng);
    const taken: ExistingPost = { date: all[0].date, time: all[0].time };
    const next = findBestSlots([taken], 1, eng);
    expect(`${next[0].date}T${next[0].time}`).not.toBe(`${all[0].date}T${all[0].time}`);
  });

  it('sorts slots by score descending', () => {
    const slots = findBestSlots([], 5, makeEngagement());
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i - 1].score).toBeGreaterThanOrEqual(slots[i].score);
    }
  });

  it('starts the search from tomorrow, never today', () => {
    // findBestSlots emits LOCAL date strings — derive `todayStr` the same
    // way to avoid a UTC/local mismatch on hosts that span a date line
    // relative to the pinned 10:00 UTC anchor.
    const today = new Date('2026-04-15T10:00:00Z');
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const slots = findBestSlots([], 10, makeEngagement());
    for (const s of slots) {
      expect(s.date).not.toBe(todayStr);
    }
  });

  it('honours per-platform daily caps — full day is skipped when any target platform is at cap', () => {
    const eng = makeEngagement();
    const baseline = findBestSlots([], 1, eng);
    const cappedDate = baseline[0].date;
    const existing: ExistingPost[] = [
      { date: cappedDate, time: '12:00', platforms: ['instagram'], status: 'scheduled' },
      { date: cappedDate, time: '18:00', platforms: ['instagram'], status: 'scheduled' },
    ];
    const slots = findBestSlots(existing, 5, eng, {
      platforms: ['instagram'],
      caps: { instagram: 2 },
    });
    for (const s of slots) {
      expect(s.date).not.toBe(cappedDate);
    }
  });

  it('ignores `posted` and `failed` posts when computing platform caps', () => {
    const eng = makeEngagement();
    const baseline = findBestSlots([], 1, eng);
    const targetDate = baseline[0].date;
    // Fill the day with posted+failed entries — those should NOT count.
    const existing: ExistingPost[] = [
      { date: targetDate, time: '06:00', platforms: ['instagram'], status: 'posted' },
      { date: targetDate, time: '07:00', platforms: ['instagram'], status: 'failed' },
    ];
    const slots = findBestSlots(existing, 5, eng, {
      platforms: ['instagram'],
      caps: { instagram: 1 },
    });
    // The day should still be available since posted+failed don't count.
    expect(slots.some(s => s.date === targetDate)).toBe(true);
  });

  it('returns empty array when count is 0', () => {
    expect(findBestSlots([], 0, makeEngagement())).toEqual([]);
  });

  describe('AUTO-SCHEDULE-FIX (2026-05-21): postsPerDay hard cap', () => {
    it('caps same-call picks at postsPerDay per day', () => {
      // Maurice's bug: without a hard cap, 5 requested slots could all
      // land on the dominant engagement day (Saturday). With postsPerDay=1
      // each day can hold at most one slot from this call.
      const slots = findBestSlots([], 5, makeEngagement(), { postsPerDay: 1 });
      const dates = slots.map((s) => s.date);
      const uniqueDates = new Set(dates);
      expect(uniqueDates.size).toBe(dates.length);
      expect(dates.length).toBe(5);
    });

    it('respects existing posts in the cap accounting', () => {
      // 2 existing posts on the engagement-best day saturate it. A new
      // pick with postsPerDay=2 must land somewhere else.
      const eng = makeEngagement();
      const baselineSlot = findBestSlots([], 1, eng)[0];
      const dominantDate = baselineSlot.date;
      const existing = [
        { date: dominantDate, time: '20:00', platforms: ['instagram'] },
        { date: dominantDate, time: '19:00', platforms: ['instagram'] },
      ];
      const next = findBestSlots(existing, 1, eng, { postsPerDay: 2 });
      expect(next.length).toBe(1);
      expect(next[0].date).not.toBe(dominantDate);
    });

    it('without postsPerDay (undefined) preserves old soft-penalty behaviour', () => {
      // Back-compat: 5 picks against an engagement profile with a heavy
      // weekend bias would historically stack on the dominant day. We
      // assert that the cap-less path still permits same-day duplicates
      // (the existing soft penalty isn't strong enough). If this test
      // ever flips to all-unique, the soft penalty was tuned up — fine,
      // but the cap test above is the real guarantee.
      const slots = findBestSlots([], 5, makeEngagement());
      const dates = slots.map((s) => s.date);
      expect(dates.length).toBe(5);
      // Don't assert uniqueness — point is the cap path is what enforces it.
    });

    it('caps interact with platform per-day caps (both honored)', () => {
      const slots = findBestSlots([], 4, makeEngagement(), {
        postsPerDay: 1,
        platforms: ['instagram'],
        caps: { instagram: 1 },
      });
      const dates = slots.map((s) => s.date);
      expect(new Set(dates).size).toBe(dates.length);
    });
  });

  it('reason string mentions IG data when source is instagram', () => {
    const eng = makeEngagement();
    eng.source = 'instagram';
    const slots = findBestSlots([], 1, eng);
    expect(slots[0].reason).toContain('IG data');
  });

  it('reason string mentions research when source is default', () => {
    const slots = findBestSlots([], 1, makeEngagement());
    expect(slots[0].reason).toContain('research');
  });

  describe('BUG-CRIT-002 — distributes across the week instead of piling on one day', () => {
    it('spreads 10 picks across multiple days, not all on one day', () => {
      const slots = findBestSlots([], 10, makeEngagement());
      const dayCounts = slots.reduce<Record<string, number>>((acc, s) => {
        acc[s.date] = (acc[s.date] || 0) + 1;
        return acc;
      }, {});
      const distinctDays = Object.keys(dayCounts).length;
      expect(distinctDays).toBeGreaterThanOrEqual(5);
      const maxOnAnyDay = Math.max(...Object.values(dayCounts));
      expect(maxOnAnyDay).toBeLessThanOrEqual(3);
    });

    it('penalizes a day proportionally to existing posts on it', () => {
      const eng = makeEngagement();
      const baseline = findBestSlots([], 1, eng);
      const bestDay = baseline[0].date;
      const existing: ExistingPost[] = [
        { date: bestDay, time: '12:00', platforms: ['instagram'], status: 'scheduled' },
        { date: bestDay, time: '18:00', platforms: ['instagram'], status: 'scheduled' },
        { date: bestDay, time: '20:00', platforms: ['instagram'], status: 'scheduled' },
      ];
      const next = findBestSlots(existing, 1, eng);
      expect(next[0].date).not.toBe(bestDay);
    });

    it('cross-platform: a Twitter post on a day still penalizes that day for an Instagram pick', () => {
      const eng = makeEngagement();
      const baseline = findBestSlots([], 1, eng);
      const bestDay = baseline[0].date;
      const existing: ExistingPost[] = [
        { date: bestDay, time: '20:00', platforms: ['twitter'], status: 'scheduled' },
        { date: bestDay, time: '18:00', platforms: ['twitter'], status: 'scheduled' },
        { date: bestDay, time: '12:00', platforms: ['twitter'], status: 'scheduled' },
      ];
      const next = findBestSlots(existing, 1, eng, { platforms: ['instagram'] });
      expect(next[0].date).not.toBe(bestDay);
    });

    it('iterative single-slot picks (simulating the pipeline loop) distribute across days', () => {
      const eng = makeEngagement();
      const accumulated: ExistingPost[] = [];
      for (let i = 0; i < 12; i++) {
        const [pick] = findBestSlots(accumulated, 1, eng);
        accumulated.push({
          date: pick.date,
          time: pick.time,
          platforms: ['instagram'],
          status: 'scheduled',
        });
      }
      const dayCounts = accumulated.reduce<Record<string, number>>((acc, p) => {
        acc[p.date] = (acc[p.date] || 0) + 1;
        return acc;
      }, {});
      expect(Object.keys(dayCounts).length).toBeGreaterThanOrEqual(5);
      expect(Math.max(...Object.values(dayCounts))).toBeLessThanOrEqual(3);
    });

    it('overflows to the second week once the first week is uniformly saturated', () => {
      const eng = makeEngagement();
      const accumulated: ExistingPost[] = [];
      // Saturate the first week — 14 picks is enough to push the algorithm past the first 7 days.
      for (let i = 0; i < 14; i++) {
        const [pick] = findBestSlots(accumulated, 1, eng);
        accumulated.push({
          date: pick.date,
          time: pick.time,
          platforms: ['instagram'],
          status: 'scheduled',
        });
      }
      const startMs = new Date('2026-04-16').getTime();
      const week1End = startMs + 7 * 24 * 60 * 60 * 1000;
      const week2Picks = accumulated.filter(p => new Date(p.date).getTime() >= week1End);
      expect(week2Picks.length).toBeGreaterThan(0);
    });

    it('historical posted/failed entries do NOT penalize a day for distribution', () => {
      const eng = makeEngagement();
      const baseline = findBestSlots([], 1, eng);
      const bestDay = baseline[0].date;
      // Use a historical hour OUTSIDE the engagement window so the slot
      // itself doesn't get marked taken — we're isolating the "should
      // posted/failed count toward the distribution divisor?" question
      // from the orthogonal "is the exact time slot still free?" check.
      const existing: ExistingPost[] = [
        { date: bestDay, time: '07:00', platforms: ['instagram'], status: 'posted' },
        { date: bestDay, time: '08:00', platforms: ['instagram'], status: 'failed' },
      ];
      const next = findBestSlots(existing, 1, eng);
      expect(next[0].date).toBe(bestDay);
    });
  });
});

describe('findBestSlot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns one slot in {date,time} shape', () => {
    const slot = findBestSlot([], makeEngagement());
    expect(slot).toHaveProperty('date');
    expect(slot).toHaveProperty('time');
    expect(slot.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(slot.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('falls back to tomorrow @ 19:00 when engagement has no usable hours', () => {
    const empty: CachedEngagement = {
      hours: [],
      days: [],
      fetchedAt: Date.now(),
      source: 'default',
    };
    const slot = findBestSlot([], empty);
    expect(slot.time).toBe('19:00');
  });
});

describe('loadEngagementData / saveEngagementData', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T10:00:00Z'));
    store = setupLocalStorageStub();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns defaults when localStorage is empty', () => {
    const data = loadEngagementData();
    expect(data.source).toBe('default');
    expect(data.hours.length).toBeGreaterThan(0);
    expect(data.days).toHaveLength(7);
  });

  it('round-trips through saveEngagementData', () => {
    const original: CachedEngagement = {
      hours: [{ hour: 20, weight: 0.95 }],
      days: [{ day: 6, multiplier: 1.0 }],
      fetchedAt: Date.now(),
      source: 'instagram',
    };
    saveEngagementData(original);
    const loaded = loadEngagementData();
    expect(loaded.source).toBe('instagram');
    expect(loaded.hours).toEqual(original.hours);
    expect(loaded.days).toEqual(original.days);
  });

  it('falls back to defaults when cache is older than 24h TTL', () => {
    const stale: CachedEngagement = {
      hours: [{ hour: 3, weight: 1.0 }],
      days: [{ day: 1, multiplier: 1.0 }],
      fetchedAt: Date.now() - 25 * 60 * 60 * 1000,
      source: 'instagram',
    };
    store.set('mashup_engagement_cache', JSON.stringify(stale));
    const loaded = loadEngagementData();
    expect(loaded.source).toBe('default');
  });

  it('returns defaults when localStorage holds malformed JSON', () => {
    store.set('mashup_engagement_cache', 'not json');
    const loaded = loadEngagementData();
    expect(loaded.source).toBe('default');
  });
});
