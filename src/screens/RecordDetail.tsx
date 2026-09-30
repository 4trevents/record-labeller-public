import { useEffect, useState } from "react";
import { db } from "../db/dexie";
import { persistCollection } from "../lib/persist";
import type { CollectionRecord, ProvenanceField, Track } from "../types/schema";

const MEDIA_CONDITIONS = ["M", "NM", "VG+", "VG", "G+", "G", "F", "P"];
const SLEEVE_CONDITIONS = [...MEDIA_CONDITIONS, "Generic", "No Cover", "Not Graded"];

function ProvenanceBadge<T>({ field, unit = "" }: { field: ProvenanceField<T> | null; unit?: string }) {
  if (!field || field.value === null) return <span className="muted">—</span>;
  return (
    <span>
      {String(field.value)}
      {unit}{" "}
      <span className="muted">
        ({field.source}, {field.confidence}
        {field.locked ? ", locked" : ""})
      </span>
    </span>
  );
}

function formatFormat(record: CollectionRecord): string {
  const { size, qty, descriptions } = record.format;
  const parts = [qty && qty > 1 ? `${qty}x${size ?? ""}` : size, ...descriptions].filter(Boolean);
  return parts.join(", ") || "—";
}

function manualField<T>(value: T): ProvenanceField<T> {
  return { value, source: "manual", confidence: "high", locked: true };
}

function markEdited(fields: string[], path: string): string[] {
  return fields.includes(path) ? fields : [...fields, path];
}

interface Draft {
  artist: string;
  title: string;
  labelName: string;
  labelCatno: string;
  year: string;
  country: string;
  formatSize: string;
  formatQty: string;
  formatDescriptions: string;
  genres: string;
  styles: string;
  speedValue: string;
  mediaCondition: string;
  sleeveCondition: string;
  discogsFolder: string;
  rating: string;
  location: string;
  tags: string;
  notes: string;
  purchasePrice: string;
  purchaseCurrency: string;
  purchaseStore: string;
  soldPrice: string;
  soldCurrency: string;
  trackBpm: Record<string, string>;
  trackKey: Record<string, string>;
}

function toDraft(record: CollectionRecord): Draft {
  return {
    artist: record.artist,
    title: record.title,
    labelName: record.labels[0]?.name ?? "",
    labelCatno: record.labels[0]?.catno ?? "",
    year: record.year?.toString() ?? "",
    country: record.country ?? "",
    formatSize: record.format.size ?? "",
    formatQty: record.format.qty?.toString() ?? "",
    formatDescriptions: record.format.descriptions.join(", "),
    genres: record.genres.join(", "),
    styles: record.styles.join(", "),
    speedValue: record.speed?.value?.toString() ?? "",
    mediaCondition: record.personal.mediaCondition ?? "",
    sleeveCondition: record.personal.sleeveCondition ?? "",
    discogsFolder: record.personal.discogsFolder ?? "",
    rating: record.personal.rating?.toString() ?? "",
    location: record.personal.location ?? "",
    tags: record.personal.tags.join(", "),
    notes: record.personal.notes,
    purchasePrice: record.personal.purchase.price?.toString() ?? "",
    purchaseCurrency: record.personal.purchase.currency ?? "",
    purchaseStore: record.personal.purchase.store ?? "",
    soldPrice: record.personal.sold.price?.toString() ?? "",
    soldCurrency: record.personal.sold.currency ?? "",
    trackBpm: Object.fromEntries(record.tracks.map((t) => [t.position, t.bpm?.value?.toString() ?? ""])),
    trackKey: Object.fromEntries(record.tracks.map((t) => [t.position, t.key?.value ?? ""])),
  };
}

const splitList = (s: string) => s.split(",").map((v) => v.trim()).filter(Boolean);
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
const strOrNull = (s: string) => (s.trim() === "" ? null : s.trim());

