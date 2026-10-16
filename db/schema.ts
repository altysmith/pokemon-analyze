import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Japan City League data is intentionally isolated from international season data.
export const jpEvents = sqliteTable("jp_events", {
  id: text("id").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  eventDate: text("event_date").notNull(),
  prefectureRaw: text("prefecture_raw").notNull(),
  prefectureKey: text("prefecture_key").notNull(),
  shopRaw: text("shop_raw").notNull(),
  shopKey: text("shop_key").notNull(),
  knownPlayerCount: integer("known_player_count"),
  placementCount: integer("placement_count").notNull().default(0),
  classifiedPlacementCount: integer("classified_placement_count").notNull().default(0),
  classifiedTop8Count: integer("classified_top8_count").notNull().default(0),
  decklistCount: integer("decklist_count").notNull().default(0),
  sourceHash: text("source_hash").notNull(),
  revision: integer("revision").notNull().default(1),
  ingestionStatus: text("ingestion_status").notNull().default("complete"),
  firstDiscoveredAt: text("first_discovered_at").notNull(),
  lastCheckedAt: text("last_checked_at").notNull(),
  lastChangedAt: text("last_changed_at").notNull(),
}, (table) => [
  uniqueIndex("jp_events_source_url_idx").on(table.sourceUrl),
  index("jp_events_date_idx").on(table.eventDate),
  index("jp_events_shop_idx").on(table.shopKey),
]);

export const jpArchetypes = sqliteTable("jp_archetypes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceValue: text("source_value").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const jpArchetypeAliases = sqliteTable("jp_archetype_aliases", {
  sourceValue: text("source_value").primaryKey(),
  archetypeId: text("archetype_id").notNull().references(() => jpArchetypes.id),
});

export const jpPlacements = sqliteTable("jp_placements", {
  eventId: text("event_id").notNull().references(() => jpEvents.id),
  sourceRow: integer("source_row").notNull(),
  placing: integer("placing").notNull(),
  playerNameRaw: text("player_name_raw").notNull(),
  playerUrl: text("player_url"),
  archetypeRaw: text("archetype_raw"),
  archetypeId: text("archetype_id").references(() => jpArchetypes.id),
  decklistUrl: text("decklist_url"),
}, (table) => [
  primaryKey({ columns: [table.eventId, table.sourceRow] }),
  index("jp_placements_archetype_idx").on(table.archetypeId),
  index("jp_placements_placing_idx").on(table.placing),
]);

export const jpDecklists = sqliteTable("jp_decklists", {
  eventId: text("event_id").notNull(),
  sourceRow: integer("source_row").notNull(),
  sourceUrl: text("source_url").notNull(),
  contentStatus: text("content_status").notNull().default("link_only"),
  lastCheckedAt: text("last_checked_at"),
}, (table) => [
  primaryKey({ columns: [table.eventId, table.sourceRow] }),
  index("jp_decklists_url_idx").on(table.sourceUrl),
]);

export const jpExpansions = sqliteTable("jp_expansions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  japaneseReleaseDate: text("japanese_release_date").notNull(),
  internationalReleaseDate: text("international_release_date"),
  formatId: text("format_id"),
  legalityNotes: text("legality_notes"),
  sourceUrl: text("source_url").notNull(),
}, (table) => [index("jp_expansions_release_idx").on(table.japaneseReleaseDate)]);

export const jpIngestionRuns = sqliteTable("jp_ingestion_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceKind: text("source_kind").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(),
  checkedEvents: integer("checked_events").notNull().default(0),
  changedEvents: integer("changed_events").notNull().default(0),
  error: text("error"),
});

export const jpEventRevisions = sqliteTable("jp_event_revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: text("event_id").notNull().references(() => jpEvents.id),
  revision: integer("revision").notNull(),
  sourceHash: text("source_hash").notNull(),
  observedAt: text("observed_at").notNull(),
  ingestionRunId: integer("ingestion_run_id").notNull().references(() => jpIngestionRuns.id),
}, (table) => [uniqueIndex("jp_event_revisions_event_revision_idx").on(table.eventId, table.revision)]);
