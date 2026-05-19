// QSTASH-DELIVERY — contract tests for /api/social/qstash-deliver.
//
// Covers the surfaces that determine whether a delivery causes a real
// publish: signature verification, body parsing, atomic claim against
// Redis, and the 200-on-skip semantics that stop QStash retries when
// the cron safety net beat us to the claim.
//
// We replace both the Redis client and the QStash receiver with stubs.
// We DO NOT exercise /api/social/post — fireOne uses global fetch, and
// the route returns success/failure based on its HTTP response. Each
// test stubs fetch as needed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/social/qstash-deliver/route';
import {
  enqueuePost,
  __setRedisForTests,
  type EnqueuedPost,
} from '@/lib/server-queue';
import { __setQStashForTests } from '@/lib/qstash-client';
import type { Receiver } from '@upstash/qstash';

const ORIG_ENV = { ...process.env };
const ORIG_FETCH = globalThis.fetch;

// Minimal in-memory Redis surface — same shape as server-queue.test.ts
// but trimmed to what claimPostById + markResult exercise.
class MockRedis {
  zsets = new Map<string, Map<string, number>>();
  hashes = new Map<string, Map<string, string>>();

  pipeline() {
    const ops: Array<() => void> = [];
    const api = {
      zadd: (key: string, e: { score: number; member: string }) => {
        ops.push(() => this.zadd(key, e));
        return api;
      },
      hset: (key: string, f: Record<string, string>) => {
        ops.push(() => this.hset(key, f));
        return api;
      },
      zrem: (key: string, m: string) => {
        ops.push(() => this.zrem(key, m));
        return api;
      },
      hdel: (key: string, f: string) => {
        ops.push(() => this.hdel(key, f));
        return api;
      },
      exec: async () => {
        for (const op of ops) op();
        return [];
      },
    };
    return api;
  }

  zadd(key: string, e: { score: number; member: string }) {
    const z = this.zsets.get(key) ?? new Map();
    z.set(e.member, e.score);
    this.zsets.set(key, z);
    return 1;
  }
  zrem(key: string, member: string) {
    const z = this.zsets.get(key);
    if (!z) return 0;
    return z.delete(member) ? 1 : 0;
  }
  hset(key: string, fields: Record<string, string>) {
    const h = this.hashes.get(key) ?? new Map();
    for (const [f, v] of Object.entries(fields)) h.set(f, v);
    this.hashes.set(key, h);
    return Object.keys(fields).length;
  }
  hget(key: string, field: string) {
    return this.hashes.get(key)?.get(field) ?? null;
  }
  hdel(key: string, field: string) {
    const h = this.hashes.get(key);
    return h?.delete(field) ? 1 : 0;
  }
  // Unused by the deliver route but server-queue.ts pulls it during
  // some helper paths — keep it present so the mock's shape matches.
  zscore(key: string, member: string) {
    return this.zsets.get(key)?.get(member) ?? null;
  }
}

function makeStubReceiver(opts: { verifyReturn?: boolean; verifyError?: Error } = {}): Receiver {
  return {
    async verify() {
      if (opts.verifyError) throw opts.verifyError;
      return opts.verifyReturn ?? true;
    },
  } as unknown as Receiver;
}

function makePost(overrides: Partial<EnqueuedPost> = {}): EnqueuedPost {
  return {
    id: 'p1',
    date: '2026-05-16',
    time: '12:00',
    fireAt: 1_700_000_000_000,
    platforms: ['instagram'],
    caption: 'hello',
    mediaUrl: 'https://cdn/img.jpg',
    credentials: { instagram: { accessToken: 'EAA-x', igAccountId: '999' } },
    ...overrides,
  };
}

