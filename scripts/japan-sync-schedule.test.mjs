import assert from "node:assert/strict";
import test from "node:test";
import { nextDailyRun, validateTimeZone } from "./japan-sync-schedule.mjs";

test("schedules 11 AM in Eastern daylight time", () => {
  assert.equal(
    nextDailyRun(new Date("2026-10-19T14:59:20Z"), 11, 0, "America/New_York").toISOString(),
    "2026-10-19T15:00:00.000Z",
  );
});

test("schedules the next day after today's run time", () => {
  assert.equal(
    nextDailyRun(new Date("2026-10-19T15:00:20Z"), 11, 0, "America/New_York").toISOString(),
    "2026-10-20T15:00:00.000Z",
  );
});

test("follows Eastern standard time after daylight saving time ends", () => {
  assert.equal(
    nextDailyRun(new Date("2026-11-10T15:00:00Z"), 11, 0, "America/New_York").toISOString(),
    "2026-11-10T16:00:00.000Z",
  );
});

test("rejects an invalid time zone", () => {
  assert.throws(() => validateTimeZone("Eastern-ish"), RangeError);
});
