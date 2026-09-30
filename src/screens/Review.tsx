import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/dexie";
import { persistCollection } from "../lib/persist";
import type { CollectionRecord, ProvenanceField } from "../types/schema";

function confirmField(field: ProvenanceField<number> | null): ProvenanceField<number> | null {
  if (!field) return field;
  return { ...field, confidence: "high", locked: true };
}

function manualField(value: number): ProvenanceField<number> {
  return { value, source: "manual", confidence: "high", locked: true };
}

async function saveRecord(record: CollectionRecord) {
  const stillNeedsReview = record.speed?.locked === false;
  const trackReviewPending = record.tracks.some((t) => t.speed && !t.speed.locked);
  if (!stillNeedsReview && !trackReviewPending) {
    record.status = "identified";
  }
  record.updatedAt = new Date().toISOString();
  await db.records.put(record);
  await persistCollection();
}

function SpeedRow({
  label,
  field,
  onConfirm,
  onCorrect,
}: {
  label: string;
  field: ProvenanceField<number> | null;
  onConfirm: () => void;
  onCorrect: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(field?.value ?? ""));

  if (!field) return null;

  return (
    <div className="speed-row">
      <span className="speed-label">{label}</span>
      {editing ? (
        <>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{ width: 70 }}
          />
          <button
            type="button"
            onClick={() => {
              onCorrect(Number(value));
              setEditing(false);
            }}
          >
            Save
          </button>
        </>
      ) : (
        <>
          <span className="speed-value">
            {field.value} RPM <span className="muted">({field.source}, {field.confidence})</span>
          </span>
          {!field.locked && (
            <>
              <button type="button" onClick={onConfirm}>
                Confirm
              </button>
              <button type="button" onClick={() => setEditing(true)}>
                Correct
              </button>
            </>
          )}
          {field.locked && <span className="status-badge status-identified">confirmed</span>}
        </>
      )}
    </div>
  );
}

function ReviewCard({ record }: { record: CollectionRecord }) {
  const sides = useMemo(() => {
    const map = new Map<string, ProvenanceField<number>>();
    for (const t of record.tracks) {
      if (t.speed && !map.has(t.side)) map.set(t.side, t.speed);
    }
    return [...map.entries()];
  }, [record]);

  const update = async (mutate: (r: CollectionRecord) => void) => {
    const fresh = await db.records.get(record.id);
    if (!fresh) return;
    mutate(fresh);
    await saveRecord(fresh);
  };

  return (
    <div className="review-card">
      <h3>
        {record.artist} – {record.title}
      </h3>
      <p className="muted">
        {record.labels[0]?.name} {record.labels[0]?.catno ? `· ${record.labels[0].catno}` : ""} ·{" "}
        {record.format.size} · {record.year ?? "—"}
      </p>

      {sides.length > 0 ? (
        sides.map(([side, field]) => (
          <SpeedRow
            key={side}
            label={`Side ${side}`}
            field={field}
            onConfirm={() => update((r) => {
              const t = r.tracks.find((t) => t.side === side);
              if (t) t.speed = confirmField(t.speed);
            })}
            onCorrect={(value) => update((r) => {
              for (const t of r.tracks.filter((t) => t.side === side)) t.speed = manualField(value);
            })}
          />
        ))
      ) : (
        <SpeedRow
          label="Speed"
          field={record.speed}
          onConfirm={() => update((r) => { r.speed = confirmField(r.speed); })}
          onCorrect={(value) => update((r) => { r.speed = manualField(value); })}
        />
      )}
    </div>
  );
}

export function Review() {
  const [search, setSearch] = useState("");
  const records = useLiveQuery(() => db.records.where("status").equals("needs_review").toArray(), []);

  const filtered = useMemo(() => {
    if (!records) return [];
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.artist.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.labels.some((l) => l.name.toLowerCase().includes(q) || (l.catno ?? "").toLowerCase().includes(q))
    );
  }, [records, search]);

  if (records === undefined) return <p className="muted">Loading…</p>;
  if (records.length === 0) return <p className="muted">Nothing needs review.</p>;

  return (
    <div className="review-screen">
      <div className="filters">
        <input
          type="search"
          placeholder="Search artist, title, label, catalog #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="count">
          {filtered.length} of {records.length}
        </span>
      </div>
      {filtered.length === 0 ? (
        <p className="muted">No matches.</p>
      ) : (
        filtered.map((r) => <ReviewCard key={r.id} record={r} />)
      )}
    </div>
  );
}
