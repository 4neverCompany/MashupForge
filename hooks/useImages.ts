'use client';

import { useState, useEffect, useRef } from 'react';
// BUG-DEV-012: persistence goes through `@/lib/persistence` (tauri-plugin-
// store in production, idb-keyval fallback in dev/test). The IDB key name
// stays the same so the migration runner in persistence.ts can detect any
// pre-fix value and copy it forward on first launch.
import { get, set } from '@/lib/persistence'
import { autoBackupImages } from '@/lib/backup/images'
import { hasEmbeddedPixels, isAssetUrl, slimImageRecord } from '@/lib/images/slim'
import { displayUrlAsync } from '@/lib/images/storage'
import { type GeneratedImage } from '../types/mashup'

// Normalize images on load: rewrite legacy tag spelling and reset any
// transient pipeline status that was persisted mid-flight (the work itself
// did not survive the reload, so the status would otherwise be stuck).
function normalizeOnLoad(img: GeneratedImage): GeneratedImage {
  const tags = img.tags?.map(t => t === 'Warhammer 40,000' ? 'Warhammer 40k' : t);
  const status = img.status === 'generating' || img.status === 'animating' ? 'ready' : img.status;
  return { ...img, tags, status };
}

// V1.4.5-DATALOSS-ROOTCAUSE: id-union merge, `patch` wins on collisions.
// Used by the load path to fold freshly-loaded store data UNDER any
// in-memory mutations that happened before hydration finished (e.g. a
// Studio-generated image saved before the user ever visited Gallery).
function mergeById(base: GeneratedImage[], patch: GeneratedImage[]): GeneratedImage[] {
  const byId = new Map<string, GeneratedImage>();
  for (const img of base) byId.set(img.id, img);
  for (const img of patch) byId.set(img.id, img);
  return Array.from(byId.values());
}

