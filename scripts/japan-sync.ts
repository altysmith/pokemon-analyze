import { openJapanDb } from "../db/japan";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { LiveJapanSource } from "../lib/japan/live-source";
import { japanSourceData } from "../lib/japan/overview";
import { syncJapanSource } from "../lib/japan/sync";

function integerFlag(name: string, fallback: number, maximum: number) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  return value;
}

const pages = integerFlag("--pages", 1, 10);
const maxEvents = integerFlag("--max-events", 10, 100);
const fromIndex = process.argv.indexOf("--from");
const fromDate = fromIndex < 0 ? undefined : process.argv[fromIndex + 1];
if (fromDate && (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)
  || Number.isNaN(Date.parse(`${fromDate}T00:00:00Z`))
  || new Date(`${fromDate}T00:00:00Z`).toISOString().slice(0, 10) !== fromDate)) {
  throw new Error("--from must be a valid YYYY-MM-DD date.");
}
const db = openJapanDb();
try {
  const results = await syncJapanSource(db, new LiveJapanSource({ pages }), { maxEvents, fromDate, sourceKind: "live" });
  writeFileSync(path.resolve("lib/japan/preview-overview.json"), JSON.stringify(japanSourceData(db)) + "\n");
  const totals = db.prepare("SELECT COUNT(*) AS events, SUM(placement_count) AS placements, SUM(classified_top8_count) AS classified_top8 FROM jp_events").get();
  console.log(JSON.stringify({ checked: results.length, changed: results.filter((result) => result.changed).length, totals }, null, 2));
} finally {
  db.close();
}
