// SCHED-POST-ROBUST: tests for the Upstash-backed queue helpers using
// an in-memory mock client. We don't reach the real Redis — these test
// the contract our code expects from the @upstash/redis surface
// (zadd/zrange/zrem/hset/hget/hdel/hgetall/pipeline) and verify the
// claim-and-fire semantics.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueuePost,
  cancelPost,
  claimDuePosts,
  markResult,
  getResults,
  clearResult,
  computeFireAt,
  getPostById,
  setQStashMessageId,
  claimPostById,
  replacePost,
  __setRedisForTests,
  __KEYS_FOR_TESTS,
  type EnqueuedPost,
} from '@/lib/server-queue';

class MockPipeline {
  ops: Array<() => void> = [];
  constructor(private store: MockRedis) {}
  zadd(key: string, entry: { score: number; member: string }) {
    this.ops.push(() => this.store.zadd(key, entry));
    return this;
  }
  hset(key: string, fields: Record<string, string>) {
    this.ops.push(() => this.store.hset(key, fields));
    return this;
  }
  zrem(key: string, member: string) {
    this.ops.push(() => this.store.zrem(key, member));
    return this;
  }
  hdel(key: string, field: string) {
    this.ops.push(() => this.store.hdel(key, field));
    return this;
  }
  async exec() {
    for (const op of this.ops) op();
    return [];
  }
}

class MockRedis {
  zsets = new Map<string, Map<string, number>>();
  hashes = new Map<string, Map<string, string>>();

  pipeline(): MockPipeline {
    return new MockPipeline(this);
  }

  zadd(key: string, entry: { score: number; member: string }) {
    const z = this.zsets.get(key) ?? new Map();
    z.set(entry.member, entry.score);
    this.zsets.set(key, z);
    return 1;
  }

  zrange(
    key: string,
    min: number,
    max: number,
    opts?: { byScore?: boolean },
  ) {
    const z = this.zsets.get(key);
    if (!z) return [] as string[];
    const members: string[] = [];
    for (const [m, s] of z.entries()) {
      if (opts?.byScore) {
        if (s >= min && s <= max) members.push(m);
      } else {
        members.push(m);
      }
    }
    return members;
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

  hgetall(key: string) {
    const h = this.hashes.get(key);
    if (!h) return null;
    return Object.fromEntries(h.entries());
  }

  zscore(key: string, member: string) {
    const z = this.zsets.get(key);
    return z?.get(member) ?? null;
  }
}

let mock: MockRedis;

beforeEach(() => {
  mock = new MockRedis();
  // The cast is safe: our module only calls the methods MockRedis implements.
  __setRedisForTests(mock as unknown as Parameters<typeof __setRedisForTests>[0]);
});

function makeEnqueued(overrides: Partial<EnqueuedPost> = {}): EnqueuedPost {
  return {
    id: 'p1',
    date: '2026-05-01',
    time: '12:00',
    fireAt: 1000,
    platforms: ['instagram'],
    caption: 'hello',
    mediaUrl: 'https://cdn/img.jpg',
    ...overrides,
  };
}

describe('computeFireAt', () => {
  it('parses ISO date + HH:mm into a finite timestamp', () => {
    const t = computeFireAt('2026-05-01', '12:30');
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
  });

  it('throws on garbage input', () => {
    expect(() => computeFireAt('not-a-date', '12:30')).toThrow();
  });
});

describe('enqueuePost / cancelPost', () => {
  it('writes both ZSET score and posts hash payload', async () => {
    await enqueuePost(makeEnqueued());
    const z = mock.zsets.get(__KEYS_FOR_TESTS.SCHEDULED);
    const h = mock.hashes.get(__KEYS_FOR_TESTS.POSTS);
    expect(z?.get('p1')).toBe(1000);
    expect(h?.get('p1')).toBeTruthy();
  });

  it('cancelPost removes from both', async () => {
    await enqueuePost(makeEnqueued());
    await cancelPost('p1');
    expect(mock.zsets.get(__KEYS_FOR_TESTS.SCHEDULED)?.get('p1')).toBeUndefined();
    expect(mock.hashes.get(__KEYS_FOR_TESTS.POSTS)?.get('p1')).toBeUndefined();
  });
});

describe('claimDuePosts', () => {
  it('returns nothing when nothing is due', async () => {
    await enqueuePost(makeEnqueued({ id: 'future', fireAt: 9_999_999 }));
    const claimed = await claimDuePosts(1000);
    expect(claimed).toEqual([]);
    // Untouched
    expect(mock.zsets.get(__KEYS_FOR_TESTS.SCHEDULED)?.get('future')).toBe(9_999_999);
  });

  it('returns due posts and removes them from both stores (atomic claim)', async () => {
    await enqueuePost(makeEnqueued({ id: 'a', fireAt: 100 }));
    await enqueuePost(makeEnqueued({ id: 'b', fireAt: 200 }));
    await enqueuePost(makeEnqueued({ id: 'c', fireAt: 9000 })); // not due

    const claimed = await claimDuePosts(500);
    const ids = claimed.map((p) => p.id).sort();
    expect(ids).toEqual(['a', 'b']);
    // Removed from ZSET + posts hash
    expect(mock.zsets.get(__KEYS_FOR_TESTS.SCHEDULED)?.get('a')).toBeUndefined();
    expect(mock.zsets.get(__KEYS_FOR_TESTS.SCHEDULED)?.get('b')).toBeUndefined();
    expect(mock.hashes.get(__KEYS_FOR_TESTS.POSTS)?.get('a')).toBeUndefined();
    expect(mock.hashes.get(__KEYS_FOR_TESTS.POSTS)?.get('b')).toBeUndefined();
    // 'c' is still pending
    expect(mock.zsets.get(__KEYS_FOR_TESTS.SCHEDULED)?.get('c')).toBe(9000);
  });

  it('skips a schedule entry that has no payload (orphan)', async () => {
    // Inject the ZSET entry directly without a hash payload.
    mock.zsets.set(__KEYS_FOR_TESTS.SCHEDULED, new Map([['orphan', 100]]));
    const claimed = await claimDuePosts(500);
    expect(claimed).toEqual([]);
    // ZREM still ran (we own it now), so it's gone
    expect(mock.zsets.get(__KEYS_FOR_TESTS.SCHEDULED)?.get('orphan')).toBeUndefined();
  });

  it('parses payloads back into EnqueuedPost shape', async () => {
    const post = makeEnqueued({ id: 'p1', fireAt: 100, caption: 'hi' });
    await enqueuePost(post);
    const claimed = await claimDuePosts(500);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].caption).toBe('hi');
    expect(claimed[0].id).toBe('p1');
  });
});

