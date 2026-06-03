'use client';

import { useState, useEffect, useRef } from 'react';
// BUG-DEV-012: persistence goes through `@/lib/persistence` (tauri-plugin-
// store in production, idb-keyval fallback in dev/test). The IDB key name
// stays the same so the migration runner in persistence.ts can detect any
// pre-fix value and copy it forward on first launch.
import { get, set } from '@/lib/persistence';
import { type GeneratedImage } from '../types/mashup';

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
  // V105.1-REACT-19: was `savedImagesRef.current = savedImages` during
  // render (refs). Moved into a useEffect so the ref mirrors state
  // after the commit phase instead of mid-render.
  const savedImagesRef = useRef(savedImages);
  useEffect(() => {
    savedImagesRef.current = savedImages;
  }, [savedImages]);

  useEffect(() => {
    const loadImages = async () => {
      try {
        const storedImages = localStorage.getItem('mashup_saved_images');
        if (storedImages) {
          try {
            const images = JSON.parse(storedImages).map(normalizeOnLoad);
            await set('mashup_saved_images', images);
            localStorage.removeItem('mashup_saved_images');
            setSavedImages(images);
          } catch {
            const idbImages = await get('mashup_saved_images');
            if (idbImages) setSavedImages(idbImages.map(normalizeOnLoad));
          }
        } else {
          const idbImages = await get('mashup_saved_images');
          if (idbImages) setSavedImages(idbImages.map(normalizeOnLoad));
        }
      } catch {
        // silent — savedImages remains empty, isImagesLoaded still fires
      } finally {
        setIsImagesLoaded(true);
      }
    };
    loadImages();
  }, []);

  // PROP-020: single debounced IDB write coalesces rapid mutations
  // (bulk tag-select, approveAll, carousel-group delete) into one write
  // 200ms after the last change, instead of N concurrent writes per
  // mutator. Mirrors the PROP-010 pattern in useSettings.
  useEffect(() => {
    if (!isImagesLoaded) return;
    const timer = setTimeout(() => {
      void set('mashup_saved_images', savedImages).catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [savedImages, isImagesLoaded]);

  // BUG-DES-002: flush-on-unload safety net for the 200ms debounce
  // window. Without this, a manual Post Now (postedAt/postError) made
  // <200ms before the user reloads is lost — IDB never gets the write,
  // so the badge "resets on reload". Writes synchronously to
  // localStorage; the load path migrates localStorage → IDB on next
  // session start. Mirrors the useSettings beforeunload flush.
  useEffect(() => {
    if (!isImagesLoaded) return;
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
  }, [isImagesLoaded]);

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
  };
}
