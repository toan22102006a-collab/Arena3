import { readFileSync } from "node:fs";

const content = readFileSync("src/lib/arena3/router.ts", "utf8");
const lines = content.split("\n");

// We want to capture all route definitions in dispatch(request)
// They look like:
// if (method === "GET" && p0 === "health" && !p1)
// if (method === "POST" && p0 === "payments" && p1 === "online" && p2 && parts[3] === "verify")
// if (method === "GET" && p0 === "invoices" && p1?.endsWith(".xml"))
// if (method === "DELETE" && p0 === "enrollments" && p1)
// if (method === "DELETE" && p0 === "payments")

const routes = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = line.match(/if\s*\(\s*method\s*===\s*["'](GET|POST|PATCH|PUT|DELETE)["']/);
  if (!m) continue;

  const method = m[1];
  let fullCond = line;
  let j = i;
  while (!fullCond.includes("{") && j < lines.length - 1) {
    j++;
    fullCond += " " + lines[j].trim();
  }

  // Find handler
  let handler = "";
  for (let k = j; k < Math.min(lines.length, j + 8); k++) {
    const l = lines[k].trim();
    if (l.startsWith("return ") || l.startsWith("throw ")) {
      handler = l;
      break;
    }
  }

  routes.push({
    line: i + 1,
    method,
    rawCond: fullCond.trim().replace(/\s*\{\s*$/, "").replace(/^if\s*\(/, "").replace(/\)$/, "").trim(),
    handler: handler
  });
}

console.log(`Total routes detected: ${routes.length}`);
const byMethod = {};
for (const r of routes) {
  byMethod[r.method] = (byMethod[r.method] || 0) + 1;
}
console.log("By method:", byMethod);
const writeMethods = ["POST", "PATCH", "PUT", "DELETE"];
const writes = routes.filter(r => writeMethods.includes(r.method));
console.log(`Write routes (POST, PATCH, PUT, DELETE): ${writes.length}`);

// Print all routes
routes.forEach((r, idx) => {
  console.log(`${idx + 1}. [L${r.line}] ${r.method.padEnd(6)} | ${r.rawCond} -> ${r.handler}`);
});