function applyDraft(record: CollectionRecord, draft: Draft): CollectionRecord {
  const r: CollectionRecord = { ...record, personal: { ...record.personal, purchase: { ...record.personal.purchase }, sold: { ...record.personal.sold } } };
  let edited = [...r.manuallyEditedFields];

  const setIfChanged = <K extends string>(path: K, current: unknown, next: unknown, apply: () => void) => {
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    apply();
    edited = markEdited(edited, path);
  };

  setIfChanged("artist", r.artist, draft.artist, () => { r.artist = draft.artist; });
  setIfChanged("title", r.title, draft.title, () => { r.title = draft.title; });
  const newLabels = [{ name: draft.labelName, catno: strOrNull(draft.labelCatno) }, ...r.labels.slice(1)];
  setIfChanged("labels", r.labels, newLabels, () => { r.labels = newLabels; });
  const newYear = numOrNull(draft.year);
  setIfChanged("year", r.year, newYear, () => { r.year = newYear; });
  const newCountry = strOrNull(draft.country);
  setIfChanged("country", r.country, newCountry, () => { r.country = newCountry; });
  const newFormat = { size: strOrNull(draft.formatSize), qty: numOrNull(draft.formatQty), descriptions: splitList(draft.formatDescriptions) };
  setIfChanged("format", r.format, newFormat, () => { r.format = newFormat; });
  const newGenres = splitList(draft.genres);
  setIfChanged("genres", r.genres, newGenres, () => { r.genres = newGenres; });
  const newStyles = splitList(draft.styles);
  setIfChanged("styles", r.styles, newStyles, () => { r.styles = newStyles; });

  const newSpeed = numOrNull(draft.speedValue);
  if (newSpeed !== (r.speed?.value ?? null)) {
    r.speed = newSpeed === null ? null : manualField(newSpeed);
  }

  r.personal.mediaCondition = strOrNull(draft.mediaCondition);
  r.personal.sleeveCondition = strOrNull(draft.sleeveCondition);
  r.personal.discogsFolder = strOrNull(draft.discogsFolder);
  r.personal.rating = numOrNull(draft.rating);
  r.personal.location = strOrNull(draft.location);
  r.personal.tags = splitList(draft.tags);
  r.personal.notes = draft.notes;
  r.personal.purchase = { price: numOrNull(draft.purchasePrice), currency: strOrNull(draft.purchaseCurrency), store: strOrNull(draft.purchaseStore) };
  r.personal.sold = { price: numOrNull(draft.soldPrice), currency: strOrNull(draft.soldCurrency) };

  for (const key of ["mediaCondition", "sleeveCondition", "discogsFolder", "rating", "notes", "purchase", "sold"]) {
    const path = `personal.${key}`;
    const currentVal = JSON.stringify((record.personal as unknown as Record<string, unknown>)[key]);
    const nextVal = JSON.stringify((r.personal as unknown as Record<string, unknown>)[key]);
    if (currentVal !== nextVal) edited = markEdited(edited, path);
  }

  r.tracks = r.tracks.map((t) => {
    const bpmDraft = draft.trackBpm[t.position] ?? "";
    const keyDraft = draft.trackKey[t.position] ?? "";
    const newBpm = numOrNull(bpmDraft);
    const newKey = strOrNull(keyDraft);
    return {
      ...t,
      bpm: newBpm === (t.bpm?.value ?? null) ? t.bpm : newBpm === null ? null : manualField(newBpm),
      key: newKey === (t.key?.value ?? null) ? t.key : newKey === null ? null : manualField(newKey),
    };
  });

  r.manuallyEditedFields = edited;
  r.updatedAt = new Date().toISOString();
  return r;
}

function TrackRow({
  track,
  recordSpeed,
  editing,
  bpmValue,
  keyValue,
  onBpmChange,
  onKeyChange,
}: {
  track: Track;
  recordSpeed: ProvenanceField<number> | null;
  editing: boolean;
  bpmValue: string;
  keyValue: string;
  onBpmChange: (v: string) => void;
  onKeyChange: (v: string) => void;
}) {
  const speed = track.speed ?? recordSpeed;
  return (
    <tr>
      <td>{track.position}</td>
      <td>
        {track.title}
        {track.artists && track.artists.length > 0 && (
          <span className="muted"> — {track.artists.join(", ")}</span>
        )}
      </td>
      <td>{track.duration ?? "—"}</td>
      <td>
        <ProvenanceBadge field={speed} unit=" RPM" />
      </td>
      <td>
        {editing ? (
          <input type="number" value={bpmValue} onChange={(e) => onBpmChange(e.target.value)} className="cell-input" />
        ) : (
          <ProvenanceBadge field={track.bpm} />
        )}
      </td>
      <td>
        {editing ? (
          <input type="text" value={keyValue} onChange={(e) => onKeyChange(e.target.value)} className="cell-input" placeholder="e.g. Am" />
        ) : (
          <ProvenanceBadge field={track.key} />
        )}
      </td>
    </tr>
  );
}

