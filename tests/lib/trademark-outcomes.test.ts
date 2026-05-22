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

  describe('TRADEMARK-SURGICAL-REWRITE v3 (2026-05-22): history-driven filter', () => {
    it("Mandalorian regression: 'unknown' status means substitution does NOT match it", () => {
      // Maurice's bug: Mandalorian was being substituted even though
      // gallery showed past Mandalorian prompts had succeeded. After
      // v3, only outcome='blocked' names are candidates for swap.
      // Mandalorian is NOT in SEED_BLOCKED (only Spider-Family is), so
      // its default outcome is 'unknown' → not in the blocked list.
      expect(getOutcome('Mandalorian')).toBe('unknown');
      const blocked = getAllBlocked();
      expect(blocked).not.toContain('Mandalorian');
    });

    it("explicit 'allowed' marking keeps a name out of the blocked list", () => {
      // Success-path marking from useImageGeneration's first-try
      // success branch records each name as 'allowed'. The blocked
      // list must NOT include them.
      setOutcome('Mandalorian', 'allowed');
      setOutcome('Iron Man', 'allowed');
      expect(getOutcome('Mandalorian')).toBe('allowed');
      const blocked = getAllBlocked();
      expect(blocked).not.toContain('Mandalorian');
      expect(blocked).not.toContain('Iron Man');
    });

    it('seed-blocked names stay blocked even after a coincidental "allowed" mark', () => {
      // Spider-Man is in SEED_BLOCKED. If a later prompt containing
      // Spider-Man somehow succeeds (e.g. a manual workaround), the
      // sticky-blocked guard in setOutcome keeps Spider-Man flagged.
      expect(getOutcome('Spider-Man')).toBe('blocked');
      setOutcome('Spider-Man', 'allowed'); // attempted revive
      expect(getOutcome('Spider-Man')).toBe('blocked');
    });
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

  it('returns a visually-distinctive curated generic for known names', () => {
    // TRADEMARK-SURGICAL-REWRITE (2026-05-21): generics enriched to
    // preserve visual identity per Maurice's "generic descriptions are
    // NOT acceptable — they lose what makes the character distinct" rule.
    // Assert STRUCTURAL shape (key visual cues present) rather than
    // verbatim wording so future tuning doesn't break the suite.
    const spider = genericFor('Spider-Man');
    expect(spider).toMatch(/red and blue/i);
    expect(spider).toMatch(/spider/i);

    const grogu = genericFor('Grogu');
    expect(grogu).toMatch(/green/i);
    expect(grogu).toMatch(/alien/i);

    const astartes = genericFor('Astartes');
    expect(astartes).toMatch(/armored/i);
    expect(astartes).toMatch(/sci-fi|super-soldier/i);
  });

  it('case-insensitive lookup returns the same enriched generic', () => {
    expect(genericFor('SPIDER-MAN')).toBe(genericFor('Spider-Man'));
    expect(genericFor('grogu')).toBe(genericFor('Grogu'));
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

  it('swaps known-blocked names with their generics — preserves all other text', () => {
    // TRADEMARK-SURGICAL-REWRITE: assert the rest of the prompt survives
    // verbatim (Maurice's rule #2: "ONLY change what triggered the block
    // — keep everything else identical"). Generic content is asserted
    // structurally so the test doesn't break when we tune the visual
    // descriptors.
    const result = preflightGenericize(
      'Spider-Man swinging through Tokyo at night',
      ['Spider-Man'],
    );
    expect(result.prompt).not.toContain('Spider-Man');
    expect(result.prompt).toMatch(/spider/i);
    expect(result.prompt).toContain('swinging through Tokyo at night');
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
    expect(result.prompt).not.toMatch(/spider-man/i);
    expect(result.prompt).toContain('epic pose');
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
    expect(result.prompt).not.toContain('Miles Morales');
    expect(result.prompt).toMatch(/spider/i);
    expect(result.prompt).toContain('lands on a rooftop');
  });

  it('escapes regex metacharacters in name lookups (apostrophes, hyphens)', () => {
    const result = preflightGenericize("T'Challa leaps from a tree", ["T'Challa"]);
    expect(result.prompt).not.toContain("T'Challa");
    expect(result.prompt).toMatch(/panther/i);
    expect(result.prompt).toContain('leaps from a tree');
  });
});
