import type { CollectionRecord } from "../../src/types/schema";
import { confirmOverwrite } from "./promptConfirm";

/**
 * Applies an incoming value to a record field, unless that field was
 * manually edited in the app and differs from the incoming value — in
 * which case it prompts (interactive) or skips + logs (non-interactive/
 * --overwrite-edits not passed) rather than silently clobbering the edit.
 * On an approved/forced overwrite, the field's edited-flag is cleared,
 * since it's back in sync with the automated source.
 */
export async function guardedAssign(
  record: CollectionRecord,
  path: string,
  currentValue: unknown,
  incomingValue: unknown,
  apply: () => void,
  overwriteEdits: boolean,
  conflicts: string[]
): Promise<void> {
  if (JSON.stringify(currentValue) === JSON.stringify(incomingValue)) return;

  const isEdited = record.manuallyEditedFields.includes(path);
  if (isEdited && !overwriteEdits) {
    const allow = await confirmOverwrite(
      `${record.artist} - ${record.title}: "${path}" was manually edited ` +
        `(kept: ${JSON.stringify(currentValue)}, incoming: ${JSON.stringify(incomingValue)}).`
    );
    if (!allow) {
      conflicts.push(`${record.artist} - ${record.title}: kept manual "${path}" (incoming was ${JSON.stringify(incomingValue)})`);
      return;
    }
  }

  if (isEdited) {
    record.manuallyEditedFields = record.manuallyEditedFields.filter((p) => p !== path);
  }
  apply();
}
