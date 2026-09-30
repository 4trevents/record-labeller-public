import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import type { DiscogsReleaseResponse } from "../../src/lib/discogsMapping";

const CACHE_DIR = "data/cache/discogs";
const MIN_INTERVAL_MS = 1000; // at most 1 request/second

export interface DiscogsConfig {
  token: string;
  userAgent: string;
}

export function loadDiscogsConfig(): DiscogsConfig {
  const token = process.env.DISCOGS_TOKEN;
  const userAgent = process.env.DISCOGS_USER_AGENT || "RecordLabeller/0.1";
  if (!token) {
    throw new Error(
      "DISCOGS_TOKEN is not set. Copy .env.example to .env and fill in your token from " +
        "https://www.discogs.com/settings/developers"
    );
  }
  return { token, userAgent };
}

let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

async function discogsFetch(config: DiscogsConfig, path: string): Promise<Response> {
  await throttle();
  const res = await fetch(`https://api.discogs.com${path}`, {
    headers: {
      Authorization: `Discogs token=${config.token}`,
      "User-Agent": config.userAgent,
    },
  });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? "5");
    console.warn(`Rate limited by Discogs, backing off ${retryAfter}s…`);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return discogsFetch(config, path);
  }
  return res;
}

export function cachePath(releaseId: number): string {
  return `${CACHE_DIR}/${releaseId}.json`;
}

export async function fetchRelease(
  config: DiscogsConfig,
  releaseId: number,
  opts: { useCache?: boolean } = {}
): Promise<DiscogsReleaseResponse> {
  const path = cachePath(releaseId);
  if (opts.useCache !== false && existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf8"));
  }

  const res = await discogsFetch(config, `/releases/${releaseId}`);
  if (!res.ok) {
    throw new Error(`Discogs /releases/${releaseId} failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as DiscogsReleaseResponse;

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");

  return data;
}
