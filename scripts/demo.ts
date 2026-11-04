// One command for the pitch: prepares env and database, re-seeds if the data is from another day, and starts everything.
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

const run = (cmd: string) => execSync(cmd, { stdio: "inherit" });

run("node scripts/ensure-env.mjs");
const file = "data/doctorpv.db";
if (!existsSync(file)) {
  console.log("Menyiapkan database...");
  run("npm run -s db:setup");
} else {
  const today = Math.floor((Date.now() / 1000 + 7 * 3600) / 86400);
  let seedDay = 0;
  try {
    const db = new Database(file, { readonly: true });
    const row = db.prepare("SELECT valueJson FROM Setting WHERE key = 'seedDay'").get() as { valueJson: string } | undefined;
    seedDay = Number(row?.valueJson ?? 0);
    db.close();
  } catch {
    seedDay = 0;
  }
  if (seedDay !== today) {
    console.log("Data simulasi dari hari lain. Menyusun ulang untuk hari ini...");
    run("npm run -s seed");
  }
}
if (!existsSync(".next/BUILD_ID")) {
  console.log("Membangun aplikasi...");
  run("npm run -s build");
}

const children: ChildProcess[] = [];
const start = (args: string[]) => {
  const child = spawn("npm", args, { stdio: "inherit" });
  children.push(child);
  return child;
};
start(["run", "-s", "start"]);
start(["run", "-s", "simulate"]);
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log("\nDOCTOR PV: http://localhost:3000  (Shift+D membuka kontrol demo)\n");
