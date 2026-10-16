import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { openJapanDb } from "../../db/japan";
import { FixtureJapanSource } from "./fixture-source";
import { resolveJapanDateRange } from "./date-range";
import { displayName, importJapanEvent, setArchetypeAlias } from "./import";
import { japanDeckLabel, japanOverview, japanSourceData, placementPoints, summarizeJapanData } from "./overview";
import { parseCityLeagueEvent, parseCityLeagueIndex } from "./parse";
import { nextRefreshDays } from "./refresh-policy";
import { eventNeedsRefresh, syncJapanSource } from "./sync";
import type { JapanEventSnapshot } from "./source";

const fixture = (name: string) => readFileSync(path.resolve("test/fixtures/japan", name), "utf8");
const listing = parseCityLeagueIndex(fixture("index.html"))[0];
const snapshot = () => parseCityLeagueEvent(fixture("event.html"), listing);

test("abbreviates Kangaskhan while preserving both Pokemon in each deck label", () => {
  assert.equal(japanDeckLabel("kangaskhan-mega+rayquaza-mega"), "Mega Kanga / Rayquaza Mega");
  assert.equal(japanDeckLabel("rayquaza-mega+kangaskhan-mega"), "Rayquaza Mega / Mega Kanga");
  assert.equal(japanDeckLabel("kangaskhan-mega+slowking"), "Mega Kanga / Slowking");
  assert.equal(japanDeckLabel("slowking+kangaskhan-mega"), "Slowking / Mega Kanga");
  assert.equal(japanDeckLabel("dragapult+rayquaza-mega"), "Dragapult / Rayquaza Mega");
});

test("parses source identity, original values, missing data, and icon identifiers", () => {
  assert.equal(listing.id, "5062");
  const event = snapshot();
  assert.equal(event.prefectureRaw, "Ōsaka");
  assert.equal(event.knownPlayerCount, null);
  assert.equal(event.placements.length, 3);
  assert.equal(event.placements[0].archetypeRaw, "dragapult");
  assert.equal(event.placements[0].decklistUrl, "https://www.limitlesstcg.com/decks/list/jp/75520");
  assert.equal(event.placements[1].archetypeRaw, "hydrapple+ogerpon");
  assert.equal(event.placements[1].decklistUrl, null);
  assert.equal(event.placements[2].archetypeRaw, null);
});

