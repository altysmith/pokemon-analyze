import type Database from "better-sqlite3";
import { displayName } from "./import";

type CountRow = { events: number; placements: number; top8: number; classified_top8: number; decklists: number; latest_date: string | null };
type EventRow = { id: string; event_date: string; placement_count: number; classified_top8_count: number; decklist_count: number };
type PlacementRow = {
  archetype_id: string;
  source_value: string;
  placing: number;
  decklist_url: string | null;
  event_date: string;
  event_id: string;
};

export type JapanSourceData = { events: EventRow[]; placements: PlacementRow[] };

export type JapanArchetypeSummary = {
  id: string;
  name: string;
  icons: string[];
  placementPoints: number;
  wins: number;
  top8: number;
  finishes: number;
  latestWinningListUrl: string | null;
  latestWinningDate: string | null;
};

export function placementPoints(placing: number) {
  if (placing === 1) return 8;
  if (placing === 2) return 6;
  if (placing <= 4) return 4;
  if (placing <= 8) return 2;
  if (placing <= 16) return 1;
  return 0;
}

export function japanDeckLabel(sourceValue: string) {
  return displayName(sourceValue).replaceAll("Kangaskhan Mega", "Mega Kanga");
}

export function japanSourceData(db: Database.Database): JapanSourceData {
  const events = db.prepare(`SELECT id, event_date, placement_count, classified_top8_count, decklist_count FROM jp_events`).all() as EventRow[];
  const placements = db.prepare(`SELECT p.archetype_id, a.source_value, p.placing, p.decklist_url,
    e.event_date, e.id AS event_id FROM jp_placements p
    JOIN jp_archetypes a ON a.id = p.archetype_id
    JOIN jp_events e ON e.id = p.event_id
    WHERE p.archetype_id IS NOT NULL`).all() as PlacementRow[];
  return { events, placements };
}

export function summarizeJapanData(data: JapanSourceData, range: { from: string | null; to: string | null } = { from: null, to: null }) {
  const events = data.events.filter((event) => (!range.from || event.event_date >= range.from) && (!range.to || event.event_date <= range.to));
  const eventIds = new Set(events.map((event) => event.id));
  const dates = events.map((event) => event.event_date).sort();
  const counts: CountRow & { first_date: string | null } = {
    events: events.length,
    placements: events.reduce((sum, event) => sum + event.placement_count, 0),
    top8: events.reduce((sum, event) => sum + Math.min(8, event.placement_count), 0),
    classified_top8: events.reduce((sum, event) => sum + event.classified_top8_count, 0),
    decklists: events.reduce((sum, event) => sum + event.decklist_count, 0),
    first_date: dates[0] ?? null,
    latest_date: dates.at(-1) ?? null,
  };
  const groups = new Map<string, JapanArchetypeSummary & { winningEventId: number }>();
  for (const row of data.placements) {
    if (!eventIds.has(row.event_id)) continue;
    let group = groups.get(row.archetype_id);
    if (!group) {
      group = {
        id: row.archetype_id, name: japanDeckLabel(row.source_value), icons: row.source_value.split("+").filter(Boolean), placementPoints: 0,
        wins: 0, top8: 0, finishes: 0, latestWinningListUrl: null,
        latestWinningDate: null, winningEventId: -1,
      };
      groups.set(row.archetype_id, group);
    }
    group.placementPoints += placementPoints(row.placing);
    group.finishes++;
    if (row.placing <= 8) group.top8++;
    if (row.placing === 1) {
      group.wins++;
      const eventId = Number(row.event_id);
      if (row.decklist_url && (!group.latestWinningDate || row.event_date > group.latestWinningDate
        || (row.event_date === group.latestWinningDate && eventId > group.winningEventId))) {
        group.latestWinningListUrl = row.decklist_url;
        group.latestWinningDate = row.event_date;
        group.winningEventId = eventId;
      }
    }
  }
  const archetypes: JapanArchetypeSummary[] = [...groups.values()].sort((a, b) =>
    b.placementPoints - a.placementPoints || b.wins - a.wins || b.top8 - a.top8 || a.name.localeCompare(b.name));
  return { counts, archetypes };
}

export function japanOverview(db: Database.Database, range: { from: string | null; to: string | null } = { from: null, to: null }) {
  return summarizeJapanData(japanSourceData(db), range);
}
