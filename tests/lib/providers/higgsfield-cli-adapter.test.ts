/**
 * Tests for lib/providers/higgsfield/cli-adapter.
 *
 * Coverage (per spec):
 *   - happy path: CLI returns JSON with url → AssetRef(kind: 'image', url)
 *   - happy path async: CLI returns JSON with request_id, no url → AssetRef(kind: 'job')
 *   - CLI not found → ProviderUnavailableError
 *   - timeout → ProviderTimeoutError
 *   - JSON parse error → ProviderParseError
 *   - zero-exit JSON error payload → ProviderRejectedError
 *   - generateImage / generateVideo argument construction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import * as cliUtils from '@/lib/providers/cli-utils';
import {
  __setSpawnForTests,
  __setLogForTests,
} from '@/lib/providers/cli-utils';
import { HiggsfieldCliAdapter } from '@/lib/providers/higgsfield/cli-adapter';
import {
  ProviderParseError,
  ProviderRejectedError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from '@/lib/providers/interface';

interface FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  kill: ReturnType<typeof vi.fn>;
}

function makeChild(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  errorOnSpawn?: Error;
} = {}): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = Readable.from([Buffer.from(opts.stdout ?? '', 'utf8')]);
  child.stderr = Readable.from([Buffer.from(opts.stderr ?? '', 'utf8')]);
  child.kill = vi.fn();
  if (opts.errorOnSpawn) {
    setImmediate(() => child.emit('error', opts.errorOnSpawn));
  } else {
    setImmediate(() => child.emit('close', opts.exitCode ?? 0));
  }
  return child;
}

const spawnMock = vi.fn();
const adapter = new HiggsfieldCliAdapter();

beforeEach(() => {
  spawnMock.mockReset();
  __setSpawnForTests(spawnMock as never);
  __setLogForTests(() => {});
  // Force-resolve the binary so isAvailable() short-circuits.
  (adapter as unknown as { resolvedBinary: string | null; resolveAttempted: boolean }).resolvedBinary = 'higgsfield';
  (adapter as unknown as { resolvedBinary: string | null; resolveAttempted: boolean }).resolveAttempted = true;
});

afterEach(() => {
  __setSpawnForTests(null);
  __setLogForTests(null);
});

describe('HiggsfieldCliAdapter.generateImage — happy paths', () => {
  it('returns AssetRef with url for sync image response', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({ url: 'https://cdn.higgsfield.ai/x.png', request_id: 'r-1' }),
      }) as never,
    );
    const ref = await adapter.generateImage({ prompt: 'a cat' });
    expect(ref.kind).toBe('image');
    expect(ref.provider).toBe('higgsfield');
    expect(ref.url).toBe('https://cdn.higgsfield.ai/x.png');
    expect(ref.jobId).toBe('r-1');
  });

  it('returns AssetRef kind:job when CLI returns request_id only', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({ request_id: 'r-async-1' }),
      }) as never,
    );
    const ref = await adapter.generateImage({ prompt: 'a cat' });
    expect(ref.kind).toBe('job');
    expect(ref.jobId).toBe('r-async-1');
    expect(ref.url).toBeUndefined();
  });

  it('builds the correct argv with all options', async () => {
    spawnMock.mockReturnValue(
      makeChild({ stdout: JSON.stringify({ url: 'https://x' }) }) as never,
    );
    await adapter.generateImage({
      prompt: 'a cat',
      aspectRatio: '16:9',
      seed: 7,
      width: 1024,
      height: 768,
      negativePrompt: 'blurry',
      referenceImage: { path: '/tmp/ref.png' },
      model: 'text2image_nano_banana',
    });
    const [, args] = spawnMock.mock.calls[0] as [string, string[], unknown];
    expect(args).toContain('--prompt');
    expect(args).toContain('a cat');
    expect(args).toContain('--seed');
    expect(args).toContain('7');
    expect(args).toContain('--width');
    expect(args).toContain('1024');
    expect(args).toContain('--aspect-ratio');
    expect(args).toContain('16:9');
    expect(args).toContain('--negative-prompt');
    expect(args).toContain('blurry');
    expect(args).toContain('--image');
    expect(args).toContain('/tmp/ref.png');
    expect(args).toContain('text2image_nano_banana');
  });
});

describe('HiggsfieldCliAdapter.generateVideo — happy paths', () => {
  it('returns AssetRef kind:video for sync URL response', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({
          url: 'https://cdn.higgsfield.ai/clip.mp4',
          request_id: 'r-vid',
          duration: 8,
        }),
      }) as never,
    );
    const ref = await adapter.generateVideo({ prompt: 'a sunrise', durationSec: 8 });
    expect(ref.kind).toBe('video');
    expect(ref.url).toBe('https://cdn.higgsfield.ai/clip.mp4');
    expect(ref.durationSec).toBe(8);
  });

  it('returns AssetRef kind:job for queued video', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({ status: 'queued', request_id: 'r-queue-1' }),
      }) as never,
    );
    const ref = await adapter.generateVideo({ prompt: 'a sunrise' });
    expect(ref.kind).toBe('job');
    expect(ref.jobId).toBe('r-queue-1');
  });

  it('throws ProviderRejectedError when CLI returns status=failed', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({ status: 'failed', error: 'unsafe content' }),
      }) as never,
    );
    await expect(adapter.generateVideo({ prompt: 'x' })).rejects.toBeInstanceOf(
      ProviderRejectedError,
    );
  });
});

describe('HiggsfieldCliAdapter — error paths', () => {
  it('rejects empty prompt', async () => {
    await expect(adapter.generateImage({ prompt: '' })).rejects.toBeInstanceOf(
      ProviderParseError,
    );
  });

  it('rejects video with no prompt and no image', async () => {
    await expect(adapter.generateVideo({ prompt: '' })).rejects.toBeInstanceOf(
      ProviderParseError,
    );
  });

  it('maps CLI-not-found to ProviderUnavailableError', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        errorOnSpawn: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      }) as never,
    );
    await expect(adapter.generateImage({ prompt: 'x' })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it('maps CLI timeout to ProviderTimeoutError', async () => {
    const child = new EventEmitter() as FakeChild;
    child.stdout = Readable.from([]);
    child.stderr = Readable.from([]);
    // When the helper calls child.kill(), emit 'close' so the
    // helper's promise resolves through the timeout-error path.
    child.kill = vi.fn().mockImplementation(() => {
      setImmediate(() => child.emit('close', null));
    });
    spawnMock.mockReturnValue(child as never);
    await expect(
      adapter.generateImage({ prompt: 'x', timeoutMs: 25 }),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it('maps non-JSON stdout to ProviderParseError', async () => {
    spawnMock.mockReturnValue(makeChild({ stdout: 'not json' }) as never);
    await expect(adapter.generateImage({ prompt: 'x' })).rejects.toBeInstanceOf(
      ProviderParseError,
    );
  });

  it('maps zero-exit JSON error payload to ProviderRejectedError', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({
          error: { code: 401, message: 'token expired', hint: 're-auth' },
        }),
      }) as never,
    );
    let caught: unknown;
    try {
      await adapter.generateImage({ prompt: 'x' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderRejectedError);
    expect((caught as ProviderRejectedError).message).toContain('token expired');
  });
});

describe('HiggsfieldCliAdapter.isAvailable', () => {
  it('returns true when binary is pre-resolved', async () => {
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('returns false when no binary resolves', async () => {
    const fresh = new HiggsfieldCliAdapter();
    (fresh as unknown as { resolvedBinary: string | null; resolveAttempted: boolean }).resolveAttempted = true;
    (fresh as unknown as { resolvedBinary: string | null; resolveAttempted: boolean }).resolvedBinary = null;
    expect(await fresh.isAvailable()).toBe(false);
  });
});

describe('HiggsfieldCliAdapter.generateVideo — timeout default (spec 60s)', () => {
  it('applies 60s default when opts.timeoutMs is undefined', async () => {
    const spy = vi.spyOn(cliUtils, 'cliInvoke').mockResolvedValueOnce({
      parsed: { url: 'https://cdn.higgsfield.ai/clip.mp4', request_id: 'r-1', duration: 8 },
      stdout: '{}',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
    } as never);
    await adapter.generateVideo({ prompt: 'a sunrise', durationSec: 8 });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 60_000 }));
    spy.mockRestore();
  });

  it('respects opts.timeoutMs override when set', async () => {
    const spy = vi.spyOn(cliUtils, 'cliInvoke').mockResolvedValueOnce({
      parsed: { url: 'https://cdn.higgsfield.ai/clip.mp4', request_id: 'r-2', duration: 8 },
      stdout: '{}',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
    } as never);
    await adapter.generateVideo({ prompt: 'a sunrise', durationSec: 8, timeoutMs: 5000 });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5000 }));
    spy.mockRestore();
  });
});
