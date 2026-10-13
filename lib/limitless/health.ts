import { LABS_BASE, listLabsEvents } from "./labs";
import { getOverallMetagame, OVERALL_META_BASE } from "./overall-meta";
import { listGames, PLAY_API_BASE } from "./play";
import type { SourceHealth } from "./types";

async function check(
  source: Omit<SourceHealth, "status" | "detail" | "checkedAt" | "latencyMs">,
  probe: () => Promise<string>,
): Promise<SourceHealth> {
  const started = Date.now();
  try {
    const detail = await probe();
    return {
      ...source,
      status: "connected",
      detail,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ...source,
      status: "degraded",
      detail: error instanceof Error ? error.message : "Connection failed.",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
    };
  }
}

export function checkLimitlessSources() {
  return Promise.all([
    check(
      {
        id: "play-api",
        label: "Play Limitless API",
        kind: "official-json-api",
        url: PLAY_API_BASE,
      },
      async () => {
        const games = await listGames();
        const ptcg = games.find((game) => game.id === "PTCG");
        return ptcg
          ? `${ptcg.name} is available with ${Object.keys(ptcg.formats).length} formats.`
          : `Connected; ${games.length} games returned.`;
      },
    ),
    check(
      {
        id: "overall-meta",
        label: "Limitless overall metagame",
        kind: "public-html",
        url: `${OVERALL_META_BASE}/decks`,
      },
      async () => {
        const decks = await getOverallMetagame({ time: "1months", limit: 5 });
        return `${decks.length} current deck rows parsed in the connection probe.`;
      },
    ),
    check(
      {
        id: "labs",
        label: "Limitless Labs",
        kind: "public-html",
        url: LABS_BASE,
      },
      async () => {
        const events = await listLabsEvents();
        return `${events.length} Labs events discovered.`;
      },
    ),
  ]);
}
