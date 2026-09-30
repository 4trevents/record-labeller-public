# Record Labeller — Project Spec (v0.1)

A personal vinyl cataloguing and label-printing app. It works as an offline-first web frontend. Claude Code handles the batch jobs that need AI or bulk API work, and writes JSON that the app imports.

## Goals

1. Get records into the collection by Discogs CSV import, Discogs ID/URL, barcode scan, or photo.
2. Enrich each record with data the Discogs export lacks: tracklist, speed (33/45/78), BPM and key.
3. Design custom labels (fields, layout, dimensions) and print them to PDF.

## Non-goals (for now)

- No live Claude API calls from the app. All AI work happens in Claude Code, which writes into the repo.
- No multi-user support, accounts or cloud sync. A single user's data lives in JSON files and IndexedDB.

---

## Architecture

```
[ PWA frontend ]  <-- import/export JSON -->  [ /data in repo ]  <-- scripts + Claude Code
  IndexedDB working copy                        collection.json      enrichment, identification
  Discogs lookups (token in settings)           queue/ (photos)
  barcode scan, label designer, PDF             cache/discogs/
```

The app handles:
- browsing, editing and review
- instant lookups: barcode search or Discogs ID via the Discogs API
- queuing unidentified records with photos
- label design and PDF output

The repo scripts handle deterministic bulk work: CSV import, Discogs enrichment, rekordbox/BPM imports.

Claude Code is used only for judgment steps:
- reading record photos
- fuzzy-matching tracks across sources
- resolving ambiguous pressings
- summarising what needs review

### Stack

- Vite + React + TypeScript, installable as a PWA (vite-plugin-pwa)
- IndexedDB via Dexie
- Barcode scanning with `@zxing/browser`
- PDF output with `pdf-lib`, QR codes with `qrcode`
- Optional in-browser OCR with `tesseract.js`
- Node scripts in `/scripts` (TypeScript, run with `tsx`)
- Optional Cloudflare Worker proxy for Discogs, needed if browser CORS blocks direct calls or the app is hosted publicly and the token shouldn't live in the client

### Discogs access

- Auth is a personal access token sent as `Authorization: Discogs token=<token>`, plus a descriptive `User-Agent` (e.g. `RecordLabeller/0.1`).
- Scripts read these from `.env`, which is gitignored and never committed:
  - `DISCOGS_TOKEN`
  - `DISCOGS_USERNAME`
  - `DISCOGS_USER_AGENT`
- The app reads the token from Settings and keeps it only in local storage. It is never written into `collection.json` or any exported file.
- OAuth, and a consumer key/secret, are only needed if other people use the app with their own accounts. That's out of scope.
- Optional alternative to CSV import: `/users/{username}/collection/folders/0/releases` returns the collection, including folder, rating, date added and custom field values, straight from the API.

### Data exchange rules

- `data/collection.json` is the interchange file, and both the app and the scripts read and write it.
- In dev, the app uses the File System Access API to get a handle to the repo's `/data` folder once, then reads `collection.json` on start and writes it directly on every change — no manual export step, so Claude Code's scripts always see current app state. This only works in Chromium-based browsers (Chrome/Edge); dev work should happen there.
- When hosted (or in a non-Chromium browser), the File System Access API isn't available, so import/export falls back to a file picker, and the user is responsible for keeping the exported file in sync with the repo if they also run scripts.
- Merges match on `id` (a stable local UUID), falling back to `discogsReleaseId`.
- Imports are idempotent, so re-importing never duplicates.
- Every record carries `updatedAt`. On conflict, the newer record wins per field, except that `locked` fields always win.

---

## Data schema

