import type Database from "better-sqlite3";
import { importJapanEvent, type ImportResult } from "./import";
import { nextRefreshDays } from "./refresh-policy";
import type { JapanListingEvent, JapanSource } from "./source";

type Existing = {
  last_checked_at: string;
  classified_top8_count: number;
  decklist_count: number;
  placement_count: number;
};

export function eventNeedsRefresh(db: Database.Database, event: JapanListingEvent, now = new Date().toISOString()) {
  const existing = db.prepare("SELECT last_checked_at, classified_top8_count, decklist_count, placement_count FROM jp_events WHERE id = ?").get(event.id) as Existing | undefined;
  if (!existing) return true;
  const incomplete = existing.placement_count < 8
    || existing.classified_top8_count < Math.min(8, existing.placement_count)
    || existing.decklist_count < existing.placement_count;
  const interval = nextRefreshDays(event.eventDate, now, incomplete);
  return interval !== null && Date.parse(now) - Date.parse(existing.last_checked_at) >= interval * 86_400_000;
}

export async function syncJapanSource(db: Database.Database, source: JapanSource, options: {
  now?: string;
  force?: boolean;
  maxEvents?: number;
  fromDate?: string;
  sourceKind?: "fixture" | "live";
} = {}): Promise<ImportResult[]> {
  const now = options.now ?? new Date().toISOString();
  const events = await source.listEvents();
  const due = events.filter((event) => (!options.fromDate || event.eventDate >= options.fromDate)
    && (options.force || eventNeedsRefresh(db, event, now))).slice(0, options.maxEvents ?? 10);
  const results: ImportResult[] = [];
  for (const event of due) {
    const snapshot = await source.getEvent(event);
    results.push(importJapanEvent(db, snapshot, { now, sourceKind: options.sourceKind }));
  }
  return results;
}
