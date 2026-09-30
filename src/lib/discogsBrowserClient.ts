import type { DiscogsReleaseResponse } from "./discogsMapping";
import { getDiscogsToken, getWorkerBaseUrl } from "./settings";

export class DiscogsConfigError extends Error {}
export class DiscogsNotFoundError extends Error {}

function requireConfig(): { token: string; baseUrl: string } {
  const token = getDiscogsToken();
  const baseUrl = getWorkerBaseUrl();
  if (!token) throw new DiscogsConfigError("No Discogs token set. Add one in Settings.");
  if (!baseUrl) throw new DiscogsConfigError("No proxy Worker URL set. Add one in Settings.");
  return { token, baseUrl };
}

export async function fetchReleaseFromBrowser(releaseId: number): Promise<DiscogsReleaseResponse> {
  const { token, baseUrl } = requireConfig();
  const res = await fetch(`${baseUrl}/releases/${releaseId}`, {
    headers: { Authorization: `Discogs token=${token}` },
  });
  if (res.status === 404) throw new DiscogsNotFoundError(`Release ${releaseId} not found on Discogs.`);
  if (!res.ok) throw new Error(`Discogs lookup failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export interface DiscogsMasterVersion {
  id: number;
  title: string;
  catno?: string;
  released?: string;
  country?: string;
  thumb?: string;
  format?: string;
}

export async function fetchMasterVersions(masterId: number): Promise<DiscogsMasterVersion[]> {
  const { token, baseUrl } = requireConfig();
  const res = await fetch(`${baseUrl}/masters/${masterId}/versions`, {
    headers: { Authorization: `Discogs token=${token}` },
  });
  if (!res.ok) throw new Error(`Discogs master lookup failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.versions ?? [];
}
