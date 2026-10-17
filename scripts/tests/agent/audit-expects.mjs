/**
 * audit-expects.mjs — Phân tích toàn bộ các lời gọi check() và blocked()
 * trong scripts/tests/agent/0*.mjs và 1*.mjs.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const AGENT_SCRIPTS = join(ROOT, "scripts", "tests", "agent");
const OUT_FILE = join(ROOT, "test-output", "round2", "EXPECT-AUDIT.md");

const suiteFiles = readdirSync(AGENT_SCRIPTS)
  .filter((f) => /^(0[1-9]|1[0-5])-.*\.mjs$/.test(f))
  .sort();

console.log(`Tìm thấy ${suiteFiles.length} suite files để kiểm toán.`);

const auditRows = [];
const suspiciousCases = [];

for (const file of suiteFiles) {
  const content = readFileSync(join(AGENT_SCRIPTS, file), "utf8");
  const suiteName = file.replace(/\.mjs$/, "");

  // Tìm các lời gọi check("ID", "Title", actual/resp, expectOpts)
  // Regex tìm check("ID"...)
  const checkRegex = /check\s*\(\s*(["'])([\w\d\-_\.]+)\1\s*,\s*(["'])(.*?)\3\s*,\s*([^,]+?)\s*,\s*(\{[\s\S]*?\})\s*\)/g;
  let match;
  while ((match = checkRegex.exec(content)) !== null) {
    const id = match[2];
    const title = match[4];
    const expectStr = match[6].replace(/\s+/g, " ");

    let suspicious = false;
    const reasons = [];

    // Kiểm tra: status có chứa cả 2xx lẫn 4xx/5xx không?
    if (/status\s*:\s*\[[^\]]*2\d\d[^\]]*[45]\d\d[^\]]*\]/.test(expectStr)) {
      suspicious = true;
      reasons.push("Status chứa cả 2xx và 4xx/5xx");
    }

    // Kiểm tra test: () => true
    if (/test\s*:\s*\(\s*\)\s*=>\s*true/.test(expectStr) || /test\s*:\s*function\s*\(\s*\)\s*\{\s*return\s*true/.test(expectStr)) {
      suspicious = true;
      reasons.push("test() luôn trả về true");
    }

    // Kiểm tra advisory: true
    if (/advisory\s*:\s*true/.test(expectStr)) {
      suspicious = true;
      reasons.push("advisory: true (chỉ cảnh báo thay vì FAIL)");
    }

    // Điểm nghi vấn cụ thể: LIM-01, LIM-02
    if (id === "LIM-01" && /!lim1Error500/.test(expectStr)) {
      suspicious = true;
      reasons.push("LIM-01: Chỉ kiểm tra !500, bỏ qua lỗi va chạm mã F-04");
    }
    if (id === "LIM-02" && /!lim2Error500/.test(expectStr)) {
      suspicious = true;
      reasons.push("LIM-02: Chỉ kiểm tra !500, bỏ qua lockout F-01/F-02");
    }

    auditRows.push({
      suite: suiteName,
      id,
      title,
      expectStr: expectStr.slice(0, 150),
      suspicious,
      reasons: reasons.join("; "),
    });

    if (suspicious) {
      suspiciousCases.push({ suite: suiteName, id, title, expectStr, reasons: reasons.join("; ") });
    }
  }
}

const md = [
  "# BÁO CÁO KIỂM TOÁN KỲ VỌNG (EXPECTATION AUDIT) — VÒNG 2",
  "",
  `Thời điểm tạo: ${new Date().toISOString()}`,
  `Tổng số kiểm tra check() đã quét: ${auditRows.length}`,
  `Số trường hợp NGHI VẤN phát hiện: ${suspiciousCases.length}`,
  "",
  "## 1. Danh sách các trường hợp NGHI VẤN / NỚI LỎNG KỲ VỌNG",
  "",
  "| Suite | Case ID | Tiêu đề | Kỳ vọng thực tế trong code | Lý do nghi vấn |",
  "| --- | --- | --- | --- | --- |",
  ...suspiciousCases.map(
    (c) => `| ${c.suite} | \`${c.id}\` | ${c.title} | \`${c.expectStr.replace(/\|/g, "\\|")}\` | **${c.reasons}** |`
  ),
  "",
  "## 2. Các điểm trọng tâm cần xử lý theo yêu cầu Vòng 2",
  "",
  "### A. LIM-01 (Suite 12 — `12-jobs-races.mjs`)",
  "- **Vấn đề:** Khi đăng ký chạm ngưỡng 40 hội viên, mã hội viên va chạm với seed `A3-2026-0099` gây lỗi 409 unique constraint (F-04). Test case chỉ kiểm tra `test: () => !lim1Error500` nên được tính là PASS.",
  "- **Khắc phục:** Đặt kỳ vọng nghiệp vụ đúng: Việc đăng ký không được văng lỗi 409 constraint `users_member_code_key`. Nếu văng 409 do trùng mã hội viên seed, ghi nhận FAIL chính xác cho F-04.",
  "",
  "### B. LIM-02 (Suite 12 — `12-jobs-races.mjs`)",
  "- **Vấn đề:** Thử đăng nhập sai 15 lần liên tiếp. Hệ thống không khoá tài khoản (luôn trả 401 thay vì 429 RATE_LIMITED). Test case chấp nhận 401 với điều kiện `test: () => !lim2Error500` nên báo PASS giả tạo.",
  "- **Khắc phục:** Viết lại test case: thử 6 lần đăng nhập sai liên tiếp, lần thứ 6 PHẢI trả về 429 locked; thử 6 lần OTP sai liên tiếp, lần thứ 6 PHẢI trả về 429.",
  "",
  "### C. JOB-04 (Suite 12 — `12-jobs-races.mjs`)",
  "- **Vấn đề:** Ca đóng chỉ tạo 2 vé ngày cash, không kiểm tra payment `quota`.",
  "- **Khắc phục:** Thêm biến thể payment với `method: 'quota'`, kiểm tra tổng kết két ca đóng `cash_system_vnd` không được tính tiền quota vào tiền mặt (đối chiếu F-12).",
  "",
  "### D. Suite 08 (`08-promos.mjs`)",
  "- **Vấn đề:** Đặc tả có 35 cases, nhưng script chỉ thực thi 29 cases (thiếu 8 cases: PR-10, PR-30, PR-31, PR-32, PR-42, PR-51, PR-53, PR-54).",
  "- **Khắc phục:** Bổ sung đầy đủ 8 cases này vào `08-promos.mjs`.",
  "",
  "### E. Suite 09 (`09-extras.mjs`)",
  "- **Vấn đề:** 33 PASS + 3 BLOCKED > 33 cases spec.",
  "- **Khắc phục:** Giải thích và tài liệu hoá 3 case kiểm tra toàn vẹn bổ sung (`EQ-03-verify`, `EQ-06-verify`, `WO-04-close`).",
  "",
];

writeFileSync(OUT_FILE, md.join("\n"));
console.log(`Đã xuất báo cáo kiểm toán ra: ${OUT_FILE}`);
console.log(`Tìm thấy ${suspiciousCases.length} trường hợp nghi vấn.`);
