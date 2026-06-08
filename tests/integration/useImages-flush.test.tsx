// @vitest-environment jsdom
//
// BUG-CRIT-006 / BUG-DES-002: useImages flush-on-unload safety net.
//
// Bug: useImages persists savedImages with a 200ms debounce. A manual
// Post Now (postedAt/postError patch) that lands <200ms before the
// user reloads loses the IDB write — the badge "resets on reload."
//
// Fix: hooks/useImages.ts adds a `beforeunload` listener that
// synchronously writes the latest savedImages to localStorage. The
// next session's load path migrates localStorage → IDB on first
// render (already in place; we don't change it).
//
// This test pins the flush contract so a future refactor can't
// silently drop the listener.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useImages } from '@/hooks/useImages';

// Mock idb-keyval so the hook doesn't try to hit a real IDB during the
// test. The flush path doesn't touch IDB anyway (it writes to
// localStorage), but the load path calls `get` on mount.
vi.mock('idb-keyval', () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  localStorage.clear();
  cleanup();
});

afterEach(() => {
  localStorage.clear();
});

describe('BUG-CRIT-006 / BUG-DES-002 — useImages flush-on-unload', () => {
  it('writes savedImages to localStorage when beforeunload fires', async () => {
    const { result } = renderHook(() => useImages());

    // Wait for the load effect to flip isImagesLoaded → true so the
    // flush listener subscribes.
    await vi.waitFor(() => expect(result.current.isImagesLoaded).toBe(true));

    act(() => {
      result.current.saveImage({
        id: 'img-flush-1',
        prompt: 'flush test',
        url: 'https://example.test/x.png',
        postedAt: 1234567890,
      });
    });

    // Sanity: the image is in state.
    expect(result.current.savedImages).toHaveLength(1);
    expect(result.current.savedImages[0]!.id).toBe('img-flush-1');
    expect(result.current.savedImages[0]!.postedAt).toBe(1234567890);

    // localStorage should be empty BEFORE beforeunload fires — the
    // 200ms debounce hasn't elapsed and the flush is the only sync
    // path to localStorage.
    expect(localStorage.getItem('mashup_saved_images')).toBeNull();

    // Fire beforeunload.
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    // The flush should have written the latest savedImages.
    const persisted = localStorage.getItem('mashup_saved_images');
    expect(persisted).not.toBeNull();
    const parsed = JSON.parse(persisted!) as Array<{ id: string; postedAt?: number }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.id).toBe('img-flush-1');
    expect(parsed[0]!.postedAt).toBe(1234567890);
  });

  it('flush always writes the latest value (savedImagesRef pattern)', async () => {
    const { result } = renderHook(() => useImages());
    await vi.waitFor(() => expect(result.current.isImagesLoaded).toBe(true));

    // First image
    act(() => {
      result.current.saveImage({
        id: 'a',
        prompt: 'p',
        url: 'https://example.test/a.png',
      });
    });
    // Second image — re-render with new state. The flush listener was
    // registered with the old `savedImages` reference; this test
    // verifies it sees the NEW value through savedImagesRef rather
    // than the stale closure.
    act(() => {
      result.current.saveImage({
        id: 'b',
        prompt: 'p',
        url: 'https://example.test/b.png',
      });
    });

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    const parsed = JSON.parse(localStorage.getItem('mashup_saved_images')!) as Array<{ id: string }>;
    const ids = parsed.map((p) => p.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('registers the beforeunload listener once isImagesLoaded flips true', async () => {
    // V1.2.1: lazy persistence load. The lazy-load useEffect flips
    // isImagesLoaded to `true` synchronously on mount (so the studio
    // doesn't block waiting for the 100+ MB store JSON.parse). The
    // flush useEffect then registers the beforeunload listener on the
    // same render tick. Pre-v1.2.1 this test asserted 0 calls; the new
    // contract is "listener is registered after the synchronous
    // render+effects flush" which is what the user-visible
    // reload-survives contract requires.
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useImages());
    // Flush the synchronous effects pass + the setState re-render that
    // happens when the lazy-load useEffect calls setIsImagesLoaded(true).
    await act(async () => {
      await Promise.resolve();
    });

    const beforeunloadCalls = addSpy.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(beforeunloadCalls.length).toBeGreaterThanOrEqual(1);

    addSpy.mockRestore();
  });
});
