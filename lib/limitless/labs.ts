import { fetchHtml } from "./http";
import type { LabsEvent } from "./types";

export const LABS_BASE = "https://labs.limitlesstcg.com";

const decodeHtml = (value: string) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const textOnly = (value: string) =>
  decodeHtml(value.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());

export async function listLabsEvents() {
  return parseLabsEvents(await fetchHtml(`${LABS_BASE}/`));
}

export function parseLabsEvents(html: string): LabsEvent[] {
  const events: LabsEvent[] = [];
  const anchors = html.matchAll(
    /<a\b[^>]*href="\/(\d+)\/standings"[^>]*>([\s\S]*?)<\/a>/gi,
  );

  for (const match of anchors) {
    const [, id, body] = match;
    const nameMatch = body.match(
      /<div\b[^>]*class="[^"]*font-bold text-xl[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    );
    const name = textOnly(nameMatch?.[1] ?? "");
    if (!name) continue;

    const images = [...body.matchAll(/<img\b([^>]*)>/gi)].map((image) => image[1]);
    const logoAttributes = images[0] ?? "";
    const flagAttributes = images.find((attributes) => /\/flags\//i.test(attributes));
    const src = (attributes: string | undefined) =>
      attributes?.match(/src="([^"]+)"/i)?.[1] ?? null;
    const country = flagAttributes?.match(/alt="([A-Z]{2})"/i)?.[1] ?? null;
    const allText = textOnly(body);
    const dateLabel = allText.startsWith(name)
      ? allText.slice(name.length).trim()
      : allText;

    events.push({
      id,
      name,
      dateLabel,
      country,
      logoUrl: src(logoAttributes),
      standingsUrl: `${LABS_BASE}/${id}/standings`,
    });
  }

  return events;
}

export function labsEventUrl(
  id: string,
  view: "standings" | "decks" | "pairings",
  options: { conversion?: boolean; round?: number } = {},
) {
  if (!/^\d{4,12}$/.test(id)) throw new Error("Invalid Labs event ID.");
  const url = new URL(`/${id}/${view}`, LABS_BASE);
  if (view === "decks" && options.conversion) url.searchParams.set("conversion", "");
  if (view === "pairings" && options.round) {
    url.searchParams.set("round", String(options.round));
  }
  return url;
}