function req(body: unknown, signature?: string): Request {
  return new Request('http://localhost/api/social/qstash-deliver', {
    method: 'POST',
    headers: signature ? { 'upstash-signature': signature } : {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let mock: MockRedis;

beforeEach(() => {
  process.env = { ...ORIG_ENV };
  process.env.UPSTASH_REDIS_REST_URL = 'http://stub-redis';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'stub';
  process.env.QSTASH_CURRENT_SIGNING_KEY = 'cur';
  process.env.QSTASH_NEXT_SIGNING_KEY = 'next';
  process.env.APP_URL = 'http://localhost:3000';
  mock = new MockRedis();
  __setRedisForTests(mock as unknown as Parameters<typeof __setRedisForTests>[0]);
});

afterEach(() => {
  process.env = ORIG_ENV;
  __setRedisForTests(null);
  __setQStashForTests(null, null);
  globalThis.fetch = ORIG_FETCH;
  vi.restoreAllMocks();
});

describe('qstash-deliver — signature gate', () => {
  it('returns 401 when the upstash-signature header is missing', async () => {
    __setQStashForTests(null, makeStubReceiver({ verifyReturn: true }));
    const res = await POST(req(makePost()));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/upstash-signature/i);
  });

  it('returns 401 when the receiver returns false', async () => {
    __setQStashForTests(null, makeStubReceiver({ verifyReturn: false }));
    const res = await POST(req(makePost(), 'bad-sig'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid/i);
  });

  it('returns 401 with the SDK error message when verify throws', async () => {
    __setQStashForTests(
      null,
      makeStubReceiver({ verifyError: new Error('SignatureError: token expired') }),
    );
    const res = await POST(req(makePost(), 'expired'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/expired/i);
  });
});

describe('qstash-deliver — body validation', () => {
  it('returns 400 when the body is not valid JSON', async () => {
    __setQStashForTests(null, makeStubReceiver({ verifyReturn: true }));
    const res = await POST(req('not-json', 'sig'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the body is missing required id field', async () => {
    __setQStashForTests(null, makeStubReceiver({ verifyReturn: true }));
    const res = await POST(req({ caption: 'no id' }, 'sig'));
    expect(res.status).toBe(400);
  });
});

describe('qstash-deliver — claim and fire', () => {
  it('claims the post, fires via /api/social/post, returns delivered=1', async () => {
    __setQStashForTests(null, makeStubReceiver({ verifyReturn: true }));
    await enqueuePost(makePost({ id: 'p1' }));

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(req(makePost({ id: 'p1' }), 'sig'));
    expect(res.status).toBe(200);
    const summary = (await res.json()) as { delivered: number; failed: number };
    expect(summary.delivered).toBe(1);
    expect(summary.failed).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns 200 with skipped=true when the post was already drained (race)', async () => {
    __setQStashForTests(null, makeStubReceiver({ verifyReturn: true }));
    // Do NOT enqueue — simulates cron safety net already claiming the post.

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(req(makePost({ id: 'p1' }), 'sig'));
    expect(res.status).toBe(200);
    const summary = (await res.json()) as { skipped?: boolean; delivered: number };
    expect(summary.skipped).toBe(true);
    expect(summary.delivered).toBe(0);
    // Critical: no publish attempted when already claimed.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 200 with failed=1 when /api/social/post returns non-2xx', async () => {
    __setQStashForTests(null, makeStubReceiver({ verifyReturn: true }));
    await enqueuePost(makePost({ id: 'p1' }));

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Instagram token expired' }), { status: 400 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(req(makePost({ id: 'p1' }), 'sig'));
    // 200 stops QStash retries; the failure is recorded in markResult and
    // reaches the browser via /api/queue/results.
    expect(res.status).toBe(200);
    const summary = (await res.json()) as { delivered: number; failed: number; reason?: string };
    expect(summary.failed).toBe(1);
    expect(summary.reason).toMatch(/Instagram token expired/);
  });

  it('forwards mediaUrls payload shape when the post is a carousel', async () => {
    __setQStashForTests(null, makeStubReceiver({ verifyReturn: true }));
    const carouselPost = makePost({
      id: 'c1',
      mediaUrl: undefined,
      mediaUrls: ['https://cdn/1.jpg', 'https://cdn/2.jpg'],
      carouselGroupId: 'grp-1',
    });
    await enqueuePost(carouselPost);

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await POST(req(carouselPost, 'sig'));
    const [, init] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse((init as RequestInit).body as string) as {
      mediaUrls?: string[];
      mediaUrl?: string;
    };
    expect(sentBody.mediaUrls).toEqual(['https://cdn/1.jpg', 'https://cdn/2.jpg']);
    expect(sentBody.mediaUrl).toBeUndefined();
  });

  it('forwards the credentials snapshot through to /api/social/post', async () => {
    __setQStashForTests(null, makeStubReceiver({ verifyReturn: true }));
    await enqueuePost(makePost({ id: 'p1' }));

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await POST(req(makePost({ id: 'p1' }), 'sig'));
    const [, init] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse((init as RequestInit).body as string) as {
      credentials?: { instagram?: { accessToken?: string } };
    };
    expect(sentBody.credentials?.instagram?.accessToken).toBe('EAA-x');
  });
});
