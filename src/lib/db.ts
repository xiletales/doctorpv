import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

const holder = globalThis as unknown as { __prisma?: PrismaClient };

export const prisma: PrismaClient =
  holder.__prisma ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./data/sunpulse.db" }),
  });

holder.__prisma = prisma;
