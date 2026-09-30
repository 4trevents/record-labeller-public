# Record Labeller

A personal vinyl cataloguing and label-printing app. It imports a Discogs
collection export, enriches each release with tracklist, speed, BPM and
key data, and designs custom printable labels for physical records.

See [SPEC.md](./SPEC.md) for the full design spec.

This is a public snapshot of an actively-developed personal project — the
real collection data lives in a separate private repo and is never
published here. It exists partly to give a couple of API providers a
working public backlink per their attribution/signup requirements.

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
