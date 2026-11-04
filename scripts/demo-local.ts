// Runs everything on a Postgres embedded in this project, with no internet and no Supabase.
// The connection values below take priority over .env, so .env credentials are never used here.
//   npm run demo:local        database, app and simulator
//   npm run db:local          database only
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PG_PORT = Number(process.env.LOCAL_PG_PORT ?? 54329);
const APP_PORT = process.env.DEMO_PORT ?? "3000";
const dbOnly = process.argv.includes("--db-only");
const dir = resolve(".local-pg");

export const LOCAL_URL = `postgresql://sunpulse_owner:local@localhost:${PG_PORT}/sunpulse`;

async function startDatabase() {
  const fresh = !existsSync(`${dir}/PG_VERSION`);
  const db = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "local", port: PG_PORT, persistent: true, onLog: () => {}, onError: () => {} });
  if (fresh) await db.initialise();
  await db.start();
  if (fresh) {
    // A non-superuser table owner, the same relationship Prisma has on Supabase, so RLS behaves alike.
    const admin = db.getPgClient();
    await admin.connect();
    await admin.query("CREATE ROLE sunpulse_owner LOGIN PASSWORD 'local' NOSUPERUSER NOBYPASSRLS");
    await admin.query("CREATE ROLE anon NOLOGIN");
    await admin.query("CREATE DATABASE sunpulse OWNER sunpulse_owner");
    await admin.end();
    const inDb = db.getPgClient("sunpulse");
    await inDb.connect();
    await inDb.query("ALTER SCHEMA public OWNER TO sunpulse_owner");
    await inDb.query("GRANT USAGE ON SCHEMA public TO anon");
    await inDb.query("ALTER DEFAULT PRIVILEGES FOR ROLE sunpulse_owner IN SCHEMA public GRANT ALL ON TABLES TO anon");
    await inDb.end();
  }
  return db;
}

async function main() {
  const db = await startDatabase();
  const stop = async () => {
    await db.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  console.log(`Postgres lokal aktif di port ${PG_PORT}.`);
  if (dbOnly) return;
  const child = spawn("npx", ["tsx", "scripts/demo.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: LOCAL_URL,
      DIRECT_URL: LOCAL_URL,
      NEXTAUTH_URL: `http://localhost:${APP_PORT}`,
      PORT: APP_PORT,
      SIM_TARGET: `http://localhost:${APP_PORT}`,
    },
  });
  child.on("exit", () => void stop());
}

main().catch((err: unknown) => {
  console.error("Postgres lokal gagal dimulai:", err instanceof Error ? err.message : "kesalahan tidak dikenal");
  process.exit(1);
});
