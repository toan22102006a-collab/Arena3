/**
 * build-inventory-md.mjs
 * Processes raw-inventory.json and builds test-output/cleanup/INVENTORY.md
 * with exact file:line spans, classification, and intended action.
 */
import fs from "node:fs";

const raw = JSON.parse(fs.readFileSync("test-output/cleanup/raw-inventory.json", "utf8"));

// Refine classification where needed
for (const item of raw) {
  const f = item.file;
  const s = item.snippet;

  if (f.startsWith("migrations/")) {
    item.classification = "OLD-MIGRATION";
    item.action = "Không sửa (migration cũ)";
  } else if (f === "src/routeTree.gen.ts" || f.includes("grading-report.json") || f.includes("Arena3-Grading-Report.md") || f.includes("interactive-tests-report.json")) {
    item.classification = "GENERATED";
    item.action = "Tự sinh lại hoặc không sửa tay";
  } else if (f.startsWith("docs/diagrams/")) {
    if (/day.?pass|daypass|debt/i.test(s)) {
      item.classification = "DEBT-STALE-DOC";
      item.action = "Sửa sơ đồ draw.io XML";
    }
  } else if (f.startsWith("docs/")) {
    if (f.includes("HANDOFF-SRS-v2.3.md")) {
      item.classification = "DEBT-STALE-DOC";
      item.action = "Thêm ghi chú superseded ở đầu file";
    } else if (f.includes("Arena3-Scope-Benchmark.md")) {
      item.classification = "DEBT-STALE-DOC";
      item.action = "Đổi trạng thái thành Removed by scope decision (v2.4)";
    } else if (/BR-44/i.test(s) && (/debt/i.test(s) || /hạn mức/i.test(s))) {
      item.classification = "BR44-WRONG";
      item.action = "Sửa thành quy tắc mở ca thu ngân";
    } else if (/BR-44/i.test(s)) {
      item.classification = "FALSE-POSITIVE";
      item.action = "Giữ nguyên (BR-44 đã đúng nghĩa mở ca)";
    } else {
      item.classification = "DEBT-STALE-DOC";
      item.action = "Sửa tài liệu";
    }
  } else if (f.startsWith("scripts/srs") || f === "scripts/build-srs-iii.py") {
    if (/BR-44/i.test(s) && /debt/i.test(s)) {
      item.classification = "BR44-WRONG";
      item.action = "Sửa script thành quy tắc mở ca";
    } else {
      item.classification = "DEBT-STALE-DOC";
      item.action = "Sửa script sinh tài liệu/sơ đồ";
    }
  } else if (f.startsWith("src/routes/desk.day-passes.tsx")) {
    item.classification = "UI-ENTRY";
    item.action = "Xoá toàn bộ file màn hình";
  } else if (f.startsWith("src/routes/desk.index.tsx") && /day-pass/i.test(s)) {
    item.classification = "UI-ENTRY";
    item.action = "Xoá lối vào quầy vé ngày";
  } else if (f.startsWith("src/routes/manager.index.tsx") && /day-pass/i.test(s)) {
    item.classification = "UI-ENTRY";
    item.action = "Xoá lối vào quản lý vé ngày";
  } else if (f.startsWith("src/components/shell.tsx") && /day-pass/i.test(s)) {
    item.classification = "UI-ENTRY";
    item.action = "Xoá mục menu shell";
  } else if (f.startsWith("src/routes/manager.settings.tsx") && /day_pass/i.test(s)) {
    item.classification = "UI-ENTRY";
    item.action = "Xoá ô cấu hình giá vé ngày";
  } else if (f.startsWith("src/routes/desk.payments.tsx") && (/owed/i.test(s) || /debt/i.test(s))) {
    item.classification = "DEBT-WORDING";
    item.action = "Đổi chữ thành toCollect / dueTotal";
  } else if (f.startsWith("src/lib/i18n/vi.desk.ts") && (/còn nợ/i.test(s) || /owed/i.test(s))) {
    item.classification = "DEBT-WORDING";
    item.action = "Đổi chuỗi dịch thành cần thu / không có khoản chờ thu";
  } else if (f.startsWith("src/lib/arena3/router.ts") && /day-passes/i.test(s)) {
    item.classification = "WRITE-PATH";
    item.action = "Xoá 4 route day-passes";
  } else if (f.startsWith("src/lib/arena3/handlers/extras.ts")) {
    if (/ref_type in/.test(s)) {
      item.classification = "HISTORY-READ";
      item.action = "Giữ lại đọc lịch sử ca, thêm comment";
    } else if (/dayPass/i.test(s) || /day-pass/i.test(s)) {
      item.classification = "WRITE-PATH";
      item.action = "Xoá hàm xử lý vé ngày";
    }
  } else if (f.startsWith("src/lib/arena3/handlers/desk.ts")) {
    if (/day_pass_vnd/i.test(s)) {
      item.classification = "WRITE-PATH";
      item.action = "Xoá trường khỏi select/update settings";
    } else if (/debt/i.test(s)) {
      item.classification = "DEBT-WORDING";
      item.action = "Sửa comment làm rõ không có nợ";
    }
  } else if (f.startsWith("src/lib/arena3/validate.ts") && /day_pass_vnd/i.test(s)) {
    item.classification = "WRITE-PATH";
    item.action = "Bỏ khỏi schema settings";
  } else if (f.startsWith("src/lib/arena3/helpers.ts") && /day_pass_vnd/i.test(s)) {
    item.classification = "WRITE-PATH";
    item.action = "Bỏ khỏi kiểu CenterSettings";
  } else if (f.startsWith("src/lib/arena3/labels.ts") && /day_pass/i.test(s)) {
    item.classification = "HISTORY-READ";
    item.action = "Giữ nhãn lịch sử";
  } else if (f.startsWith("src/routes/manager.audit.tsx") && /day_pass/i.test(s)) {
    item.classification = "HISTORY-READ";
    item.action = "Giữ nhãn lịch sử audit";
  } else if (f.startsWith("src/lib/i18n/vi.ops.ts") || f.startsWith("src/lib/i18n/vi.srv.ts")) {
    if (/"Day pass"|"Sell day pass"|"Use day pass"|"Void day pass"/i.test(s)) {
      item.classification = "HISTORY-READ";
      item.action = "Giữ khoá dịch lịch sử";
    } else if (/day pass/i.test(s) || /vé ngày/i.test(s)) {
      item.classification = "WRITE-PATH";
      item.action = "Xoá khoá dịch vé ngày không còn dùng";
    }
  } else if (f.startsWith("scripts/tests/agent/")) {
    if (/DP-/i.test(s) || /day-passes/i.test(s) || /day.?pass/i.test(s)) {
      item.classification = "WRITE-PATH";
      item.action = "Cập nhật hoặc xoá case test vé ngày";
    } else if (/BR-44/i.test(s)) {
      item.classification = "FALSE-POSITIVE";
      item.action = "Giữ nguyên (BR-44 đúng nghĩa mở ca)";
    }
  } else if (f.startsWith("scripts/tests/")) {
    if (/day.?pass/i.test(s)) {
      item.classification = "WRITE-PATH";
      item.action = "Xoá luồng test vé ngày";
    }
  } else if (f === "scripts/arena3-srs141-check.mjs") {
    item.classification = "FALSE-POSITIVE";
    item.action = "Giữ nguyên (bằng chứng công nợ đã gỡ)";
  } else if (f === "scripts/auto-grade.mjs") {
    item.classification = "DEBT-STALE-DOC";
    item.action = "Cập nhật tiêu chí chấm điểm";
  }
}

