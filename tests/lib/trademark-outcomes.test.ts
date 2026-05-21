import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getOutcome,
  setOutcome,
  getAllBlocked,
  genericFor,
  preflightGenericize,
  __resetForTests,
} from '@/lib/trademark-outcomes';

function setupLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
  return store;
}

describe('trademark-outcomes store', () => {
  beforeEach(() => {
    setupLocalStorage();
    __resetForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('seeds the SEED_BLOCKED defaults on first read', () => {
    expect(getOutcome('Spider-Man')).toBe('blocked');
    expect(getOutcome('Miles Morales')).toBe('blocked');
    expect(getOutcome('Peter Parker')).toBe('blocked');
    expect(getOutcome('Spidey')).toBe('blocked');
  });

  it('returns "unknown" for unseeded names', () => {
    expect(getOutcome('Batman')).toBe('unknown');
    expect(getOutcome('SomeNewCharacter')).toBe('unknown');
  });

  it('persists setOutcome between calls', () => {
    setOutcome('Batman', 'blocked');
    expect(getOutcome('Batman')).toBe('blocked');
  });

  it('"blocked" markings are sticky — "allowed" cannot overwrite them', () => {
    setOutcome('Batman', 'blocked');
    setOutcome('Batman', 'allowed');
    expect(getOutcome('Batman')).toBe('blocked');
  });

  it('"allowed" markings can move to "blocked"', () => {
    setOutcome('Yoda', 'allowed');
    expect(getOutcome('Yoda')).toBe('allowed');
    setOutcome('Yoda', 'blocked');
    expect(getOutcome('Yoda')).toBe('blocked');
  });

  it('getAllBlocked surfaces every name flagged "blocked"', () => {
    setOutcome('Batman', 'blocked');
    setOutcome('Yoda', 'allowed');
    const blocked = getAllBlocked();
    expect(blocked).toContain('Spider-Man'); // from seed
    expect(blocked).toContain('Batman');     // from this test
    expect(blocked).not.toContain('Yoda');   // explicitly allowed
  });
});

describe('genericFor', () => {
  beforeEach(() => {
    setupLocalStorage();
    __resetForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the curated generic for known names', () => {
    expect(genericFor('Spider-Man')).toBe('a spider-powered hero');
    expect(genericFor('Grogu')).toBe('a small green-skinned alien child');
    expect(genericFor('Astartes')).toBe('an armored sci-fi soldier');
  });

  it('case-insensitive lookup', () => {
    expect(genericFor('SPIDER-MAN')).toBe('a spider-powered hero');
    expect(genericFor('grogu')).toBe('a small green-skinned alien child');
  });

  it('falls back to a permissive default for unknown names', () => {
    expect(genericFor('SomeFutureCharacter')).toBe('a popular character');
  });
});

describe('preflightGenericize', () => {
  beforeEach(() => {
    setupLocalStorage();
    __resetForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('swaps known-blocked names with their generics', () => {
    const result = preflightGenericize(
      'Spider-Man swinging through Tokyo at night',
      ['Spider-Man'],
    );
    expect(result.prompt).toBe('a spider-powered hero swinging through Tokyo at night');
    expect(result.swapped).toEqual(['Spider-Man']);
  });

  it('handles multiple blocked names in one prompt', () => {
    const result = preflightGenericize(
      'Spider-Man and Grogu team up in a Mandalorian temple',
      ['Spider-Man', 'Grogu', 'Mandalorian'],
    );
    expect(result.prompt).not.toMatch(/Spider-Man|Grogu|Mandalorian/);
    expect(result.swapped.sort()).toEqual(['Grogu', 'Mandalorian', 'Spider-Man']);
  });

  it('case-insensitive substring match in the prompt', () => {
    const result = preflightGenericize('spider-man epic pose', ['Spider-Man']);
    expect(result.prompt).toBe('a spider-powered hero epic pose');
    expect(result.swapped).toContain('Spider-Man');
  });

  it('returns the original prompt + empty swapped when no names match', () => {
    const result = preflightGenericize('an original character vista', ['Spider-Man']);
    expect(result.prompt).toBe('an original character vista');
    expect(result.swapped).toEqual([]);
  });

  it('multi-word names rewrite before their single-word fragments', () => {
    // "Miles Morales" should be swapped as a unit; a hypothetical "Miles"
    // alone in the blocked list wouldn't fragment the canonical name.
    const result = preflightGenericize('Miles Morales lands on a rooftop', ['Miles Morales']);
    expect(result.prompt).toBe('a young spider-powered hero lands on a rooftop');
  });

  it('escapes regex metacharacters in name lookups (apostrophes, hyphens)', () => {
    const result = preflightGenericize("T'Challa leaps from a tree", ["T'Challa"]);
    expect(result.prompt).toBe('a panther-themed warrior leaps from a tree');
  });
});
