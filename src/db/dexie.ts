import Dexie, { type Table } from "dexie";
import { emptyCollection } from "../types/schema";
import type { CollectionRecord, QueueItem, LabelTemplate, Collection } from "../types/schema";

class RecordLabellerDB extends Dexie {
  records!: Table<CollectionRecord, string>;
  queue!: Table<QueueItem, string>;
  templates!: Table<LabelTemplate, string>;

  constructor() {
    super("record-labeller");
    this.version(1).stores({
      records: "id, discogsReleaseId, status, artist, title",
      queue: "id, status",
      templates: "id, name",
    });
  }
}

export const db = new RecordLabellerDB();

export async function loadCollectionIntoDb(collection: Collection): Promise<void> {
  await db.transaction("rw", db.records, db.queue, db.templates, async () => {
    await db.records.clear();
    await db.queue.clear();
    await db.templates.clear();
    await db.records.bulkPut(collection.records);
    await db.queue.bulkPut(collection.queue);
    await db.templates.bulkPut(collection.templates);
  });
}

export async function exportCollectionFromDb(): Promise<Collection> {
  const [records, queue, templates] = await Promise.all([
    db.records.toArray(),
    db.queue.toArray(),
    db.templates.toArray(),
  ]);
  return { ...emptyCollection(), records, queue, templates };
}
