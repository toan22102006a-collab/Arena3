import fs from "node:fs";
import path from "node:path";

const dir = "test-output/bugfix/G-1/final";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl"));
const cases = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), "utf8").trim().split(/\r?\n/);
  for (const l of lines) {
    if (!l.trim()) continue;
    cases.push({ ...JSON.parse(l), suite: f.replace(".jsonl", "") });
  }
}
console.log("Total cases in G-1/final:", cases.length);
const targets = cases.filter(c => {
  const id = c.id;
  return id === "BK-04" || id === "WI-09" || id === "PS-20" || id === "SEC-85" || id === "SEC-92" ||
         /^FZ-.*-nul_byte$/.test(id) || /^FZ-.*-body_null$/.test(id);
});
console.log("Matching target cases:", targets.length);

const grouped = {
  FAIL: [],
  WARN: [],
  PASS: [],
  BLOCKED: [],
};

for (const t of targets) {
  grouped[t.result]?.push(`${t.suite}:${t.id}`);
}

console.log("\nTarget cases in G-1/final by result:");
console.log("FAIL (" + grouped.FAIL.length + "):", grouped.FAIL);
console.log("WARN (" + grouped.WARN.length + "):", grouped.WARN);
console.log("PASS (" + grouped.PASS.length + "):", grouped.PASS);
console.log("BLOCKED (" + grouped.BLOCKED.length + "):", grouped.BLOCKED);