### Top level: `collection.json`

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-09-23T10:00:00Z",
  "records": [],
  "queue": [],
  "templates": []
}
```

### Provenance wrapper

Every enrichable field is stored in this shape, so the source of each value is known and manual edits survive re-enrichment:

```json
{ "value": 124, "source": "rekordbox", "confidence": "high", "locked": false }
```

`source` is one of `csv`, `discogs`, `discogs_inferred`, `rekordbox`, `audio_analysis`, `getsongbpm`, `claude`, `manual`.

`confidence` is one of `high`, `medium`, `low`.

**Precedence** (highest first): `manual` > `rekordbox` / `audio_analysis` > `getsongbpm` > `discogs` > `discogs_inferred` > `claude`.

Enrichment never overwrites a `locked` field or a field from a higher-precedence source. Editing a field manually in the app sets `source: manual, locked: true`.

### Record

```json
{
  "id": "uuid",
  "discogsReleaseId": 1234567,
  "status": "identified",
  "artist": "Artist Name",
  "title": "Release Title",
  "labels": [{ "name": "Label", "catno": "LBL001" }],
  "year": 1996,
  "country": "UK",
  "format": { "size": "12\"", "qty": 1, "descriptions": ["Single", "33 ⅓ RPM"] },
  "genres": ["Electronic"],
  "styles": ["Deep House"],
  "speed": { "value": 33, "source": "discogs", "confidence": "high", "locked": false },
  "tracks": [
    {
      "position": "A1",
      "side": "A",
      "title": "Track Title",
      "artists": null,
      "duration": "6:42",
      "speed": { "value": 45, "source": "discogs", "confidence": "high", "locked": false },
      "bpm": { "value": 122, "source": "rekordbox", "confidence": "high", "locked": false },
      "key": { "value": "Am", "source": "rekordbox", "confidence": "high", "locked": false }
    }
  ],
  "personal": {
    "mediaCondition": "VG+",
    "sleeveCondition": "VG",
    "location": "Crate 3",
    "discogsFolder": "Uncategorized",
    "rating": null,
    "tags": [],
    "notes": "",
    "dateAdded": "2019-05-01",
    "purchase": { "price": null, "currency": null, "store": null },
    "sold": { "price": null, "currency": null },
    "custom": {}
  },
  "images": { "coverThumb": "https://...", "photos": [] },
  "candidates": [],
  "updatedAt": "2026-09-23T10:00:00Z"
}
```

Field notes:
- `status` is one of `identified`, `needs_review`, `unidentified`.
- `speed` at record level is the default. `tracks[].speed` overrides it, because a single 12" can have a 33 side and a 45 side.
- `key` is stored in standard notation (`Am`, `F#`, `Ebm`). The app derives Camelot or Open Key for display according to a setting.
- `bpm` is a number, one decimal place allowed.
- `candidates` holds possible Discogs matches for review: `{ discogsReleaseId, title, catno, year, country, thumb, score, reason }`.
- Raw Discogs responses are cached in `data/cache/discogs/{releaseId}.json`, never inlined into the collection file.
- Discogs tracklist entries can be headings or index tracks with sub-tracks. Flatten sub-tracks into `tracks` and drop headings, but keep the heading text as a note if it's meaningful.

### Queue item (unidentified records)

```json
{
  "id": "uuid",
  "createdAt": "2026-09-23T10:00:00Z",
  "photos": ["queue/uuid-cover.jpg", "queue/uuid-label-a.jpg"],
  "barcodeAttempt": "5012345678900",
  "userHint": "white label, think it's on Strictly Rhythm",
  "status": "pending"
}
```

`status` is one of `pending`, `processed`, `failed`. When the item is processed, a record is created with `status: needs_review` (or `identified` if the match has high confidence) and linked by `queueItemId`.

### Label template

```json
{
  "id": "uuid",
  "name": "Sleeve sticker",
  "widthMm": 62,
  "heightMm": 29,
  "paddingMm": 2,
  "border": { "widthPt": 0.5, "radiusMm": 1 },
  "elements": [
    { "type": "trackTable", "xMm": 0, "yMm": 0, "wMm": 62, "hMm": 60,
      "columns": [
        { "field": "position", "sizePt": 14, "weight": 700 },
        { "field": "title", "sizePt": 10, "weight": 600, "overflow": "wrap", "maxLines": 2 },
        { "field": "duration", "sizePt": 7, "color": "#666666" },
        { "field": "bpm", "render": "badge", "fill": true, "sizePt": 9 },
        { "field": "key", "render": "badge", "fill": false, "sizePt": 9 }
      ],
      "maxRows": 8 },
    { "type": "text", "xMm": 0, "yMm": 62, "wMm": 62, "hMm": 5, "template": "{artist}",
      "font": "Inter", "sizePt": 11, "weight": 700, "align": "left", "overflow": "shrink" },
    { "type": "text", "xMm": 0, "yMm": 67, "wMm": 62, "hMm": 4, "template": "{title}",
      "sizePt": 9, "weight": 700 },
    { "type": "text", "xMm": 0, "yMm": 71, "wMm": 45, "hMm": 4, "template": "{labels[0].name}  {labels[0].catno}",
      "sizePt": 7 },
    { "type": "text", "xMm": 0, "yMm": 76, "wMm": 30, "hMm": 4, "template": "{year} · {genres[0]}",
      "sizePt": 7 },
    { "type": "qr", "xMm": 47, "yMm": 73, "wMm": 13, "hMm": 13, "template": "https://www.discogs.com/release/{discogsReleaseId}" }
  ],
  "print": {
    "mode": "sheet",
    "pageSize": "A4",
    "cols": 3, "rows": 8,
    "marginsMm": { "top": 10, "left": 7 },
    "gapMm": { "x": 2.5, "y": 0 },
    "startPosition": 1
  }
}
```

