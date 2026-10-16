import { listLabsEvents } from "../lib/limitless/labs";
import { seasonEventFromLabs, INITIAL_SEASON_EVENTS, type SeasonEvent } from "../lib/limitless/season-catalog";
import { getRegionalData } from "../lib/limitless/season";
import { readSeasonEvents, writeSeasonEvents } from "../lib/limitless/season-store";
import { fetchMainEventIndex, findMainEventId } from "../lib/limitless/main-event-link";

const now = new Date();
const today = now.toISOString().slice(0, 10);
const current = await readSeasonEvents();
const known = new Map<string, SeasonEvent>([...INITIAL_SEASON_EVENTS, ...current].map((event) => [event.id, event]));
const listed = (await listLabsEvents()).map(seasonEventFromLabs).filter((event): event is SeasonEvent => event !== null);
if (!listed.length) throw new Error("No eligible Labs events found; keeping the existing catalog.");

let added = 0;
let waiting = 0;
let checked = 0;
let linked = 0;
let mainIndex: string | null | undefined;
for (const event of listed) {
  if (event.endDate >= today) continue;
  const previous = known.get(event.id);
  // Recent events may be corrected after their first publication. The web app
  // reads those pages with its own short cache; this pass also checks readiness.
  const recent = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${event.endDate}T00:00:00Z`) <= 7 * 86_400_000;
  if (!previous || recent) {
    checked++;
    try {
      const result = await getRegionalData(event);
      if (!result.decks.some((deck) => deck.day1 !== null)) throw new Error("conversion rows are not available yet");
      if (!previous) {
        known.set(event.id, event);
        added++;
        console.log(`[season-sync] added ${event.name} (${event.id})`);
      }
    } catch (error) {
      waiting++;
      console.warn(`[season-sync] ${previous ? "recheck failed" : "waiting"} for ${event.name} (${event.id}): ${error instanceof Error ? error.message : error}`);
      continue;
    }
  }
  const accepted = known.get(event.id)!;
  if (!accepted.mainEventId) {
    try {
      if (mainIndex === undefined) mainIndex = await fetchMainEventIndex();
      if (mainIndex) {
        const mainEventId = await findMainEventId(event, mainIndex);
        if (mainEventId) {
          known.set(event.id, { ...accepted, mainEventId });
          linked++;
          console.log(`[season-sync] linked main-site tournament ${mainEventId} to Labs ${event.id}`);
        }
      }
    } catch (error) {
      mainIndex = null;
      console.warn(`[season-sync] main-site link unavailable for ${event.id}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

if (added || linked || current.length !== known.size) await writeSeasonEvents([...known.values()]);
console.log(JSON.stringify({ discovered: listed.length, checked, added, linked, waiting, total: known.size, at: now.toISOString() }));
