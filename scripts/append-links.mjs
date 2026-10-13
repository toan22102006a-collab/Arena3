import { readFileSync, writeFileSync } from "node:fs";

const links = JSON.parse(readFileSync("docs/drawio/drawio-links.json", "utf8"));
let md = readFileSync("docs/drawio/README.md", "utf8");

const launchSection = `
---

## 🚀 Mở và thao tác trực tiếp trên Draw.io (1-Click Launch)
Tích hợp trực tiếp công nghệ tạo liên kết của **@drawio/mcp**, bạn có thể bấm trực tiếp vào các liên kết dưới đây để khởi chạy và thao tác kéo thả/chỉnh sửa trên web canvas của Draw.io ngay lập tức:

- 🔗 **[Mở Sơ đồ 01: Use Case Diagram trên Draw.io](${links.useCase.openInDrawioUrl})**
- 🔗 **[Mở Sơ đồ 02: Context Diagram DFD Cấp 0 trên Draw.io](${links.contextDfd.openInDrawioUrl})**
- 🔗 **[Mở Sơ đồ 03: Swimlane Activity Diagram trên Draw.io](${links.swimlaneRegister.openInDrawioUrl})**
- 🔗 **[Mở Toàn bộ Bộ Sơ đồ (Master Multi-Tab) trên Draw.io](${links.masterMultiTab.openInDrawioUrl})**
`;

if (!md.includes("1-Click Launch")) {
  md += launchSection;
  writeFileSync("docs/drawio/README.md", md, "utf8");
  console.log("Appended 1-Click Launch section to README.md");
}
