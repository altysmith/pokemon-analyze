import { fetchHtml } from "./http";
import { LABS_BASE } from "./labs";
import { readSeasonEvents } from "./season-store";
import type { SeasonEvent } from "./season-catalog";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Geography = "all" | "us" | "europe" | "south-america" | "oceania" | "other";
export type RecordCounts = { wins: number; losses: number; ties: number };
export type EventDeck = {
  slug: string;
  name: string;
  icons: string[];
  players: number;
  share: number;
  record: RecordCounts;
  winRate: number;
  day1: number | null;
  day2: number | null;
  conversion: number | null;
};
export type Regional = SeasonEvent;
export type RegionalData = Regional & { decks: EventDeck[]; playerTotal: number };
export type MetaDeck = {
  slug: string;
  name: string;
  icons: string[];
  players: number;
  share: number;
  record: RecordCounts;
  winRate: number;
  day1: number;
  day2: number;
  conversion: number | null;
  events: number;
};
export type Matchup = {
  slug: string;
  name: string;
  icons: string[];
  record: RecordCounts;
  matches: number;
  winRate: number;
  category: "favorable" | "neutral" | "unfavorable";
};

export const getSeasonEvents = readSeasonEvents;

const TTL = 30 * 60 * 1000;
const MAX_STALE = 24 * 60 * 60 * 1000;
const cached = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();

function cachePath(key: string) {
  const dir = process.env.SEASON_CACHE_DIR;
  return dir ? join(dir, `${createHash("sha256").update(`v1:${key}`).digest("hex")}.json`) : null;
}

async function readDiskCache<T>(key: string): Promise<{ savedAt: number; value: T } | null> {
  const path = cachePath(key);
  if (!path) return null;
  try {
    const entry: unknown = JSON.parse(await readFile(path, "utf8"));
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      if (typeof record.savedAt === "number" && Number.isFinite(record.savedAt)
        && record.savedAt <= Date.now() && Date.now() - record.savedAt < MAX_STALE && "value" in record) {
        return { savedAt: record.savedAt, value: record.value as T };
      }
    }
  } catch {
    // A missing or corrupt cache entry can be rebuilt from Limitless.
  }
  return null;
}

async function writeDiskCache<T>(key: string, value: T) {
  const path = cachePath(key);
  if (!path) return;
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(process.env.SEASON_CACHE_DIR!, { recursive: true });
    await writeFile(temporary, JSON.stringify({ savedAt: Date.now(), value }));
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    console.warn(`[season cache] Could not save ${key}: ${error instanceof Error ? error.message : error}`);
  }
}

async function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cached.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight as Promise<T>;
  const disk = await readDiskCache<T>(key);
  const afterRead = pending.get(key);
  if (afterRead) return disk ? disk.value : afterRead as Promise<T>;
  if (disk) {
    cached.set(key, { expires: disk.savedAt + TTL > Date.now() ? disk.savedAt + TTL : Date.now() + 60_000, value: disk.value });
    if (disk.savedAt + TTL > Date.now()) return disk.value;
  }
  const task = load().then(async (value) => {
    cached.set(key, { expires: Date.now() + TTL, value });
    await writeDiskCache(key, value);
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  if (disk) {
    void task.catch(() => {});
    return disk.value;
  }
  return task;
}

function decode(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&nbsp;/g, " ");
}

function plain(value: string) {
  return decode(value.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function rows(html: string) {
  const table = html.match(/<table\b[\s\S]*?<\/table>/i)?.[0] ?? "";
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) => [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]))
    .filter((cells) => cells.length > 0);
}

function number(value: string) {
  return Number(plain(value).replace(/,/g, ""));
}

function percent(value: string) {
  return Number(plain(value).replace("%", "")) / 100;
}

function record(value: string): RecordCounts | null {
  const match = plain(value).match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
  return match ? { wins: Number(match[1]), losses: Number(match[2]), ties: Number(match[3]) } : null;
}

function deckLink(value: string) {
  const match = value.match(/href="\/\d+\/decks\/([^"/?]+)(?:\/matchups)?"[^>]*>([\s\S]*?)<\/a>/i);
  return match ? { slug: match[1], name: plain(match[2]) } : null;
}

function deckIcons(value: string) {
  return [...value.matchAll(/<img\b[^>]*\balt="([a-z0-9-]+)"[^>]*>/gi)].map((match) => match[1].toLowerCase());
}

function parseEventDecks(html: string): EventDeck[] {
  return rows(html).flatMap((cells) => {
    if (cells.length < 6) return [];
    const deck = deckLink(cells[2]);
    const counts = record(cells[4]);
    const players = number(cells[1]);
    const share = percent(cells[3]);
    if (!deck || !counts || !Number.isFinite(players) || !Number.isFinite(share)) return [];
    return [{ ...deck, icons: deckIcons(cells[0]), players, share, record: counts, winRate: winRate(counts), day1: null, day2: null, conversion: null }];
  });
}

