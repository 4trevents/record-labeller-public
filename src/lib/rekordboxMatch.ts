import { parseTitle, similarity, mixDescriptorsCompatible, ARTIST_MATCH_THRESHOLD, TITLE_MATCH_THRESHOLD } from "./textMatch";
import type { Confidence } from "../types/schema";

export interface RekordboxTrack {
  name: string;
  artist: string;
  mix: string | null;
  bpm: number | null;
  tonality: string | null;
  durationSec: number | null;
}

export interface MatchResult {
  bpm: number | null;
  tonality: string | null;
  /** Seconds. Only set on a resolved (non-ambiguous) match — duration isn't provenance-tracked, so it's only worth trusting a match we'd also apply bpm/key from. */
  durationSec: number | null;
  confidence: Confidence;
  reason: string;
}

function effectiveMixDescriptor(t: RekordboxTrack, parsedName: ReturnType<typeof parseTitle>): string | null {
  return t.mix?.trim() || parsedName.mixHint;
}

/**
 * Matches a vinyl track (by record artist + track title) against the whole
 * rekordbox library. Conservative by design: a title match alone is not
 * enough — the candidate's mix/edit descriptor (its Mix field, or a
 * parenthetical suffix in its own Name) must be compatible with the vinyl
 * track's own mix hint (if any), even when only one title match exists.
 * Without that check, two genuinely different mixes/edits sharing a base
 * title would silently get the same BPM/key. If multiple candidates
 * survive and disagree on BPM/key, nothing is applied — logged as
 * ambiguous for manual review rather than guessed.
 */
export function matchRekordboxTrack(
  recordArtist: string,
  trackTitle: string,
  library: RekordboxTrack[]
): MatchResult | null {
  const ours = parseTitle(trackTitle);

  const titleMatches = library
    .filter((t) => similarity(t.artist, recordArtist) >= ARTIST_MATCH_THRESHOLD)
    .map((t) => ({ track: t, parsedName: parseTitle(t.name) }))
    .filter(({ parsedName }) => similarity(parsedName.base, ours.base) >= TITLE_MATCH_THRESHOLD);

  if (titleMatches.length === 0) return null;

  const mixCompatible = titleMatches.filter(({ track, parsedName }) =>
    mixDescriptorsCompatible(ours.mixHint, effectiveMixDescriptor(track, parsedName))
  );

  if (mixCompatible.length === 0) {
    const seen = titleMatches
      .map(({ track, parsedName }) => `"${effectiveMixDescriptor(track, parsedName) || "(no mix label)"}"`)
      .join(", ");
    return {
      bpm: null,
      tonality: null,
      durationSec: null,
      confidence: "low",
      reason:
        `title/artist matched ${titleMatches.length} rekordbox entr${titleMatches.length === 1 ? "y" : "ies"} ` +
        `but none of their mix labels (${seen}) correspond to "${ours.mixHint ?? "(no mix specified)"}" — not applied`,
    };
  }

  if (mixCompatible.length === 1) {
    const { track, parsedName } = mixCompatible[0];
    return {
      bpm: track.bpm,
      tonality: track.tonality,
      durationSec: track.durationSec,
      confidence: "high",
      reason: `matched "${track.artist} - ${track.name}"${effectiveMixDescriptor(track, parsedName) ? ` (${effectiveMixDescriptor(track, parsedName)})` : ""} in rekordbox`,
    };
  }

  const bpmSet = new Set(mixCompatible.map(({ track }) => (track.bpm !== null ? Math.round(track.bpm * 10) : null)));
  const keySet = new Set(mixCompatible.map(({ track }) => track.tonality ?? null));
  if (bpmSet.size === 1 && keySet.size === 1) {
    const { track } = mixCompatible[0];
    return {
      bpm: track.bpm,
      tonality: track.tonality,
      durationSec: track.durationSec,
      confidence: "medium",
      reason: `${mixCompatible.length} matching rekordbox entries, all agree on BPM/key`,
    };
  }

  const summary = mixCompatible
    .map(({ track, parsedName }) => `${effectiveMixDescriptor(track, parsedName) || "(no mix label)"}: ${track.bpm ?? "?"}bpm/${track.tonality ?? "?"}`)
    .join("; ");
  return {
    bpm: null,
    tonality: null,
    durationSec: null,
    confidence: "low",
    reason: `${mixCompatible.length} ambiguous rekordbox matches with differing BPM/key (${summary}) — not applied, needs manual check`,
  };
}
