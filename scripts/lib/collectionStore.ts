import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { emptyCollection, normalizeCollection } from "../../src/types/schema";
import type { Collection } from "../../src/types/schema";

export const COLLECTION_PATH = "data/collection.json";

export function loadCollection(path: string = COLLECTION_PATH): Collection {
  if (!existsSync(path)) return emptyCollection();
  const raw = readFileSync(path, "utf8");
  return normalizeCollection(JSON.parse(raw) as Collection);
}

export function saveCollection(collection: Collection, path: string = COLLECTION_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  collection.exportedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(collection, null, 2) + "\n", "utf8");
}

export function writeReport(jobName: string, contents: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `data/reports/${jobName}-${timestamp}.md`;
  mkdirSync("data/reports", { recursive: true });
  writeFileSync(path, contents, "utf8");
  return path;
}
