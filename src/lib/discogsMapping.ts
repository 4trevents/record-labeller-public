import type { Candidate, ProvenanceField, RecordFormat, RecordLabel, Track } from "../types/schema";

// Minimal shape of the fields we use from a Discogs /releases/{id} response.
// The real response has many more fields; we only type what we read.
export interface DiscogsReleaseResponse {
  id: number;
  title: string;
  artists?: { name: string; join?: string; anv?: string }[];
  labels?: { name: string; catno?: string }[];
  formats?: { name?: string; qty?: string; descriptions?: string[] }[];
  country?: string;
  year?: number;
  genres?: string[];
  styles?: string[];
  notes?: string;
  thumb?: string;
  images?: { type?: string; uri?: string; uri150?: string }[];
  tracklist?: DiscogsTrack[];
}

export interface DiscogsTrack {
  position: string;
  type_?: "track" | "heading" | "index";
  title: string;
  duration?: string;
  artists?: { name: string }[];
  sub_tracks?: DiscogsTrack[];
}

export interface DiscogsSearchResult {
  id: number;
  type: string; // "release" | "master" | ...
  title: string;
  catno?: string;
  year?: string;
  country?: string;
  thumb?: string;
  format?: string[];
}

/** Strips Discogs' "(2)" disambiguation suffix from artist names, e.g. "Bill Evans (2)". */
function stripDisambiguation(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, "");
}

export function formatArtists(artists: DiscogsReleaseResponse["artists"]): string {
  if (!artists || artists.length === 0) return "";
  return artists
    .map((a, i) => {
      const name = stripDisambiguation(a.anv || a.name);
      const isLast = i === artists.length - 1;
      return isLast ? name : `${name}${a.join ? ` ${a.join} ` : ", "}`;
    })
    .join("");
}

export function mapLabels(labels: DiscogsReleaseResponse["labels"]): RecordLabel[] {
  if (!labels || labels.length === 0) return [];
  return labels.map((l) => ({ name: l.name, catno: l.catno?.trim() || null }));
}

export function mapFormat(formats: DiscogsReleaseResponse["formats"]): RecordFormat {
  const first = formats?.[0];
  if (!first) return { size: null, qty: null, descriptions: [] };
  const [size, ...rest] = first.descriptions ?? [];
  return {
    size: size ?? first.name ?? null,
    qty: first.qty ? Number(first.qty) : null,
    descriptions: rest,
  };
}

export function mapCoverThumb(response: DiscogsReleaseResponse): string | null {
  return response.thumb || response.images?.find((i) => i.type === "primary")?.uri150 || response.images?.[0]?.uri150 || null;
}

const RPM_PATTERN = /(33(?:\s*1\/3|\s*⅓)?|45|78)\s*(?:rpm)/gi;

/**
 * Parses "33 ⅓ RPM" / "45 RPM" / "78 RPM" out of a formats[].descriptions
 * list. Returns every distinct value found — a release can legitimately
 * list more than one (e.g. a mixed-speed multi-disc compilation), which the
 * caller must treat as ambiguous rather than picking the first one.
 */
function parseRpmValuesFromDescriptions(descriptions: string[]): number[] {
  const values = new Set<number>();
  for (const d of descriptions) {
    for (const match of d.matchAll(RPM_PATTERN)) {
      values.add(Math.round(parseFloat(match[1])));
    }
  }
  return [...values];
}

/**
 * Best-effort scan of free-text release notes for per-side speed mentions,
 * e.g. "Side B plays at 45" or "Sides A, C & D play at 45 RPM, side B plays
 * at 33 1/3 RPM" (a real example from this collection).
 */
function parseSideSpeedsFromNotes(notes: string | undefined): Map<string, number> {
  const result = new Map<string, number>();
  if (!notes) return result;
  const pattern = /sides?\s*([a-d](?:\s*(?:,|&|and)\s*[a-d])*)\D{0,20}?(33|45|78)\s*(?:rpm|1\/3|⅓)?/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(notes))) {
    const letters = m[1].match(/[a-d]/gi) ?? [];
    for (const letter of letters) result.set(letter.toUpperCase(), Number(m[2]));
  }
  return result;
}

export interface SpeedResolution {
  recordSpeed: ProvenanceField<number> | null;
  trackSideSpeeds: Map<string, ProvenanceField<number>>;
  needsReview: boolean;
}

function speedsFromSideMap(sideSpeeds: Map<string, number>): {
  trackSideSpeeds: Map<string, ProvenanceField<number>>;
  defaultValue: number;
} {
  const trackSideSpeeds = new Map<string, ProvenanceField<number>>();
  for (const [side, value] of sideSpeeds) {
    trackSideSpeeds.set(side, { value, source: "discogs", confidence: "medium", locked: false });
  }
  const counts = new Map<number, number>();
  for (const v of sideSpeeds.values()) counts.set(v, (counts.get(v) ?? 0) + 1);
  const defaultValue = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { trackSideSpeeds, defaultValue };
}

/**
 * Speed resolution order (per SPEC.md):
 *   1. Exactly one distinct "NN RPM" in formats[].descriptions -> high
 *      confidence, source "discogs". Multiple distinct values (a real case:
 *      mixed-speed multi-disc compilations) are NOT treated as confident —
 *      they fall through to per-side note parsing instead, since picking
 *      one arbitrarily would silently mislabel whichever side isn't it.
 *   2. Per-side mentions in release notes ("Side B plays at 45", or "Sides
 *      A, C & D play at 45 RPM, side B plays at 33 1/3 RPM") -> medium
 *      confidence, source "discogs", applied to matching tracks' side and
 *      flagged for review since it's a free-text heuristic.
 *   3. Inferred from format size (7"->45, LP/Album->33, 12" single is ambiguous) ->
 *      source "discogs_inferred", confidence "medium" (7"/LP) or "low" (ambiguous 12"),
 *      always flagged needs_review.
 *   4. Otherwise left null — never invent a value.
 */
