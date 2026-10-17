import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "test-output/results";
const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
const warns = [];

for (const f of files) {
  const lines = readFileSync(join(dir, f), "utf8").split(/\r?\n/).filter(Boolean);
  for (const l of lines) {
    try {
      const obj = JSON.parse(l);
      const v = (obj.result || obj.verdict || "").toUpperCase();
      if (v === "WARN") {
        warns.push({ suite: obj.suite || f.replace(".jsonl", ""), id: obj.id, title: obj.title });
      }
    } catch {}
  }
}

console.log(`Total WARN: ${warns.length}`);
for (const w of warns) {
  console.log(`${w.suite}:${w.id} — ${w.title}`);
}
