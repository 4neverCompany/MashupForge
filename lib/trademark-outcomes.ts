// TRADEMARK-LEARNING (2026-05-21): localStorage-backed outcome store
// for known-IP names. Companion to lib/extract-trademark-names.ts.
//
// The pipeline records two signals into this store as it runs:
//
// 1. Pre-flight (in useIdeaProcessor.triggerImageGeneration) — extract
//    names from the prompt, look each up, and rewrite the prompt to
//    replace 'blocked' names with generic equivalents BEFORE submitting
//    to Leonardo. Saves the API call and the user-visible "blocked,
//    retrying" status flash.
//
// 2. Post-flight outcome — when generation comes back with TRADEMARK
//    moderation, mark every extracted name 'blocked'. When generation
//    succeeds without moderation, mark every extracted name 'allowed'
//    (but only when not already 'blocked' — a blocked name doesn't get
//    revived by a coincidental successful prompt that contained it).
//
// The store is intentionally a flat name→outcome map persisted to
// localStorage. No per-model granularity (Leonardo's moderation
// applies across the board), no expiry (a name that's blocked stays
// blocked until the user manually clears the store via DevTools).
//
// Bootstrap: on first read with no persisted entries, seed
// SEED_BLOCKED with the names Maurice observed failing in pipeline
// logs. New names land via the post-flight TRADEMARK signal as the
// pipeline runs.

import { TRADEMARK_SEED_LIST } from './extract-trademark-names';

export type NameOutcome = 'blocked' | 'allowed' | 'unknown';

const STORAGE_KEY = 'mashup_trademark_outcomes';

/**
 * Initial blocklist observed in Maurice's logs as of 2026-05-21.
 * Names land here only if the user has no persisted store yet — once
 * the store exists, this seed is ignored so user-observed outcomes
 * don't get overwritten on every load.
 */
const SEED_BLOCKED: readonly string[] = [
  'Spider-Man',
  'Spidey',
  'Miles Morales',
  'Peter Parker',
];

type OutcomeMap = Record<string, NameOutcome>;

function readMap(): OutcomeMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as OutcomeMap;
      }
    }
  } catch {
    // Parse failure or storage access denied — fall through to seed.
  }
  // No persisted store yet: seed with the observed blocks and persist.
  const seeded: OutcomeMap = {};
  for (const name of SEED_BLOCKED) seeded[name] = 'blocked';
  writeMap(seeded);
  return seeded;
}

function writeMap(map: OutcomeMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded or storage unavailable — best-effort, the next
    // call will re-seed from SEED_BLOCKED if writes keep failing.
  }
}

/** Return the recorded outcome for `name`. Unknown = no observation yet. */
export function getOutcome(name: string): NameOutcome {
  const map = readMap();
  return map[name] ?? 'unknown';
}

/**
 * Record an outcome for `name`. Idempotent. A 'blocked' marking never
 * gets overwritten by 'allowed' — once a name has reliably failed,
 * subsequent coincidental successes shouldn't revive it.
 */
export function setOutcome(name: string, outcome: NameOutcome): void {
  const map = readMap();
  if (map[name] === 'blocked' && outcome !== 'blocked') return;
  map[name] = outcome;
  writeMap(map);
}

/**
 * Return every name currently flagged 'blocked'. Used by the AI prompt
 * builder to inject a "TRADEMARKED CHARACTERS TO AVOID" line so the
 * upstream prompt-enhance step learns from past failures.
 */
export function getAllBlocked(): string[] {
  const map = readMap();
  return Object.entries(map)
    .filter(([, v]) => v === 'blocked')
    .map(([k]) => k);
}

/** Test seam — clear the store entirely (only the test file uses this). */
export function __resetForTests(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}

/**
 * Map a known-blocked trademarked name to a safe generic descriptor.
 * Lookup is case-insensitive against the exact canonical name as
 * extracted by `extractTrademarkNames`. Fallback for names not in this
 * table is a permissive "a popular character" — enough signal for the
 * model to keep the visual cue without quoting the IP verbatim.
 */