// QSTASH-DELIVERY: helpers added to support the push-trigger path
// (cancel route reads qstashMessageId from getPostById, schedule route
// attaches it via setQStashMessageId after publishing, deliver route
// claims by id atomically via claimPostById).
describe('getPostById', () => {
  it('returns the post when present', async () => {
    await enqueuePost(makeEnqueued({ id: 'a', caption: 'one' }));
    const post = await getPostById('a');
    expect(post?.caption).toBe('one');
  });

  it('returns null for an unknown id', async () => {
    const post = await getPostById('missing');
    expect(post).toBeNull();
  });

  it('does not claim or mutate the ZSET', async () => {
    await enqueuePost(makeEnqueued({ id: 'a', fireAt: 100 }));
    await getPostById('a');
    expect(mock.zsets.get(__KEYS_FOR_TESTS.SCHEDULED)?.get('a')).toBe(100);
  });
});

describe('setQStashMessageId', () => {
  it('merges the messageId into the existing payload', async () => {
    await enqueuePost(makeEnqueued({ id: 'a' }));
    await setQStashMessageId('a', 'msg-123');
    const post = await getPostById('a');
    expect(post?.qstashMessageId).toBe('msg-123');
  });

  it('preserves other fields on the payload', async () => {
    await enqueuePost(makeEnqueued({ id: 'a', caption: 'keep me' }));
    await setQStashMessageId('a', 'msg-123');
    const post = await getPostById('a');
    expect(post?.caption).toBe('keep me');
  });

  it('no-ops when the post was already cancelled', async () => {
    // No prior enqueue. The setter should not create a phantom entry —
    // the QStash callback would later find Redis empty and skip cleanly.
    await setQStashMessageId('ghost', 'msg-123');
    expect(mock.hashes.get(__KEYS_FOR_TESTS.POSTS)?.get('ghost')).toBeUndefined();
  });
});

describe('claimPostById', () => {
  it('returns the post and removes it from both stores', async () => {
    await enqueuePost(makeEnqueued({ id: 'a', caption: 'go' }));
    const claimed = await claimPostById('a');
    expect(claimed?.caption).toBe('go');
    expect(mock.zsets.get(__KEYS_FOR_TESTS.SCHEDULED)?.get('a')).toBeUndefined();
    expect(mock.hashes.get(__KEYS_FOR_TESTS.POSTS)?.get('a')).toBeUndefined();
  });

  it('returns null when the post is missing', async () => {
    const claimed = await claimPostById('missing');
    expect(claimed).toBeNull();
  });

  it('returns null on a second call (atomic claim guarantee)', async () => {
    // Models the cron-vs-QStash race: only the first caller gets the post.
    await enqueuePost(makeEnqueued({ id: 'a' }));
    const first = await claimPostById('a');
    const second = await claimPostById('a');
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('returns null when ZSET has the entry but payload is missing (orphan)', async () => {
    mock.zsets.set(__KEYS_FOR_TESTS.SCHEDULED, new Map([['orphan', 100]]));
    const claimed = await claimPostById('orphan');
    expect(claimed).toBeNull();
    // ZREM still ran (we ZREM before reading the hash), so the entry is gone.
    expect(mock.zsets.get(__KEYS_FOR_TESTS.SCHEDULED)?.get('orphan')).toBeUndefined();
  });
});

describe('replacePost', () => {
  it('reports replaced=false on a fresh enqueue', async () => {
    const { replaced } = await replacePost(makeEnqueued({ id: 'a' }));
    expect(replaced).toBe(false);
  });

  it('reports replaced=true and updates score on a reschedule', async () => {
    await replacePost(makeEnqueued({ id: 'a', fireAt: 100 }));
    const { replaced } = await replacePost(makeEnqueued({ id: 'a', fireAt: 999 }));
    expect(replaced).toBe(true);
    expect(mock.zsets.get(__KEYS_FOR_TESTS.SCHEDULED)?.get('a')).toBe(999);
  });
});

describe('markResult / getResults / clearResult', () => {
  it('round-trips a posted result', async () => {
    await markResult({ id: 'p1', status: 'posted', at: 999 });
    const res = await getResults();
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('p1');
    expect(res[0].status).toBe('posted');
  });

  it('round-trips a failed result with error string', async () => {
    await markResult({ id: 'p1', status: 'failed', at: 1, error: 'boom' });
    const res = await getResults();
    expect(res[0].error).toBe('boom');
  });

  it('clearResult removes from the hash', async () => {
    await markResult({ id: 'p1', status: 'posted', at: 1 });
    await clearResult('p1');
    const res = await getResults();
    expect(res).toHaveLength(0);
  });

  it('getResults returns [] when nothing has been written', async () => {
    const res = await getResults();
    expect(res).toEqual([]);
  });
});
