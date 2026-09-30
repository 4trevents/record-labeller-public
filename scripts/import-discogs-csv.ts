/**
 * Import a Discogs collection CSV export into data/collection.json.
 *
 * Usage: npm run import:csv -- data/imports/your-export.csv
 *
 * A Discogs release_id is NOT a unique key: the same release can appear
 * multiple times in a collection as separate physical copies (bought twice,
 * found a duplicate inside a sleeve, etc). The CSV export has no per-copy
 * instance id, so this script matches existing records on
 * (discogsReleaseId, Date Added) instead — two CSV rows for the same
 * release with different dateAdded become two distinct records; identical
 * (releaseId, dateAdded) pairs are treated as the same copy and merged, so
 * re-running on the same file stays idempotent.
 *
 * Personal fields (condition, folder, price, notes, dateAdded) always come
 * from the CSV. Core descriptive fields (artist/title/label/format/year)
 * are only overwritten while the record hasn't been enriched yet by
 * enrich-discogs, so a later API-sourced tracklist/structured data is never
 * clobbered by a re-import of the same CSV.
 *
 * Exception: if you've manually edited a field in the app, this script
 * won't silently overwrite it — it prompts (in an interactive terminal) or
 * skips + logs the conflict to the report (in a background/non-interactive
 * run). Pass --overwrite-edits to force the CSV to win without prompting.
 */
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import Papa from "papaparse";
import type { CollectionRecord, PersonalFields } from "../src/types/schema";
import { loadCollection, saveCollection, writeReport } from "./lib/collectionStore";
import { mapCsvRow, isEnriched } from "./lib/csvMapping";
import { guardedAssign } from "./lib/mergeGuard";

const GUARDED_PERSONAL_FIELDS: (keyof PersonalFields)[] = [
  "mediaCondition",
  "sleeveCondition",
  "discogsFolder",
  "rating",
  "notes",
  "dateAdded",
  "purchase",
  "sold",
  "custom",
];

async function main() {
  const args = process.argv.slice(2);
  const overwriteEdits = args.includes("--overwrite-edits");
  const inputPath = args.find((a) => !a.startsWith("--"));
  if (!inputPath) {
    console.error("Usage: npm run import:csv -- <path-to-discogs-export.csv> [--overwrite-edits]");
    process.exit(1);
  }
  if (inputPath.toLowerCase().endsWith(".xlsx")) {
    console.error(
      ".xlsx import isn't supported yet (the npm `xlsx` package has unpatched high-severity " +
        "advisories). Export from Discogs directly as CSV, or re-save the .xlsx as .csv — the " +
        "spec already prefers the raw CSV over an Excel-resaved copy anyway."
    );
    process.exit(1);
  }
  if (!existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const csvText = readFileSync(inputPath, "utf8");
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    for (const err of parsed.errors.slice(0, 10)) {
      console.error(`CSV parse error (row ${err.row}): ${err.message}`);
    }
  }

  const collection = loadCollection();
  const copyKey = (releaseId: number | null, dateAdded: string | null) => `${releaseId}::${dateAdded ?? ""}`;
  const byCopyKey = new Map(
    collection.records.map((r) => [copyKey(r.discogsReleaseId, r.personal.dateAdded), r])
  );

  let created = 0;
  let updated = 0;
  const skipped: string[] = [];
  const conflicts: string[] = [];
  const now = new Date().toISOString();

  for (const [i, row] of parsed.data.entries()) {
    const mapped = mapCsvRow(row);
    if (!mapped) {
      skipped.push(`Row ${i + 2}: missing/invalid release_id (${row["Artist"]} - ${row["Title"]})`);
      continue;
    }

    const key = copyKey(mapped.discogsReleaseId, mapped.personal.dateAdded);
    const existing = byCopyKey.get(key);

    if (existing) {
      for (const field of GUARDED_PERSONAL_FIELDS) {
        await guardedAssign(
          existing,
          `personal.${field}`,
          existing.personal[field],
          mapped.personal[field],
          () => {
            (existing.personal[field] as unknown) = mapped.personal[field];
          },
          overwriteEdits,
          conflicts
        );
      }
      // location/tags/dateAdded aren't CSV-sourced (dateAdded doubles as the
      // copy-matching key above, so it's intentionally never edited in-app).
      if (!isEnriched(existing)) {
        await guardedAssign(existing, "artist", existing.artist, mapped.artist, () => { existing.artist = mapped.artist; }, overwriteEdits, conflicts);
        await guardedAssign(existing, "title", existing.title, mapped.title, () => { existing.title = mapped.title; }, overwriteEdits, conflicts);
        const newLabels = [{ name: mapped.labelName ?? "", catno: mapped.catno }];
        await guardedAssign(existing, "labels", existing.labels, newLabels, () => { existing.labels = newLabels; }, overwriteEdits, conflicts);
        await guardedAssign(existing, "format", existing.format, mapped.format, () => { existing.format = mapped.format; }, overwriteEdits, conflicts);
        await guardedAssign(existing, "year", existing.year, mapped.year, () => { existing.year = mapped.year; }, overwriteEdits, conflicts);
      }
      existing.updatedAt = now;
      updated++;
    } else {
      const record: CollectionRecord = {
        id: randomUUID(),
        discogsReleaseId: mapped.discogsReleaseId,
        status: "identified",
        artist: mapped.artist,
        title: mapped.title,
        labels: [{ name: mapped.labelName ?? "", catno: mapped.catno }],
        year: mapped.year,
        country: null,
        format: mapped.format,
        genres: [],
        styles: [],
        speed: null,
        tracks: [],
        discogsNotes: null,
        personal: mapped.personal,
        manuallyEditedFields: [],
        images: { coverThumb: null, photos: [] },
        candidates: [],
        updatedAt: now,
      };
      collection.records.push(record);
      byCopyKey.set(key, record);
      created++;
    }
  }

  saveCollection(collection);

  const reportLines = [
    `# import-discogs-csv — ${now}`,
    "",
    `Source: \`${inputPath}\``,
    `Rows processed: ${parsed.data.length}`,
    `Records created: ${created}`,
    `Records updated: ${updated}`,
    `Rows skipped: ${skipped.length}`,
    `Manual-edit conflicts kept as-is: ${conflicts.length}`,
    "",
  ];
  if (skipped.length > 0) {
    reportLines.push("## Skipped rows", "", ...skipped.map((s) => `- ${s}`), "");
  }
  if (conflicts.length > 0) {
    reportLines.push(
      "## Manual-edit conflicts",
      "",
      "These fields were edited in the app and differ from the CSV; kept your edit. Re-run with --overwrite-edits to force the CSV value instead.",
      "",
      ...conflicts.map((c) => `- ${c}`),
      ""
    );
  }
  const reportPath = writeReport("import-discogs-csv", reportLines.join("\n"));

  console.log(`Created ${created}, updated ${updated}, skipped ${skipped.length}, conflicts kept ${conflicts.length}.`);
  console.log(`Report: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

