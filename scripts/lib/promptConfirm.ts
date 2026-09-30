import { createInterface } from "node:readline/promises";

/**
 * Asks "overwrite this manually-edited field?" when run in a real terminal.
 * In a non-interactive context (background job, piped output, no TTY) there's
 * no one to ask, so it defaults to NOT overwriting — the safe choice, since
 * skipping is always recoverable (re-run with --overwrite-edits) but a
 * silent overwrite of a manual edit isn't.
 */
export async function confirmOverwrite(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${message} Overwrite? [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
