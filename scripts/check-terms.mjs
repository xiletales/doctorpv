// The product has no alley concept. Fails the build if the old term comes back in code, UI, seed data or docs.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mjs|prisma|md|json|css)$/.test(f) && !f.endsWith("package-lock.json") && !f.endsWith("check-terms.mjs"));
const pattern = /(^|[^a-z])gang(?!guan)|DOCTOR PV|doctorpv/i;
const hits = [];
for (const f of files) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (pattern.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}
if (hits.length > 0) {
  console.error(`Old terms found:\n${hits.join("\n")}`);
  process.exit(1);
}
