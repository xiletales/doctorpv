// Proves the database is closed to the public API while the application still works.
// Usage: npm run db:verify-rls (the app must be running for the login check).
import "dotenv/config";
import { createPrisma } from "../src/lib/prisma-factory";

const BASE = process.env.VERIFY_APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
let failed = false;
const report = (ok: boolean, text: string) => {
  console.log(`${ok ? "LOLOS" : "GAGAL"}  ${text}`);
  if (!ok) failed = true;
};

async function checkTables() {
  const db = createPrisma(process.env.DIRECT_URL ?? "", 1);
  const tables = await db.$queryRaw<{ tablename: string; rowsecurity: boolean; forced: boolean }[]>`
    SELECT t.tablename, t.rowsecurity, c.relforcerowsecurity AS forced
    FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename AND c.relnamespace = 'public'::regnamespace
    WHERE t.schemaname = 'public' ORDER BY t.tablename`;
  const open = tables.filter((t) => !t.rowsecurity).map((t) => t.tablename);
  report(tables.length > 0 && open.length === 0, `RLS aktif di ${tables.length - open.length} dari ${tables.length} tabel${open.length ? `. Terbuka: ${open.join(", ")}` : ""}`);
  report(tables.every((t) => !t.forced), "Tidak ada FORCE RLS, sehingga pemilik tabel tetap bisa mengakses");
  const users = await db.user.count();
  report(users > 0, `Tabel User berisi ${users} baris lewat koneksi aplikasi, jadi hasil kosong di REST memang karena RLS`);
  await db.$disconnect();
  return tables.map((t) => t.tablename);
}

async function checkRest(tables: string[]) {
  if (!SUPABASE || !KEY || /[<>]/.test(SUPABASE + KEY)) {
    report(false, "NEXT_PUBLIC_SUPABASE_URL atau NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY belum diisi, jadi uji REST tidak berjalan");
    return;
  }
  const leaked: string[] = [];
  const results = new Map<number, number>();
  for (const table of tables) {
    const res = await fetch(`${SUPABASE}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`, { headers: { apikey: KEY } });
    results.set(res.status, (results.get(res.status) ?? 0) + 1);
    if (res.ok) {
      const rows = (await res.json()) as unknown[];
      if (rows.length > 0) leaked.push(table);
    } else if (res.status >= 500) {
      leaked.push(`${table} (HTTP ${res.status}, tidak bisa disimpulkan)`);
    }
  }
  const summary = [...results.entries()].map(([s, n]) => `HTTP ${s} x${n}`).join(", ");
  report(leaked.length === 0, `REST dengan publishable key: ${tables.length} tabel diuji, ${summary}. ${leaked.length ? `Bocor: ${leaked.join(", ")}` : "Tidak ada baris yang kembali"}`);
  const user = await fetch(`${SUPABASE}/rest/v1/User?select=email,passwordHash&limit=1`, { headers: { apikey: KEY } });
  const body = user.ok ? ((await user.json()) as unknown[]) : null;
  report(!body || body.length === 0, `Query User lewat REST: HTTP ${user.status}, ${body ? `${body.length} baris` : "ditolak"}`);
}

async function checkLogin() {
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  try {
    const csrf = await fetch(`${BASE}/api/auth/csrf`);
    keep(csrf);
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };
    const csrfCookie = cookie();
    const login = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: csrfCookie },
      body: new URLSearchParams({ csrfToken, email: "dlh@sunpulse.id", password: "demo1234", json: "true" }),
    });
    keep(login);
    const session = (await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookie() } })).json()) as { user?: { role?: string } };
    report(session.user?.role === "dlh", `Login aplikasi dlh@sunpulse.id: peran terbaca "${session.user?.role ?? "tidak ada"}"`);
    const data = await fetch(`${BASE}/api/v1/overview`, { headers: { cookie: cookie() } });
    report(data.status === 200, `Data aplikasi setelah login: /api/v1/overview HTTP ${data.status}`);
    const wrong = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: csrfCookie },
      body: new URLSearchParams({ csrfToken, email: "dlh@sunpulse.id", password: "kata-sandi-salah", json: "true" }),
    });
    const location = wrong.headers.get("location") ?? "";
    report(wrong.status === 401 || location.includes("error"), "Kata sandi salah tetap ditolak");
  } catch {
    report(false, `Aplikasi tidak terjangkau di ${BASE}. Jalankan npm run demo, lalu ulangi.`);
  }
}

async function main() {
  const tables = await checkTables();
  await checkRest(tables);
  await checkLogin();
  console.log(failed ? "\nHasil: GAGAL" : "\nHasil: semua lolos");
  process.exit(failed ? 1 : 0);
}

void main();
