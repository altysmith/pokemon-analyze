import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { INITIAL_SEASON_EVENTS } from "./season-catalog";
import { readSeasonEvents, writeSeasonEvents } from "./season-store";

test("writes a valid catalog and rejects malformed replacement data", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "lometa-season-test-"));
  const file = path.join(directory, "events.json");
  const previous = process.env.SEASON_CATALOG_PATH;
  process.env.SEASON_CATALOG_PATH = file;
  try {
    assert.equal((await readSeasonEvents()).length, INITIAL_SEASON_EVENTS.length);
    const added = { ...INITIAL_SEASON_EVENTS[0], id: "0099", shortName: "Example" };
    await writeSeasonEvents([...INITIAL_SEASON_EVENTS, added]);
    assert.equal((await readSeasonEvents()).some((event) => event.id === "0099"), true);
    assert.equal((await readFile(file, "utf8")).includes('"version": 1'), true);
    await writeFile(file, '{"version":1,"events":[{"id":"bad"}]}');
    await assert.rejects(readSeasonEvents(), /Invalid season event catalog/);
  } finally {
    if (previous === undefined) delete process.env.SEASON_CATALOG_PATH;
    else process.env.SEASON_CATALOG_PATH = previous;
    await unlink(file).catch(() => {});
    await rmdir(directory);
  }
});
