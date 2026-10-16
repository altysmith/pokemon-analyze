import type { LabsEvent } from "./types";

export type SeasonEvent = {
  id: string;
  name: string;
  shortName: string;
  date: string;
  endDate: string;
  kind: "regional" | "special";
  geography: "us" | "europe" | "south-america" | "oceania" | "other";
  country: string;
  mainEventId?: string;
};

export const SEASON_START = "2026-09-01";
export const SEASON_END = "2027-08-31";

export const INITIAL_SEASON_EVENTS: SeasonEvent[] = [
  { id: "0072", name: "Regional Championship Baltimore", shortName: "Baltimore", date: "2026-09-18", endDate: "2026-09-20", kind: "regional", geography: "us", country: "US", mainEventId: "577" },
  { id: "0073", name: "Regional Championship Brisbane", shortName: "Brisbane", date: "2026-09-26", endDate: "2026-09-27", kind: "regional", geography: "oceania", country: "AU", mainEventId: "578" },
  { id: "0074", name: "Regional Championship Frankfurt", shortName: "Frankfurt", date: "2026-09-26", endDate: "2026-09-27", kind: "regional", geography: "europe", country: "DE", mainEventId: "579" },
  { id: "0075", name: "Regional Championship Recife", shortName: "Recife", date: "2026-10-03", endDate: "2026-10-04", kind: "regional", geography: "south-america", country: "BR", mainEventId: "580" },
  { id: "0076", name: "Regional Championship Louisville", shortName: "Louisville", date: "2026-10-09", endDate: "2026-10-11", kind: "regional", geography: "us", country: "US", mainEventId: "581" },
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const EUROPE = new Set(["AT", "BE", "CH", "CZ", "DE", "DK", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK"]);
const SOUTH_AMERICA = new Set(["AR", "BO", "BR", "CL", "CO", "EC", "PE", "PY", "UY", "VE"]);
const OCEANIA = new Set(["AU", "FJ", "NZ"]);

function isoDate(year: number, month: number, day: number) {
  const result = new Date(Date.UTC(year, month - 1, day));
  return result.getUTCFullYear() === year && result.getUTCMonth() === month - 1 && result.getUTCDate() === day
    ? result.toISOString().slice(0, 10) : null;
}

export function parseEventDates(label: string) {
  const parts = label.toLowerCase().replaceAll("–", "-").replaceAll("—", "-").match(/^(\w+) (\d{1,2})(?:\s*-\s*(?:(\w+) )?(\d{1,2}))?, (\d{4})$/);
  if (!parts) return null;
  const firstMonth = MONTHS.indexOf(parts[1]) + 1;
  const lastMonth = parts[3] ? MONTHS.indexOf(parts[3]) + 1 : firstMonth;
  const finalYear = Number(parts[5]);
  if (!firstMonth || !lastMonth) return null;
  const firstYear = firstMonth > lastMonth ? finalYear - 1 : finalYear;
  const date = isoDate(firstYear, firstMonth, Number(parts[2]));
  const endDate = isoDate(finalYear, lastMonth, Number(parts[4] ?? parts[2]));
  return date && endDate && date <= endDate ? { date, endDate } : null;
}

export function seasonEventFromLabs(event: LabsEvent): SeasonEvent | null {
  const kind = event.name.startsWith("Regional Championship ") ? "regional"
    : event.name.startsWith("Special Event ") ? "special" : null;
  const dates = parseEventDates(event.dateLabel);
  if (!kind || !dates || dates.date < SEASON_START || dates.date > SEASON_END || !/^\d{4,12}$/.test(event.id)) return null;
  const country = event.country ?? "";
  const geography = country === "US" ? "us" : EUROPE.has(country) ? "europe"
    : SOUTH_AMERICA.has(country) ? "south-america" : OCEANIA.has(country) ? "oceania" : "other";
  return { id: event.id, name: event.name, shortName: event.name.replace(/^(Regional Championship|Special Event) /, ""),
    ...dates, kind, geography, country };
}

export function isSeasonEvent(value: unknown): value is SeasonEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<SeasonEvent>;
  return typeof event.id === "string" && /^\d{4,12}$/.test(event.id)
    && typeof event.name === "string" && typeof event.shortName === "string"
    && typeof event.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.date)
    && typeof event.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.endDate)
    && (event.kind === "regional" || event.kind === "special")
    && ["us", "europe", "south-america", "oceania", "other"].includes(event.geography ?? "")
    && typeof event.country === "string"
    && (event.mainEventId === undefined || /^\d+$/.test(event.mainEventId));
}

export function sortSeasonEvents(events: SeasonEvent[]) {
  return [...events].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
