// QSTASH-DELIVERY: tests for the QStash wrapper. We don't hit real
// Upstash — these verify the contract our schedule/cancel/deliver
// routes expect from the wrapper:
//   - isQStashConfigured gates publish-side behaviour
//   - resolveDeliveryUrl picks the right env var, suffixes the path
//   - scheduleDelivery uses notBefore in SECONDS, returns messageId
//   - cancelDelivery is 404-tolerant
//   - verifyDelivery delegates to the receiver with the raw body
//
// The SDK's Client/Receiver are replaced via __setQStashForTests with
// in-test stubs that mimic the shape we use. We don't reach jose or
// crypto-js — purely contract-level coverage.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Client, Receiver } from '@upstash/qstash';
import {
  isQStashConfigured,
  resolveDeliveryUrl,
  scheduleDelivery,
  cancelDelivery,
  verifyDelivery,
  __setQStashForTests,
} from '@/lib/qstash-client';
import type { EnqueuedPost } from '@/lib/server-queue';

const ORIG_ENV = { ...process.env };

interface PublishCall {
  url: string;
  body: unknown;
  notBefore?: number;
  retries?: number;
  headers?: Record<string, string>;
}

function makeStubClient(opts: {
  messageId?: string;
  publishError?: Error;
  cancelError?: Error;
} = {}): { client: Client; publishCalls: PublishCall[]; cancelCalls: string[] } {
  const publishCalls: PublishCall[] = [];
  const cancelCalls: string[] = [];
  const stub = {
    async publishJSON(req: PublishCall) {
      if (opts.publishError) throw opts.publishError;
      publishCalls.push(req);
      return { messageId: opts.messageId ?? 'msg-default', url: req.url, deduplicated: false };
    },
    messages: {
      async cancel(messageId: string) {
        if (opts.cancelError) throw opts.cancelError;
        cancelCalls.push(messageId);
        return { cancelled: 1 };
      },
    },
  };
  return { client: stub as unknown as Client, publishCalls, cancelCalls };
}

function makeStubReceiver(opts: { verifyReturn?: boolean; verifyError?: Error } = {}): {
  receiver: Receiver;
  verifyCalls: Array<{ signature: string; body: string; url?: string }>;
} {
  const verifyCalls: Array<{ signature: string; body: string; url?: string }> = [];
  const stub = {
    async verify(req: { signature: string; body: string; url?: string }) {
      verifyCalls.push({ ...req });
      if (opts.verifyError) throw opts.verifyError;
      return opts.verifyReturn ?? true;
    },
  };
  return { receiver: stub as unknown as Receiver, verifyCalls };
}

function basePost(overrides: Partial<EnqueuedPost> = {}): EnqueuedPost {
  return {
    id: 'p1',
    date: '2026-05-16',
    time: '12:00',
    fireAt: 1_700_000_000_500, // includes sub-second component to test floor
    platforms: ['instagram'],
    caption: 'hello',
    mediaUrl: 'https://cdn/img.jpg',
    ...overrides,
  };
}

beforeEach(() => {
  process.env = { ...ORIG_ENV };
  __setQStashForTests(null, null);
});

afterEach(() => {
  process.env = ORIG_ENV;
  __setQStashForTests(null, null);
});

describe('isQStashConfigured', () => {
  it('returns false when QSTASH_TOKEN is unset', () => {
    delete process.env.QSTASH_TOKEN;
    expect(isQStashConfigured()).toBe(false);
  });

  it('returns true when QSTASH_TOKEN is set (even to a placeholder)', () => {
    process.env.QSTASH_TOKEN = 'eyJ...';
    expect(isQStashConfigured()).toBe(true);
  });
});

describe('resolveDeliveryUrl', () => {
  it('prefers QSTASH_DELIVERY_URL and suffixes the deliver path', () => {
    process.env.QSTASH_DELIVERY_URL = 'https://mashup-studio.vercel.app';
    expect(resolveDeliveryUrl()).toBe('https://mashup-studio.vercel.app/api/social/qstash-deliver');
  });

  it('strips trailing slashes before appending the deliver path', () => {
    process.env.QSTASH_DELIVERY_URL = 'https://mashup-studio.vercel.app///';
    expect(resolveDeliveryUrl()).toBe('https://mashup-studio.vercel.app/api/social/qstash-deliver');
  });

  it('returns the explicit URL unchanged when it already ends with the deliver path', () => {
    process.env.QSTASH_DELIVERY_URL =
      'https://mashup-studio.vercel.app/api/social/qstash-deliver';
    expect(resolveDeliveryUrl()).toBe('https://mashup-studio.vercel.app/api/social/qstash-deliver');
  });

  it('falls back to APP_URL when QSTASH_DELIVERY_URL is absent', () => {
    delete process.env.QSTASH_DELIVERY_URL;
    process.env.APP_URL = 'https://app.example';
    expect(resolveDeliveryUrl()).toBe('https://app.example/api/social/qstash-deliver');
  });

  it('falls back to VERCEL_URL with https:// prefix', () => {
    delete process.env.QSTASH_DELIVERY_URL;
    delete process.env.APP_URL;
    process.env.VERCEL_URL = 'mashup-studio-abc123.vercel.app';
    expect(resolveDeliveryUrl()).toBe(
      'https://mashup-studio-abc123.vercel.app/api/social/qstash-deliver',
    );
  });

  it('throws when no source env var is set', () => {
    delete process.env.QSTASH_DELIVERY_URL;
    delete process.env.APP_URL;
    delete process.env.VERCEL_URL;
    expect(() => resolveDeliveryUrl()).toThrow(/Cannot resolve QStash delivery URL/);
  });
});

