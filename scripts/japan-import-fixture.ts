import { readFileSync } from "node:fs";
import { openJapanDb } from "../db/japan";
import { FixtureJapanSource } from "../lib/japan/fixture-source";
import { syncJapanSource } from "../lib/japan/sync";

const [indexFile, eventFile, id] = process.argv.slice(2);
if (!indexFile || !eventFile || !id) {
  throw new Error("Usage: pnpm japan:import-fixture <index.html> <event.html> <event-id>");
}
const source = new FixtureJapanSource(readFileSync(indexFile, "utf8"), new Map([[id, readFileSync(eventFile, "utf8")]]));
const db = openJapanDb();
try {
  const results = await syncJapanSource(db, {
    async listEvents() {
      return (await source.listEvents()).filter((event) => event.id === id);
    },
    getEvent: (event) => source.getEvent(event),
  }, { force: true, maxEvents: 1 });
  if (results.length !== 1) throw new Error("Event ID not present in index fixture.");
  process.stdout.write(JSON.stringify(results[0]) + "\n");
} finally {
  db.close();
}
