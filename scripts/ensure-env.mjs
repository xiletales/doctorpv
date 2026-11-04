// Creates .env from .env.example with fresh random secrets, and the data directory.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("data/uploads", { recursive: true });
if (!existsSync(".env")) {
  const content = readFileSync(".env.example", "utf8").replace(
    /"change-me"/g,
    () => `"${randomBytes(32).toString("hex")}"`,
  );
  writeFileSync(".env", content);
  console.log("Created .env");
}
