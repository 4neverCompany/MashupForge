'use client';

import { useState, useEffect } from 'react';
// BUG-DEV-012: persisted through `@/lib/persistence` so ideas survive
// a folder move on Windows (WebView2 IndexedDB partitioning fix).
import { get, set } from '@/lib/persistence';
import { type Idea } from '../types/mashup';

export function useIdeas() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [isIdeasLoaded, setIsIdeasLoaded] = useState(false);
  // V1.2.1: lazy load — see useImages.ts for the full rationale.
  const [loadTriggered, setLoadTriggered] = useState(false);

  useEffect(() => {
    if (!loadTriggered) {
      setIsIdeasLoaded(true);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const idbIdeas = await get('mashup_ideas');
        if (idbIdeas && !cancelled) setIdeas(idbIdeas);
      } catch {
        // silent — ideas remain empty
      } finally {
        if (!cancelled) setIsIdeasLoaded(true);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [loadTriggered]);

  useEffect(() => {
    if (isIdeasLoaded) {
      set('mashup_ideas', ideas);
    }
  }, [ideas, isIdeasLoaded]);

  const addIdea = (concept: string, context?: string) => {
    const newIdea: Idea = {
      id: `idea-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      concept,
      context,
      createdAt: Date.now(),
      status: 'idea'
    };
    setIdeas(prev => [newIdea, ...prev]);
  };

  const updateIdeaStatus = (id: string, status: 'idea' | 'in-work' | 'done') => {
    setIdeas(prev => prev.map(idea => idea.id === id ? { ...idea, status } : idea));
  };

  const deleteIdea = (id: string) => {
    setIdeas(prev => prev.filter(idea => idea.id !== id));
  };

  const clearIdeas = () => {
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
