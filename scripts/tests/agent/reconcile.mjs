/**
 * reconcile.mjs — Đối soát số liệu chính xác từ test-output/results/*.jsonl
 * Lấy dòng cuối của mỗi id (last row wins), phát hiện trùng lặp, id thiếu verdict, file rỗng.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RESULTS_DIR = join(ROOT, "test-output", "results");
const OUT_FILE = join(ROOT, "test-output", "round2", "RECONCILE.md");
const OUT_FILE_R3 = join(ROOT, "test-output", "round3", "RECONCILE.md");
const OUT_FILE_R4 = join(ROOT, "test-output", "round4", "RECONCILE.md");
const VERDICTS = ["PASS", "FAIL", "WARN", "BLOCKED"];

const verdictOf = (row) => {
  if (row.verdict && VERDICTS.includes(String(row.verdict).toUpperCase())) {
    return String(row.verdict).toUpperCase();
  }
  if (row.result && VERDICTS.includes(String(row.result).toUpperCase())) {
    return String(row.result).toUpperCase();
  }
  const v = Object.values(row).find((x) => typeof x === "string" && VERDICTS.includes(x.toUpperCase()));
  return v ? v.toUpperCase() : "NO_VERDICT";
};

mkdirSync(join(ROOT, "test-output", "round2"), { recursive: true });
mkdirSync(join(ROOT, "test-output", "round3"), { recursive: true });
mkdirSync(join(ROOT, "test-output", "round4"), { recursive: true });

const files = existsSync(RESULTS_DIR)
  ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".jsonl")).sort()
  : [];

const mdLines = [
  "# BÁO CÁO ĐỐI SOÁT SỐ LIỆU HỆ THỐNG (RECONCILE)",
  "",
  `Thời điểm tạo: ${new Date().toISOString()}`,
  `Thư mục quét: \`test-output/results/*.jsonl\``,
  "",
  "## 1. Bảng số liệu chuẩn hoá (Last row per ID wins)",
  "",
  "| Suite | Raw Rows | Unique Cases | PASS | FAIL | WARN | BLOCKED | NO_VERDICT |",
  "| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
];

const duplicates = [];
const noVerdicts = [];
const emptyFiles = [];

const total = { raw: 0, unique: 0, PASS: 0, FAIL: 0, WARN: 0, BLOCKED: 0, NO_VERDICT: 0 };

for (const file of files) {
  const filePath = join(RESULTS_DIR, file);
  const suiteName = file.replace(/\.jsonl$/, "");
  const content = readFileSync(filePath, "utf8");
  const rawLines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (rawLines.length === 0) {
    emptyFiles.push(file);
    mdLines.push(`| ${suiteName} | 0 | 0 | 0 | 0 | 0 | 0 | 0 |`);
    continue;
  }

  total.raw += rawLines.length;

  const seenIds = new Map(); // id -> count
  const lastRowMap = new Map(); // id -> row

  let lineIndex = 0;
  for (const line of rawLines) {
    lineIndex++;
    try {
      const obj = JSON.parse(line);
      const id = obj.id ?? `#anon-${lineIndex}`;
      seenIds.set(id, (seenIds.get(id) || 0) + 1);
      lastRowMap.set(id, obj);
    } catch (err) {
      console.error(`Lỗi JSON line ${lineIndex} trong ${file}:`, err.message);
    }
  }

  for (const [id, count] of seenIds.entries()) {
    if (count > 1) {
      duplicates.push({ suite: suiteName, file, id, count });
    }
  }

  const counts = { PASS: 0, FAIL: 0, WARN: 0, BLOCKED: 0, NO_VERDICT: 0 };
  for (const [id, row] of lastRowMap.entries()) {
    const v = verdictOf(row);
    if (v === "NO_VERDICT") {
      noVerdicts.push({ suite: suiteName, id, title: row.title ?? "" });
    }
    counts[v] = (counts[v] || 0) + 1;
  }

  total.unique += lastRowMap.size;
  total.PASS += counts.PASS;
  total.FAIL += counts.FAIL;
  total.WARN += counts.WARN;
  total.BLOCKED += counts.BLOCKED;
  total.NO_VERDICT += counts.NO_VERDICT;

  mdLines.push(
    `| ${suiteName} | ${rawLines.length} | ${lastRowMap.size} | ${counts.PASS} | ${counts.FAIL} | ${counts.WARN} | ${counts.BLOCKED} | ${counts.NO_VERDICT} |`
  );
}

mdLines.push(
  `| **TỔNG CỘNG** | **${total.raw}** | **${total.unique}** | **${total.PASS}** | **${total.FAIL}** | **${total.WARN}** | **${total.BLOCKED}** | **${total.NO_VERDICT}** |`,
  ""
);

mdLines.push("## 2. Danh sách ID trùng lặp trong cùng file", "");
if (duplicates.length === 0) {
  mdLines.push("*(Không có ID trùng lặp)*", "");
} else {
  mdLines.push("| Suite | Case ID | Số lần xuất hiện | Xử lý |", "| --- | --- | :---: | --- |");
  for (const d of duplicates) {
    mdLines.push(`| ${d.suite} | \`${d.id}\` | ${d.count} | Giữ dòng cuối (last row wins) |`);
  }
  mdLines.push("");
}

mdLines.push("## 3. Danh sách ID không có verdict", "");
if (noVerdicts.length === 0) {
  mdLines.push("*(Không có case nào thiếu verdict)*", "");
} else {
  mdLines.push("| Suite | Case ID | Title |", "| --- | --- | --- |");
  for (const nv of noVerdicts) {
    mdLines.push(`| ${nv.suite} | \`${nv.id}\` | ${nv.title} |`);
  }
  mdLines.push("");
}

mdLines.push("## 4. Danh sách file JSONL rỗng", "");
if (emptyFiles.length === 0) {
  mdLines.push("*(Không có file rỗng)*", "");
} else {
  for (const ef of emptyFiles) {
    mdLines.push(`- \`${ef}\` (0 bytes / 0 dòng)`);
  }
  mdLines.push("");
}

writeFileSync(OUT_FILE, mdLines.join("\n"));
writeFileSync(OUT_FILE_R3, mdLines.join("\n"));
writeFileSync(OUT_FILE_R4, mdLines.join("\n"));
console.log(mdLines.join("\n"));
console.log(`\nĐã ghi: ${OUT_FILE}, ${OUT_FILE_R3} và ${OUT_FILE_R4}`);
