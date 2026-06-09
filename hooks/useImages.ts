'use client';

import { useState, useEffect, useRef } from 'react';
// BUG-DEV-012: persistence goes through `@/lib/persistence` (tauri-plugin-
// store in production, idb-keyval fallback in dev/test). The IDB key name
// stays the same so the migration runner in persistence.ts can detect any
// pre-fix value and copy it forward on first launch.
import { get, set } from '@/lib/persistence'
import { autoBackupImages } from '@/lib/backup/images'
import { type GeneratedImage } from '../types/mashup'

// Normalize images on load: rewrite legacy tag spelling and reset any
// transient pipeline status that was persisted mid-flight (the work itself
// did not survive the reload, so the status would otherwise be stuck).
function normalizeOnLoad(img: GeneratedImage): GeneratedImage {
  const tags = img.tags?.map(t => t === 'Warhammer 40,000' ? 'Warhammer 40k' : t);
  const status = img.status === 'generating' || img.status === 'animating' ? 'ready' : img.status;
  return { ...img, tags, status };
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

  // V1.2.1: studio mount is no longer blocked by image I/O. isLoaded
  // flips to true immediately; the actual data load is gated on the
  // Gallery view calling requestLoad().
  useEffect(() => {
    if (!loadTriggered) {
      // Studio mount: signal "not loaded yet" so the splash stays
      // visible? Actually no — the studio can render with empty state.
      // We set isImagesLoaded=true so isLoaded (in MashupContext) is
      // not stuck on this. The Gallery view re-triggers the load.
      setIsImagesLoaded(true);
      return;
    }
    let cancelled = false;
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
              if (idbImages && !cancelled) setSavedImages(idbImages.map(normalizeOnLoad));
            } else {
              // Merge: store first, localStorage on top. If the
              // localStorage is a partial (e.g. an in-flight
              // addImage that hasn't been IDB-persisted yet),
              // the merge keeps the rest of the store intact.
              const storeValue = Array.isArray(idbImages) ? idbImages : [];
              // For images, "merge" is union by id (later wins).
              // The in-flight localStorage edit supersedes the
              // store version of the same id.
              const byId = new Map<string, GeneratedImage>();
              for (const img of storeValue) byId.set(img.id, img);
              for (const img of images) byId.set(img.id, img);
              const merged = Array.from(byId.values());
              await set('mashup_saved_images', merged);
              localStorage.removeItem('mashup_saved_images');
              if (!cancelled) setSavedImages(merged);
            }
          } catch {
            const idbImages = await get('mashup_saved_images');
            if (idbImages && !cancelled) setSavedImages(idbImages.map(normalizeOnLoad));
          }
        } else {
          const idbImages = await get('mashup_saved_images');
          if (idbImages && !cancelled) setSavedImages(idbImages.map(normalizeOnLoad));
        }
      } catch {
        // silent — savedImages remains empty
      } finally {
        if (!cancelled) setIsImagesLoaded(true);
      }
    };
    loadImages();
    return () => { cancelled = true; };
  }, [loadTriggered]);

  // PROP-020: single debounced IDB write coalesces rapid mutations
  // (bulk tag-select, approveAll, carousel-group delete) into one write
  // 200ms after the last change, instead of N concurrent writes per
  // mutator. Mirrors the PROP-010 pattern in useSettings.
  useEffect(() => {
    if (!isImagesLoaded) return;
    const timer = setTimeout(() => {
      void set('mashup_saved_images', savedImages).catch(() => {});
      // Auto-backup to Documents folder (survives reinstall)
      void autoBackupImages(savedImages);
    }, 200);
    return () => clearTimeout(timer);
  }, [savedImages, isImagesLoaded]);

  // BUG-DES-002: flush-on-unload safety net for the 200ms debounce
  // window. Without this, a manual Post Now (postedAt/postError) made
  // <200ms before the user reloads is lost — IDB never gets the write,
  // so the badge "resets on reload". Writes synchronously to
  // localStorage; the load path migrates localStorage → IDB on next
  // session start. Mirrors the useSettings beforeunload flush.
  //
  // V1.2.6-HOTFIX: gate the listener on BOTH isImagesLoaded AND
  // loadTriggered. The original code registered the listener as
  // soon as `isImagesLoaded` flipped to true (which happens
  // immediately on mount, BEFORE the actual load runs). The
  // beforeunload handler then wrote the initial in-memory `[]`
  // state to localStorage on the next page navigation. The
  // next page's load effect found that empty array and
  // overwrote the store with `[]`, wiping the user's images.
  //
  // By requiring `loadTriggered` to also be true, we only
  // register the listener when there's actually a loaded
  // debounce to flush. Users who navigate without ever
  // visiting Gallery no longer get the bug.
  useEffect(() => {
    if (!isImagesLoaded || !loadTriggered) return;
    const flush = () => {
      try {
        localStorage.setItem(
          'mashup_saved_images',
          JSON.stringify(savedImagesRef.current),
        );
      } catch { /* storage quota — silent */ }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [isImagesLoaded, loadTriggered]);

  const saveImage = (img: GeneratedImage) => {
    setSavedImages(prev => {
      const exists = prev.some(i => i.id === img.id);
      if (exists) return prev.map(i => i.id === img.id ? { ...i, ...img } : i);
      return [{ ...img, savedAt: Date.now() }, ...prev];
    });
  };

  const deleteImage = (id: string, fromSaved: boolean) => {
    if (fromSaved) {
      setSavedImages(prev => prev.filter(i => i.id !== id));
    }
    return !fromSaved;
  };

  const updateImageTags = (id: string, tags: string[]) => {
    setSavedImages(prev => prev.map(img => img.id === id ? { ...img, tags } : img));
  };

  const bulkUpdateImageTags = (ids: string[], tags: string[], mode: 'append' | 'replace') => {
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
    setSavedImages(prev => prev.map(img => img.id === id ? { ...img, approved: !img.approved } : img));
  };

  const setImageStatus = (id: string, status: 'generating' | 'animating' | 'ready') => {
    setSavedImages(prev => prev.map(img => img.id === id ? { ...img, status } : img));
  };

  const updateSavedImageCollectionId = (imageId: string, collectionId: string | undefined) => {
    setSavedImages(prev => prev.map(img => img.id === imageId ? { ...img, collectionId } : img));
  };

  const clearCollectionFromImages = (collectionId: string) => {
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