const GENERIC_FOR: Record<string, string> = {
  // Marvel — Spider-Family
  'spider-man': 'a spider-powered hero',
  'spidey': 'a spider-powered hero',
  'web-slinger': 'a spider-powered hero',
  'miles morales': 'a young spider-powered hero',
  'peter parker': 'a young spider-powered hero',
  'gwen stacy': 'a spider-powered heroine',
  'spider-gwen': 'a spider-powered heroine',
  // Marvel — Avengers / X-Men
  'iron man': 'an armored tech hero',
  'tony stark': 'an armored tech hero',
  'captain america': 'a patriotic shield-bearing hero',
  'steve rogers': 'a patriotic shield-bearing hero',
  'thor': 'a thunder-wielding god',
  'loki': 'a trickster god in green',
  'hulk': 'a giant green-skinned brute',
  'bruce banner': 'a giant green-skinned brute',
  'black widow': 'a redhead spy in tactical gear',
  'hawkeye': 'a purple-clad archer',
  'black panther': 'a panther-themed warrior',
  't\'challa': 'a panther-themed warrior',
  'doctor strange': 'a robed sorcerer with glowing runes',
  'scarlet witch': 'a crimson-clad witch with energy magic',
  'vision': 'a synthetic android with a glowing forehead gem',
  'wolverine': 'a clawed feral mutant',
  'logan': 'a clawed feral mutant',
  'deadpool': 'a red-suited masked mercenary',
  'wade wilson': 'a red-suited masked mercenary',
  'storm': 'a weather-wielding mutant',
  'cyclops': 'an optic-blast mutant in a visor',
  'jean grey': 'a fiery telepathic mutant',
  'magneto': 'a metal-controlling mutant in red and purple',
  'professor x': 'a bald telepathic mentor',
  'doctor doom': 'a green-cloaked armored sorcerer-king',
  'thanos': 'a colossal purple cosmic warlord',
  // DC
  'batman': 'a brooding bat-themed vigilante',
  'bruce wayne': 'a brooding bat-themed vigilante',
  'superman': 'a flying caped hero in red and blue',
  'clark kent': 'a flying caped hero in red and blue',
  'wonder woman': 'an amazonian warrior in red and gold',
  'diana prince': 'an amazonian warrior in red and gold',
  'flash': 'a speedster in red lightning',
  'barry allen': 'a speedster in red lightning',
  'aquaman': 'an ocean-king with a trident',
  'green lantern': 'a glowing-ring hero in green',
  'joker': 'a green-haired clown villain',
  'harley quinn': 'a red-and-black harlequin antihero',
  'catwoman': 'a feline thief in black',
  // Star Wars
  'darth vader': 'a black-masked sith lord',
  'anakin skywalker': 'a black-masked sith lord',
  'luke skywalker': 'a young jedi knight',
  'leia organa': 'a rebel princess in white',
  'princess leia': 'a rebel princess in white',
  'han solo': 'a roguish space smuggler',
  'obi-wan kenobi': 'a robed jedi mentor',
  'yoda': 'a small wise green alien sage',
  'grogu': 'a small green-skinned alien child',
  'baby yoda': 'a small green-skinned alien child',
  'mandalorian': 'a sci-fi warrior in beskar armor',
  'din djarin': 'a sci-fi warrior in beskar armor',
  'jedi': 'a robed sci-fi knight',
  'sith': 'a black-robed dark sci-fi warlord',
  'boba fett': 'a bounty hunter in green armor',
  'jango fett': 'a bounty hunter in blue armor',
  'kylo ren': 'a black-robed crossguard-saber wielder',
  // Warhammer 40k
  'astartes': 'an armored sci-fi soldier',
  'space marine': 'an armored sci-fi soldier',
  'tyranid': 'a chitinous alien creature',
  'tyranids': 'chitinous alien creatures',
  'imperial guard': 'sci-fi conscript soldiers',
  'astra militarum': 'sci-fi conscript soldiers',
  'primarch': 'a colossal genetically-engineered warlord',
  'custodes': 'a golden-armored elite guardian',
  'inquisitor': 'a grim-faced cloaked agent',
  'ork': 'a green-skinned brutish alien warrior',
  'orks': 'green-skinned brutish alien warriors',
  'eldar': 'a graceful pointed-helmet space elf',
  'necron': 'a skeletal robotic alien',
  'tau': 'a sleek armored alien soldier',
  'tau empire': 'sleek armored alien soldiers',
  // Other
  'master chief': 'a green-armored super-soldier',
  'geralt of rivia': 'a white-haired monster hunter',
  'mario': 'a red-capped plumber hero',
  'luigi': 'a green-capped plumber hero',
  'link': 'a green-tunic blond hero with a sword',
  'zelda': 'a princess with golden hair',
  'pikachu': 'a yellow electric mouse creature',
};

export function genericFor(name: string): string {
  return GENERIC_FOR[name.toLowerCase()] ?? 'a popular character';
}

/**
 * Rewrite `prompt` so every name flagged 'blocked' in the store is
 * replaced by its generic descriptor. Returns the rewritten prompt
 * plus the set of names that were swapped — callers log those for
 * pipeline visibility.
 *
 * Substring-replace by canonical-cased name. Case-insensitive match
 * via a regex per name so user prompts with off-canonical casing
 * ("spider-man") still get caught.
 */
export interface PreflightResult {
  prompt: string;
  swapped: string[];
}

export function preflightGenericize(prompt: string, blockedNames: string[]): PreflightResult {
  let out = prompt;
  const swapped: string[] = [];
  // Sort longest-first so multi-word names rewrite before their
  // single-word fragments.
  const ordered = [...blockedNames].sort((a, b) => b.length - a.length);
  for (const name of ordered) {
    const generic = genericFor(name);
    // Escape regex metachars in the name (hyphens, apostrophes etc).
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    if (re.test(out)) {
      out = out.replace(re, generic);
      swapped.push(name);
    }
  }
  return { prompt: out, swapped };
}

// Re-export the seed list so callers that need to know "what names
// might be in this store" (e.g. UI surfaces, debug views) have one
// import.
export { TRADEMARK_SEED_LIST } from './extract-trademark-names';
