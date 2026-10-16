import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { JapanEventSnapshot } from "./source";

type StoredEvent = { source_hash: string; revision: number; placement_count: number };
export type ImportResult = { runId: number; eventId: string; changed: boolean; revision: number };

export function normalizeJapanKey(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

function validate(snapshot: JapanEventSnapshot) {
  if (!/^\d+$/.test(snapshot.id) || snapshot.sourceUrl !== "https://www.limitlesstcg.com/tournaments/jp/" + snapshot.id) throw new Error("Invalid City League source identity.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.eventDate) || Number.isNaN(Date.parse(snapshot.eventDate + "T00:00:00Z"))) throw new Error("Invalid event date.");
  if (!snapshot.prefectureRaw.trim() || !snapshot.shopRaw.trim() || snapshot.placements.length === 0) throw new Error("Incomplete event snapshot.");
  const rows = new Set<number>();
  for (const placement of snapshot.placements) {
    if (!Number.isInteger(placement.sourceRow) || placement.sourceRow < 1 || rows.has(placement.sourceRow)) throw new Error("Duplicate or invalid source row.");
    if (!Number.isInteger(placement.placing) || placement.placing < 1 || !placement.playerNameRaw.trim()) throw new Error("Invalid placement.");
    rows.add(placement.sourceRow);
  }
}

function hash(snapshot: JapanEventSnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function displayName(sourceValue: string) {
  return sourceValue.split("+").filter(Boolean).map((name) => name.split("-").filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ")).join(" / ");
}

function resolveArchetype(db: Database.Database, sourceValue: string, now: string) {
  const alias = db.prepare("SELECT archetype_id AS id FROM jp_archetype_aliases WHERE source_value = ?").get(sourceValue) as { id: string } | undefined;
  if (alias) return alias.id;
  const id = normalizeJapanKey(sourceValue);
  if (!id) return null;
  db.prepare("INSERT INTO jp_archetypes (id, name, source_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
    .run(id, displayName(sourceValue), sourceValue, now, now);
  db.prepare("INSERT INTO jp_archetype_aliases (source_value, archetype_id) VALUES (?, ?) ON CONFLICT(source_value) DO NOTHING").run(sourceValue, id);
  return id;
}

export function setArchetypeAlias(db: Database.Database, sourceValue: string, archetypeId: string) {
  const archetype = db.prepare("SELECT id FROM jp_archetypes WHERE id = ?").get(archetypeId);
  if (!archetype) throw new Error("Canonical archetype does not exist.");
  db.prepare("INSERT INTO jp_archetype_aliases (source_value, archetype_id) VALUES (?, ?) ON CONFLICT(source_value) DO UPDATE SET archetype_id = excluded.archetype_id")
    .run(sourceValue, archetypeId);
  db.prepare("UPDATE jp_placements SET archetype_id = ? WHERE archetype_raw = ?").run(archetypeId, sourceValue);
}

export function importJapanEvent(db: Database.Database, snapshot: JapanEventSnapshot, options: { now?: string; allowReduction?: boolean; sourceKind?: "fixture" | "live" } = {}): ImportResult {
  validate(snapshot);
  const now = options.now ?? new Date().toISOString();
  const sourceHash = hash(snapshot);
  const run = db.prepare("INSERT INTO jp_ingestion_runs (source_kind, started_at, status) VALUES (?, ?, 'running')").run(options.sourceKind ?? "fixture", now);
  const runId = Number(run.lastInsertRowid);
  try {
    const result = db.transaction(() => {
      const existing = db.prepare("SELECT source_hash, revision, placement_count FROM jp_events WHERE id = ?").get(snapshot.id) as StoredEvent | undefined;
      if (existing && snapshot.placements.length < existing.placement_count && !options.allowReduction) {
        throw new Error("Placement count fell; review the source before replacing existing standings.");
      }
      if (existing?.source_hash === sourceHash) {
        db.prepare("UPDATE jp_events SET last_checked_at = ? WHERE id = ?").run(now, snapshot.id);
        return { runId, eventId: snapshot.id, changed: false, revision: existing.revision };
      }

      const revision = (existing?.revision ?? 0) + 1;
      const classified = snapshot.placements.filter((placement) => placement.archetypeRaw !== null).length;
      const classifiedTop8 = snapshot.placements.filter((placement) => placement.placing <= 8 && placement.archetypeRaw !== null).length;
      const decklists = snapshot.placements.filter((placement) => placement.decklistUrl !== null).length;
      const status = classified === snapshot.placements.length ? "complete" : "partial_classification";
      db.prepare(`INSERT INTO jp_events
        (id, source_url, event_date, prefecture_raw, prefecture_key, shop_raw, shop_key, known_player_count,
         placement_count, classified_placement_count, classified_top8_count, decklist_count, source_hash, revision,
         ingestion_status, first_discovered_at, last_checked_at, last_changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
         source_url=excluded.source_url, event_date=excluded.event_date, prefecture_raw=excluded.prefecture_raw,
         prefecture_key=excluded.prefecture_key, shop_raw=excluded.shop_raw, shop_key=excluded.shop_key,
         known_player_count=excluded.known_player_count, placement_count=excluded.placement_count,
         classified_placement_count=excluded.classified_placement_count, classified_top8_count=excluded.classified_top8_count,
         decklist_count=excluded.decklist_count, source_hash=excluded.source_hash, revision=excluded.revision,
         ingestion_status=excluded.ingestion_status, last_checked_at=excluded.last_checked_at, last_changed_at=excluded.last_changed_at`)
        .run(snapshot.id, snapshot.sourceUrl, snapshot.eventDate, snapshot.prefectureRaw, normalizeJapanKey(snapshot.prefectureRaw),
          snapshot.shopRaw, normalizeJapanKey(snapshot.shopRaw), snapshot.knownPlayerCount, snapshot.placements.length,
          classified, classifiedTop8, decklists, sourceHash, revision, status, now, now, now);

      db.prepare("DELETE FROM jp_decklists WHERE event_id = ?").run(snapshot.id);
      db.prepare("DELETE FROM jp_placements WHERE event_id = ?").run(snapshot.id);
      const addPlacement = db.prepare(`INSERT INTO jp_placements
        (event_id, source_row, placing, player_name_raw, player_url, archetype_raw, archetype_id, decklist_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      const addDecklist = db.prepare("INSERT INTO jp_decklists (event_id, source_row, source_url) VALUES (?, ?, ?)");
      for (const placement of snapshot.placements) {
        const archetypeId = placement.archetypeRaw ? resolveArchetype(db, placement.archetypeRaw, now) : null;
        addPlacement.run(snapshot.id, placement.sourceRow, placement.placing, placement.playerNameRaw, placement.playerUrl,
          placement.archetypeRaw, archetypeId, placement.decklistUrl);
        if (placement.decklistUrl) addDecklist.run(snapshot.id, placement.sourceRow, placement.decklistUrl);
      }
      db.prepare("INSERT INTO jp_event_revisions (event_id, revision, source_hash, observed_at, ingestion_run_id) VALUES (?, ?, ?, ?, ?)")
        .run(snapshot.id, revision, sourceHash, now, runId);
      return { runId, eventId: snapshot.id, changed: true, revision };
    })();
    db.prepare("UPDATE jp_ingestion_runs SET finished_at = ?, status = 'complete', checked_events = 1, changed_events = ? WHERE id = ?")
      .run(now, result.changed ? 1 : 0, runId);
    return result;
  } catch (error) {
    db.prepare("UPDATE jp_ingestion_runs SET finished_at = ?, status = 'failed', checked_events = 1, error = ? WHERE id = ?")
      .run(now, error instanceof Error ? error.message : "Unknown import error", runId);
    throw error;
  }
}
