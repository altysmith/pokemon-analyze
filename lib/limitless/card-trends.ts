import { fetchHtml } from "./http";

const BASE = "https://www.limitlesstcg.com";
const MIN_DECKLISTS = 5;
const MIN_COPY_CHANGE = 0.1;
const ALIASES: Record<string, string[]> = {
  "ogerpon-meganium-hydrapple": ["Hydrapple"],
};

export type CardShift = {
  id: string;
  name: string;
  set: string;
  number: string;
  from: number;
  to: number;
  change: number;
};
export type CardComparison = {
  status: "ok" | "insufficient" | "unavailable";
  fromDecklists: number;
  toDecklists: number;
  added: CardShift[];
  removed: CardShift[];
  fromUrl: string;
  toUrl: string;
  message?: string;
};

type Card = { id: string; name: string; set: string; number: string; copies: number };
type DeckOption = { id: string; name: string; decklists: number };
const cache = new Map<string, { until: number; value: string }>();
const pending = new Map<string, Promise<string>>();

async function cachedHtml(url: string) {
  const hit = cache.get(url);
  if (hit && hit.until > Date.now()) return hit.value;
  const inFlight = pending.get(url);
  if (inFlight) return inFlight;
  const task = fetchHtml(url).then((value) => {
    cache.set(url, { until: Date.now() + 30 * 60_000, value });
    return value;
  }).finally(() => pending.delete(url));
  pending.set(url, task);
  return task;
}

function plain(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function normalize(value: string) {
  return value.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim();
}

function deckOptions(html: string): DeckOption[] {
  return [...html.matchAll(/<li\s+data-value="([0-9]+(?:\.[0-9]+)?)">([\s\S]*?)<\/li>/g)].flatMap((match) => {
    const label = plain(match[2]);
    const parts = label.match(/^(.*?)\s+-\s+(\d+) decklists?$/i);
    return parts ? [{ id: match[1], name: parts[1], decklists: Number(parts[2]) }] : [];
  });
}

function cards(html: string): Card[] {
  const section = html.split('data-text-decklist>')[1]?.split('data-image-decklist')[0] ?? "";
  const found = new Map<string, Card>();
  const pattern = /<div\s+class="decklist-card"[^>]*data-set="([^"]+)"[^>]*data-number="([^"]+)"[^>]*>[\s\S]*?<span\s+class="card-count">([\d.]+)<\/span>[\s\S]*?<span\s+class="card-name">([\s\S]*?)<\/span>/g;
  for (const match of section.matchAll(pattern)) {
    const copies = Number(match[3]);
    if (!Number.isFinite(copies)) continue;
    const card = { id: `${match[1]}-${match[2]}`, set: match[1], number: match[2], copies, name: plain(match[4]) };
    found.set(card.id, card);
  }
  return [...found.values()];
}

async function cardUsage(mainEventId: string, slug: string, deckName: string) {
  const base = `${BASE}/tournaments/${mainEventId}/cards`;
  const index = await cachedHtml(base);
  const names = [deckName, ...(ALIASES[slug] ?? [])].map(normalize);
  const option = deckOptions(index).find((item) => names.includes(normalize(item.name)));
  if (!option) return { decklists: 0, cards: [] as Card[], url: base, available: false };
  const url = `${base}?deck=${encodeURIComponent(option.id)}`;
  if (option.decklists < MIN_DECKLISTS) return { decklists: option.decklists, cards: [] as Card[], url, available: true };
  const selected = plain(index.match(/<div class="dropdown-select" data-reload data-key="deck">([\s\S]*?)<span class="sub">/)?.[1] ?? "");
  const html = normalize(selected) === normalize(option.name) ? index : await cachedHtml(url);
  const parsed = cards(html);
  if (parsed.length === 0) throw new Error(`No card rows found for ${deckName} at tournament ${mainEventId}.`);
  return { decklists: option.decklists, cards: parsed, url, available: true };
}

export async function getCardComparison(fromId: string, toId: string, slug: string, deckName: string): Promise<CardComparison> {
  if (!/^\d+$/.test(fromId) || !/^\d+$/.test(toId) || fromId === toId) throw new Error("Invalid event comparison.");
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) throw new Error("Invalid deck slug.");
  const [from, to] = await Promise.all([cardUsage(fromId, slug, deckName), cardUsage(toId, slug, deckName)]);
  const common = { fromDecklists: from.decklists, toDecklists: to.decklists, fromUrl: from.url, toUrl: to.url };
  if (!from.available || !to.available) return { ...common, status: "unavailable", added: [], removed: [], message: "Published card averages are unavailable for this deck at one of the selected Regionals." };
  if (from.decklists < MIN_DECKLISTS || to.decklists < MIN_DECKLISTS) return { ...common, status: "insufficient", added: [], removed: [], message: `At least ${MIN_DECKLISTS} published decklists are needed at each Regional to limit small-sample noise.` };
  const before = new Map(from.cards.map((card) => [card.id, card]));
  const after = new Map(to.cards.map((card) => [card.id, card]));
  const shifts = [...new Set([...before.keys(), ...after.keys()])].map((id): CardShift => {
    const a = before.get(id);
    const b = after.get(id);
    const first = a?.copies ?? 0;
    const last = b?.copies ?? 0;
    const card = b ?? a!;
    return { id, name: card.name, set: card.set, number: card.number, from: first, to: last, change: last - first };
  });
  return {
    ...common, status: "ok",
    added: shifts.filter((card) => card.change >= MIN_COPY_CHANGE).sort((a, b) => b.change - a.change).slice(0, 5),
    removed: shifts.filter((card) => card.change <= -MIN_COPY_CHANGE).sort((a, b) => a.change - b.change).slice(0, 5),
  };
}
