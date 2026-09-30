import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

export interface RekordboxTrack {
  name: string;
  artist: string;
  mix: string | null;
  bpm: number | null;
  tonality: string | null;
  /** Seconds, from TotalTime. */
  durationSec: number | null;
}

interface RawTrackAttrs {
  Name?: string;
  Artist?: string;
  Mix?: string;
  AverageBpm?: string | number;
  Tonality?: string;
  TotalTime?: string | number;
}

export function parseRekordboxXml(path: string): RekordboxTrack[] {
  const xml = readFileSync(path, "utf8");
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const doc = parser.parse(xml);

  const collection = doc?.DJ_PLAYLISTS?.COLLECTION;
  if (!collection) throw new Error("Not a recognised rekordbox XML export (missing DJ_PLAYLISTS/COLLECTION).");

  const rawTracks: RawTrackAttrs[] = Array.isArray(collection.TRACK)
    ? collection.TRACK
    : collection.TRACK
      ? [collection.TRACK]
      : [];

  return rawTracks
    .filter((t) => t.Name && t.Artist)
    .map((t) => ({
      name: String(t.Name),
      artist: String(t.Artist),
      mix: t.Mix ? String(t.Mix) : null,
      bpm: t.AverageBpm !== undefined && t.AverageBpm !== "" ? Number(t.AverageBpm) : null,
      tonality: t.Tonality ? String(t.Tonality) : null,
      durationSec: t.TotalTime !== undefined && t.TotalTime !== "" ? Number(t.TotalTime) : null,
    }));
}