Template details:
- Element types are `text`, `trackTable`, `qr`, `image`, `line`, `rect`.
- `overflow` is one of `shrink`, `truncate`, `wrap`.
- `print.mode` is `single` (one label per page, for label printers) or `sheet`. Sticker sheets on a home inkjet/laser are the primary target, so `sheet` mode is the default; `single` (dedicated label printer) stays supported since the schema already models it.
- `startPosition` lets you reuse a partially used label sheet.
- Template strings bind to record fields, including derived ones: `{bpmRange}`, `{keysCamelot}`, `{speedSummary}` and `{side:A}` (tracks for one side).
- `trackTable` columns are objects, not bare field names, so BPM/key can render as pill-shaped badges (filled for BPM, outlined for key) rather than plain text — matching a hand-designed reference layout: big side/position letter, wrapped title, duration, BPM badge, key badge, one row per track. `position` uses the existing `A1`/`A2`/`B1`/`B2` numbering, not just the bare side letter.
- **Any column must render as blank/omitted, not an empty badge, when the underlying field has no value.** Since BPM/key enrichment will only cover a fraction of the collection (see `enrich-bpm-key` coverage note below), most tracklists will have rows with no BPM or key badge at all — this is the expected common case, not an edge case.
- Side-grouped tracklisting (a heading per side, tracks listed underneath) is a possible future layout but out of scope for now; a flat track list ordered by `position` is enough since the position already encodes the side.

---

## Input methods

1. **Discogs collection CSV** (script: `import-discogs-csv`). Accept both `.csv` and `.xlsx`.

   | Column | Maps to | Handling |
   |---|---|---|
   | `release_id` | `discogsReleaseId` | Primary key for merge |
   | `Catalog#` | `labels[].catno` (provisional) | `none` → null |
   | `Artist`, `Title` | `artist`, `title` (provisional) | API replaces with structured artists; keep `Various` as-is |
   | `Label` | `labels[].name` (provisional) | Comma-joined for multi-label (`C2Records, Columbia`), so don't split on commas; take structured labels from the API. Keep `Not On Label` as a real value, since it marks bootlegs and white labels. Discogs sometimes appends the artist, e.g. `Not On Label (Artist Self-released)`, so match on the prefix |
   | `Format` | `format` (provisional) | e.g. `12", Ltd, W/Lbl`: first token is size, the rest are descriptions. The export has no RPM, so speed always comes from the API |
   | `Rating` | `personal.rating` | Blank → null |
   | `Released` | `year` | `0` → null |
   | `CollectionFolder` | `personal.discogsFolder` | Also usable as a batch filter for printing |
   | `Date Added` | `personal.dateAdded` | ISO datetime in raw CSV; an Excel serial (e.g. `46276.09`) if the file was resaved via Excel, so handle both |
   | `Collection Media Condition` / `Sleeve Condition` | `personal.mediaCondition` / `sleeveCondition` | Normalise `Very Good Plus (VG+)` → `VG+`. Sleeve can also be `No Cover`, `Generic` or `Not Graded` |
   | `Collection Price`, `Currency`, `Store` | `personal.purchase` | Optional |
   | `Collection Sold Price`, `Sold Currency` | `personal.sold` | Optional |
   | `Collection Notes` | `personal.notes` | |
   | Any other `Collection <Name>` column | `personal.custom[<Name>]` | Discogs custom collection fields; pass through untouched |

   The export has no per-track data, speed or structured artists/labels. CSV values are provisional until `enrich-discogs` runs. Personal fields always come from the CSV and are never overwritten by enrichment.

   Prefer the raw Discogs CSV over an Excel-resaved copy: Excel can mangle catalogue numbers (leading zeros, values like `1-2` becoming dates).
