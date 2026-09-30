import Dexie, { type Table } from "dexie";
import { normalizeCollection } from "../types/schema";
import type { Collection } from "../types/schema";

const COLLECTION_FILENAME = "collection.json";

// Directory handles are structured-cloneable, so IndexedDB can persist them
// across reloads. Kept in a tiny separate DB from the record data itself.
interface StoredHandle {
  key: string;
  handle: FileSystemDirectoryHandle;
}
class HandleDB extends Dexie {
  handles!: Table<StoredHandle, string>;
  constructor() {
    super("record-labeller-handles");
    this.version(1).stores({ handles: "key" });
  }
}
const handleDb = new HandleDB();

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

/** Restores a previously chosen /data folder handle, if the user granted one before. */
export async function getStoredDataFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  const stored = await handleDb.handles.get("data");
  if (!stored) return null;
  const ok = await ensurePermission(stored.handle);
  return ok ? stored.handle : null;
}

/** Prompts the user to pick the repo's /data folder and remembers the choice. */
export async function chooseDataFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ id: "record-labeller-data", mode: "readwrite" });
  await handleDb.handles.put({ key: "data", handle });
  return handle;
}

export async function readCollectionFromFolder(dir: FileSystemDirectoryHandle): Promise<Collection | null> {
  try {
    const fileHandle = await dir.getFileHandle(COLLECTION_FILENAME);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return normalizeCollection(JSON.parse(text) as Collection);
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") return null;
    throw err;
  }
}

export async function writeCollectionToFolder(dir: FileSystemDirectoryHandle, collection: Collection): Promise<void> {
  const fileHandle = await dir.getFileHandle(COLLECTION_FILENAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify({ ...collection, exportedAt: new Date().toISOString() }, null, 2) + "\n");
  await writable.close();
}

/** Fallback for browsers without File System Access (or hosted deployments): manual export. */
export function downloadCollectionAsFile(collection: Collection): void {
  const blob = new Blob(
    [JSON.stringify({ ...collection, exportedAt: new Date().toISOString() }, null, 2) + "\n"],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = COLLECTION_FILENAME;
  a.click();
  URL.revokeObjectURL(url);
}

/** Fallback for manual import via a file picker input. */
export function readCollectionFromUpload(file: File): Promise<Collection> {
  return file.text().then((text) => normalizeCollection(JSON.parse(text) as Collection));
}