describe('scheduleDelivery', () => {
  it('publishes with notBefore in seconds (floored) and returns messageId', async () => {
    process.env.QSTASH_TOKEN = 'tk';
    process.env.QSTASH_DELIVERY_URL = 'https://app.example';
    const { client, publishCalls } = makeStubClient({ messageId: 'msg-abc' });
    __setQStashForTests(client, null);

    const post = basePost({ fireAt: 1_700_000_000_500 });
    const result = await scheduleDelivery(post);

    expect(result.messageId).toBe('msg-abc');
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0].url).toBe('https://app.example/api/social/qstash-deliver');
    // fireAt 1_700_000_000_500 ms → 1_700_000_000 s (floor)
    expect(publishCalls[0].notBefore).toBe(1_700_000_000);
    expect(publishCalls[0].retries).toBe(3);
    expect((publishCalls[0].body as EnqueuedPost).id).toBe('p1');
  });

  it('forwards the full EnqueuedPost (credentials included) as the JSON body', async () => {
    process.env.QSTASH_TOKEN = 'tk';
    process.env.APP_URL = 'https://app.example';
    const { client, publishCalls } = makeStubClient();
    __setQStashForTests(client, null);

    const post = basePost({
      credentials: { instagram: { accessToken: 'EAA-x', igAccountId: '999' } },
    });
    await scheduleDelivery(post);

    const sent = publishCalls[0].body as EnqueuedPost;
    expect(sent.credentials?.instagram?.accessToken).toBe('EAA-x');
    expect(sent.credentials?.instagram?.igAccountId).toBe('999');
  });

  it('throws a readable error when QSTASH_TOKEN is missing', async () => {
    delete process.env.QSTASH_TOKEN;
    __setQStashForTests(null, null);
    await expect(scheduleDelivery(basePost())).rejects.toThrow(/QSTASH_TOKEN/);
  });
});

describe('cancelDelivery', () => {
  it('calls messages.cancel with the messageId', async () => {
    process.env.QSTASH_TOKEN = 'tk';
    const { client, cancelCalls } = makeStubClient();
    __setQStashForTests(client, null);

    await cancelDelivery('msg-xyz');
    expect(cancelCalls).toEqual(['msg-xyz']);
  });

  it('returns { cancelled: 0 } when the SDK throws a 404-shaped error', async () => {
    process.env.QSTASH_TOKEN = 'tk';
    const { client } = makeStubClient({ cancelError: new Error('Request failed (404 Not Found)') });
    __setQStashForTests(client, null);

    const result = await cancelDelivery('msg-already-fired');
    expect(result.cancelled).toBe(0);
  });

  it('re-throws non-404 errors', async () => {
    process.env.QSTASH_TOKEN = 'tk';
    const { client } = makeStubClient({ cancelError: new Error('500 server error') });
    __setQStashForTests(client, null);

    await expect(cancelDelivery('msg-xyz')).rejects.toThrow(/500/);
  });
});

describe('verifyDelivery', () => {
  it('delegates to the receiver with raw bytes (not parsed JSON)', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'cur';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next';
    const { receiver, verifyCalls } = makeStubReceiver({ verifyReturn: true });
    __setQStashForTests(null, receiver);

    const ok = await verifyDelivery({
      signature: 'sig-abc',
      rawBody: '{"id":"p1"}',
      url: 'https://app.example/api/social/qstash-deliver',
    });
    expect(ok).toBe(true);
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0].signature).toBe('sig-abc');
    expect(verifyCalls[0].body).toBe('{"id":"p1"}');
    expect(verifyCalls[0].url).toBe('https://app.example/api/social/qstash-deliver');
  });

  it('returns false when the receiver does (bad sig path)', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'cur';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next';
    const { receiver } = makeStubReceiver({ verifyReturn: false });
    __setQStashForTests(null, receiver);

    const ok = await verifyDelivery({ signature: 'bad', rawBody: 'x' });
    expect(ok).toBe(false);
  });

  it('throws a readable error when signing keys are missing', async () => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
    __setQStashForTests(null, null);
    await expect(
      verifyDelivery({ signature: 's', rawBody: 'x' }),
    ).rejects.toThrow(/QSTASH_CURRENT_SIGNING_KEY/);
  });

  it('omits the url field when not provided (test ergonomics)', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'cur';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next';
    const { receiver, verifyCalls } = makeStubReceiver({ verifyReturn: true });
    __setQStashForTests(null, receiver);

    await verifyDelivery({ signature: 's', rawBody: 'x' });
    expect(verifyCalls[0].url).toBeUndefined();
  });
});
