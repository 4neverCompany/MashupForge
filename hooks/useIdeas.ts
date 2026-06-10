'use client';

import { useState, useEffect, useRef } from 'react';
// BUG-DEV-012: persisted through `@/lib/persistence` so ideas survive
// a folder move on Windows (WebView2 IndexedDB partitioning fix).
import { get, set } from '@/lib/persistence';
import { type Idea } from '../types/mashup';

// V1.4.7: id-union merge, `patch` (in-memory) wins on collisions — the
// load path folds store data UNDER mutations made before hydration.
function mergeIdeasById(base: Idea[], patch: Idea[]): Idea[] {
  const byId = new Map<string, Idea>();
  for (const idea of base) byId.set(idea.id, idea);
  for (const idea of patch) byId.set(idea.id, idea);
  return Array.from(byId.values());
}

export function useIdeas() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [isIdeasLoaded, setIsIdeasLoaded] = useState(false);
  // V1.2.1: lazy load — see useImages.ts for the full rationale.
  const [loadTriggered, setLoadTriggered] = useState(false);

  // V1.4.7: same dirty-flag pattern as useImages/useSettings — only a
  // real mutation arms the auto-save; hydration commits don't, and the
  // persist gate stays closed while the load is in flight.
  const dirtyRef = useRef(false);
  const loadInFlightRef = useRef(false);
  const markDirty = () => {
    dirtyRef.current = true;
    setLoadTriggered(true);
  };

  useEffect(() => {
    if (!loadTriggered) {
      // react-hooks/set-state-in-effect: deferred via queueMicrotask
      // (project convention), stale-guarded against a loadTriggered
      // flip before the microtask fires.
      let stale = false;
      queueMicrotask(() => {
        if (!stale) setIsIdeasLoaded(true);
      });
      return () => { stale = true; };
    }
    // V1.4.7: close the persist gate while the real load runs (the
    // mount microtask above left isIdeasLoaded true). Documented
    // project exception — same as useImages/useSettings.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsIdeasLoaded(false);
    let cancelled = false;
    loadInFlightRef.current = true;
    const load = async () => {
      try {
        const idbIdeas = await get('mashup_ideas');
        // Fold store data UNDER any in-memory mutations made while the
        // load was in flight (in-memory wins by id).
        if (idbIdeas && !cancelled) setIdeas(prev => mergeIdeasById(idbIdeas, prev));
      } catch {
        // silent — ideas remain empty
      } finally {
        loadInFlightRef.current = false;
        if (!cancelled) setIsIdeasLoaded(true);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [loadTriggered]);

  // V1.2.8: gate the auto-save effect on BOTH isIdeasLoaded AND
  // loadTriggered (mount flips isIdeasLoaded true while the in-memory
  // state is still `[]`). V1.4.7: additionally on dirtyRef — only real
  // mutations write back, hydration commits don't.
  useEffect(() => {
    if (!isIdeasLoaded || !loadTriggered) return;
    if (!dirtyRef.current) return;
    if (loadInFlightRef.current) return;
    set('mashup_ideas', ideas);
  }, [ideas, isIdeasLoaded, loadTriggered]);

  const addIdea = (concept: string, context?: string) => {
    const newIdea: Idea = {
      id: `idea-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      concept,
      context,
      createdAt: Date.now(),
      status: 'idea'
    };
    markDirty();
    setIdeas(prev => [newIdea, ...prev]);
  };

  const updateIdeaStatus = (id: string, status: 'idea' | 'in-work' | 'done') => {
    markDirty();
    setIdeas(prev => prev.map(idea => idea.id === id ? { ...idea, status } : idea));
  };

  const deleteIdea = (id: string) => {
    markDirty();
    setIdeas(prev => prev.filter(idea => idea.id !== id));
  };

  const clearIdeas = () => {
    markDirty();
    setIdeas([]);
  };

  return {
    ideas,
    addIdea,
    clearIdeas,
    updateIdeaStatus,
    deleteIdea,
    isIdeasLoaded,
    requestLoad: () => setLoadTriggered(true),
  };
}
