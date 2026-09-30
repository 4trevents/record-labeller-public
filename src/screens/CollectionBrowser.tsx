import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/dexie";
import { RecordDetail } from "./RecordDetail";
import type { CollectionRecord, RecordStatus } from "../types/schema";

const STATUS_LABELS: Record<RecordStatus, string> = {
  identified: "Identified",
  needs_review: "Needs review",
  unidentified: "Unidentified",
};

function formatFormat(record: CollectionRecord): string {
  const { size, qty, descriptions } = record.format;
  const parts = [qty && qty > 1 ? `${qty}x${size ?? ""}` : size, ...descriptions].filter(Boolean);
  return parts.join(", ") || "—";
}

type EnrichmentLevel = "enriched" | "partial" | "not_enriched";

const ENRICHMENT_LABELS: Record<EnrichmentLevel, string> = {
  enriched: "Yes",
  partial: "Partial",
  not_enriched: "No",
};

const ENRICHMENT_BADGE_CLASS: Record<EnrichmentLevel, string> = {
  enriched: "status-identified",
  partial: "status-needs_review",
  not_enriched: "status-unidentified",
};

/**
 * "not_enriched": no Discogs tracklist yet (enrich-discogs hasn't run for this record).
 * "partial": has a tracklist, but at least one track is still missing bpm/key/duration.
 * "enriched": has a tracklist and every track has bpm, key and duration filled.
 */
function getEnrichmentLevel(record: CollectionRecord): EnrichmentLevel {
  if (record.tracks.length === 0) return "not_enriched";
  const complete = record.tracks.every((t) => t.bpm && t.key && t.duration);
  return complete ? "enriched" : "partial";
}

type EnrichedFilter = "all" | EnrichmentLevel;

const PAGE_SIZE = 100;

export function CollectionBrowser() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RecordStatus | "all">("all");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [enrichedFilter, setEnrichedFilter] = useState<EnrichedFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const records = useLiveQuery(() => db.records.toArray(), []);

  const folders = useMemo(() => {
    if (!records) return [];
    const set = new Set<string>();
    for (const r of records) {
      if (r.personal.discogsFolder) set.add(r.personal.discogsFolder);
    }
    return [...set].sort();
  }, [records]);

  const enrichmentCounts = useMemo(() => {
    const counts: Record<EnrichmentLevel, number> = { enriched: 0, partial: 0, not_enriched: 0 };
    for (const r of records ?? []) counts[getEnrichmentLevel(r)]++;
    return counts;
  }, [records]);

  const filtered = useMemo(() => {
    if (!records) return [];
    const q = search.trim().toLowerCase();
    return records
      .filter((r) => statusFilter === "all" || r.status === statusFilter)
      .filter((r) => folderFilter === "all" || r.personal.discogsFolder === folderFilter)
      .filter((r) => enrichedFilter === "all" || getEnrichmentLevel(r) === enrichedFilter)
      .filter((r) => {
        if (!q) return true;
        return (
          r.artist.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.labels.some((l) => l.name.toLowerCase().includes(q) || (l.catno ?? "").toLowerCase().includes(q))
        );
      })
      .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  }, [records, search, statusFilter, folderFilter, enrichedFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  if (records === undefined) {
    return <p className="muted">Loading collection…</p>;
  }

  if (records.length === 0) {
    return <p className="muted">No records loaded yet. Connect your data folder or import collection.json.</p>;
  }

  return (
    <div className="collection-browser">
      <div className="filters">
        <input
          type="search"
          placeholder="Search artist, title, label, catalog #…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as RecordStatus | "all");
            setPage(1);
          }}
        >
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={folderFilter}
          onChange={(e) => {
            setFolderFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All folders</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          value={enrichedFilter}
          onChange={(e) => {
            setEnrichedFilter(e.target.value as EnrichedFilter);
            setPage(1);
          }}
        >
          <option value="all">All (enrichment)</option>
          <option value="enriched">Enriched only</option>
          <option value="partial">Partially enriched only</option>
          <option value="not_enriched">Not enriched only</option>
        </select>
        <span className="count">
          {filtered.length} of {records.length} · {enrichmentCounts.enriched} enriched, {enrichmentCounts.partial} partial,{" "}
          {enrichmentCounts.not_enriched} not enriched
        </span>
      </div>

      <table className="record-table">
        <thead>
          <tr>
            <th>Artist</th>
            <th>Title</th>
            <th>Label</th>
            <th>Catalog #</th>
            <th>Year</th>
            <th>Format</th>
            <th>Folder</th>
            <th>Condition</th>
            <th>Status</th>
            <th>Enriched</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map((r) => (
            <tr key={r.id} onClick={() => setSelectedId(r.id)} className="row-clickable">
              <td>{r.artist}</td>
              <td>{r.title}</td>
              <td>{r.labels[0]?.name || "—"}</td>
              <td>{r.labels[0]?.catno || "—"}</td>
              <td>{r.year ?? "—"}</td>
              <td>{formatFormat(r)}</td>
              <td>{r.personal.discogsFolder || "—"}</td>
              <td>{r.personal.mediaCondition || "—"}</td>
              <td>
                <span className={`status-badge status-${r.status}`}>{STATUS_LABELS[r.status]}</span>
              </td>
              <td>
                <span className={`status-badge ${ENRICHMENT_BADGE_CLASS[getEnrichmentLevel(r)]}`}>
                  {ENRICHMENT_LABELS[getEnrichmentLevel(r)]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pagination">
        <button type="button" onClick={() => setPage(1)} disabled={currentPage === 1}>
          « First
        </button>
        <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}>
          ‹ Prev
        </button>
        <span>
          Page {currentPage} of {totalPages}
        </span>
        <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === totalPages}>
          Next ›
        </button>
        <button type="button" onClick={() => setPage(totalPages)} disabled={currentPage === totalPages}>
          Last »
        </button>
      </div>

      {selectedId && (() => {
        const selected = records.find((r) => r.id === selectedId);
        return selected ? <RecordDetail record={selected} onClose={() => setSelectedId(null)} /> : null;
      })()}
    </div>
  );
}
