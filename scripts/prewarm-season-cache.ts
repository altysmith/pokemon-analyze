import { aggregateMeta, getAggregatedMatchups, getSeasonData } from "../lib/limitless/season";

if (!process.env.SEASON_CACHE_DIR) throw new Error("SEASON_CACHE_DIR must point to the shared season cache.");

const events = await getSeasonData();
const top = aggregateMeta(events);
const opponents = top.slice(0, 25).map((deck) => deck.slug);
console.log(`Cached ${events.length} events; warming matchups for ${Math.min(top.length, 15)} decks.`);
for (const deck of top.slice(0, 15)) {
  const matchups = await getAggregatedMatchups(events, deck.slug, opponents);
  console.log(`${deck.slug}: ${matchups.length} opposing decks`);
}
