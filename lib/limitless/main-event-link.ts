import { fetchHtml } from "./http";
import type { SeasonEvent } from "./season-catalog";

const BASE = "https://www.limitlesstcg.com";

type MainEvent = { id: string; date: string; country: string; name: string };

export function parseMainEvents(html: string): MainEvent[] {
  return [...html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)].flatMap((match) => {
    const attrs = match[1];
    const date = attrs.match(/\bdata-date="(\d{4}-\d{2}-\d{2})"/)?.[1];
    const country = attrs.match(/\bdata-country="([A-Z]{2})"/)?.[1];
    const name = attrs.match(/\bdata-name="([^"]+)"/)?.[1];
    const id = match[2].match(/href="\/tournaments\/(\d+)"/)?.[1];
    return date && country && name && id ? [{ id, date, country, name }] : [];
  });
}

export function mainEventCandidates(events: MainEvent[], event: SeasonEvent) {
  const city = event.shortName.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return events.filter((item) => {
    const name = item.name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    const days = Math.abs(Date.parse(`${item.date}T00:00:00Z`) - Date.parse(`${event.date}T00:00:00Z`)) / 86_400_000;
    return item.country === event.country && days <= 3
      && name.startsWith(event.kind === "regional" ? "regional " : "special event ")
      && name.includes(city);
  });
}

export async function findMainEventId(event: SeasonEvent, indexHtml: string) {
  const candidates = mainEventCandidates(parseMainEvents(indexHtml), event);
  if (candidates.length !== 1) return null;
  const main = candidates[0];
  const page = await fetchHtml(`${BASE}/tournaments/${main.id}`);
  return page.includes(`https://labs.limitlesstcg.com/${event.id}/standings`) ? main.id : null;
}

export async function fetchMainEventIndex() {
  return fetchHtml(`${BASE}/tournaments`);
}
