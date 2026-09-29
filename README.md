# Record Labeller

A personal vinyl cataloguing and label-printing app. It imports a Discogs
collection export, enriches each release with tracklist, speed, BPM and
key data, and designs custom printable labels for physical records.

This is the public-facing repo for an otherwise private project — it
exists mainly to provide a public backlink for the services below, per
their attribution requirements. The actual app and collection data live
in a private repository.

## Stack

- Vite + React + TypeScript (PWA)
- IndexedDB (Dexie) as the local working copy
- Node/tsx scripts for batch enrichment jobs
- A small Cloudflare Worker proxy for in-app Discogs API calls

## Powered by

- [Discogs](https://www.discogs.com/) — release, tracklist, format and genre/style data
- [GetSongBPM](https://getsongbpm.com/) — BPM and musical key data
