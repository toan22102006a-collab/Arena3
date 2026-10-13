# Claude Code Rules — Arena 3 Sports Center Management System

## Diagram Generation Standard (STRICT DRAW.IO XML ONLY — NO MERMAID)

Khi tạo bất kỳ sơ đồ nào (Use Case, Class, Sequence, Activity, Context/DFD), LUÔN tạo file `.drawio` hợp lệ trong thư mục `docs/diagrams/` hoặc `docs/drawio/` theo các quy tắc nghiêm ngặt sau:

1. Cấu trúc XML chuẩn Draw.io:
<mxGraphModel dx="1422" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1100" background="#ffffff">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
  </root>
</mxGraphModel>

2. Cấm tuyệt đối:
- Tuyệt đối KHÔNG dùng Mermaid dưới bất kỳ hình thức nào.
- KHÔNG chứa XML comments trong file draw.io xuất ra.
- KHÔNG thiếu mxGeometry trên bất kỳ node hay edge nào.
- Mọi node/khối BẮT BUỘC có vertex="1".
- Mọi đường nối/mũi tên BẮT BUỘC có edge="1".
- ID của các cell phải là duy nhất (unique), không được trùng lặp.
- source và target của edge phải trỏ tới các ID vertex thực sự tồn tại.
- Không để các khối/text chồng chéo lên nhau.

3. Chuẩn UML 2.0 Class Diagram:
- Style:
  style="verticalAlign=top;align=left;overflow=fill;fontSize=12;fontFamily=Helvetica;html=1;whiteSpace=wrap;fillColor=#f8fafc;strokeColor=#475569;"
- Value của class phải dùng thẻ <hr> để chia ngăn rõ ràng:
  <b>ClassName</b><hr>+ attribute1: type<br>- attribute2: type<hr>+ method1(): returnType<br>+ method2(): returnType
- Ký hiệu visibility chuẩn UML: + (public), - (private), # (protected).

4. Quy chuẩn ngôn ngữ và xuất file:
- Toàn bộ nhãn tuân thủ chuẩn tiếng Anh học thuật theo giáo trình SE FPT University.
- Sau khi tạo file, báo đường dẫn file để mở trực tiếp trong draw.io hoặc VS Code extension `hediet.vscode-drawio`.
