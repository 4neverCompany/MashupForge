// SCHED-POST-ROBUST: browser-side helpers that talk to the queue API.
//
// Kept tiny and dependency-free so the schedule paths can fire-and-forget
// without disrupting the local IDB write. All calls are best-effort: the
// browser is the source of truth for scheduled state; the server queue is
// a mirror that the cron drains. If a push fails (offline, server down,
// queue not configured), the next schedule action will re-push and the
// browser's own auto-poster — when not in cron-owner mode — will still
// fire the post when the tab is open.

import type { ScheduledPost } from '@/types/mashup';
import type { SocialCredentials } from '@/lib/server-queue';

interface SchedulePushPayload {
  id: string;
  date: string;
  time: string;
  platforms: string[];
  caption: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  carouselGroupId?: string;
  imageId?: string;
  /** SCHED-CRON-CREDS-FIX: snapshot of the user's social credentials
   *  taken at enqueue time. Forwarded all the way through to
   *  /api/social/post when the cron fires; without this the scheduled
   *  cron path lost credentials and IG/Pinterest posts failed unless
   *  the server had matching env vars set. */
  credentials?: SocialCredentials;
}

export async function pushScheduleToServer(payload: SchedulePushPayload): Promise<void> {
  try {
    await fetch('/api/queue/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Best-effort; swallow and let the browser's IDB write be source of truth.
  }
}

export async function cancelScheduleOnServer(id: string): Promise<void> {
  try {
    await fetch('/api/queue/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  } catch {
    // Best-effort — see above.
  }
}

export interface QueueResultLite {
  id: string;
  status: 'posted' | 'failed';
  at: number;
  error?: string;
  carouselGroupId?: string;
}

/** Fetch every result the server has buffered. Returns [] on any failure
 *  so the caller can run on a timer without exception handling. */
export async function fetchQueueResults(): Promise<QueueResultLite[]> {
  try {
    const res = await fetch('/api/queue/results');
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: QueueResultLite[] };
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}

/** Acknowledge results so the server can drop them from its hash. */
export async function ackQueueResults(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await fetch('/api/queue/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  } catch {
    // Best-effort.
  }
}

/** Reconcile a list of server-side results into a `scheduledPosts`
 *  array. Pure function — given the same inputs, returns the same output.
 *  Returns the next scheduledPosts plus the ids that were applied (for
 *  acking the server). */
export function reconcileResults(
  scheduledPosts: ScheduledPost[],
  results: QueueResultLite[],
): { next: ScheduledPost[]; appliedIds: string[] } {
  if (results.length === 0) return { next: scheduledPosts, appliedIds: [] };
  const byId = new Map(results.map((r) => [r.id, r]));
  const localIds = new Set(scheduledPosts.map((p) => p.id));
  const appliedIds: string[] = [];

  let mutated = false;
  const next = scheduledPosts.map((p) => {
    const r = byId.get(p.id);
    if (!r) return p;
    // Don't downgrade a terminal status the browser has already
    // recorded (e.g., user manually marked it failed locally).
    if (p.status === 'posted' || p.status === 'failed') return p;
    appliedIds.push(p.id);
    mutated = true;
    return { ...p, status: r.status };
  });

  // Also ack any result whose id no longer exists locally — the user
  // likely deleted the post; no point keeping the result around.
  for (const r of results) {
    if (!localIds.has(r.id)) appliedIds.push(r.id);
  }

  // Preserve identity when nothing actually changed locally — lets
  // React skip re-renders even if we still need to ack orphans.
  return { next: mutated ? next : scheduledPosts, appliedIds };
}
