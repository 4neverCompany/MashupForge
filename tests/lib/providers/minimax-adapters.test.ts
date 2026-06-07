/**
 * Tests for lib/providers/minimax/text-adapter (M3) and
 * lib/providers/minimax/video-adapter (Hailuo 2.3).
 *
 * Both adapters delegate to lib/mmx-client.ts; we exercise them
 * through that module's __setSpawnForTests seam. Coverage:
 *   - generateImage / generateVideo throw UnsupportedOperationError
 *     on the wrong-direction adapter
 *   - text-adapter: generateText streams deltas
 *   - text-adapter: describeImage returns description
 *   - video-adapter: generateVideo returns AssetRef kind:job
 *   - both: isAvailable mirrors mmx's probe
 *   - both: spawn ENOENT maps to ProviderError with code 'UNAVAILABLE'
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import * as mmxClient from '@/lib/mmx-client';
import { __setSpawnForTests } from '@/lib/mmx-client';
import { MinimaxTextAdapter } from '@/lib/providers/minimax/text-adapter';
import { MinimaxVideoAdapter } from '@/lib/providers/minimax/video-adapter';
import {
  ProviderError,
  ProviderParseError,
  UnsupportedOperationError,
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
const textAdapter = new MinimaxTextAdapter();
const videoAdapter = new MinimaxVideoAdapter();

beforeEach(() => {
  spawnMock.mockReset();
  __setSpawnForTests(spawnMock as never);
});
afterEach(() => {
  __setSpawnForTests(null);
});

describe('MinimaxTextAdapter', () => {
  it('throws UnsupportedOperationError for generateImage', async () => {
    await expect(textAdapter.generateImage({ prompt: 'x' })).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
  });

  it('throws UnsupportedOperationError for generateVideo', async () => {
    await expect(textAdapter.generateVideo({ prompt: 'x' })).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
  });

  it('rejects empty generateText message', async () => {
    const gen = textAdapter.generateText('');
    await expect(gen.next()).rejects.toBeInstanceOf(ProviderParseError);
  });

  it('generateText yields text deltas from mmx', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({
          role: 'assistant',
          content: [{ type: 'text', text: 'hello world' }],
        }),
      }) as never,
    );
    const out: string[] = [];
    for await (const delta of textAdapter.generateText('hi')) out.push(delta);
    expect(out.join('')).toBe('hello world');
  });

  it('describeImage routes --image and returns description', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({ description: 'a cat on a sofa' }),
      }) as never,
    );
    const { description } = await textAdapter.describeImage({ image: '/tmp/x.png' });
    expect(description).toBe('a cat on a sofa');
  });

  it('describeImage maps spawn ENOENT to ProviderError code=UNAVAILABLE', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        errorOnSpawn: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      }) as never,
    );
    let caught: unknown;
    try {
      await textAdapter.describeImage({ image: '/tmp/x.png' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    expect((caught as ProviderError).code).toBe('UNAVAILABLE');
  });

  it('isAvailable mirrors mmx probe', async () => {
    spawnMock.mockReturnValue(makeChild({ stdout: 'mmx 1.0' }) as never);
    expect(await textAdapter.isAvailable()).toBe(true);
    spawnMock.mockReturnValue(
      makeChild({ errorOnSpawn: new Error('not found') }) as never,
    );
    expect(await textAdapter.isAvailable()).toBe(false);
  });

  it('exposes the canonical default model name', () => {
    expect(textAdapter.defaultModel).toBe('M3');
    const custom = new MinimaxTextAdapter({ defaultModel: 'MiniMax-M3-Pro' });
    expect(custom.defaultModel).toBe('MiniMax-M3-Pro');
  });
});

describe('MinimaxVideoAdapter (Hailuo 2.3)', () => {
  it('throws UnsupportedOperationError for generateImage', async () => {
    await expect(videoAdapter.generateImage({ prompt: 'x' })).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
  });

  it('rejects generateVideo with no prompt and no image', async () => {
    await expect(videoAdapter.generateVideo({ prompt: '' })).rejects.toBeInstanceOf(
      ProviderParseError,
    );
  });

  it('generateVideo returns AssetRef kind:job with taskId', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({ task_id: 'hailuo-task-1' }),
      }) as never,
    );
    const ref = await videoAdapter.generateVideo({
      prompt: 'a slow zoom into a forest',
      durationSec: 6,
    });
    expect(ref.kind).toBe('job');
    expect(ref.jobId).toBe('hailuo-task-1');
    expect(ref.provider).toBe('minimax-video');
    expect(ref.durationSec).toBe(6);
  });

  it('generateVideo returns AssetRef kind:video with file path when sync', async () => {
    spawnMock.mockReturnValue(
      makeChild({
        stdout: JSON.stringify({ output_file: '/tmp/hailuo-out.mp4' }),
      }) as never,
    );
    const ref = await videoAdapter.generateVideo({ prompt: 'x' });
    expect(ref.kind).toBe('video');
    expect(ref.path).toBe('/tmp/hailuo-out.mp4');
  });

  it('passes the default model id "Hailuo-2.3" to mmx', async () => {
    spawnMock.mockReturnValue(
      makeChild({ stdout: JSON.stringify({ task_id: 't1' }) }) as never,
    );
    await videoAdapter.generateVideo({ prompt: 'x' });
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain('--model');
    expect(args).toContain('Hailuo-2.3');
  });

  it('respects a caller-supplied model override', async () => {
    spawnMock.mockReturnValue(
      makeChild({ stdout: JSON.stringify({ task_id: 't2' }) }) as never,
    );
    await videoAdapter.generateVideo({ prompt: 'x', model: 'Hailuo-2.2-Pro' });
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain('Hailuo-2.2-Pro');
  });

  it('pollTask returns AssetRef kind:job without calling the CLI', async () => {
    // pollTask is a placeholder until mmx grows a status subcommand
    // we wire in. It must NOT spawn anything.
    const ref = await videoAdapter.pollTask('t3');
    expect(ref.kind).toBe('job');
    expect(ref.jobId).toBe('t3');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('isAvailable mirrors mmx probe', async () => {
    spawnMock.mockReturnValue(makeChild({ stdout: 'mmx 1.0' }) as never);
    expect(await videoAdapter.isAvailable()).toBe(true);
  });
});

describe('MinimaxVideoAdapter.generateVideo — timeout default (spec 60s)', () => {
  it('applies 60s default when opts.timeoutMs is undefined', async () => {
    const spy = vi.spyOn(mmxClient, 'generateVideo').mockResolvedValueOnce({
      taskId: 'hailuo-default-1',
    } as never);
    await videoAdapter.generateVideo({ prompt: 'a slow zoom' });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ timeoutMs: 60_000 }),
    );
    spy.mockRestore();
  });

  it('respects opts.timeoutMs override when set', async () => {
    const spy = vi.spyOn(mmxClient, 'generateVideo').mockResolvedValueOnce({
      taskId: 'hailuo-override-1',
    } as never);
    await videoAdapter.generateVideo({ prompt: 'a slow zoom', timeoutMs: 5000 });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ timeoutMs: 5000 }),
    );
    spy.mockRestore();
  });
});