2. **Discogs ID or URL** (in the app). Accept `1234567`, `r1234567` or `discogs.com/release/1234567-...`. Master URLs (`/master/...`) are not releases: show the master's versions and let the user pick one.
3. **Barcode scan** (in the app). Call Discogs search with `barcode=`. With several results, show a pressing picker with thumbnails.
4. **Photo to queue** (in the app). Take cover, label and spine photos and save them to the queue. The Claude Code `identify-queue` job resolves them.
5. **Manual entry** (in the app), for records not on Discogs.

## Enrichment jobs (in `/scripts`, run by Claude Code or directly)

### `enrich-discogs`
- Fetch `/releases/{id}` for every record missing a tracklist or with stale data, and cache the raw response.
- Rate-limit to at most 1 request per second and back off on 429. Send a descriptive User-Agent.
- Fill in the tracklist, format, genres, styles and cover thumbnail.
- Speed:
  - Parse `formats[].descriptions` for "33 ⅓ RPM", "45 RPM" and "78 RPM".
  - Check track-level and release notes for per-side speeds (e.g. "Side B plays at 45").
  - If neither gives a speed, infer from format: 7" gives 45; LP/album gives 33; a 12" single is ambiguous and gets low confidence. Mark inferred values `discogs_inferred` and flag the record `needs_review`.

### `enrich-bpm-key`
Sources, in order of precedence when both are available:
1. The user's DJ library export (rekordbox XML), fuzzy-matched on artist, title and mix name. Claude Code resolves ambiguous matches. **Coverage is small** — about 50 of ~2,000 records have a rekordbox match — so this covers a minority of the collection even once run.
2. GetSongBPM API (free key, requires attribution; check current terms). This is the practical primary source for most of the collection, so it's worth validating match quality early rather than treating it as a fallback.
3. Local audio analysis (e.g. essentia or librosa) if the user supplies rips.

Given the coverage gap, most records will simply have no BPM/key at all for a long time — the app and label templates must treat that as the normal case, not a loading/error state.

Rules:
- **Never invent BPM or key values.** Leave the field blank rather than guess.
- Matches below high confidence are flagged for review.
- Spotify's audio-features endpoint is not an option: it's deprecated for new apps.

### `identify-queue` (Claude Code, vision)
1. For each pending queue item, read the photos and extract catalogue number, label, artist, title, matrix/runout text if visible, and year hints.
2. Search Discogs using `catno`, `label`, `artist` and `release_title`.
3. Score the candidates. A high-confidence single match creates an `identified` record. Anything else creates a `needs_review` record with the top 3–5 candidates.

### Output of every job
- An updated `data/collection.json`.
- A short `data/reports/{job}-{timestamp}.md` listing what changed, what was skipped and what needs review.

---

## App screens

- **Collection:** search, plus filters for BPM range, key (with Camelot-compatible keys), speed, genre/style, location and status.
- **Record detail:** edit any field (which locks it) and see each field's source and confidence.
- **Add:** Discogs ID/URL, barcode scanner, photo-to-queue, manual entry.
- **Review:** records marked `needs_review`. Pick a pressing, confirm inferred speeds, accept or reject BPM/key matches.
- **Labels:** template editor with mm grid, snapping and live preview using a real record. Select records, generate PDF, and print a test page with alignment marks.
- **Settings:** Discogs token, key notation (musical/Camelot/Open Key), import/export, default template.

---

## Milestones

1. Data model, CSV import script, collection browser, JSON import/export.
2. `enrich-discogs` script, add by Discogs ID/URL in the app, review screen for speed.
3. Label designer and PDF output (single-label and sheet modes).
4. `enrich-bpm-key`, starting with whichever source the user has.
5. Barcode scanning, photo queue and the `identify-queue` workflow.
6. PWA install, hosting and optional Worker proxy.

## Decisions

- **Scanning device**: laptop/webcam, not phone. Barcode scanning and photo capture should be designed and tested against a desktop browser + webcam first.
- **Printer**: sticker sheets on a home inkjet/laser, not a dedicated label printer. `print.mode: "sheet"` is the primary path; `single` stays supported since the schema already models it, but isn't the near-term focus.
- **DJ library**: rekordbox, but only ~50 of ~2,000 records have an analysed match. See the coverage note under `enrich-bpm-key`.
- **Label BPM/key display**: per-track, not a per-side summary — position, title, duration, BPM badge, key badge per row, styled after a hand-designed reference (see the label template example above). Fields render blank when missing rather than showing an empty badge.

## Open questions

- Exact sticker sheet product/layout (brand, label size, cols/rows) — needed to finalize the default `print` block's `pageSize`, `cols`/`rows`, margins and gaps.
