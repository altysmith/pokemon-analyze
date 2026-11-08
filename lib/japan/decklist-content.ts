import type Database from "better-sqlite3";

export type JapanDeckCard = { section: "Pokémon" | "Trainer" | "Energy"; quantity: number; name: string; setCode: string; cardNumber: string };
const SOURCE_URL = /^https:\/\/www\.limitlesstcg\.com\/decks\/list\/jp\/\d+$/;

function decode(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|nbsp|lt|gt|#039);/gi, (match, entity: string) => {
    const known: Record<string, string> = { amp: "&", quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">", "#039": "'" };
    const key = entity.toLowerCase();
    if (key in known) return known[key];
    if (key.startsWith("#")) {
      const codepoint = key.startsWith("#x") ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
      if (Number.isInteger(codepoint) && codepoint > 0 && codepoint <= 0x10ffff) return String.fromCodePoint(codepoint);
    }
    return match;
  });
}

export function parseJapanDecklist(html: string): JapanDeckCard[] {
  const content = html.split('<div class="decklist-main">')[1]?.split('<div class="decklist-bottom">')[0] ?? "";
  const cards: JapanDeckCard[] = [];
  let section: JapanDeckCard["section"] | null = null;
  const token = /<div class="decklist-column-heading">([^<]+)<\/div>|<div class="decklist-card"([^>]*)>([\s\S]*?)<\/div>/g;
  for (const match of content.matchAll(token)) {
    if (match[1]) {
      const heading = decode(match[1]).trim();
      section = heading.startsWith("Pokémon") ? "Pokémon" : heading.startsWith("Trainer") ? "Trainer" : heading.startsWith("Energy") ? "Energy" : null;
      continue;
    }
    if (!section) continue;
    const attributes = match[2];
    const body = match[3];
    const quantity = Number(body.match(/<span class="card-count">(\d+)<\/span>/)?.[1]);
    const name = decode(body.match(/<span class="card-name">([\s\S]*?)<\/span>/)?.[1] ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const setCode = decode(attributes.match(/data-set="([^"]+)"/)?.[1] ?? "");
    const cardNumber = decode(attributes.match(/data-number="([^"]+)"/)?.[1] ?? "");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 60 || !name || !setCode || !cardNumber) throw new Error("Invalid City League deck card.");
    cards.push({ section, quantity, name, setCode, cardNumber });
  }
  if (!cards.length || cards.reduce((sum, card) => sum + card.quantity, 0) !== 60) throw new Error("City League decklist was missing or incomplete.");
  return cards;
}

export function storedJapanDecklist(db: Database.Database, sourceUrl: string): JapanDeckCard[] | null {
  const status = db.prepare("SELECT status FROM jp_decklist_content WHERE source_url = ?").get(sourceUrl) as { status: string } | undefined;
  if (status?.status !== "complete") return null;
  return db.prepare("SELECT section, quantity, name, set_code AS setCode, card_number AS cardNumber FROM jp_decklist_cards WHERE source_url = ? ORDER BY position").all(sourceUrl) as JapanDeckCard[];
}

export function storeJapanDecklist(db: Database.Database, sourceUrl: string, cards: JapanDeckCard[], now = new Date().toISOString()) {
  if (!SOURCE_URL.test(sourceUrl) || cards.reduce((sum, card) => sum + card.quantity, 0) !== 60) throw new Error("Invalid City League decklist.");
  db.transaction(() => {
    db.prepare("INSERT INTO jp_decklist_content (source_url, status, last_checked_at) VALUES (?, 'complete', ?) ON CONFLICT(source_url) DO UPDATE SET status = excluded.status, last_checked_at = excluded.last_checked_at").run(sourceUrl, now);
    db.prepare("DELETE FROM jp_decklist_cards WHERE source_url = ?").run(sourceUrl);
    const insert = db.prepare("INSERT INTO jp_decklist_cards (source_url, position, section, quantity, name, set_code, card_number) VALUES (?, ?, ?, ?, ?, ?, ?)");
    cards.forEach((card, index) => insert.run(sourceUrl, index, card.section, card.quantity, card.name, card.setCode, card.cardNumber));
  })();
}

export async function fetchJapanDecklist(sourceUrl: string): Promise<JapanDeckCard[]> {
  if (!SOURCE_URL.test(sourceUrl)) throw new Error("Unexpected City League decklist URL.");
  const response = await fetch(sourceUrl, {
    headers: { "User-Agent": "LoMeta/0.1 (personal City League research)", Accept: "text/html" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/html")) throw new Error(`City League decklist request failed: HTTP ${response.status}`);
  const html = await response.text();
  if (html.length > 5_000_000) throw new Error("City League decklist exceeded size limit.");
  return parseJapanDecklist(html);
}

export function pendingJapanDecklists(db: Database.Database, limit: number) {
  return db.prepare(`SELECT d.source_url AS sourceUrl FROM jp_decklists d
    JOIN jp_events e ON e.id = d.event_id
    LEFT JOIN jp_decklist_content c ON c.source_url = d.source_url
    WHERE c.status IS NULL
    GROUP BY d.source_url
    ORDER BY MAX(e.event_date) DESC, MIN(d.source_row) ASC
    LIMIT ?`).all(limit) as { sourceUrl: string }[];
}

export type JapanCardSearchResult = {
  eventId: string; sourceRow: number; sourceUrl: string; eventDate: string; placing: number;
  playerName: string; deckName: string; archetypeId: string; matchedCards: string;
};

export function searchJapanDecklists(db: Database.Database, query: string, range: { from: string | null; to: string | null }, limit = 51, offset = 0): JapanCardSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  return db.prepare(`SELECT d.event_id AS eventId, d.source_row AS sourceRow, d.source_url AS sourceUrl,
      e.event_date AS eventDate, p.placing, p.player_name_raw AS playerName,
      a.name AS deckName, p.archetype_id AS archetypeId, GROUP_CONCAT(DISTINCT c.name) AS matchedCards
    FROM jp_decklists d
    JOIN jp_placements p ON p.event_id = d.event_id AND p.source_row = d.source_row
    JOIN jp_events e ON e.id = d.event_id
    JOIN jp_archetypes a ON a.id = p.archetype_id
    JOIN jp_decklist_cards c ON c.source_url = d.source_url
    WHERE instr(lower(c.name), ?) > 0
      AND (? IS NULL OR e.event_date >= ?) AND (? IS NULL OR e.event_date <= ?)
    GROUP BY d.event_id, d.source_row
    ORDER BY e.event_date DESC, p.placing ASC, CAST(d.event_id AS INTEGER) DESC
    LIMIT ? OFFSET ?`).all(needle, range.from, range.from, range.to, range.to, limit, offset) as JapanCardSearchResult[];
}

export function japanDecklistCoverage(db: Database.Database, range: { from: string | null; to: string | null }) {
  return db.prepare(`SELECT COUNT(DISTINCT d.source_url) AS total,
    COUNT(DISTINCT CASE WHEN c.status = 'complete' THEN d.source_url END) AS indexed
    FROM jp_decklists d JOIN jp_events e ON e.id = d.event_id
    LEFT JOIN jp_decklist_content c ON c.source_url = d.source_url
    WHERE (? IS NULL OR e.event_date >= ?) AND (? IS NULL OR e.event_date <= ?)`).get(range.from, range.from, range.to, range.to) as { total: number; indexed: number };
}
