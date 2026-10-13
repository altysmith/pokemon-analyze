import { fetchHtml } from "./http";
import type { OverallMetaDeck } from "./types";

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
} = {}) {
  const url = new URL("/decks", OVERALL_META_BASE);
  if (options.format) url.searchParams.set("format", options.format);
  if (options.time) url.searchParams.set("time", options.time);
  if (options.splitVariants !== false) url.searchParams.set("variants", "on");

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

    const deckLink = cells[2].match(/href="\/decks\/(\d+)"/i);
    const icons = [...cells[1].matchAll(/<img\b[^>]*alt="([^"]+)"/gi)].map(
      (match) => decodeHtml(match[1]),
    );
    decks.push({
      rank,
      id: deckLink?.[1] ?? null,
      name: textOnly(cells[2]),
      points,
      share,
      icons,
    });
  }

  return decks;
}
