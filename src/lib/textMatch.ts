/** Shared fuzzy string matching for track identification (rekordbox, GetSongBPM, future Serato/Traktor). */

export interface ParsedTitle {
  base: string;
  mixHint: string | null;
}

/** Splits "Track Name (Dub Mix)" into { base: "Track Name", mixHint: "Dub Mix" }. */
export function parseTitle(title: string): ParsedTitle {
  const match = title.match(/^(.*?)\s*[([]([^)\]]+)[)\]]\s*$/);
  if (!match) return { base: title.trim(), mixHint: null };
  return { base: match[1].trim(), mixHint: match[2].trim() };
}

function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Fully concatenated (no word boundaries) — for whole-string similarity, tolerant of spacing/punctuation differences like "K.W.S" vs "KWS". */
export function normalize(s: string): string {
  return stripDiacritics(s.toLowerCase())
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Word-tokenized (boundaries preserved) — for token-overlap comparisons like mix-label matching. */
export function tokenize(s: string): string[] {
  return stripDiacritics(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/** 1.0 = identical (after normalization), 0.0 = completely different. */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

// Words too generic to establish that two mix/edit labels refer to the same thing.
const GENERIC_MIX_WORDS = new Set([
  "mix", "edit", "version", "remix", "original", "vip", "extended", "radio",
  "club", "dub", "full", "short", "main", "the", "a", "of",
]);

export function significantTokens(s: string): Set<string> {
  return new Set(tokenize(s).filter((t) => !GENERIC_MIX_WORDS.has(t)));
}

/**
 * Whether two mix/edit descriptors (e.g. "Dub Mix" vs "7\" Sunshine edit")
 * plausibly refer to the same version, by significant-word overlap rather
 * than whole-string similarity — mix labels are phrased too inconsistently
 * for Levenshtein to be reliable ("Sunshine Mix" vs "7\" Sunshine edit").
 * Both null/blank counts as compatible (neither side specifies a version).
 */
export function mixDescriptorsCompatible(a: string | null, b: string | null): boolean {
  const at = a ? significantTokens(a) : new Set<string>();
  const bt = b ? significantTokens(b) : new Set<string>();
  if (at.size === 0 && bt.size === 0) return true;
  if (at.size === 0 || bt.size === 0) return false;
  for (const t of at) if (bt.has(t)) return true;
  return false;
}

export const ARTIST_MATCH_THRESHOLD = 0.88;
export const TITLE_MATCH_THRESHOLD = 0.88;
