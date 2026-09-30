import type { CollectionRecord, PersonalFields, RecordFormat } from "../../src/types/schema";

export const KNOWN_COLUMNS = [
  "Catalog#",
  "Artist",
  "Title",
  "Label",
  "Format",
  "Rating",
  "Released",
  "release_id",
  "CollectionFolder",
  "Date Added",
  "Collection Media Condition",
  "Collection Sleeve Condition",
  "Collection Price",
  "Collection Currency",
  "Collection Store",
  "Collection Sold Price",
  "Collection Sold Currency",
  "Collection Notes",
] as const;

function blankToNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function toNumber(value: string | undefined): number | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Discogs collection exports mix ISO datetimes, DD/MM/YYYY HH:mm (seen in
 * real exports resaved or downloaded regionally), and Excel serial numbers
 * (if the file was round-tripped through Excel). Try each in turn.
 */
export function parseDateAdded(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (dmy) {
    const [, dd, mm, yyyy, hh = "0", min = "0"] = dmy;
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min)));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    // Excel serial date: days since 1899-12-30 (epoch quirk included).
    const serial = Number(trimmed);
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

export function normaliseCondition(value: string | undefined): string | null {
  const trimmed = blankToNull(value);
  if (!trimmed) return null;
  const match = trimmed.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : trimmed;
}

export function parseFormat(value: string | undefined): RecordFormat {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return { size: null, qty: null, descriptions: [] };

  const tokens = trimmed.split(",").map((t) => t.trim()).filter(Boolean);
  const [first, ...rest] = tokens;

  const qtyMatch = first.match(/^(\d+)\s*x\s*(.+)$/i);
  const size = qtyMatch ? qtyMatch[2].trim() : first;
  const qty = qtyMatch ? Number(qtyMatch[1]) : null;

  return { size: size || null, qty, descriptions: rest };
}

export function parseYear(value: string | undefined): number | null {
  const n = toNumber(value);
  return n && n !== 0 ? n : null;
}

export function parseRating(value: string | undefined): number | null {
  return toNumber(value);
}

export interface CsvMappedRow {
  discogsReleaseId: number;
  artist: string;
  title: string;
  labelName: string | null;
  catno: string | null;
  format: RecordFormat;
  year: number | null;
  personal: PersonalFields;
}

export function mapCsvRow(row: Record<string, string>): CsvMappedRow | null {
  const releaseId = toNumber(row["release_id"]);
  if (releaseId === null) return null;

  const custom: Record<string, string> = {};
  for (const key of Object.keys(row)) {
    if (key.startsWith("Collection ") && !(KNOWN_COLUMNS as readonly string[]).includes(key)) {
      const value = blankToNull(row[key]);
      if (value !== null) custom[key.replace(/^Collection /, "")] = value;
    }
  }

  const catno = blankToNull(row["Catalog#"]);

  return {
    discogsReleaseId: releaseId,
    artist: (row["Artist"] ?? "").trim(),
    title: (row["Title"] ?? "").trim(),
    labelName: blankToNull(row["Label"]),
    catno: catno && catno.toLowerCase() === "none" ? null : catno,
    format: parseFormat(row["Format"]),
    year: parseYear(row["Released"]),
    personal: {
      mediaCondition: normaliseCondition(row["Collection Media Condition"]),
      sleeveCondition: normaliseCondition(row["Collection Sleeve Condition"]),
      location: null,
      discogsFolder: blankToNull(row["CollectionFolder"]),
      rating: parseRating(row["Rating"]),
      tags: [],
      notes: (row["Collection Notes"] ?? "").trim(),
      dateAdded: parseDateAdded(row["Date Added"]),
      purchase: {
        price: toNumber(row["Collection Price"]),
        currency: blankToNull(row["Collection Currency"]),
        store: blankToNull(row["Collection Store"]),
      },
      sold: {
        price: toNumber(row["Collection Sold Price"]),
        currency: blankToNull(row["Collection Sold Currency"]),
      },
      custom,
    },
  };
}

/** True once enrich-discogs has filled in a real tracklist for this record. */
export function isEnriched(record: CollectionRecord): boolean {
  return record.tracks.length > 0;
}
