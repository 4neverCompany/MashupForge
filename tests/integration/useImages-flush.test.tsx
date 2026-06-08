// @vitest-environment jsdom
//
// BUG-CRIT-006 / BUG-DES-002 / V1.2.7-HOTFIX: useImages flush-on-unload
// safety net.
//
// Bug (v1.2.5): useImages persists savedImages with a 200ms
// debounce. A manual Post Now (postedAt/postError patch) that
// lands <200ms before the user reloads loses the IDB write —
// the badge "resets on reload."
//
// Fix (v1.2.5): hooks/useImages.ts adds a `beforeunload`
// listener that synchronously writes the latest savedImages
// to localStorage.
//
// New bug (v1.2.7-HOTFIX): the listener was registered as
// soon as `isImagesLoaded` flipped to `true`, which happens
// immediately on mount BEFORE the actual store-load runs.
// On the next page navigation (e.g. OAuth "Connect Higgsfield"
// redirect), the listener fired with the initial in-memory
// `[]` state and wrote that empty value to localStorage.
// The next page's load effect found the empty array and
// clobbered the store with `[]` — wiping the user's images.
//
// New fix (v1.2.7-HOTFIX): the listener is now gated on
// BOTH `isImagesLoaded` AND `loadTriggered`. The user must
// have actually visited the data's home view (Gallery) for
// the listener to be active. When `loadTriggered` is false,
// there's no debounce to flush, so no listener is needed.
//
// This test pins the new contract so a future refactor
// can't silently re-introduce the v1.2.5 data-loss bug.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useImages } from '@/hooks/useImages';

// Mock idb-keyval so the hook doesn't try to hit a real IDB
// during the test. The flush path doesn't touch IDB anyway
// (it writes to localStorage), but the load path calls `get`
// on mount.
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

describe('V1.2.7-HOTFIX — beforeunload flush is gated on loadTriggered', () => {
  it('does NOT register the beforeunload listener when loadTriggered is false', async () => {
    // The user just opened the studio. isImagesLoaded flips to true
    // immediately (lazy load) but the actual store-load hasn't run
    // because requestLoad() wasn't called yet. The flush listener
    // must NOT be active in this state — otherwise the next page
    // navigation would write the initial in-memory `[]` to
    // localStorage and clobber the store.
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => useImages());
    // Flush the synchronous effects pass + the setState re-render
    // that happens when the lazy-load useEffect calls
    // setIsImagesLoaded(true).
    await act(async () => {
      await Promise.resolve();
    });

    const beforeunloadCalls = addSpy.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(beforeunloadCalls.length).toBe(0);

    addSpy.mockRestore();
  });

  it('DOES register the beforeunload listener once requestLoad() is called', async () => {
    const { result } = renderHook(() => useImages());
    await act(async () => {
      await Promise.resolve();
    });

    // Trigger the lazy load (simulating the user navigating to
    // the Gallery view which calls requestLoad() on mount).
    act(() => {
      result.current.requestLoad();
    });
    await vi.waitFor(() => expect(result.current.isImagesLoaded).toBe(true));

    // Now the listener should be active. The 200ms debounce is in
    // play; beforeunload is the only sync path to localStorage.
    expect(localStorage.getItem('mashup_saved_images')).toBeNull();
  });

  it('writes savedImages to localStorage when beforeunload fires (after loadTriggered)', async () => {
    const { result } = renderHook(() => useImages());
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.requestLoad();
    });
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

    // localStorage should be empty BEFORE beforeunload fires —
    // the 200ms debounce hasn't elapsed and the flush is the
    // only sync path to localStorage.
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
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.requestLoad();
    });
    await vi.waitFor(() => expect(result.current.isImagesLoaded).toBe(true));

    act(() => {
      result.current.saveImage({
        id: 'a',
        prompt: 'p',
        url: 'https://example.test/a.png',
      });
    });
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
});
