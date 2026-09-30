import { useState } from "react";
import { db } from "../db/dexie";
import { persistCollection } from "../lib/persist";
import { fetchReleaseFromBrowser, fetchMasterVersions, type DiscogsMasterVersion } from "../lib/discogsBrowserClient";
import {
  parseDiscogsReleaseInput,
  formatArtists,
  mapLabels,
  mapFormat,
  mapCoverThumb,
  resolveSpeed,
  flattenTracklist,
} from "../lib/discogsMapping";
import type { CollectionRecord } from "../types/schema";

export function AddRecord() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<DiscogsMasterVersion[] | null>(null);
  const [existingCopies, setExistingCopies] = useState<number | null>(null);
  const [lastAdded, setLastAdded] = useState<CollectionRecord | null>(null);

  async function addRelease(releaseId: number, confirmDuplicate = false) {
    setError(null);

    if (!confirmDuplicate) {
      const copies = await db.records.where("discogsReleaseId").equals(releaseId).count();
      if (copies > 0) {
        setExistingCopies(copies);
        return;
      }
    }
    setExistingCopies(null);
    setBusy(true);
    try {
      const release = await fetchReleaseFromBrowser(releaseId);
      const speeds = resolveSpeed(release);
      const { tracks, headingNotes } = flattenTracklist(release.tracklist, speeds);
      const now = new Date().toISOString();

      const record: CollectionRecord = {
        id: crypto.randomUUID(),
        discogsReleaseId: release.id,
        status: speeds.needsReview ? "needs_review" : "identified",
        artist: formatArtists(release.artists) || "Unknown",
        title: release.title,
        labels: mapLabels(release.labels),
        year: release.year ?? null,
        country: release.country ?? null,
        format: mapFormat(release.formats),
        genres: release.genres ?? [],
        styles: release.styles ?? [],
        speed: speeds.recordSpeed,
        tracks,
        discogsNotes: headingNotes.length > 0 ? headingNotes.join(" / ") : null,
        personal: {
          mediaCondition: null,
          sleeveCondition: null,
          location: null,
          discogsFolder: null,
          rating: null,
          tags: [],
          notes: "",
          dateAdded: now,
          purchase: { price: null, currency: null, store: null },
          sold: { price: null, currency: null },
          custom: {},
        },
        images: { coverThumb: mapCoverThumb(release), photos: [] },
        candidates: [],
        manuallyEditedFields: [],
        updatedAt: now,
      };

      await db.records.put(record);
      await persistCollection();
      setLastAdded(record);
      setInput("");
      setVersions(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    setLastAdded(null);
    const parsed = parseDiscogsReleaseInput(input);
    if (!parsed) {
      setError("Couldn't parse that as a Discogs release ID, r-id, or discogs.com URL.");
      return;
    }
    if ("masterId" in parsed) {
      setBusy(true);
      try {
        const results = await fetchMasterVersions(parsed.masterId);
        setVersions(results);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    await addRelease(parsed.releaseId);
  }

  return (
    <div className="add-record">
      <label>
        Discogs release ID or URL
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="1234567, r1234567, or https://www.discogs.com/release/1234567-..."
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
      </label>
      <button type="button" onClick={handleSubmit} disabled={busy || !input.trim()}>
        {busy ? "Looking up…" : "Add"}
      </button>

      {error && <p className="error">{error}</p>}

      {existingCopies !== null && (
        <div className="notice">
          <p>
            You already have {existingCopies} {existingCopies === 1 ? "copy" : "copies"} of this release.
          </p>
          <button
            type="button"
            onClick={() => {
              const parsed = parseDiscogsReleaseInput(input);
              if (parsed && "releaseId" in parsed) addRelease(parsed.releaseId, true);
            }}
          >
            Add another copy anyway
          </button>
          <button type="button" onClick={() => setExistingCopies(null)}>
            Cancel
          </button>
        </div>
      )}

      {versions && (
        <div className="version-picker">
          <p>This is a master release — pick a specific pressing:</p>
          <ul>
            {versions.map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => addRelease(v.id)}>
                  {v.title} {v.catno ? `· ${v.catno}` : ""} {v.country ? `· ${v.country}` : ""}{" "}
                  {v.released ? `· ${v.released}` : ""}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lastAdded && (
        <p className="success">
          Added: {lastAdded.artist} – {lastAdded.title}
          {lastAdded.status === "needs_review" ? " (flagged for review — speed inferred, please confirm)" : ""}
        </p>
      )}
    </div>
  );
}