test("idempotent import updates changed standings and records coverage separately", () => {
  const db = openJapanDb(":memory:");
  try {
    const first = importJapanEvent(db, snapshot(), { now: "2026-10-14T00:00:00.000Z" });
    const repeat = importJapanEvent(db, snapshot(), { now: "2026-10-14T01:00:00.000Z" });
    assert.equal(first.changed, true);
    assert.equal(repeat.changed, false);
    assert.equal(repeat.revision, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM jp_placements").get() as { n: number }).n, 3);
    const coverage = db.prepare("SELECT placement_count, classified_placement_count, classified_top8_count, decklist_count, known_player_count FROM jp_events").get() as Record<string, number | null>;
    assert.deepEqual(coverage, { placement_count: 3, classified_placement_count: 2, classified_top8_count: 2, decklist_count: 1, known_player_count: null });
    const updated: JapanEventSnapshot = snapshot();
    updated.placements[2].archetypeRaw = "dragapult";
    updated.placements.push({ sourceRow: 4, placing: 4, playerNameRaw: "New player", playerUrl: null, archetypeRaw: null, decklistUrl: null });
    const next = importJapanEvent(db, updated, { now: "2026-10-15T00:00:00.000Z" });
    assert.equal(next.revision, 2);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM jp_event_revisions").get() as { n: number }).n, 2);
    assert.equal((db.prepare("SELECT classified_placement_count AS n FROM jp_events").get() as { n: number }).n, 3);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM jp_decklists").get() as { n: number }).n, 1);
  } finally {
    db.close();
  }
});

test("archetype aliases update placements without changing original source values", () => {
  const db = openJapanDb(":memory:");
  try {
    importJapanEvent(db, snapshot());
    setArchetypeAlias(db, "hydrapple+ogerpon", "dragapult");
    const row = db.prepare("SELECT archetype_raw, archetype_id FROM jp_placements WHERE source_row = 2").get();
    assert.deepEqual(row, { archetype_raw: "hydrapple+ogerpon", archetype_id: "dragapult" });
  } finally {
    db.close();
  }
});

test("reduced or invalid standings cannot erase previously imported placements", () => {
  const db = openJapanDb(":memory:");
  try {
    importJapanEvent(db, snapshot());
    const reduced = snapshot();
    reduced.placements.pop();
    assert.throws(() => importJapanEvent(db, reduced), /Placement count fell/);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM jp_placements").get() as { n: number }).n, 3);
    assert.equal((db.prepare("SELECT status FROM jp_ingestion_runs ORDER BY id DESC LIMIT 1").get() as { status: string }).status, "failed");
  } finally {
    db.close();
  }
});

test("fixture source refreshes an incomplete event on schedule", async () => {
  const db = openJapanDb(":memory:");
  try {
    const source = new FixtureJapanSource(fixture("index.html"), new Map([["5062", fixture("event.html")]]));
    const first = await syncJapanSource(db, source, { now: "2026-10-14T00:00:00.000Z" });
    assert.equal(first.length, 1);
    assert.equal(eventNeedsRefresh(db, listing, "2026-10-14T12:00:00.000Z"), false);
    const second = await syncJapanSource(db, source, { now: "2026-10-15T00:00:00.000Z" });
    assert.equal(second.length, 1);
    assert.equal(second[0].changed, false);
    assert.equal(nextRefreshDays("2026-09-01", "2026-10-14T00:00:00.000Z", false), null);
  } finally {
    db.close();
  }
});

test("sync excludes events before the requested start date", async () => {
  const db = openJapanDb(":memory:");
  try {
    const source = new FixtureJapanSource(fixture("index.html"), new Map([["5062", fixture("event.html")]]));
    const excluded = await syncJapanSource(db, source, { fromDate: "2026-10-14" });
    assert.equal(excluded.length, 0);
    const included = await syncJapanSource(db, source, { fromDate: "2026-10-13" });
    assert.equal(included.length, 1);
  } finally {
    db.close();
  }
});

test("overview uses classified Top 8 as its share denominator", () => {
  assert.equal(displayName("kangaskhan-mega+dragapult"), "Kangaskhan Mega / Dragapult");
  assert.deepEqual([1, 2, 3, 4, 5, 8, 9, 16, 17].map(placementPoints), [8, 6, 4, 4, 2, 2, 1, 1, 0]);
  const db = openJapanDb(":memory:");
  try {
    importJapanEvent(db, snapshot(), { sourceKind: "live" });
    const overview = japanOverview(db);
    assert.equal(overview.counts.events, 1);
    assert.equal(overview.counts.top8, 3);
    assert.equal(overview.counts.classified_top8, 2);
    assert.equal(overview.archetypes.reduce((sum, row) => sum + row.top8, 0), 2);
    assert.equal((db.prepare("SELECT source_kind FROM jp_ingestion_runs").get() as { source_kind: string }).source_kind, "live");
  } finally {
    db.close();
  }
});

test("a newer second place boosts rank without replacing the latest winning list", () => {
  const db = openJapanDb(":memory:");
  try {
    importJapanEvent(db, snapshot());
    const later = snapshot();
    later.id = "6000";
    later.sourceUrl = "https://www.limitlesstcg.com/tournaments/jp/6000";
    later.eventDate = "2026-10-15";
    later.placements[0].archetypeRaw = "hydrapple+ogerpon";
    later.placements[0].decklistUrl = "https://www.limitlesstcg.com/decks/list/jp/80000";
    later.placements[1].archetypeRaw = "dragapult";
    later.placements[1].decklistUrl = "https://www.limitlesstcg.com/decks/list/jp/80001";
    importJapanEvent(db, later);
    let dragapult = japanOverview(db).archetypes.find((deck) => deck.id === "dragapult")!;
    assert.equal(dragapult.placementPoints, 14);
    assert.equal(dragapult.latestWinningListUrl, "https://www.limitlesstcg.com/decks/list/jp/75520");

    const newest = snapshot();
    newest.id = "6001";
    newest.sourceUrl = "https://www.limitlesstcg.com/tournaments/jp/6001";
    newest.eventDate = "2026-10-16";
    newest.placements[0].decklistUrl = "https://www.limitlesstcg.com/decks/list/jp/80002";
    importJapanEvent(db, newest);
    dragapult = japanOverview(db).archetypes.find((deck) => deck.id === "dragapult")!;
    assert.equal(dragapult.latestWinningListUrl, "https://www.limitlesstcg.com/decks/list/jp/80002");
  } finally {
    db.close();
  }
});

test("date ranges default to one month and filter every ranking input", () => {
  const now = new Date("2026-10-15T02:00:00Z"); // Still October 14 in New York.
  assert.deepEqual(resolveJapanDateRange({}, now), { key: "30d", label: "Last 30 days", from: "2026-09-15", to: "2026-10-14" });
  assert.equal(resolveJapanDateRange({ range: "custom", from: "2026-02-30", to: "2026-10-14" }, now).key, "30d");
  const db = openJapanDb(":memory:");
  try {
    importJapanEvent(db, snapshot());
    const later = snapshot();
    later.id = "6002";
    later.sourceUrl = "https://www.limitlesstcg.com/tournaments/jp/6002";
    later.eventDate = "2026-10-16";
    later.placements[0].decklistUrl = "https://www.limitlesstcg.com/decks/list/jp/80003";
    importJapanEvent(db, later);
    const data = japanSourceData(db);
    const october13 = summarizeJapanData(data, { from: "2026-10-13", to: "2026-10-13" });
    assert.equal(october13.counts.events, 1);
    assert.equal(october13.counts.classified_top8, 2);
    assert.equal(october13.archetypes.find((deck) => deck.id === "dragapult")?.latestWinningListUrl, "https://www.limitlesstcg.com/decks/list/jp/75520");
    const october16 = summarizeJapanData(data, { from: "2026-10-16", to: "2026-10-16" });
    assert.equal(october16.counts.events, 1);
    assert.equal(october16.archetypes.find((deck) => deck.id === "dragapult")?.latestWinningListUrl, "https://www.limitlesstcg.com/decks/list/jp/80003");
  } finally {
    db.close();
  }
});
