/**
 * Converts Camelot wheel notation ("8A") to standard musical key notation
 * ("Am"), which is what CollectionRecord.tracks[].key stores. The Camelot
 * wheel is a fixed, universal standard — this table is not a guess.
 *
 * Open Key notation ("1m") is intentionally NOT converted here: sources
 * disagreed on its exact numbering during research and it couldn't be
 * verified against an authoritative reference, so guessing would risk
 * silently writing a wrong key. detectKeyNotation flags it separately so
 * callers can leave it for manual confirmation instead.
 */
const CAMELOT_TO_STANDARD: Record<string, string> = {
  "1A": "Abm", "1B": "B",
  "2A": "Ebm", "2B": "F#",
  "3A": "Bbm", "3B": "Db",
  "4A": "Fm", "4B": "Ab",
  "5A": "Cm", "5B": "Eb",
  "6A": "Gm", "6B": "Bb",
  "7A": "Dm", "7B": "F",
  "8A": "Am", "8B": "C",
  "9A": "Em", "9B": "G",
  "10A": "Bm", "10B": "D",
  "11A": "F#m", "11B": "A",
  "12A": "Dbm", "12B": "E",
};

export type KeyNotationKind = "standard" | "camelot" | "openkey" | "unknown" | "empty";

export function detectKeyNotation(raw: string): KeyNotationKind {
  const trimmed = raw.trim();
  if (trimmed === "") return "empty";
  if (/^\d{1,2}[AB]$/i.test(trimmed)) return "camelot";
  if (/^\d{1,2}[dm]$/i.test(trimmed)) return "openkey";
  if (/^[A-G](#|b)?m?$/.test(trimmed)) return "standard";
  return "unknown";
}

/** Returns standard notation, or null if the input isn't standard or convertible Camelot. */
export function toStandardKey(raw: string): string | null {
  const trimmed = raw.trim();
  const kind = detectKeyNotation(trimmed);
  if (kind === "standard") return trimmed;
  if (kind === "camelot") return CAMELOT_TO_STANDARD[trimmed.toUpperCase()] ?? null;
  return null;
}