export function resolveSpeed(response: DiscogsReleaseResponse): SpeedResolution {
  const descriptions = response.formats?.[0]?.descriptions ?? [];
  const rpmValues = parseRpmValuesFromDescriptions(descriptions);

  if (rpmValues.length === 1) {
    return {
      recordSpeed: { value: rpmValues[0], source: "discogs", confidence: "high", locked: false },
      trackSideSpeeds: new Map(),
      needsReview: false,
    };
  }

  const sideSpeeds = parseSideSpeedsFromNotes(response.notes);
  if (sideSpeeds.size > 0) {
    const { trackSideSpeeds, defaultValue } = speedsFromSideMap(sideSpeeds);
    return {
      recordSpeed: { value: defaultValue, source: "discogs", confidence: "medium", locked: false },
      trackSideSpeeds,
      needsReview: true,
    };
  }

  if (rpmValues.length > 1) {
    // Multiple speeds apply somewhere on this release but notes don't say
    // where — flag it clearly rather than guessing which side is which.
    return {
      recordSpeed: { value: rpmValues[0], source: "discogs_inferred", confidence: "low", locked: false },
      trackSideSpeeds: new Map(),
      needsReview: true,
    };
  }

  const size = descriptions[0] ?? "";
  if (/^7"/.test(size)) {
    return {
      recordSpeed: { value: 45, source: "discogs_inferred", confidence: "medium", locked: false },
      trackSideSpeeds: new Map(),
      needsReview: true,
    };
  }
  if (/^(12"|LP|Album)/i.test(size) && /LP|Album/i.test(descriptions.join(" "))) {
    return {
      recordSpeed: { value: 33, source: "discogs_inferred", confidence: "medium", locked: false },
      trackSideSpeeds: new Map(),
      needsReview: true,
    };
  }
  if (/^12"/.test(size)) {
    // 12" single, no LP/Album qualifier: genuinely ambiguous (could be 33 or 45).
    return {
      recordSpeed: { value: 33, source: "discogs_inferred", confidence: "low", locked: false },
      trackSideSpeeds: new Map(),
      needsReview: true,
    };
  }

  return { recordSpeed: null, trackSideSpeeds: new Map(), needsReview: false };
}

/**
 * Flattens a Discogs tracklist into our flat Track[] shape: index tracks'
 * sub_tracks are inlined, headings are dropped (their text is returned
 * separately so the caller can decide whether it's worth keeping as a note).
 */
export function flattenTracklist(
  tracklist: DiscogsTrack[] | undefined,
  speeds: SpeedResolution
): { tracks: Track[]; headingNotes: string[] } {
  const tracks: Track[] = [];
  const headingNotes: string[] = [];

  const pushTrack = (t: DiscogsTrack) => {
    const side = t.position.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? t.position;
    const sideSpeed = speeds.trackSideSpeeds.get(side) ?? null;
    tracks.push({
      position: t.position,
      side,
      title: t.title,
      artists: t.artists?.map((a) => a.name) ?? null,
      duration: t.duration || null,
      speed: sideSpeed,
      bpm: null,
      key: null,
    });
  };

  for (const t of tracklist ?? []) {
    if (t.type_ === "heading") {
      // Keep only headings with more than a bare side label ("A", "Side A") —
      // those carry no information beyond what `position`/`side` already do.
      if (t.title && !/^side\s*[a-z0-9]?$/i.test(t.title.trim())) {
        headingNotes.push(t.title.trim());
      }
      continue;
    }
    if (t.type_ === "index" && t.sub_tracks && t.sub_tracks.length > 0) {
      for (const sub of t.sub_tracks) pushTrack(sub);
      continue;
    }
    pushTrack(t);
  }

  return { tracks, headingNotes };
}

export function mapCandidate(result: DiscogsSearchResult, score: number, reason: string): Candidate {
  return {
    discogsReleaseId: result.id,
    title: result.title,
    catno: result.catno ?? null,
    year: result.year ? Number(result.year) : null,
    country: result.country ?? null,
    thumb: result.thumb ?? null,
    score,
    reason,
  };
}

/**
 * Parses a Discogs release ID out of a bare id, "r1234567", a discogs.com
 * URL, or Discogs' own "[r1234567]"/"[m1234567]" shortcode syntax (what
 * their site's "copy release ID" button actually puts on the clipboard).
 * Returns null for master URLs/shortcodes — the caller shows a version picker.
 */
export function parseDiscogsReleaseInput(input: string): { releaseId: number } | { masterId: number } | null {
  const trimmed = input.trim().replace(/^\[+/, "").replace(/\]+$/, "").trim();

  const urlMatch = trimmed.match(/discogs\.com\/(?:[a-z-]+\/)?release\/(\d+)/i);
  if (urlMatch) return { releaseId: Number(urlMatch[1]) };

  const masterMatch = trimmed.match(/discogs\.com\/(?:[a-z-]+\/)?master\/(\d+)/i);
  if (masterMatch) return { masterId: Number(masterMatch[1]) };

  const rMatch = trimmed.match(/^r(\d+)$/i);
  if (rMatch) return { releaseId: Number(rMatch[1]) };

  const mMatch = trimmed.match(/^m(\d+)$/i);
  if (mMatch) return { masterId: Number(mMatch[1]) };

  if (/^\d+$/.test(trimmed)) return { releaseId: Number(trimmed) };

  return null;
}
