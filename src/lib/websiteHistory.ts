import type { WebsiteHistoryEntry } from "../api/emailApi";

export function mergeHistorySnapshot(
  current: ReadonlyMap<string, WebsiteHistoryEntry>,
  delta: { entries: WebsiteHistoryEntry[]; ids: string[] },
): Map<string, WebsiteHistoryEntry> {
  const changed = new Map(delta.entries.map((entry) => [entry.id, entry]));
  const next = new Map<string, WebsiteHistoryEntry>();
  for (const id of delta.ids) {
    const entry = changed.get(id) ?? current.get(id);
    if (!entry)
      throw new Error("History snapshot is incomplete. Refresh to reload it.");
    next.set(id, entry);
  }
  return next;
}
