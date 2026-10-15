export type JapanDateRange = {
  key: "7d" | "30d" | "90d" | "all" | "custom";
  label: string;
  from: string | null;
  to: string | null;
};

function easternDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function daysBefore(date: string, days: number) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function resolveJapanDateRange(params: { range?: string; from?: string; to?: string }, now = new Date()): JapanDateRange {
  const today = easternDate(now);
  if (params.range === "all") return { key: "all", label: "All imported", from: null, to: null };
  if (params.range === "custom" && validDate(params.from) && validDate(params.to) && params.from! <= params.to!) {
    return { key: "custom", label: "Custom range", from: params.from!, to: params.to! };
  }
  const days = params.range === "7d" ? 7 : params.range === "90d" ? 90 : 30;
  return { key: `${days}d` as JapanDateRange["key"], label: `Last ${days} days`, from: daysBefore(today, days - 1), to: today };
}
