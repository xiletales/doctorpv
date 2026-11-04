import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 reads the CLI connection here. `db push` and `db execute` use the session pooler
// (DIRECT_URL, port 5432). The application connects separately with DATABASE_URL in src/lib/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DIRECT_URL ?? "" },
});
