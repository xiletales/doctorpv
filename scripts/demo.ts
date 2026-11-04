// One command for the pitch: checks env, updates the database, re-seeds if the data is from another day, and starts everything.
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { config } from "dotenv";

const run = (cmd: string) => execSync(cmd, { stdio: "inherit" });

async function seededToday(): Promise<boolean> {
  const { createPrisma } = await import("../src/lib/prisma-factory");
  const db = createPrisma(process.env.DIRECT_URL ?? "", 1);
  try {
    const row = await db.setting.findUnique({ where: { key: "seedDay" } });
    return Number(row?.valueJson ?? 0) === Math.floor((Date.now() / 1000 + 7 * 3600) / 86400);
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  try {
    run("node scripts/ensure-env.mjs");
  } catch {
    process.exit(1);
  }
  config({ quiet: true });
  console.log("Memperbarui skema database...");
  run("npm run -s db:push");
  if (!(await seededToday())) {
    console.log("Data simulasi belum ada atau dari hari lain. Menyusun ulang untuk hari ini...");
    run("npx tsx prisma/seed.ts");
  }
  if (!existsSync(".next/BUILD_ID")) {
    console.log("Membangun aplikasi...");
    run("npm run -s build");
  }

  const children: ChildProcess[] = [];
  const start = (args: string[]) => {
    const child = spawn("npm", args, { stdio: "inherit" });
    children.push(child);
  };
  start(["run", "-s", "start"]);
  start(["run", "-s", "simulate"]);
  const stop = () => {
    for (const c of children) c.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log("\nSUNPULSE: http://localhost:3000  (Shift+D membuka kontrol demo)\n");
}

main().catch((err: unknown) => {
  console.error("Gagal memulai demo. Periksa koneksi internet dan .env.", err instanceof Error ? err.message : "");
  process.exit(1);
});
