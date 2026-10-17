import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const jsonPath = join(ROOT, "test-output", "round2", "eslint-src.json");
const data = JSON.parse(readFileSync(jsonPath, "utf8"));

let totalErrors = 0;
let totalWarnings = 0;
const ruleCounts = {};

for (const file of data) {
  totalErrors += file.errorCount;
  totalWarnings += file.warningCount;
  for (const m of file.messages) {
    const r = m.ruleId || "unknown";
    ruleCounts[r] = (ruleCounts[r] || 0) + 1;
  }
}

const sortedRules = Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]);

console.log("Total files checked in src/:", data.length);
console.log("Total Errors in src/:", totalErrors);
console.log("Total Warnings in src/:", totalWarnings);
console.log("\nTop 10 rules:");
sortedRules.slice(0, 10).forEach(([r, c], i) => {
  console.log(`${i + 1}. ${r}: ${c}`);
});

const outMd = [
  "# BÁO CÁO STATIC GATES — ESLINT TRÊN THƯ MỤC SRC/",
  "",
  `Thời điểm kiểm tra: ${new Date().toISOString()}`,
  `- **Thư mục quét**: \`src/\` (chỉ mã nguồn dự án, loại trừ hoàn toàn .adal, .agents, .claude, test-output, scripts)`,
  `- **Tổng số file quét**: ${data.length} files`,
  `- **Tổng số Lỗi (Errors)**: **${totalErrors}**`,
  `- **Tổng số Cảnh báo (Warnings)**: **${totalWarnings}**`,
  "",
  "## Top 10 Quy tắc bị vi phạm nhiều nhất trong `src/`:",
  "| Hạng | Tên Rule | Số lần vi phạm |",
  "|:---:|---|:---:|",
  ...sortedRules.slice(0, 10).map(([r, c], i) => `| ${i + 1} | \`${r}\` | ${c} |`),
  "",
  "## Giải trình đối soát so với Vòng 1:",
  "- **Vòng 1 báo 10.446 lỗi**: Con số này do lệnh chạy ESLint không giới hạn thư mục nên đã quét qua toàn bộ các thư mục untracked/công cụ ngoài như `.adal/`, `.agents/`, `.claude/`, `test-output/`.",
  `- **Vòng 2 quét chuẩn xác chỉ trên \`src/\`**: Số lỗi thực tế của mã nguồn là **${totalErrors} errors** (và **${totalWarnings} warnings**).`,
  "",
];

writeFileSync(join(ROOT, "test-output", "round2", "ESLINT-REPORT.md"), outMd.join("\n"));
console.log("Đã ghi báo cáo ra test-output/round2/ESLINT-REPORT.md");
