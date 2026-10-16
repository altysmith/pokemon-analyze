import { spawn } from "node:child_process";

const intervalHours = Number(process.env.SEASON_SYNC_INTERVAL_HOURS || 6);
if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 168) {
  throw new Error("SEASON_SYNC_INTERVAL_HOURS must be an integer from 1 through 168.");
}
const once = process.argv.includes("--once");
let stopping = false;
let child;
let wake;
function stop(signal) {
  stopping = true;
  child?.kill(signal);
  wake?.();
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

do {
  console.log(`[season-sync] starting at ${new Date().toISOString()}`);
  const succeeded = await new Promise((resolve) => {
    child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/season-sync.ts"], { stdio: "inherit" });
    child.once("exit", (code) => { child = undefined; resolve(code === 0); });
  });
  console.log(`[season-sync] ${succeeded ? "completed" : "failed"} at ${new Date().toISOString()}`);
  if (once || stopping) {
    if (!succeeded && !stopping) process.exitCode = 1;
    break;
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, intervalHours * 3_600_000);
    wake = () => { clearTimeout(timer); resolve(); };
  });
  wake = undefined;
} while (!stopping);