export function useImages() {
  const [savedImages, setSavedImages] = useState<GeneratedImage[]>([]);
  const [isImagesLoaded, setIsImagesLoaded] = useState(false);
  // V1.2.1: lazy load. Studio mount is cheap (no I/O). The Gallery view
  // calls `requestLoad()` on mount; the actual `get('mashup_saved_images')`
  // JSON.parse happens then. For users with a 100+ MB store file (e.g. 692
  // saved images, 256 comparison results), the studio mount was hanging
  // for 30+ seconds because the Tauri plugin-store eagerly loaded the
  // whole file. The studio never needs images at mount time — the default
  // view is 'studio' (no images rendered) — so deferring the load is
  // safe. See PITFALLS.md "v1.2.1 persistence bloat".
  const [loadTriggered, setLoadTriggered] = useState(false);
  // V105.1-REACT-19: was `savedImagesRef.current = savedImages` during
  // render (refs). Moved into a useEffect so the ref mirrors state
  // after the commit phase instead of mid-render.
  const savedImagesRef = useRef(savedImages);
  useEffect(() => {
    savedImagesRef.current = savedImages;
  }, [savedImages]);

  // V1.4.5-HYDRATION-FAIL: latched when the store load THROWS (as
  // opposed to loading an empty library). While latched, the debounced
  // direct store-write below is disabled — writing the in-memory array
  // over a store we never managed to read would wipe the library.
  const hydrationFailedRef = useRef(false);
  // V1.4.5: true while the async load is running. Belt-and-suspenders
  // for the debounce timer: effect ordering already cancels a timer
  // scheduled in the one commit where loadTriggered flipped but
  // isImagesLoaded is still stale-true; this ref makes the timer
  // callback itself refuse to fire mid-hydration, independent of
  // React's scheduling.
  const loadInFlightRef = useRef(false);

  // V1.2.1: studio mount is no longer blocked by image I/O. isLoaded
  // flips to true immediately; the actual data load is gated on the
  // Gallery view calling requestLoad().
  useEffect(() => {
    if (!loadTriggered) {
      // Studio mount: signal "not loaded yet" so the splash stays
      // visible? Actually no — the studio can render with empty state.
      // We set isImagesLoaded=true so isLoaded (in MashupContext) is
      // not stuck on this. The Gallery view re-triggers the load.
      //
      // react-hooks/set-state-in-effect: deferred via queueMicrotask
      // (project convention, see HiggsfieldConnection.tsx). Stale-
      // guarded: if loadTriggered flips before the microtask fires,
      // the cleanup runs first and this must NOT set loaded=true over
      // the in-flight load's `false` (the V1.4.5 data-loss gate).
      let stale = false;
      queueMicrotask(() => {
        if (!stale) setIsImagesLoaded(true);
      });
      return () => { stale = true; };
    }
    // V1.4.5-DATALOSS-ROOTCAUSE: while the real load is in flight,
    // isImagesLoaded must be FALSE so the debounced store-write below
    // cannot fire against a not-yet-hydrated (empty or partial) array.
    // Before this, isImagesLoaded stayed true from the !loadTriggered
    // branch above, so a mutation made during the load window could
    // overwrite the store with just that mutation.
    //
    // Deliberately synchronous (NOT queueMicrotask-deferred like the
    // branch above): the gate must close in the same commit, before
    // any mutation effect can schedule a debounced write against the
    // not-yet-hydrated array. Documented project exception, same as
    // KebabMenu.tsx / CarouselApprovalCard.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsImagesLoaded(false);
    let cancelled = false;
    loadInFlightRef.current = true;
    const loadImages = async () => {
      try {
        const storedImages = localStorage.getItem('mashup_saved_images');
        if (storedImages) {
          try {
            const images = JSON.parse(storedImages).map(normalizeOnLoad);
            // V1.2.6-HOTFIX + V1.2.8: defensive check for the
            // v1.2.5 data-loss bug. The unmount/beforeunload flush
            // on useImages was registered with `isImagesLoaded=true`
            // even when the user had never visited Gallery
            // (loadTriggered=false), so the flush wrote the
            // initial in-memory `[]` to localStorage. The next
            // page's load then overwrote the store with `[]`,
            // wiping the user's images.
            //
            // V1.2.8: ALWAYS load from the store first (it has
            // the full data), then merge localStorage on top.
            // localStorage is a patch for in-flight changes that
            // didn't reach the store; the store is authoritative
            // for the full data.
            const idbImages = await get('mashup_saved_images');
            if (images.length === 0) {
              // V1.2.5 bug artifact — empty array from beforeunload
              // firing before the user visited Gallery. Clear
              // localStorage and load from the store.
              localStorage.removeItem('mashup_saved_images');
              if (idbImages && !cancelled) setSavedImages(prev => mergeById(idbImages.map(normalizeOnLoad), prev));
            } else {
              // Merge: store first, localStorage on top. If the
              // localStorage is a partial (e.g. an in-flight
              // addImage that hasn't been IDB-persisted yet),
              // the merge keeps the rest of the store intact.
              const storeValue = Array.isArray(idbImages) ? idbImages : [];
              // For images, "merge" is union by id (later wins).
              // The in-flight localStorage edit supersedes the
              // store version of the same id.
              const merged = mergeById(storeValue, images);
              await set('mashup_saved_images', merged);
              localStorage.removeItem('mashup_saved_images');
              // V1.4.5: fold the merged result UNDER any in-memory
              // mutations that happened while the load was in flight.
              if (!cancelled) setSavedImages(prev => mergeById(merged, prev));
            }
          } catch {
            const idbImages = await get('mashup_saved_images');
            if (idbImages && !cancelled) setSavedImages(prev => mergeById(idbImages.map(normalizeOnLoad), prev));
          }
        } else {
          const idbImages = await get('mashup_saved_images');
          if (idbImages && !cancelled) setSavedImages(prev => mergeById(idbImages.map(normalizeOnLoad), prev));
        }
      } catch {
        // V1.4.5-HYDRATION-FAIL: hydration threw (IDB unavailable /
        // corrupted). savedImages stays empty — but it must NOT be
        // treated as a successful empty hydration: a later mutation
        // would arm the debounced store-write and overwrite the full
        // library with just that mutation. Latch the failure; the
        // debounce effect refuses direct store writes for the rest
        // of the session. Mutations still reach localStorage via the
        // beforeunload flush, and the next launch's load path merges
        // them on top of the (intact) store.
        hydrationFailedRef.current = true;
      } finally {
        loadInFlightRef.current = false;
        if (!cancelled) setIsImagesLoaded(true);
      }
    };
    loadImages();
    return () => { cancelled = true; };
  }, [loadTriggered]);

  // V1.4.5-DATALOSS-ROOTCAUSE: dirty flag — only a REAL mutation (one of
  // the mutators below) arms the debounced store-write. Hydration commits
  // from the load effect do NOT set it, so loading can never trigger a
  // write-back of its own result (or of the initial `[]`).
  const dirtyRef = useRef(false);
  const markDirty = () => {
    dirtyRef.current = true;
    // First mutation outside Gallery (pipeline / useIdeaProcessor in
    // Studio): hydrate the store NOW so the debounced write below has
    // the full library in memory to write back. The load path merges
    // the store data UNDER the in-memory mutation (mergeById, in-memory
    // wins), so the new image survives and nothing is clobbered.
    setLoadTriggered(true);
  };

  // PROP-020: single debounced IDB write coalesces rapid mutations
  // (bulk tag-select, approveAll, carousel-group delete) into one write
  // 200ms after the last change, instead of N concurrent writes per
  // mutator. Mirrors the PROP-010 pattern in useSettings.
  //
  // V1.4.5-DATALOSS-ROOTCAUSE: this effect was the actual wipe vector
  // behind every "images gone since v1.2.5" report. It was gated ONLY on
  // `isImagesLoaded` — which the !loadTriggered branch above sets to true
  // immediately on Studio mount, while `savedImages` is still the initial
  // `[]`. 200ms later the effect wrote that `[]` (or a lone Studio-
  // generated image) over the full library in the Tauri store. The
  // v1.2.7/v1.2.8/v1.4.4 fixes only patched the localStorage/beforeunload
  // path; this direct store-write path was untouched. Now gated on all of:
  //   - loadTriggered    → store has been (or is being) hydrated
  //   - isImagesLoaded   → hydration actually finished (see load effect)
  //   - dirtyRef         → a real mutation happened (not a hydration commit)
  useEffect(() => {
    if (!loadTriggered || !isImagesLoaded) return;
    if (!dirtyRef.current) return;
    // V1.4.5-HYDRATION-FAIL: never write the store when hydration
    // failed — the in-memory array is missing the (unreadable but
    // possibly intact) library. localStorage flush + next-launch
    // merge keeps the mutations instead.
    if (hydrationFailedRef.current) return;
    const timer = setTimeout(() => {
      if (loadInFlightRef.current || hydrationFailedRef.current) return;
      void set('mashup_saved_images', savedImages).catch(() => {});
      // Auto-backup to Documents folder (survives reinstall)
      void autoBackupImages(savedImages);
    }, 200);
    return () => clearTimeout(timer);
  }, [savedImages, isImagesLoaded, loadTriggered]);

  // BUG-DES-002: flush-on-unload safety net for the 200ms debounce
  // window. Without this, a manual Post Now (postedAt/postError) made
  // <200ms before the user reloads is lost — IDB never gets the write,
  // so the badge "resets on reload". Writes synchronously to
  // localStorage; the load path migrates localStorage → IDB on next
  // session start. Mirrors the useSettings beforeunload flush.
  //
  // V1.4.4-DATALOSS-FIX: the v1.2.7-HOTFIX gated this listener on
  // `loadTriggered` to avoid the v1.2.5 bug (writing the initial
  // in-memory `[]` on first navigation). But the gate ALSO killed
  // the safety net for the common case: user generates an image in
  // Studio (no Gallery visit), then closes the app within 200ms —
  // the 200ms debounced IDB write never fires, the flush listener
  // isn't registered, the image is lost. The user sees it once,
  // closes, reopens, gone.
  //
  // The correct fix: always register the listener, but the flush
  // function REFUSES to write an empty array. This combines both
  // safety nets:
  //   - Empty state doesn't pollute localStorage (v1.2.5 protection)
  //   - Any non-empty state is preserved on shutdown (v1.4.4 fix)
  useEffect(() => {
    const flush = () => {
      const data = savedImagesRef.current
      // CRITICAL: never write an empty array. The original v1.2.5
      // data-loss bug was caused by writing the initial in-memory
      // `[]` to localStorage on first navigation; the next page's
      // load then overwrote the store with that `[]`, wiping the
      // user's images. The empty-array short-circuit is what makes
      // it safe to register this listener unconditionally.
      if (data.length === 0) return
      try {
        localStorage.setItem(
          'mashup_saved_images',
          JSON.stringify(data),
        )
      } catch { /* storage quota — silent */ }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // ── M3.2 (V1.8): store slimming — embedded pixels OUT of the JSON ──
  // The watermark flows (winner pick, pipeline finalize, re-apply)
  // write canvas data-URLs (~0.5 MB each) into `url`; with the store
  // persisting the full array, Maurice's mashupforge.json had grown to
  // 217 MB (103 MB images + a 103 MB backup duplicate) — the documented
  // 30s+ studio-mount stall. Every save now kicks an async slim pass:
  // pixels go to the canonical images dir (v1.4.4 file-per-image
  // pattern), the record keeps a `localPath` reference. Off-Tauri (web
  // dev) slimImageRecord returns null and the fat record stays — the
  // predicate still matches on the next launch, so nothing is lost.
  const slimInFlightRef = useRef<Set<string>>(new Set());
  const slimAndPatch = async (img: GeneratedImage): Promise<boolean> => {
    if (slimInFlightRef.current.has(img.id)) return false;
    slimInFlightRef.current.add(img.id);
    try {
      const slim = await slimImageRecord(img);
      if (!slim) return false;
      markDirty();
      setSavedImages(prev => prev.map(i =>
        i.id === img.id
          ? { ...i, localPath: slim.localPath, url: slim.url, base64: undefined }
          : i,
      ));
      return true;
    } catch {
      return false;
    } finally {
      slimInFlightRef.current.delete(img.id);
    }
  };

  // One-time-per-session background migration for records that were
  // persisted fat by older versions (236 of Maurice's 259 entries).
  // Runs after a successful hydration, sequentially with a small
  // breather so ~100 MB of disk writes don't compete with the UI.
  // Idempotent: slimmed records no longer match the predicate, and a
  // failed write leaves the fat record for the next launch.
  const migrationRanRef = useRef(false);
  useEffect(() => {
    if (!loadTriggered || !isImagesLoaded) return;
    if (hydrationFailedRef.current) return;
    if (migrationRanRef.current) return;
    migrationRanRef.current = true;
    let cancelled = false;
    void (async () => {
      const fat = savedImagesRef.current.filter(hasEmbeddedPixels);
      for (const img of fat) {
        if (cancelled) return;
        await slimAndPatch(img);
        // Yield between writes — keeps the main thread responsive
        // while the first post-update launch migrates the backlog.
        await new Promise((r) => setTimeout(r, 50));
      }
      // Refresh stale asset URLs: the persisted `url` of a slimmed
      // record embeds an ABSOLUTE path (convertFileSrc), which goes
      // stale when the app-data folder moves or the app is
      // reinstalled. localPath is the durable reference — re-derive.
      // Cheap (one convertFileSrc per entry, no disk reads); off-Tauri
      // displayUrlAsync just echoes the stored url → no patch.
      const withLocal = savedImagesRef.current.filter(
        (i) => i.localPath && (!i.url || isAssetUrl(i.url)),
      );
      for (const img of withLocal) {
        if (cancelled) return;
        try {
          const fresh = await displayUrlAsync(img);
          if (fresh && fresh !== img.url) {
            markDirty();
            setSavedImages(prev => prev.map(i =>
              i.id === img.id ? { ...i, url: fresh } : i,
            ));
          }
        } catch { /* keep the stored url */ }
      }
    })();
    return () => { cancelled = true; };
    // slimAndPatch is stable-in-practice (uses refs + setState); the
    // effect must fire exactly once per successful hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTriggered, isImagesLoaded]);

  const saveImage = (img: GeneratedImage) => {
    markDirty();
    setSavedImages(prev => {
      const exists = prev.some(i => i.id === img.id);
      if (exists) return prev.map(i => i.id === img.id ? { ...i, ...img } : i);
      return [{ ...img, savedAt: Date.now() }, ...prev];
    });
    // Fire-and-forget: pixels to disk, reference in the store. The
    // record is saved fat first (UI stays snappy, nothing is lost on
    // crash), then patched slim when the disk write lands.
    if (hasEmbeddedPixels(img)) void slimAndPatch(img);
  };

  const deleteImage = (id: string, fromSaved: boolean) => {
    if (fromSaved) {
      markDirty();
      setSavedImages(prev => prev.filter(i => i.id !== id));
    }
    return !fromSaved;
  };

  const updateImageTags = (id: string, tags: string[]) => {
    markDirty();
    setSavedImages(prev => prev.map(img => img.id === id ? { ...img, tags } : img));
  };

  const bulkUpdateImageTags = (ids: string[], tags: string[], mode: 'append' | 'replace') => {
    markDirty();
    setSavedImages(prev => prev.map(img => {
      if (!ids.includes(img.id)) return img;
      if (mode === 'append') {
        const existingTags = img.tags || [];
        return { ...img, tags: Array.from(new Set([...existingTags, ...tags])) };
      }
      return { ...img, tags };
    }));
  };

  const toggleApproveImage = (id: string) => {
    markDirty();
    setSavedImages(prev => prev.map(img => img.id === id ? { ...img, approved: !img.approved } : img));
  };

  const setImageStatus = (id: string, status: 'generating' | 'animating' | 'ready') => {
    markDirty();
    setSavedImages(prev => prev.map(img => img.id === id ? { ...img, status } : img));
  };

  const updateSavedImageCollectionId = (imageId: string, collectionId: string | undefined) => {
    markDirty();
    setSavedImages(prev => prev.map(img => img.id === imageId ? { ...img, collectionId } : img));
  };

  const clearCollectionFromImages = (collectionId: string) => {
    markDirty();
    setSavedImages(prev => prev.map(img => img.collectionId === collectionId ? { ...img, collectionId: undefined } : img));
  };

  return {
    savedImages,
    saveImage,
    deleteImage,
    updateImageTags,
    bulkUpdateImageTags,
    toggleApproveImage,
    setImageStatus,
    updateSavedImageCollectionId,
    clearCollectionFromImages,
    isImagesLoaded,
    // V1.2.1: trigger the actual persistence load. Called by the
    // Gallery view on mount. Studio mount no longer blocks on this.
    requestLoad: () => setLoadTriggered(true),
  };
}
