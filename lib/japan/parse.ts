import type { JapanEventSnapshot, JapanListingEvent, JapanPlacement } from "./source";

const BASE = "https://www.limitlesstcg.com";

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

function plain(html: string) {
  return decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function attribute(html: string, name: string) {
  const found = html.match(new RegExp("\\b" + name + '="([^"]*)"', "i"));
  return found ? decode(found[1]) : null;
}

function sourceUrl(value: string | null, path: RegExp) {
  if (!value) return null;
  try {
    const url = new URL(value, BASE);
    if (!["limitlesstcg.com", "www.limitlesstcg.com"].includes(url.hostname) || !path.test(url.pathname)) return null;
    return BASE + url.pathname;
  } catch {
    return null;
  }
}

function cells(row: string) {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
}

export function parseCityLeagueIndex(html: string): JapanListingEvent[] {
  const events: JapanListingEvent[] = [];
  for (const match of html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const date = attribute(match[1], "data-date");
    const prefectureRaw = attribute(match[1], "data-city");
    const shopRaw = attribute(match[1], "data-shop");
    const href = attribute(match[2].match(/<a\b[^>]*>/i)?.[0] ?? "", "href");
    const url = sourceUrl(href, /^\/tournaments\/jp\/\d+$/);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !prefectureRaw || !shopRaw || !url) continue;
    events.push({ id: url.split("/").at(-1)!, sourceUrl: url, eventDate: date, prefectureRaw, shopRaw });
  }
  return [...new Map(events.map((event) => [event.id, event])).values()];
}

export function parseCityLeagueEvent(html: string, event: JapanListingEvent): JapanEventSnapshot {
  if (!/^\d+$/.test(event.id) || event.sourceUrl !== BASE + "/tournaments/jp/" + event.id) throw new Error("Invalid City League event ID or URL.");
  const placements: JapanPlacement[] = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = cells(match[1]);
    if (row.length < 4) continue;
    const placing = Number(plain(row[0]));
    if (!Number.isInteger(placing) || placing < 1) continue;
    const playerNameRaw = plain(row[1]);
    if (!playerNameRaw) throw new Error("Player name missing in event " + event.id + ".");
    const playerUrl = sourceUrl(attribute(row[1].match(/<a\b[^>]*>/i)?.[0] ?? "", "href"), /^\/players\/jp\/[^/]+$/);
    const icons = [...row[2].matchAll(/<img\b[^>]*>/gi)].map((icon) => attribute(icon[0], "alt")).filter((name): name is string => Boolean(name));
    const archetypeRaw = icons.length ? icons.join("+") : null;
    const decklistUrl = sourceUrl(attribute(row[3].match(/<a\b[^>]*>/i)?.[0] ?? "", "href"), /^\/decks\/list\/jp\/\d+$/);
    placements.push({ sourceRow: placements.length + 1, placing, playerNameRaw, playerUrl, archetypeRaw, decklistUrl });
  }
  if (placements.length === 0) throw new Error("No placement rows found for event " + event.id + ".");
  return { ...event, knownPlayerCount: null, placements };
}
