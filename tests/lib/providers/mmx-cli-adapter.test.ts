/**
 * Tests for lib/providers/mmx/cli-adapter.
 *
 * Coverage:
 *   - generateImage delegates to mmx-client and maps result to AssetRef
 *   - generateVideo returns AssetRef kind:job with taskId (noWait path)
 *   - mmx MmxSpawnError → ProviderUnavailableError
 *   - mmx MmxQuotaError → ProviderError code=4
 *   - mmx non-JSON / missing asset → ProviderParseError
 *   - isAvailable mirrors mmx-client's probe
 *
 * The mmx adapter delegates to lib/mmx-client.ts — we use that
 * module's own test seam (__setSpawnForTests) to inject a fake
 * spawn. The fake returns JSON shaped like mmx's --output json
 * responses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { __setSpawnForTests } from '@/lib/mmx-client';
import { MmxCliAdapter } from '@/lib/providers/mmx/cli-adapter';
import {
  ProviderError,
  ProviderParseError,
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
const adapter = new MmxCliAdapter();

beforeEach(() => {
  spawnMock.mockReset();
  __setSpawnForTests(spawnMock as never);
});
afterEach(() => {
  __setSpawnForTests(null);
});

describe('MmxCliAdapter.generateImage', () => {
  it('returns AssetRef kind:image with first url', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({
          data: { image_urls: ['https://cdn/mmx/a.png', 'https://cdn/mmx/b.png'] },
        }),
      }) as never,
    );
    const ref = await adapter.generateImage({ prompt: 'a cat' });
    expect(ref.kind).toBe('image');
    expect(ref.url).toBe('https://cdn/mmx/a.png');
    expect(ref.mimeType).toBe('image/png');
  });

  it('returns AssetRef kind:image with first file path when no urls', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({ output_files: ['/tmp/x.png'] }),
      }) as never,
    );
    const ref = await adapter.generateImage({ prompt: 'a cat' });
    expect(ref.path).toBe('/tmp/x.png');
  });

  it('rejects empty prompt', async () => {
    await expect(adapter.generateImage({ prompt: '' })).rejects.toBeInstanceOf(
      ProviderParseError,
    );
  });

  it('maps MmxSpawnError to ProviderUnavailableError', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        errorOnSpawn: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      }) as never,
    );
    await expect(adapter.generateImage({ prompt: 'x' })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it('maps MmxQuotaError (code 4) to ProviderError with code "4"', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({
          error: {
            code: 4,
            message: 'image-01 requires the Plus plan',
            hint: 'upgrade plan',
          },
        }),
      }) as never,
    );
    let caught: unknown;
    try {
      await adapter.generateImage({ prompt: 'x' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    expect((caught as ProviderError).code).toBe('4');
  });

  it('returns ProviderParseError when mmx returns no asset', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({ data: { image_urls: [] }, output_files: [] }),
      }) as never,
    );
    await expect(adapter.generateImage({ prompt: 'x' })).rejects.toBeInstanceOf(
      ProviderParseError,
    );
  });
});

describe('MmxCliAdapter.generateVideo', () => {
  it('returns AssetRef kind:job with taskId (noWait path)', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({ task_id: 'task-1' }),
      }) as never,
    );
    const ref = await adapter.generateVideo({ prompt: 'a sunrise' });
    expect(ref.kind).toBe('job');
    expect(ref.jobId).toBe('task-1');
  });

  it('rejects when neither prompt nor reference image is provided', async () => {
    await expect(adapter.generateVideo({ prompt: '' })).rejects.toBeInstanceOf(
      ProviderParseError,
    );
  });

  it('maps spawn ENOENT to ProviderUnavailableError', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        errorOnSpawn: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      }) as never,
    );
    await expect(adapter.generateVideo({ prompt: 'x' })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });
});

describe('MmxCliAdapter.isAvailable', () => {
  it('returns true on --version exit 0', async () => {
    spawnMock.mockReturnValue(makeChild({ stdout: 'mmx 1.0.0\n' }) as never);
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('returns false on spawn failure', async () => {
    spawnMock.mockReturnValue(
      makeChild({ errorOnSpawn: new Error('not found') }) as never,
    );
    expect(await adapter.isAvailable()).toBe(false);
  });
});
