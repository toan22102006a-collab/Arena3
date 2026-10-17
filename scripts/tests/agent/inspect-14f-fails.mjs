import { readFileSync } from "node:fs";

const lines = readFileSync("test-output/results/14f-role-matrix.jsonl", "utf8").trim().split("\n");
const fails = [];
for (const line of lines) {
  if (!line) continue;
  try {
    const obj = JSON.parse(line);
    if (obj.verdict === "FAIL") {
      fails.push(obj);
    }
  } catch {}
}

console.log(`Total 14f FAILs in Round 3: ${fails.length}`);
fails.forEach((f, idx) => {
  console.log(`${idx + 1}. [${f.id}] actual=${f.actual?.status ?? f.actual} exp=${JSON.stringify(f.expected)} why=${f.why || ""}`);
});
