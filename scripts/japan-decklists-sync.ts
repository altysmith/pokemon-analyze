import { openJapanDb } from "../db/japan";
import { fetchJapanDecklist, pendingJapanDecklists, storeJapanDecklist } from "../lib/japan/decklist-content";

const maxIndex = process.argv.indexOf("--max");
const max = maxIndex < 0 ? 10000 : Number(process.argv[maxIndex + 1]);
if (!Number.isInteger(max) || max < 1 || max > 10000) throw new Error("--max must be an integer from 1 to 10000.");

const db = openJapanDb();
let indexed = 0;
let failed = 0;
try {
  const pending = pendingJapanDecklists(db, max);
  console.log(`[japan-decklists] ${pending.length} lists pending`);
  for (const [index, row] of pending.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      const cards = await fetchJapanDecklist(row.sourceUrl);
      storeJapanDecklist(db, row.sourceUrl, cards);
      indexed++;
    } catch (error) {
      failed++;
      console.error(`[japan-decklists] ${row.sourceUrl}:`, error);
      if (error instanceof Error && error.message.includes("HTTP 429")) break;
    }
    if ((index + 1) % 100 === 0) console.log(`[japan-decklists] processed ${index + 1}/${pending.length}; indexed ${indexed}; failed ${failed}`);
  }
  console.log(JSON.stringify({ pending: pending.length, indexed, failed }));
  if (failed > 0) process.exitCode = 1;
} finally {
  db.close();
}
