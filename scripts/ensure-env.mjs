// Creates .env once from .env.example. It generates only the two local secrets, never writes
// database credentials, never overwrites an existing .env, and never prints any value.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (!existsSync(".env")) {
  const content = readFileSync(".env.example", "utf8").replace(
    /^(NEXTAUTH_SECRET|GATEWAY_KEY_SECRET)="change-me"$/gm,
    (_, name) => `${name}="${randomBytes(32).toString("hex")}"`,
  );
  writeFileSync(".env", content, { mode: 0o600 });
  console.log("Dibuat: .env, dengan NEXTAUTH_SECRET dan GATEWAY_KEY_SECRET acak.");
}

const fromFile = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .map((line) => line.match(/^([A-Z_]+)=["']?(.*?)["']?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const value = (name) => process.env[name] ?? fromFile[name] ?? "";
let remote = false;

function problemWithUrl(name, expectedPort) {
  const v = value(name);
  if (!v) return `${name} belum diisi.`;
  if (/[<>]|YOUR-|change-me/i.test(v)) return `${name} masih placeholder.`;
  let url;
  try {
    url = new URL(v);
  } catch {
    return `${name} bukan URL yang valid. Karakter khusus pada password harus di-percent-encode.`;
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) return `${name} harus berupa URL postgresql://.`;
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) remote = true;
  if (url.hostname.endsWith(".supabase.com") || url.hostname.endsWith(".supabase.co")) {
    if (/^db\..*\.supabase\.co$/.test(url.hostname)) return `${name} memakai host langsung yang hanya IPv6. Pakai host pooler dari dialog Connect.`;
    if (url.port !== expectedPort) return `${name} harus memakai port ${expectedPort}.`;
    if (!url.username.startsWith("postgres.")) return `Username ${name} harus berbentuk postgres.<project-ref>.`;
  }
  return null;
}

const problems = [problemWithUrl("DATABASE_URL", "6543"), problemWithUrl("DIRECT_URL", "5432")].filter(Boolean);
for (const name of ["NEXTAUTH_SECRET", "GATEWAY_KEY_SECRET"]) {
  if (!value(name) || value(name) === "change-me") problems.push(`${name} belum diisi.`);
}
const caFile = value("DATABASE_CA_CERT_FILE") || "supabase-ca.crt";
if (remote && !existsSync(caFile)) {
  problems.push(`Sertifikat CA ${caFile} tidak ditemukan. Unduh dari Database settings > SSL Configuration di dashboard Supabase.`);
}

if (problems.length > 0) {
  console.error(`\nKonfigurasi .env belum lengkap:\n${problems.map((p) => `  - ${p}`).join("\n")}\n\nIsi nilainya di .env. URL database ada di Connect pada dashboard Supabase. Lihat README.md.\n`);
  process.exit(1);
}
