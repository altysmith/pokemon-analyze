import { fetchHtml } from "./http";
import type { OverallMetaDeck } from "./types";
import type { Geography, MetaDeck } from "./season";

export const OVERALL_META_BASE = "https://www.limitlesstcg.com";

const decodeHtml = (value: string) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const textOnly = (value: string) =>
  decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());

export async function getOverallMetagame(options: {
  format?: string;
  time?: string;
  splitVariants?: boolean;
  limit?: number;
  show?: 25 | 50 | 100;
} = {}) {
  const url = new URL("/decks", OVERALL_META_BASE);
  if (options.format) url.searchParams.set("format", options.format);
  if (options.time) url.searchParams.set("time", options.time);
  if (options.splitVariants !== false) url.searchParams.set("variants", "on");
  if (options.show) url.searchParams.set("show", String(options.show));

  const html = await fetchHtml(url);
  return parseOverallMetagame(html).slice(0, options.limit ?? 50);
}

export function parseOverallMetagame(html: string): OverallMetaDeck[] {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const decks: OverallMetaDeck[] = [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => match[1],
    );
    if (cells.length < 5) continue;

    const rank = Number(textOnly(cells[0]));
    const points = Number(textOnly(cells[3]).replaceAll(",", ""));
    const share = Number(textOnly(cells[4]).replace("%", "")) / 100;
    if (!Number.isFinite(rank) || !Number.isFinite(points) || !Number.isFinite(share)) {
      continue;
    }

    const deckLink = cells[2].match(/href="(\/decks\/(\d+)(?:\?variant=\d+)?)"/i);
    const icons = [...cells[1].matchAll(/<img\b[^>]*alt="([^"]+)"/gi)].map(
      (match) => decodeHtml(match[1]),
    );
    decks.push({
      rank,
      id: deckLink?.[2] ?? null,
      url: deckLink ? new URL(deckLink[1], OVERALL_META_BASE).toString() : null,
      name: textOnly(cells[2]),
      points,
      share,
      icons,
    });
  }

  return decks;
}

const DECK_LINK_TTL = 30 * 60 * 1000;
let deckLinkCache: { expires: number; decks: OverallMetaDeck[] } | null = null;
let deckLinkRequest: Promise<OverallMetaDeck[]> | null = null;

async function currentDeckLinks() {
  if (deckLinkCache && deckLinkCache.expires > Date.now()) return deckLinkCache.decks;
  if (!deckLinkRequest) {
    deckLinkRequest = getOverallMetagame({ splitVariants: true, show: 100, limit: 100 })
      .then((decks) => {
        deckLinkCache = { expires: Date.now() + DECK_LINK_TTL, decks };
        return decks;
      })
      .finally(() => { deckLinkRequest = null; });
  }
  return deckLinkRequest;
}

function nameKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function iconKey(icons: string[]) {
  return icons.length ? [...icons].sort().join("|") : "";
}

export function matchMainDeckUrl(deck: Pick<MetaDeck, "name" | "icons">, mainDecks: OverallMetaDeck[]) {
  const byName = mainDecks.filter((candidate) => candidate.url && nameKey(candidate.name) === nameKey(deck.name));
  if (byName.length === 1) return byName[0].url;
  const icons = iconKey(deck.icons);
  if (!icons) return null;
  const byIcons = mainDecks.filter((candidate) => candidate.url && iconKey(candidate.icons) === icons);
  return byIcons.length === 1 ? byIcons[0].url : null;
}

export async function linkSeasonDecks(byGeography: Record<Geography, MetaDeck[]>) {
  try {
    const mainDecks = await currentDeckLinks();
    return Object.fromEntries(Object.entries(byGeography).map(([geography, decks]) => [
      geography, decks.map((deck) => ({ ...deck, limitlessUrl: matchMainDeckUrl(deck, mainDecks) ?? deck.limitlessUrl })),
    ])) as Record<Geography, MetaDeck[]>;
  } catch {
    return byGeography;
  }
}
