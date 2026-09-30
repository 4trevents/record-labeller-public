# Record Labeller

Personal project I am working on - record-labeller app, because the one that my friends use is iOS only!

App functions:
- scan a record via img upload or take a photo from the app
- import record collection from Discogs
- match it to Discogs API and pull extended info: tracklist, duration, style
- match it to your Rekordbox library export and find the best possible track matches to pull BPM and Key

WIP for tracks that need further lookup:
- use getsongbpm API to pull matching BPM and Key
- other ways to add, such as scan barcode or input catalogue num or discogs ID

See [SPEC.md](./SPEC.md) for the full design spec.

This is a public snapshot of an actively-developed personal project — the
real collection data lives in a separate private repo and is never
published here.

## Stack

- Vite + React + TypeScript (PWA)
- IndexedDB (Dexie) as the local working copy
- Node/tsx scripts for batch enrichment jobs (`enrich-discogs`,
  `enrich-bpm-key`, `import-discogs-csv`)
- A small Cloudflare Worker proxy for in-app Discogs API calls (browsers
  can't set the custom User-Agent header Discogs asks for)

## Powered by

- [Discogs](https://www.discogs.com/) — release, tracklist, format and genre/style data
- [GetSongBPM](https://getsongbpm.com/) — BPM and musical key data

## License

MIT — see [LICENSE](./LICENSE).
