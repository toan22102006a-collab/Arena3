/**
 * inventory-scan.mjs — Comprehensive scanner for debt, day pass, and BR-44
 * Scans the codebase excluding node_modules, test-output, .output, dist, attachments, graft, .agents, agent.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".");
const EXCLUDE_DIRS = new Set([
  "node_modules",
  "test-output",
  ".output",
  "dist",
  "attachments",
  "graft",
  ".agents",
  "agent",
  ".git",
  ".gemini",
  ".claude",
  ".cursor",
  ".adal",
  ".windsurf",
  ".kiro",
]);

// Patterns
const PATTERNS = {
  daypass: [/day[\s_-]?pass/i, /daypass/i, /day_passes/i, /v[eé]\s*ng[aà]y/i, /DP-0/i],
  debt: [/debt/i, /c[oô]ng\s*n[oợ]/i, /cong\s*no/i, /owed/i, /c[oò]n\s*n[oợ]/i, /kho[aả]n\s*n[oợ]/i, /debt_limit/i, /v_subscription_debt/i, /FR-B08/i],
  br44: [/BR-44/i],
};

function walk(dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      files = files.concat(walk(path.join(dir, entry.name)));
    } else {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

const allFiles = walk(ROOT);
console.log(`Scanning ${allFiles.length} files...`);

const matches = [];

for (const filePath of allFiles) {
  const relPath = path.relative(ROOT, filePath).replace(/\\/g, "/");
  // Skip binary files
  if (/\.(png|jpg|jpeg|gif|ico|webp|pdf|zip|tar|gz|woff|woff2|ttf|eot)$/i.test(relPath)) continue;

  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    continue;
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    let matchedCat = null;
    if (PATTERNS.br44[0].test(line)) {
      matchedCat = "BR-44";
    } else if (PATTERNS.daypass.some((p) => p.test(line))) {
      matchedCat = "Day Pass";
    } else if (PATTERNS.debt.some((p) => p.test(line))) {
      matchedCat = "Debt";
    }

    if (!matchedCat) continue;

    // Classification logic
    let classification = "UNCLASSIFIED";
    let action = "TODO";

    // 1. OLD-MIGRATION
    if (relPath.startsWith("migrations/")) {
      classification = "OLD-MIGRATION";
      action = "Không sửa (migration cũ)";
    }
    // 2. GENERATED
    else if (
      relPath === "src/routeTree.gen.ts" ||
      relPath.includes("grading-report.json") ||
      relPath.includes("interactive-tests-report.json") ||
      relPath.includes("Arena3-Grading-Report.md")
    ) {
      classification = "GENERATED";
      action = "Tự sinh lại hoặc không sửa tay";
    }
    // 3. BR44-WRONG vs BR44 Correct
    else if (matchedCat === "BR-44") {
      if (/debt/i.test(line) || /hạn mức/i.test(line)) {
        classification = "BR44-WRONG";
        action = "Sửa tài liệu thành quy tắc mở ca";
      } else {
        classification = "FALSE-POSITIVE";
        action = "Giữ nguyên (BR-44 đã đúng nghĩa mở ca)";
      }
    }
    // 4. WRITE-PATH
    else if (
      (relPath === "src/lib/arena3/router.ts" && lineNum >= 335 && lineNum <= 355) ||
      (relPath === "src/lib/arena3/handlers/extras.ts" && lineNum >= 365 && lineNum <= 485) ||
      (relPath === "src/lib/arena3/validate.ts" && /day_pass_vnd/.test(line)) ||
      (relPath === "src/lib/arena3/helpers.ts" && /day_pass_vnd/.test(line)) ||
      (relPath === "src/lib/arena3/handlers/desk.ts" && /day_pass_vnd/.test(line))
    ) {
      classification = "WRITE-PATH";
      action = "Xoá code";
    }
    // 5. UI-ENTRY
    else if (
      relPath === "src/routes/desk.day-passes.tsx" ||
      (relPath === "src/routes/desk.index.tsx" && /day-pass/i.test(line)) ||
      (relPath === "src/routes/manager.index.tsx" && /day-pass/i.test(line)) ||
      (relPath === "src/components/shell.tsx" && /day-pass/i.test(line)) ||
      (relPath === "src/routes/manager.settings.tsx" && /day_pass/i.test(line))
    ) {
      classification = "UI-ENTRY";
      action = "Xoá lối vào / màn hình UI";
    }
    // 6. HISTORY-READ
    else if (
      (relPath.includes("extras.ts") && /ref_type in/.test(line)) ||
      (relPath.includes("labels.ts") && /day_pass/i.test(line)) ||
      (relPath.includes("manager.audit.tsx") && /day_pass/i.test(line)) ||
      (relPath.includes("vi.ops.ts") && /"Day pass"|"Sell day pass"|"Use day pass"|"Void day pass"/i.test(line))
    ) {
      classification = "HISTORY-READ";
      action = "Giữ để đọc lịch sử audit/tiền cũ";
    }
    // 7. DEBT-WORDING
    else if (
      (relPath.includes("desk.payments.tsx") && (/owed/i.test(line) || /debt/i.test(line))) ||
      (relPath.includes("vi.desk.ts") && (/còn nợ/i.test(line) || /owed/i.test(line)))
    ) {
      classification = "DEBT-WORDING";
      action = "Đổi chữ thành toCollect / cần thu";
    }
    // 8. DEBT-STALE-DOC
    else if (
      (relPath.startsWith("docs/") || relPath.startsWith("scripts/srs")) &&
      (/debt/i.test(line) || /công nợ/i.test(line) || /FR-B08/i.test(line) || /day.?pass/i.test(line))
    ) {
      classification = "DEBT-STALE-DOC";
      action = "Sửa tài liệu / script sinh";
    }
    // 9. TEST SCRIPTS
    else if (relPath.startsWith("scripts/tests/")) {
      if (/day.?pass/i.test(line) || /DP-/i.test(line)) {
        classification = "WRITE-PATH";
        action = "Cập nhật hoặc xoá case test vé ngày";
      } else {
        classification = "FALSE-POSITIVE";
        action = "Kiểm tra ngữ cảnh test";
      }
    }
    // 10. Source code text
    else if (relPath.startsWith("src/")) {
      if (/day.?pass/i.test(line)) {
        classification = "WRITE-PATH";
        action = "Xoá hoặc sửa";
      } else if (/debt/i.test(line)) {
        if (relPath.includes("arena3-srs141-check")) {
          classification = "FALSE-POSITIVE";
          action = "Giữ nguyên (khẳng định không có debt)";
        } else {
          classification = "DEBT-WORDING";
          action = "Rà soát đổi chữ";
        }
      }
    } else {
      classification = "FALSE-POSITIVE";
      action = "Kiểm tra thêm";
    }

    matches.push({
      file: relPath,
      line: lineNum,
      snippet: line.trim().slice(0, 120),
      cat: matchedCat,
      classification,
      action,
    });
  }
}

console.log(`Found ${matches.length} matching occurrences.`);

const tally = {};
for (const m of matches) {
  tally[m.classification] = (tally[m.classification] || 0) + 1;
}
console.log("Tally by classification:", tally);

fs.writeFileSync("test-output/cleanup/raw-inventory.json", JSON.stringify(matches, null, 2));
console.log("Wrote raw-inventory.json");