export function RecordDetail({ record, onClose }: { record: CollectionRecord; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(record));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const startEdit = () => {
    setDraft(toDraft(record));
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const save = async () => {
    const updated = applyDraft(record, draft);
    await db.records.put(updated);
    await persistCollection();
    setEditing(false);
  };

  const field = (key: keyof Draft, label: string, type = "text") => (
    <label className="detail-field">
      <span>{label}</span>
      <input type={type} value={draft[key] as string} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </label>
  );

  return (
    <div className="detail-overlay" onClick={editing ? undefined : onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="detail-close" onClick={onClose}>
          ✕
        </button>
        <div className="detail-edit-bar">
          {editing ? (
            <>
              <button type="button" onClick={save}>Save</button>
              <button type="button" onClick={cancelEdit}>Cancel</button>
            </>
          ) : (
            <button type="button" onClick={startEdit}>Edit</button>
          )}
        </div>

        <div className="detail-header">
          {record.images.coverThumb && <img src={record.images.coverThumb} alt="" className="detail-cover" />}
          <div>
            {editing ? (
              <>
                {field("artist", "Artist")}
                {field("title", "Title")}
              </>
            ) : (
              <>
                <h2>{record.artist}</h2>
                <h3>{record.title}</h3>
              </>
            )}
            {editing ? (
              <div className="detail-field-row">
                {field("labelName", "Label")}
                {field("labelCatno", "Catalog #")}
              </div>
            ) : (
              <p className="muted">
                {record.labels.map((l) => `${l.name}${l.catno ? ` · ${l.catno}` : ""}`).join(" / ") || "—"}
              </p>
            )}
            {editing ? (
              <div className="detail-field-row">
                {field("formatSize", "Size")}
                {field("formatQty", "Qty", "number")}
                {field("formatDescriptions", "Descriptions (comma-separated)")}
                {field("year", "Year", "number")}
                {field("country", "Country")}
              </div>
            ) : (
              <p className="muted">
                {formatFormat(record)} · {record.year ?? "—"} · {record.country ?? "—"}
              </p>
            )}
            {record.discogsReleaseId && (
              <p>
                <a href={`https://www.discogs.com/release/${record.discogsReleaseId}`} target="_blank" rel="noreferrer">
                  discogs.com/release/{record.discogsReleaseId}
                </a>
              </p>
            )}
            <p>
              <span className={`status-badge status-${record.status}`}>{record.status}</span>{" "}
              {record.tracks.length > 0 ? (
                <span className="status-badge status-identified">enriched</span>
              ) : (
                <span className="status-badge status-unidentified">not enriched</span>
              )}
            </p>
          </div>
        </div>

        <section>
          <h4>Genres / Styles</h4>
          {editing ? (
            <div className="detail-field-row">
              {field("genres", "Genres (comma-separated)")}
              {field("styles", "Styles (comma-separated)")}
            </div>
          ) : (
            <p>{record.genres.join(", ") || "—"} {record.styles.length > 0 && `/ ${record.styles.join(", ")}`}</p>
          )}
        </section>

        <section>
          <h4>Speed (default)</h4>
          {editing ? (
            field("speedValue", "RPM", "number")
          ) : (
            <p>
              <ProvenanceBadge field={record.speed} unit=" RPM" />
            </p>
          )}
        </section>

        {record.tracks.length > 0 && (
          <section>
            <h4>Tracklist</h4>
            <table className="record-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Title</th>
                  <th>Duration</th>
                  <th>Speed</th>
                  <th>BPM</th>
                  <th>Key</th>
                </tr>
              </thead>
              <tbody>
                {record.tracks.map((t) => (
                  <TrackRow
                    key={t.position}
                    track={t}
                    recordSpeed={record.speed}
                    editing={editing}
                    bpmValue={draft.trackBpm[t.position] ?? ""}
                    keyValue={draft.trackKey[t.position] ?? ""}
                    onBpmChange={(v) => setDraft({ ...draft, trackBpm: { ...draft.trackBpm, [t.position]: v } })}
                    onKeyChange={(v) => setDraft({ ...draft, trackKey: { ...draft.trackKey, [t.position]: v } })}
                  />
                ))}
              </tbody>
            </table>
          </section>
        )}

        {record.discogsNotes && (
          <section>
            <h4>Discogs notes</h4>
            <p>{record.discogsNotes}</p>
          </section>
        )}

        <section>
          <h4>Personal</h4>
          {editing ? (
            <div className="detail-field-grid">
              <label className="detail-field">
                <span>Folder</span>
                <input type="text" value={draft.discogsFolder} onChange={(e) => setDraft({ ...draft, discogsFolder: e.target.value })} />
              </label>
              <label className="detail-field">
                <span>Media condition</span>
                <select value={draft.mediaCondition} onChange={(e) => setDraft({ ...draft, mediaCondition: e.target.value })}>
                  <option value="">—</option>
                  {MEDIA_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="detail-field">
                <span>Sleeve condition</span>
                <select value={draft.sleeveCondition} onChange={(e) => setDraft({ ...draft, sleeveCondition: e.target.value })}>
                  <option value="">—</option>
                  {SLEEVE_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="detail-field">
                <span>Rating</span>
                <select value={draft.rating} onChange={(e) => setDraft({ ...draft, rating: e.target.value })}>
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="detail-field">
                <span>Location</span>
                <input type="text" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
              </label>
              <label className="detail-field">
                <span>Tags (comma-separated)</span>
                <input type="text" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
              </label>
              <label className="detail-field">
                <span>Purchase price</span>
                <input type="number" value={draft.purchasePrice} onChange={(e) => setDraft({ ...draft, purchasePrice: e.target.value })} />
              </label>
              <label className="detail-field">
                <span>Purchase currency</span>
                <input type="text" value={draft.purchaseCurrency} onChange={(e) => setDraft({ ...draft, purchaseCurrency: e.target.value })} />
              </label>
              <label className="detail-field">
                <span>Purchase store</span>
                <input type="text" value={draft.purchaseStore} onChange={(e) => setDraft({ ...draft, purchaseStore: e.target.value })} />
              </label>
              <label className="detail-field">
                <span>Sold price</span>
                <input type="number" value={draft.soldPrice} onChange={(e) => setDraft({ ...draft, soldPrice: e.target.value })} />
              </label>
              <label className="detail-field">
                <span>Sold currency</span>
                <input type="text" value={draft.soldCurrency} onChange={(e) => setDraft({ ...draft, soldCurrency: e.target.value })} />
              </label>
              <label className="detail-field detail-field-wide">
                <span>Notes</span>
                <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={3} />
              </label>
            </div>
          ) : (
            <table className="detail-kv">
              <tbody>
                <tr>
                  <td>Folder</td>
                  <td>{record.personal.discogsFolder ?? "—"}</td>
                </tr>
                <tr>
                  <td>Media / Sleeve condition</td>
                  <td>
                    {record.personal.mediaCondition ?? "—"} / {record.personal.sleeveCondition ?? "—"}
                  </td>
                </tr>
                <tr>
                  <td>Rating</td>
                  <td>{record.personal.rating ?? "—"}</td>
                </tr>
                <tr>
                  <td>Location</td>
                  <td>{record.personal.location ?? "—"}</td>
                </tr>
                <tr>
                  <td>Tags</td>
                  <td>{record.personal.tags.join(", ") || "—"}</td>
                </tr>
                <tr>
                  <td>Date added</td>
                  <td>{record.personal.dateAdded ? new Date(record.personal.dateAdded).toLocaleDateString() : "—"}</td>
                </tr>
                <tr>
                  <td>Purchase</td>
                  <td>
                    {record.personal.purchase.price
                      ? `${record.personal.purchase.price} ${record.personal.purchase.currency ?? ""} @ ${record.personal.purchase.store ?? "?"}`
                      : "—"}
                  </td>
                </tr>
                <tr>
                  <td>Sold</td>
                  <td>
                    {record.personal.sold.price ? `${record.personal.sold.price} ${record.personal.sold.currency ?? ""}` : "—"}
                  </td>
                </tr>
                <tr>
                  <td>Notes</td>
                  <td>{record.personal.notes || "—"}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
