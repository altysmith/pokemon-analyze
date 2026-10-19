import { spawn } from "node:child_process";
import { describeRun, nextDailyRun, validateTimeZone } from "./japan-sync-schedule.mjs";

const numberSetting = (name, fallback, minimum, maximum) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
};

const pages = numberSetting("JP_SYNC_PAGES", 10, 1, 10);
const maxEvents = numberSetting("JP_SYNC_MAX_EVENTS", 100, 1, 100);
const runHour = numberSetting("JP_SYNC_HOUR", 11, 0, 23);
const runMinute = numberSetting("JP_SYNC_MINUTE", 0, 0, 59);
const timeZone = validateTimeZone(process.env.JP_SYNC_TIME_ZONE || "America/New_York");
const runOnce = process.argv.includes("--once");

let stopping = false;
let activeChild;
let wakeSleep;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[japan-sync] received ${signal}; stopping`);
  activeChild?.kill(signal);
  wakeSleep?.();
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

function sync() {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    console.log(`[japan-sync] starting at ${startedAt}`);
    activeChild = spawn(process.execPath, [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/japan-sync.ts",
      "--pages",
      String(pages),
      "--max-events",
      String(maxEvents),
    ], { stdio: "inherit" });
    activeChild.once("exit", (code, signal) => {
      activeChild = undefined;
      if (code === 0) {
        console.log(`[japan-sync] completed at ${new Date().toISOString()}`);
      } else {
        console.error(`[japan-sync] failed at ${new Date().toISOString()} (${signal ?? `exit ${code}`})`);
      }
      resolve(code === 0);
    });
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    wakeSleep = () => {
      clearTimeout(timer);
      resolve();
    };
  }).finally(() => {
    wakeSleep = undefined;
  });
}

do {
  const succeeded = await sync();
  if (runOnce || stopping) {
    if (!succeeded && !stopping) process.exitCode = 1;
    break;
  }
  const nextRun = nextDailyRun(new Date(), runHour, runMinute, timeZone);
  console.log(`[japan-sync] next run at ${nextRun.toISOString()} (${describeRun(nextRun, timeZone)} ${timeZone})`);
  await sleep(nextRun.getTime() - Date.now());
} while (!stopping);
