import type { Entry } from "./model";

export interface DeletedEntry {
  entry: Entry;
  index: number;
  recentIndex: number;
}

export function restoreEntry(entries: Entry[], deleted: DeletedEntry): Entry[] {
  if (entries.some((entry) => entry.id === deleted.entry.id)) return entries;
  const next = [...entries];
  next.splice(Math.min(deleted.index, next.length), 0, deleted.entry);
  return next;
}

export function restoreRecent(
  recent: number[],
  deleted: DeletedEntry,
): number[] {
  if (deleted.recentIndex < 0 || recent.includes(deleted.entry.id))
    return recent;
  const next = [...recent];
  next.splice(Math.min(deleted.recentIndex, next.length), 0, deleted.entry.id);
  return next.slice(0, 6);
}
