// Local-only settings, per SPEC.md: the Discogs token lives only in
// localStorage, never in collection.json or any exported file.

const KEYS = {
  discogsToken: "recordLabeller.discogsToken",
  workerBaseUrl: "recordLabeller.workerBaseUrl",
} as const;

export function getDiscogsToken(): string {
  return localStorage.getItem(KEYS.discogsToken) ?? "";
}

export function setDiscogsToken(value: string): void {
  localStorage.setItem(KEYS.discogsToken, value);
}

export function getWorkerBaseUrl(): string {
  return localStorage.getItem(KEYS.workerBaseUrl) ?? "";
}

export function setWorkerBaseUrl(value: string): void {
  localStorage.setItem(KEYS.workerBaseUrl, value.replace(/\/+$/, ""));
}
