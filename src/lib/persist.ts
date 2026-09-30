import { exportCollectionFromDb } from "../db/dexie";
import { writeCollectionToFolder } from "./collectionSync";

let activeFolder: FileSystemDirectoryHandle | null = null;

export function setActiveFolder(folder: FileSystemDirectoryHandle | null): void {
  activeFolder = folder;
}

export function hasActiveFolder(): boolean {
  return activeFolder !== null;
}

/** Writes the current Dexie state back to collection.json in the connected data folder, if any. */
export async function persistCollection(): Promise<void> {
  if (!activeFolder) return;
  const collection = await exportCollectionFromDb();
  await writeCollectionToFolder(activeFolder, collection);
}
