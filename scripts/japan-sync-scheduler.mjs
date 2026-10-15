import { spawn } from "node:child_process";

const numberSetting = (name, fallback, minimum, maximum) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
};

const intervalHours = numberSetting("JP_SYNC_INTERVAL_HOURS", 24, 1, 168);
const pages = numberSetting("JP_SYNC_PAGES", 1, 1, 10);
const maxEvents = numberSetting("JP_SYNC_MAX_EVENTS", 10, 1, 100);
const runOnce = process.argv.includes("--once");
const intervalMs = intervalHours * 60 * 60 * 1_000;

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
  const nextRun = new Date(Date.now() + intervalMs).toISOString();
  console.log(`[japan-sync] next run at ${nextRun}`);
  await sleep(intervalMs);
} while (!stopping);
