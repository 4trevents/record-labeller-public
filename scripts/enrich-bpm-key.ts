/**
 * Fill in BPM, key, and (where missing) duration for tracks, per SPEC.md's
 * source order:
 *   1. rekordbox XML export (this script's --rekordbox flag)
 *   2. GetSongBPM API (TODO — added once rekordbox matching is verified)
 *   3. Local audio analysis (out of scope — no rips available)
 *
 * Usage: npm run enrich:bpm-key -- --rekordbox path/to/rekordbox.xml [--limit 50] [--force]
 *   --limit N   only process the first N tracks needing data
 *   --force     re-match tracks that already have a bpm/key (still won't touch locked fields)
 *
 * Never invents a value: a track only gets bpm/key/duration written when
 * matched with high or medium confidence (see matchRekordboxTrack).
 * Ambiguous matches (multiple rekordbox entries for the same artist+title
 * that disagree on BPM/key — a sign of different mixes/edits) are left
 * blank and logged to the report for manual review instead of guessed.
 * Duration only fills a gap (Discogs doesn't always provide one) — it's
 * never used to overwrite an existing value, and isn't provenance-tracked
 * like bpm/key/speed since there's no source/confidence to attach.
 */
import "./lib/loadEnv";
import { loadCollection, saveCollection, writeReport } from "./lib/collectionStore";
import { parseRekordboxXml } from "./lib/rekordboxXml";
import { matchRekordboxTrack } from "../src/lib/rekordboxMatch";
import { toStandardKey, detectKeyNotation } from "../src/lib/keyNotation";

function formatDuration(totalSec: number): string {
  const rounded = Math.round(totalSec);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const rekordboxIdx = args.indexOf("--rekordbox");
  const rekordboxPath = rekordboxIdx >= 0 ? args[rekordboxIdx + 1] : undefined;
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const force = args.includes("--force");
  return { rekordboxPath, limit, force };
}

async function main() {
  const { rekordboxPath, limit, force } = parseArgs();
  if (!rekordboxPath) {
    console.error("Usage: npm run enrich:bpm-key -- --rekordbox path/to/rekordbox.xml [--limit N] [--force]");
    process.exit(1);
  }

  console.log(`Loading rekordbox library from ${rekordboxPath}…`);
  const library = parseRekordboxXml(rekordboxPath);
  console.log(`Loaded ${library.length} rekordbox tracks.`);

  const collection = loadCollection();
  const now = new Date().toISOString();

  let bpmFilled = 0;
  let keyFilled = 0;
  let durationFilled = 0;
  let flaggedReview = 0;
  const ambiguous: string[] = [];
  const openKeyUnconverted: string[] = [];
  let processed = 0;

  outer: for (const record of collection.records) {
    for (const track of record.tracks) {
      const needsBpm = force || !track.bpm;
      const needsKey = force || !track.key;
      const needsDuration = !track.duration; // not provenance-tracked, so --force doesn't apply
      if (!needsBpm && !needsKey && !needsDuration) continue;
      if (track.bpm?.locked && track.key?.locked && !needsDuration) continue;
      if (processed >= limit) break outer;
      processed++;

      const match = matchRekordboxTrack(record.artist, track.title, library);

      // Self-healing: on a --force re-run, a field this script previously
      // filled (source "rekordbox", unlocked) that can no longer be
      // substantiated gets cleared rather than left stale — e.g. after a
      // matching-logic fix. Never touches a manually-confirmed/locked field,
      // and never touches a field on a normal (non-force) run, since a
      // normal run only looks at fields that are already null anyway.
      if (force && (!match || match.confidence === "low")) {
        if (track.bpm?.source === "rekordbox" && !track.bpm.locked) track.bpm = null;
        if (track.key?.source === "rekordbox" && !track.key.locked) track.key = null;
      }

      if (!match) continue;

      if (match.confidence === "low") {
        ambiguous.push(`${record.artist} - ${track.title}: ${match.reason}`);
        continue;
      }

      let touchedThisTrack = false;

      if (needsBpm && !track.bpm?.locked && match.bpm !== null) {
        track.bpm = { value: Math.round(match.bpm * 10) / 10, source: "rekordbox", confidence: match.confidence, locked: false };
        bpmFilled++;
        touchedThisTrack = true;
      }

      if (needsKey && !track.key?.locked && match.tonality) {
        const standard = toStandardKey(match.tonality);
        if (standard) {
          track.key = { value: standard, source: "rekordbox", confidence: match.confidence, locked: false };
          keyFilled++;
          touchedThisTrack = true;
        } else if (detectKeyNotation(match.tonality) === "openkey") {
          openKeyUnconverted.push(`${record.artist} - ${track.title}: rekordbox key "${match.tonality}" is Open Key notation, not auto-converted`);
        }
      }

      if (touchedThisTrack && match.confidence !== "high" && record.status === "identified") {
        record.status = "needs_review";
        flaggedReview++;
      }

      if (needsDuration && match.durationSec !== null) {
        track.duration = formatDuration(match.durationSec);
        durationFilled++;
        touchedThisTrack = true;
      }

      if (touchedThisTrack) record.updatedAt = now;
    }
  }

  saveCollection(collection);

  const reportLines = [
    `# enrich-bpm-key — ${now}`,
    "",
    `Source: rekordbox (${rekordboxPath}, ${library.length} tracks)`,
    `Tracks processed: ${processed}`,
    `BPM filled: ${bpmFilled}`,
    `Key filled: ${keyFilled}`,
    `Duration filled: ${durationFilled}`,
    `Flagged needs_review (medium-confidence match): ${flaggedReview}`,
    `Ambiguous matches skipped: ${ambiguous.length}`,
    `Open Key notation skipped (not auto-converted): ${openKeyUnconverted.length}`,
    "",
  ];
  if (ambiguous.length > 0) {
    reportLines.push("## Ambiguous matches (not applied)", "", ...ambiguous.map((a) => `- ${a}`), "");
  }
  if (openKeyUnconverted.length > 0) {
    reportLines.push(
      "## Open Key notation (not auto-converted)",
      "",
      "Set your rekordbox key display to Camelot or standard notation and re-export, or set these manually in the app.",
      "",
      ...openKeyUnconverted.map((o) => `- ${o}`),
      ""
    );
  }
  const reportPath = writeReport("enrich-bpm-key", reportLines.join("\n"));

  console.log(`BPM filled ${bpmFilled}, key filled ${keyFilled}, duration filled ${durationFilled}, ambiguous ${ambiguous.length}, open-key skipped ${openKeyUnconverted.length}.`);
  console.log(`Report: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
