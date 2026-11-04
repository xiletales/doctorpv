import type { PrismaClient } from "@/generated/prisma/client";
import { createPrisma } from "./prisma-factory";

const holder = globalThis as unknown as { __prisma?: PrismaClient };

/** Runtime traffic goes through the transaction pooler (DATABASE_URL, port 6543). */
export const prisma: PrismaClient = holder.__prisma ?? createPrisma(process.env.DATABASE_URL ?? "", 5);

holder.__prisma = prisma;