// Tally counts
const tally = {
  "WRITE-PATH": 0,
  "UI-ENTRY": 0,
  "HISTORY-READ": 0,
  "DEBT-WORDING": 0,
  "DEBT-STALE-DOC": 0,
  "BR44-WRONG": 0,
  "OLD-MIGRATION": 0,
  "GENERATED": 0,
  "FALSE-POSITIVE": 0,
  "UNCLASSIFIED": 0,
};

for (const item of raw) {
  tally[item.classification] = (tally[item.classification] || 0) + 1;
}

const mdLines = [
  "# BẢNG KIỂM KÊ TOÀN DIỆN TRƯỚC KHI SỬA (INVENTORY.md)",
  "",
  `**Thời điểm quét:** ${new Date().toISOString()}`,
  `**Tổng số vị trí phát hiện:** ${raw.length}`,
  "",
  "## 1. Bảng tổng hợp số lượng theo nhãn phân loại",
  "",
  "| Nhãn phân loại | Số lượng | Mô tả & Hướng xử lý |",
  "| :--- | :---: | :--- |",
  `| \`WRITE-PATH\` | **${tally["WRITE-PATH"]}** | Code bán/dùng/huỷ vé ngày, cấu hình giá, test liên quan → **Xoá / Sửa** |`,
  `| \`UI-ENTRY\` | **${tally["UI-ENTRY"]}** | Menu, nút bấm, liên kết, màn hình dẫn tới vé ngày → **Xoá** |`,
  `| \`HISTORY-READ\` | **${tally["HISTORY-READ"]}** | Nhãn audit, ref_type, sổ ca, hoá đơn đọc dữ liệu cũ → **Giữ nguyên + comment** |`,
  `| \`DEBT-WORDING\` | **${tally["DEBT-WORDING"]}** | Chữ nợ/owed mô tả đơn chờ thanh toán hoặc phần còn phải thu → **Đổi chữ** |`,
  `| \`DEBT-STALE-DOC\` | **${tally["DEBT-STALE-DOC"]}** | Tài liệu đặc tả SRS, SDD, sơ đồ, script sinh còn mô tả nợ/vé ngày → **Sửa tài liệu** |`,
  `| \`BR44-WRONG\` | **${tally["BR44-WRONG"]}** | Tài liệu/script gọi BR-44 là debt limit → **Sửa thành quy tắc mở ca thu ngân** |`,
  `| \`OLD-MIGRATION\` | **${tally["OLD-MIGRATION"]}** | Migration cũ đã chạy (migrations/00xx_*.sql) → **Không sửa (luật cứng)** |`,
  `| \`GENERATED\` | **${tally["GENERATED"]}** | File tự sinh (routeTree.gen.ts, báo cáo chấm điểm...) → **Không sửa tay, sinh lại** |`,
  `| \`FALSE-POSITIVE\` | **${tally["FALSE-POSITIVE"]}** | Trùng từ khoá nhưng đúng ngữ cảnh hoặc không liên quan → **Giữ nguyên** |`,
  `| **TỔNG CỘNG** | **${raw.length}** | |`,
  "",
  "## 2. Kiểm tra cờ tính năng (`src/lib/arena3/flags.ts`)",
  "",
  "- **Kết quả:** Đã kiểm tra trực tiếp mã nguồn `src/lib/arena3/flags.ts`. File chỉ khai báo 3 cờ: `F4` (điểm danh/kết quả), `F5` (kế hoạch huấn luyện), `F6` (bài tập về nhà). **Hoàn toàn không có cờ tính năng nào dành cho vé ngày.**",
  "",
  "## 3. Danh sách kiểm tra các điểm bắt buộc (Checklist Mục 2)",
  "",
  "- [x] `src/lib/arena3/router.ts:338–351`: 4 route `/day-passes` (`WRITE-PATH`)",
  "- [x] `src/lib/arena3/handlers/extras.ts:369–484`: `dayPassSell`, `dayPassList`, `dayPassUse`, `dayPassVoid` (`WRITE-PATH`)",
  "- [x] `src/lib/arena3/handlers/extras.ts:501`: `ref_type in ('booking','subscription','day_pass')` (`HISTORY-READ`)",
  "- [x] `src/routes/desk.day-passes.tsx`: Màn hình bán/quản lý vé ngày quầy (`UI-ENTRY`)",
  "- [x] `src/routes/desk.index.tsx:228`, `src/routes/manager.index.tsx:222`, `src/components/shell.tsx:85–87,117`: Lối vào UI (`UI-ENTRY`)",
  "- [x] `src/routes/manager.settings.tsx:46,223,227`, `src/lib/arena3/validate.ts:54,89`, `src/lib/arena3/helpers.ts:43,57`, `src/lib/arena3/handlers/desk.ts:1019`: Cấu hình giá vé ngày (`WRITE-PATH`, `UI-ENTRY`)",
  "- [x] `src/routes/manager.audit.tsx:113,123,124,144`, `src/lib/arena3/labels.ts:227`: Hiển thị audit lịch sử (`HISTORY-READ`)",
  "- [x] `src/lib/i18n/vi.ops.ts`, `src/lib/i18n/vi.srv.ts`: Chuỗi dịch vé ngày (`WRITE-PATH`, `HISTORY-READ`)",
  "- [x] `src/routes/desk.payments.tsx:206,352–355,587`, `src/lib/i18n/vi.desk.ts:294,322`: Thuật ngữ owed/debt (`DEBT-WORDING`)",
  "- [x] `src/lib/arena3/handlers/desk.ts:297,611`: Comment nhắc debt (`DEBT-WORDING`)",
  "- [x] `docs/SRS.md:163` (FR-B08), `:357` (FR-G03 debt), `:372` (FR-G18 debt), `:544` (BR-44 sai nghĩa) (`DEBT-STALE-DOC`, `BR44-WRONG`)",
  "- [x] `docs/SDD.md:216`: subscription-debt view (`DEBT-STALE-DOC`)",
  "- [x] `docs/SRS-feature-checklist.md:86,96,204`, `docs/FIXLIST.md:48,241`, `docs/HANDOFF-SRS-v2.3.md` (`DEBT-STALE-DOC`)",
  "- [x] `docs/diagrams/srs/*.drawio`: 6 file sơ đồ cần dọn (`DEBT-STALE-DOC`)",
  "- [x] Script sinh tài liệu & sơ đồ: `build-srs-iii.py`, `doc-nb.txt`, `br_map.py`, `srs_diagrams/*.py` (`DEBT-STALE-DOC`)",
  "- [x] Test suites & scripts: `01`, `09`, `12`, `13`, `14a`, `14b`, `14e`, `14f`, `audit-expects`, `regression.mjs` (`WRITE-PATH`)",
  "- [x] Tài liệu tiếng Việt & QA: Sổ tay kiểm thử, Phân công, Scope Benchmark, Test Instructions, Test Suites (`DEBT-STALE-DOC`)",
  "",
  "## 4. Chi tiết từng vị trí quét được trong toàn bộ codebase",
  "",
  "| File:Dòng | Trích đoạn ngắn | Phân loại | Hành động dự kiến |",
  "| :--- | :--- | :---: | :--- |",
];

for (const item of raw) {
  const snip = item.snippet.replace(/\|/g, "\\|").slice(0, 100);
  mdLines.push(`| \`${item.file}:${item.line}\` | \`${snip}\` | \`${item.classification}\` | ${item.action} |`);
}

fs.writeFileSync("test-output/cleanup/INVENTORY.md", mdLines.join("\n"));
console.log("Wrote test-output/cleanup/INVENTORY.md successfully.");
