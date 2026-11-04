import { PrismaPg } from "@prisma/adapter-pg";
import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Remote connections always verify the server certificate. Supabase's CA is not in Node's
 * trust store, so it is read from DATABASE_CA_CERT_FILE. Without that file the connection
 * fails rather than continuing unverified. A local Postgres for development has no TLS.
 */
export function createPrisma(url: string, max: number): PrismaClient {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const caFile = process.env.DATABASE_CA_CERT_FILE ?? "supabase-ca.crt";
  const ca = !local && existsSync(caFile) ? readFileSync(caFile, "utf8") : undefined;
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      max,
      connectionTimeoutMillis: 15_000,
      ssl: local ? false : { rejectUnauthorized: true, ca },
    }),
  });
}
