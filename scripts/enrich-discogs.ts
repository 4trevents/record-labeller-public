/**
 * Fetch full release data from Discogs for every record that doesn't have a
 * tracklist yet, and fill in tracklist, format, genres, styles, cover
 * thumbnail and speed (see resolveSpeed in src/lib/discogsMapping.ts for the
 * speed inference rules).
 *
 * Usage: npm run enrich:discogs [-- --limit 50] [-- --force] [-- --refresh] [-- --overwrite-edits]
 *   --limit N          only process the first N pending records (useful for a trial run)
 *   --force            re-fetch from Discogs (bypassing the cache) and overwrite already-enriched records
 *   --refresh          reprocess already-enriched records from the existing cache, without hitting
 *                       the API again — useful after a mapping-logic fix, to re-derive fields cheaply
 *   --overwrite-edits  force Discogs values to win over manually-edited fields, without prompting
 *
 * Rate-limited to 1 request/second; raw responses are cached to
 * data/cache/discogs/{releaseId}.json and reused on later runs unless --force
 * is passed for that record.
 *
 * If you've manually edited artist/title/label/format/country/year/genres/
 * styles in the app, this script won't silently overwrite them — it prompts
 * (interactive terminal) or skips + logs the conflict (background run).
 * Pass --overwrite-edits to force the Discogs value to win without prompting.
 * bpm/key are never touched here regardless (Discogs has no such data) —
 * that's enrich-bpm-key's job.
 */
import "./lib/loadEnv";
import { loadCollection, saveCollection, writeReport } from "./lib/collectionStore";
import { loadDiscogsConfig, fetchRelease } from "./lib/discogsClient";
import { formatArtists, mapLabels, mapFormat, mapCoverThumb, resolveSpeed, flattenTracklist } from "../src/lib/discogsMapping";
import { guardedAssign } from "./lib/mergeGuard";
import type { CollectionRecord } from "../src/types/schema";

function parseArgs() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const force = args.includes("--force"); // re-fetch from Discogs, bypassing the on-disk cache
  const refresh = args.includes("--refresh"); // reprocess already-enriched records, using the cache
  const overwriteEdits = args.includes("--overwrite-edits");
  return { limit, force, refresh, overwriteEdits };
}

const GUARDED_CORE_FIELDS: (keyof CollectionRecord)[] = [
  "artist",
  "title",
  "labels",
  "format",
  "country",
  "year",
  "genres",
  "styles",
];

async function main() {
  const { limit, force, refresh, overwriteEdits } = parseArgs();
  const config = loadDiscogsConfig();
  const collection = loadCollection();
  const conflicts: string[] = [];

  const pending = collection.records
    .filter((r) => (refresh ? r.tracks.length > 0 : force || r.tracks.length === 0))
    .slice(0, limit);

  console.log(`Enriching ${pending.length} record(s)…`);

  let enriched = 0;
  let needsReview = 0;
  const failed: string[] = [];
  const now = new Date().toISOString();

  for (const record of pending) {
    if (!record.discogsReleaseId) {
      failed.push(`${record.id}: no discogsReleaseId, skipped`);
      continue;
    }
    try {
      const release = await fetchRelease(config, record.discogsReleaseId, { useCache: !force });

      const incoming: Record<string, unknown> = {
        artist: formatArtists(release.artists) || record.artist,
        title: release.title || record.title,
        labels: mapLabels(release.labels).length > 0 ? mapLabels(release.labels) : record.labels,
        format: mapFormat(release.formats),
        country: release.country ?? record.country,
        year: release.year ?? record.year,
        genres: release.genres ?? [],
        styles: release.styles ?? [],
      };
      for (const field of GUARDED_CORE_FIELDS) {
        await guardedAssign(
          record,
          field,
          record[field],
          incoming[field],
          () => {
            (record[field] as unknown) = incoming[field];
          },
          overwriteEdits,
          conflicts
        );
      }
      record.images = { ...record.images, coverThumb: mapCoverThumb(release) };

      const speeds = resolveSpeed(release);

      // Never overwrite a speed the user already confirmed/corrected via the
      // Review screen (source "manual" or locked), even on --force/--refresh.
      const speedLocked = record.speed?.locked === true;
      if (!speedLocked) record.speed = speeds.recordSpeed;

      const { tracks, headingNotes } = flattenTracklist(release.tracklist, speeds);
      // Discogs never supplies bpm/key, so flattenTracklist always produces
      // them null — always carry forward whatever a track already had
      // (manual edit or a future enrich-bpm-key run), and keep locked speed
      // overrides too. Nothing to merge for a first-time enrichment.
      const priorByPosition = new Map(record.tracks.map((t) => [t.position, t]));
      record.tracks = tracks.map((t) => {
        const prior = priorByPosition.get(t.position);
        if (!prior) return t;
        return {
          ...t,
          speed: prior.speed?.locked ? prior.speed : t.speed,
          bpm: prior.bpm,
          key: prior.key,
        };
      });
      record.discogsNotes = headingNotes.length > 0 ? headingNotes.join(" / ") : null;

      if (!speedLocked) {
        record.status = speeds.needsReview ? "needs_review" : "identified";
      }
      if (record.status === "needs_review") needsReview++;

      record.updatedAt = now;
      enriched++;
    } catch (err) {
      failed.push(`${record.artist} - ${record.title} (${record.discogsReleaseId}): ${(err as Error).message}`);
    }
  }

  saveCollection(collection);

  const reportLines = [
    `# enrich-discogs — ${now}`,
    "",
    `Records processed: ${pending.length}`,
    `Enriched: ${enriched}`,
    `Flagged needs_review (speed inference): ${needsReview}`,
    `Failed: ${failed.length}`,
    `Manual-edit conflicts kept as-is: ${conflicts.length}`,
    "",
  ];
  if (failed.length > 0) {
    reportLines.push("## Failed", "", ...failed.map((f) => `- ${f}`), "");
  }
  if (conflicts.length > 0) {
    reportLines.push(
      "## Manual-edit conflicts",
      "",
      "These fields were edited in the app and differ from Discogs; kept your edit. Re-run with --overwrite-edits to force the Discogs value instead.",
      "",
      ...conflicts.map((c) => `- ${c}`),
      ""
    );
  }
  const reportPath = writeReport("enrich-discogs", reportLines.join("\n"));

  console.log(`Enriched ${enriched}, needs_review ${needsReview}, failed ${failed.length}, conflicts kept ${conflicts.length}.`);
  console.log(`Report: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