function parseConversion(html: string) {
  const values = new Map<string, { day1: number; day2: number; conversion: number }>();
  for (const cells of rows(html)) {
    if (cells.length < 5) continue;
    const deck = deckLink(cells[1]);
    const day1 = number(cells[2]);
    const day2 = number(cells[3]);
    if (deck && Number.isFinite(day1) && Number.isFinite(day2)) {
      values.set(deck.slug, { day1, day2, conversion: day1 ? day2 / day1 : 0 });
    }
  }
  return values;
}

export function winRate(counts: RecordCounts) {
  const total = counts.wins + counts.losses + counts.ties;
  return total ? (counts.wins + counts.ties / 3) / total : 0;
}

export function matches(counts: RecordCounts) {
  return counts.wins + counts.losses + counts.ties;
}

function addRecord(target: RecordCounts, source: RecordCounts) {
  target.wins += source.wins;
  target.losses += source.losses;
  target.ties += source.ties;
}

export async function getRegionalData(event: Regional): Promise<RegionalData> {
  return memo(`event:${event.id}`, async () => {
    const base = `${LABS_BASE}/${event.id}/decks`;
    const [decksHtml, conversionHtml] = await Promise.all([
      fetchHtml(base), fetchHtml(`${base}?conversion=`),
    ]);
    const decks = parseEventDecks(decksHtml);
    if (decks.length === 0) throw new Error(`No deck rows found for ${event.shortName}.`);
    const conversions = parseConversion(conversionHtml);
    for (const deck of decks) {
      const conversion = conversions.get(deck.slug);
      if (conversion) Object.assign(deck, conversion);
    }
    return { ...event, decks, playerTotal: decks.reduce((sum, deck) => sum + deck.players, 0) };
  });
}

export async function getSeasonData() {
  return Promise.all((await getSeasonEvents()).map(getRegionalData));
}

export function aggregateMeta(events: RegionalData[]): MetaDeck[] {
  const totalPlayers = events.reduce((sum, event) => sum + event.playerTotal, 0);
  const map = new Map<string, MetaDeck>();
  for (const event of events) {
    for (const deck of event.decks) {
      const item = map.get(deck.slug) ?? {
        slug: deck.slug, name: deck.name, icons: deck.icons, players: 0, share: 0,
        record: { wins: 0, losses: 0, ties: 0 }, winRate: 0,
        day1: 0, day2: 0, conversion: null, events: 0,
      };
      item.players += deck.players;
      if (!item.icons.length && deck.icons.length) item.icons = deck.icons;
      addRecord(item.record, deck.record);
      item.day1 += deck.day1 ?? 0;
      item.day2 += deck.day2 ?? 0;
      item.events += 1;
      map.set(deck.slug, item);
    }
  }
  return [...map.values()].map((deck) => ({
    ...deck,
    share: totalPlayers ? deck.players / totalPlayers : 0,
    winRate: winRate(deck.record),
    conversion: deck.day1 ? deck.day2 / deck.day1 : null,
  })).sort((a, b) => b.players - a.players);
}

function parseMatchups(html: string) {
  return rows(html).flatMap((cells) => {
    if (cells.length < 5) return [];
    const deck = deckLink(cells[1]);
    const counts = record(cells[3]);
    return deck && counts ? [{ ...deck, icons: deckIcons(cells[0]), record: counts }] : [];
  });
}

export async function getAggregatedMatchups(events: RegionalData[], slug: string, opponentSlugs: string[]): Promise<Matchup[]> {
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) throw new Error("Invalid deck slug.");
  const relevant = events.filter((event) => event.decks.some((deck) => deck.slug === slug));
  const sourceRows = await Promise.all(relevant.map((event) => memo(`matchups:${event.id}:${slug}`, async () =>
    parseMatchups(await fetchHtml(`${LABS_BASE}/${event.id}/decks/${slug}/matchups`))
  )));
  const allowed = new Set(opponentSlugs);
  const map = new Map<string, { name: string; icons: string[]; record: RecordCounts }>();
  for (const eventRows of sourceRows) {
    for (const row of eventRows) {
      if (row.slug === slug || !allowed.has(row.slug)) continue;
      const item = map.get(row.slug) ?? { name: row.name, icons: row.icons, record: { wins: 0, losses: 0, ties: 0 } };
      if (!item.icons.length && row.icons.length) item.icons = row.icons;
      addRecord(item.record, row.record);
      map.set(row.slug, item);
    }
  }
  return [...map.entries()].map(([opponentSlug, value]) => {
    const rate = winRate(value.record);
    return {
      slug: opponentSlug, name: value.name, icons: value.icons, record: value.record,
      matches: matches(value.record), winRate: rate,
      category: rate >= 0.55 ? "favorable" as const : rate <= 0.45 ? "unfavorable" as const : "neutral" as const,
    };
  }).sort((a, b) => b.matches - a.matches);
}
