import { INITIAL_SEASON_EVENTS, isSeasonEvent, sortSeasonEvents, type SeasonEvent } from "./season-catalog";

export function seasonCatalogPath() {
  return process.env.SEASON_CATALOG_PATH || ".data/season-events.json";
}

export async function readSeasonEvents(): Promise<SeasonEvent[]> {
  let contents: string;
  try {
    const { readFile } = await import("node:fs/promises");
    contents = await readFile(/* turbopackIgnore: true */ seasonCatalogPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return INITIAL_SEASON_EVENTS;
    throw error;
  }
  const data: unknown = JSON.parse(contents);
  if (!data || typeof data !== "object" || (data as { version?: unknown }).version !== 1
    || !Array.isArray((data as { events?: unknown }).events)
    || !(data as { events: unknown[] }).events.every(isSeasonEvent)) {
    throw new Error("Invalid season event catalog; the last good file was preserved.");
  }
  const events = (data as { events: SeasonEvent[] }).events;
  const ids = new Set(events.map((event) => event.id));
  if (ids.size !== events.length) throw new Error("Duplicate season event IDs in catalog.");
  return sortSeasonEvents(events);
}

export async function writeSeasonEvents(events: SeasonEvent[]) {
  const { mkdir, rename, writeFile, unlink } = await import("node:fs/promises");
  const path = await import("node:path");
  const target = seasonCatalogPath();
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, events: sortSeasonEvents(events) }, null, 2) + "\n", { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
