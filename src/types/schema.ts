// Data schema shared between the app (browser) and /scripts (Node/tsx).
// Mirrors SPEC.md "Data schema" section — keep both in sync.

export type FieldSource =
  | "csv"
  | "discogs"
  | "discogs_inferred"
  | "rekordbox"
  | "audio_analysis"
  | "getsongbpm"
  | "claude"
  | "manual";

export type Confidence = "high" | "medium" | "low";

export interface ProvenanceField<T> {
  value: T | null;
  source: FieldSource;
  confidence: Confidence;
  locked: boolean;
}

export type RecordStatus = "identified" | "needs_review" | "unidentified";

export interface RecordLabel {
  name: string;
  catno: string | null;
}

export interface RecordFormat {
  size: string | null;
  qty: number | null;
  descriptions: string[];
}

export interface Track {
  position: string;
  side: string;
  title: string;
  artists: string[] | null;
  duration: string | null;
  speed: ProvenanceField<number> | null;
  bpm: ProvenanceField<number> | null;
  key: ProvenanceField<string> | null;
}

export interface Candidate {
  discogsReleaseId: number;
  title: string;
  catno: string | null;
  year: number | null;
  country: string | null;
  thumb: string | null;
  score: number;
  reason: string;
}

export interface PersonalFields {
  mediaCondition: string | null;
  sleeveCondition: string | null;
  location: string | null;
  discogsFolder: string | null;
  rating: number | null;
  tags: string[];
  notes: string;
  dateAdded: string | null;
  purchase: { price: number | null; currency: string | null; store: string | null };
  sold: { price: number | null; currency: string | null };
  custom: Record<string, string>;
}

export interface CollectionRecord {
  id: string;
  discogsReleaseId: number | null;
  status: RecordStatus;
  artist: string;
  title: string;
  labels: RecordLabel[];
  year: number | null;
  country: string | null;
  format: RecordFormat;
  genres: string[];
  styles: string[];
  speed: ProvenanceField<number> | null;
  tracks: Track[];
  /** Tracklist heading text from Discogs (e.g. "That Side / This Side") that doesn't fit a track row. Replaced wholesale on each enrich-discogs run, never appended. Distinct from personal.notes, which is user-owned and never touched by enrichment. */
  discogsNotes: string | null;
  personal: PersonalFields;
  /** Dot-paths of fields manually edited in the app (e.g. "artist", "personal.notes") that import-discogs-csv / enrich-discogs must not silently overwrite. */
  manuallyEditedFields: string[];
  images: { coverThumb: string | null; photos: string[] };
  candidates: Candidate[];
  queueItemId?: string;
  updatedAt: string;
}

export type QueueItemStatus = "pending" | "processed" | "failed";

export interface QueueItem {
  id: string;
  createdAt: string;
  photos: string[];
  barcodeAttempt: string | null;
  userHint: string | null;
  status: QueueItemStatus;
}

export type ElementType = "text" | "trackTable" | "qr" | "image" | "line" | "rect";
export type OverflowMode = "shrink" | "truncate" | "wrap";

export interface TrackTableColumn {
  field: "position" | "title" | "duration" | "bpm" | "key" | "speed";
  sizePt: number;
  weight?: number;
  color?: string;
  overflow?: OverflowMode;
  maxLines?: number;
  render?: "text" | "badge";
  fill?: boolean;
}

export interface LabelElement {
  type: ElementType;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  template?: string;
  font?: string;
  sizePt?: number;
  weight?: number;
  align?: "left" | "center" | "right";
  overflow?: OverflowMode;
  columns?: TrackTableColumn[];
  maxRows?: number;
  source?: string;
}

export interface LabelTemplate {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  paddingMm: number;
  border: { widthPt: number; radiusMm: number };
  elements: LabelElement[];
  print: {
    mode: "single" | "sheet";
    pageSize: string;
    cols: number;
    rows: number;
    marginsMm: { top: number; left: number };
    gapMm: { x: number; y: number };
    startPosition: number;
  };
}

export interface Collection {
  schemaVersion: 1;
  exportedAt: string;
  records: CollectionRecord[];
  queue: QueueItem[];
  templates: LabelTemplate[];
}

export function emptyCollection(): Collection {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    records: [],
    queue: [],
    templates: [],
  };
}

/** Backfills fields added after a collection.json may have been written, so old files keep loading. */
export function normalizeCollection(raw: Collection): Collection {
  for (const record of raw.records) {
    if (!Array.isArray(record.manuallyEditedFields)) record.manuallyEditedFields = [];
    if (record.discogsNotes === undefined) record.discogsNotes = null;
  }
  return raw;
}
