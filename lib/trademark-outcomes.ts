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
 *
 * TRADEMARK-SURGICAL-REWRITE (2026-05-21): generics enriched per
 * Maurice's "generic descriptions are NOT acceptable — they lose what
 * makes the character distinct" rule. Previously entries like
 * "a patriotic shield-bearing hero" stripped Captain America down to
 * something the model couldn't visualize correctly. Now each entry
 * carries enough visual cues (colors, silhouette, signature props) to
 * keep the visual identity recoverable without the name.
 */
const GENERIC_FOR: Record<string, string> = {
  // Marvel — Spider-Family
  'spider-man': 'a red and blue spider-themed hero in a web-pattern suit with a black spider emblem',
  'spidey': 'a red and blue spider-themed hero in a web-pattern suit',
  'web-slinger': 'a red and blue spider-themed hero in a web-pattern suit',
  'miles morales': 'a young black-and-red spider-themed hero in a hooded web-pattern suit',
  'peter parker': 'a red and blue spider-themed hero in a web-pattern suit',
  'gwen stacy': 'a white-and-pink spider-themed heroine with hood up and ballet pose',
  'spider-gwen': 'a white-and-pink spider-themed heroine with hood up and ballet pose',
  // Marvel — Avengers / X-Men
  'iron man': 'a hero in red and gold high-tech armored battlesuit with glowing chest reactor',
  'tony stark': 'a hero in red and gold high-tech armored battlesuit with glowing chest reactor',
  'captain america': 'a hero in a red, white, and blue armored suit with a star emblem and round shield with concentric stripes',
  'steve rogers': 'a hero in a red, white, and blue armored suit with a star emblem and round shield with concentric stripes',
  'thor': 'a blonde norse-themed warrior in armor and red cape wielding a short hammer with crackling lightning',
  'loki': 'a horned-helmeted trickster in green and gold robes holding twin daggers',
  'hulk': 'a giant green-skinned muscular brute in torn purple pants',
  'bruce banner': 'a giant green-skinned muscular brute in torn purple pants',
  'black widow': 'a redhead spy in a black tactical bodysuit with wrist gauntlets',
  'hawkeye': 'an archer in a purple-and-black tactical suit with a compound bow',
  'black panther': 'a sleek black-armored panther-themed warrior with silver claws and tribal vibranium accents',
  't\'challa': 'a sleek black-armored panther-themed warrior with silver claws and tribal vibranium accents',
  'doctor strange': 'a goateed sorcerer in red Cloak of Levitation with mandala-glowing-rune hand gestures',
  'scarlet witch': 'a crimson-clad witch with a tiara and chaos-magic energy crackling around her hands',
  'vision': 'a synthetic android with red skin, green-and-yellow tunic, and a glowing yellow forehead gem',
  'wolverine': 'a stocky clawed mutant in yellow-and-blue suit with three retractable metal claws per hand',
  'logan': 'a stocky clawed mutant in yellow-and-blue suit with three retractable metal claws per hand',
  'deadpool': 'a red-and-black masked mercenary in a tactical suit with twin katanas crossed on his back',
  'wade wilson': 'a red-and-black masked mercenary in a tactical suit with twin katanas crossed on his back',
  'storm': 'a white-haired mutant in a black-and-white cape with crackling weather-energy around her',
  'cyclops': 'a blue-suited mutant in a yellow X-emblem with a glowing red visor firing optic beams',
  'jean grey': 'a red-haired mutant in green-and-gold suit haloed in fiery telepathic energy',
  'magneto': 'a regal silver-haired villain in a red helmet and purple-and-red cape controlling floating metal',
  'professor x': 'a bald telepathic mentor in a wheelchair, fingers to temple, surrounded by mind-glow',
  'doctor doom': 'a regal villain in green-cloaked iron-faced armor with metal mask and gauntlets',
  'thanos': 'a colossal purple-skinned cosmic warlord in golden armor with a gauntlet of glowing gems',
  // DC
  'batman': 'a brooding vigilante in matte-black armored bat-suit with cape, cowl, and yellow utility belt',
  'bruce wayne': 'a brooding vigilante in matte-black armored bat-suit with cape, cowl, and yellow utility belt',
  'superman': 'a flying caped hero in a blue suit, red cape, and red boots with a stylized chest emblem',
  'clark kent': 'a flying caped hero in a blue suit, red cape, and red boots with a stylized chest emblem',
  'wonder woman': 'an amazonian warrior in red-and-blue armor with golden tiara, lasso, and silver bracers',
  'diana prince': 'an amazonian warrior in red-and-blue armor with golden tiara, lasso, and silver bracers',
  'flash': 'a speedster in a head-to-toe crimson suit with yellow lightning-bolt emblem and ear-wings',
  'barry allen': 'a speedster in a head-to-toe crimson suit with yellow lightning-bolt emblem and ear-wings',
  'aquaman': 'a long-haired ocean king in golden scale-armor and green pants wielding a glowing trident',
  'green lantern': 'a hero in a black-and-green suit projecting green energy constructs from a glowing ring',
  'joker': 'a cackling pale-faced villain with green hair, red lips, and a purple suit',
  'harley quinn': 'a red-and-black harlequin-themed antihero with bleached pigtails and an oversized mallet',
  'catwoman': 'a feline thief in a sleek black leather catsuit with goggles and a whip',
  // Star Wars
  'darth vader': 'a tall black-armored sith lord in flowing cape, ribbed black helmet, and red glowing lightsaber',
  'anakin skywalker': 'a tall black-armored sith lord in flowing cape, ribbed black helmet, and red glowing lightsaber',
  'luke skywalker': 'a young jedi knight in black tunic with a green glowing lightsaber',
  'leia organa': 'a rebel princess in flowing white robes with twin-bun hairstyle and a determined gaze',
  'princess leia': 'a rebel princess in flowing white robes with twin-bun hairstyle and a determined gaze',
  'han solo': 'a roguish space smuggler in a white shirt, black vest, and side-holstered blaster pistol',
  'obi-wan kenobi': 'a robed jedi mentor with greying beard and a blue glowing lightsaber',
  'yoda': 'a tiny long-eared green alien sage in beige robes holding a wooden cane',
  'grogu': 'a tiny long-eared green-skinned alien child in beige robes with huge dark eyes',
  'baby yoda': 'a tiny long-eared green-skinned alien child in beige robes with huge dark eyes',
  'mandalorian': 'a bounty hunter in matte beskar armor and T-visor helmet with a jetpack and shoulder cape',
  'din djarin': 'a bounty hunter in matte beskar armor and T-visor helmet with a jetpack and shoulder cape',
  'jedi': 'a robed sci-fi knight wielding a glowing blue or green plasma sword',
  'sith': 'a black-robed dark sci-fi warlord wielding a glowing red plasma sword',
  'boba fett': 'a bounty hunter in green-and-rust mandalorian armor with a T-visor helmet and jetpack',
  'jango fett': 'a bounty hunter in blue-and-silver mandalorian armor with a T-visor helmet and jetpack',
  'kylo ren': 'a black-robed sith apprentice in cracked silver-cross helmet wielding a crossguard red plasma sword',
  // Warhammer 40k
  'astartes': 'a colossal armored sci-fi super-soldier in painted ceramite power armor with bolter',
  'space marine': 'a colossal armored sci-fi super-soldier in painted ceramite power armor with bolter',
  'tyranid': 'a chitinous alien xenomorph-like creature with scythed forelimbs and a maw of fangs',
  'tyranids': 'a swarm of chitinous alien creatures with scythed forelimbs and fanged maws',
  'imperial guard': 'human conscript soldiers in olive-drab flak armor with peaked caps and lasguns',
  'astra militarum': 'human conscript soldiers in olive-drab flak armor with peaked caps and lasguns',
  'primarch': 'a colossal genetically-engineered armored warlord, twice the size of a super-soldier',
  'custodes': 'a golden-armored elite guardian with crested helmet and tall guardian spear',
  'inquisitor': 'a grim-faced cloaked sci-fi agent in dark robes with rosette pendant and bolt pistol',
  'ork': 'a green-skinned brutish alien warrior with tusks, plate scrap-armor, and a heavy shoota',
  'orks': 'green-skinned brutish alien warriors with tusks, plate scrap-armor, and heavy shootas',
  'eldar': 'a graceful tall alien in form-fitting blue armor with pointed crested helmet',
  'necron': 'a skeletal robotic alien with glowing green eyes wielding a gauss flayer',
  'tau': 'a sleek alien soldier in white-and-orange battlesuit with a pulse rifle',
  'tau empire': 'sleek alien soldiers in white-and-orange battlesuits with pulse rifles',
  // Other
  'master chief': 'a hulking armored super-soldier in olive-green Mjolnir power armor with mirrored gold visor',
  'geralt of rivia': 'a stoic white-haired monster hunter in black armor with twin swords on his back',
  'mario': 'a stocky mustachioed plumber in red shirt, blue overalls, and red cap with white "M" emblem',
  'luigi': 'a tall mustachioed plumber in green shirt, blue overalls, and green cap with white "L" emblem',
  'link': 'a young blonde-haired hero in a green tunic and pointed cap wielding a master sword',
  'zelda': 'a princess with golden hair in flowing royal blue-and-white robes with triforce emblem',
  'pikachu': 'a small yellow electric mouse creature with red cheek-spots and a lightning-bolt tail',
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
