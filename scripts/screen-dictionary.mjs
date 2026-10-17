// Screen dictionary: a real screenshot of every screen, one page each, with a plain-language description.
//   node scripts/screen-dictionary.mjs            -> shoots, builds docs/screen-dictionary/index.html and docs/Arena3-Screen-Dictionary.pdf
//   node scripts/screen-dictionary.mjs --no-shoot -> rebuild the document from the existing images
// Needs the app running on http://127.0.0.1:8090 (seeded demo data). It only READS: it never clicks a button
// that writes (no booking, payment, shift, promo...), so it is safe on any database. The only thing it
// creates is a sign-in session per role; set SESSIONS=path/to/sessions.json to reuse saved ones instead.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const base = process.env.BASE ?? "http://127.0.0.1:8090";
const noShoot = process.argv.includes("--no-shoot");
const OUT = "docs/screen-dictionary";
mkdirSync(`${OUT}/img`, { recursive: true });

const ROLES = {
  public: { vn: "Khách (chưa đăng nhập)", phone: null, color: "#5f6857" },
  member: { vn: "Hội viên", phone: "0901230102", color: "#3f7d20" },
  receptionist: { vn: "Lễ tân", phone: "0900000002", color: "#7a4a24" },
  coach: { vn: "Huấn luyện viên", phone: "0901110011", color: "#356b1b" },
  manager: { vn: "Quản lý", phone: "0900000001", color: "#4a2f17" },
};

// 6 representative screens for dark mode appendix
const DARK_SCREENS = [
  { id: "S01", route: "/", role: "public", title: "Trang chủ" },
  { id: "S02", route: "/login", role: "public", title: "Đăng nhập" },
  { id: "S06", route: "/app/book", role: "member", title: "Đặt sân" },
  { id: "S11", route: "/app/pass", role: "member", title: "Mã QR vào cổng (Thẻ hội viên)" },
  { id: "S16", route: "/desk", role: "receptionist", title: "Quầy lễ tân" },
  { id: "S32", route: "/manager", role: "manager", title: "Báo cáo (Bảng điều khiển quản lý)" },
];

// How a screen is reached.
//   dock  : on the top bar (computer) and the bottom bar (phone)
//   sheet : on the top bar (computer); on a phone it sits under «Thêm» in the bottom bar
//   more  : under «Thêm» on both; `group` is the heading it sits under in that menu
const nav = (label, where = "dock", group = null) => ({ label, where, group });
const reach = (n) => {
  const L = `«${n.label}»`;
  const inMore = n.group ? `«Thêm» → ${n.group} → ${L}` : `«Thêm» → ${L}`;
  if (n.where === "more") return { d: `Thanh trên: ${inMore}`, m: `Thanh dưới: ${inMore}` };
  if (n.where === "sheet") return { d: `Thanh trên: ${L}`, m: `Thanh dưới: ${inMore}` };
  return { d: `Thanh trên: ${L}`, m: `Thanh dưới: ${L}` };
};

// [role, route, title, nav|string, purpose, who, actions[{t, mark}], note, extra (caption of a second shot), tab]
// `mark` = visible label of the control; when it is found on screen a numbered circle is drawn on the shot.
// `extra` adds a second page: the bottom of the page, or (with `tab`) the n-th tab opened (read-only).
const A = (t, mark) => ({ t, mark });
const S = [
  // ── Public (S01 - S04)
  ["public", "/", "Trang chủ", "Mở website của trung tâm",
    "Trang giới thiệu cho người chưa có tài khoản. Phần đầu nói ngay điều quan trọng nhất: trung tâm đang mở cửa không, hôm nay còn bao nhiêu giờ sân trống, giá từ bao nhiêu. Cuộn xuống là lịch sân trống trực tiếp, bảng giá theo môn, gói hội viên (chia theo môn), lớp đang mở, huấn luyện viên, cảm nhận của hội viên và thông tin ghé trung tâm.",
    "Bất kỳ ai vào website, chưa cần tài khoản.",
    [A("Bấm «Đặt sân» để xuống thẳng lịch sân trống", "Đặt sân"), A("Bấm «Xem bảng giá» để xem giá theo môn", "Xem bảng giá"), A("Chạm một giờ trống trên lưới: trang báo giá và mời đăng nhập để giữ sân"), A("Đăng nhập hoặc tạo tài khoản", "Đăng nhập"), A("Đổi ngôn ngữ EN | VI")],
    "Ảnh là phần đầu trang. Lịch sân, bảng giá, gói, lớp và huấn luyện viên nằm phía dưới (ảnh trang sau là lịch sân trống).",
    "Cuộn xuống: lịch sân trống trực tiếp"],
  ["public", "/login", "Đăng nhập", "Bấm «Đăng nhập» ở trang chủ",
    "Cửa vào chung của mọi người. Nhập số điện thoại (hoặc email) và mật khẩu; hệ thống tự đưa bạn đến đúng khu theo vai trò: quản lý, lễ tân, huấn luyện viên hay hội viên.",
    "Hội viên và nhân viên đã có tài khoản.",
    [A("Nhập số điện thoại hoặc email, và mật khẩu"), A("Bấm «Quên mật khẩu?» nếu quên", "Quên mật khẩu?"), A("Bấm «Tạo tài khoản» nếu chưa có", "Tạo tài khoản")],
    "Hàng «Tài khoản demo» chỉ có ở bản xem thử để người xem đăng nhập nhanh. Bản chạy thật tắt hàng này (biến VITE_DEMO_LOGINS)."],
  ["public", "/register", "Tạo tài khoản", "Bấm «Tạo tài khoản» ở trang đăng nhập",
    "Người mới tự tạo tài khoản hội viên: họ tên, số điện thoại, email, ngày sinh, mật khẩu (từ 8 ký tự, có chữ và số). Người dưới 18 tuổi phải điền thêm người giám hộ. Hệ thống gửi mã 6 số qua email để xác nhận.",
    "Người chưa là hội viên.",
    [A("Điền thông tin, tự chọn ngày sinh"), A("Tự tick ô đồng ý điều khoản và NĐ 13/2023"), A("Bấm «Gửi mã xác nhận»", "Gửi mã xác nhận"), A("Nhập mã 6 số để hoàn tất")],
    "C6: Ngày sinh để trống và ô đồng ý không tick sẵn; nút gửi mã chỉ bật khi người dùng tự chọn ngày sinh và tự đồng ý. Bước nhập mã chỉ hiện sau khi gửi mã."],
  ["public", "/forgot", "Quên mật khẩu", "Bấm «Quên mật khẩu?» ở trang đăng nhập",
    "Lấy lại mật khẩu: nhập số điện thoại, hệ thống gửi mã 6 số tới email đã đăng ký (hết hạn sau 5 phút), rồi đặt mật khẩu mới. Tài khoản không có email thì nhờ lễ tân đặt mật khẩu tạm.",
    "Ai quên mật khẩu.",
    [A("Nhập số điện thoại, bấm «Gửi mã»", "Gửi mã"), A("Nhập mã 6 số và mật khẩu mới")],
    "Ảnh là bước đầu. Bước nhập mã và mật khẩu mới chỉ hiện sau khi gửi mã."],

  // ── Member (S05 - S15)
  ["member", "/app", "Trang chủ hội viên", nav("Lịch"),
    "Màn hình đầu tiên sau khi đăng nhập. Trên cùng là các nhắc việc (gói sắp hết hạn, chỗ trống trong danh sách chờ). Sau đó là «Hôm nay» (sân và lớp trong ngày, có nút hủy), thẻ gói tập đang dùng, lối tắt và thông báo mới nhất.",
    "Hội viên.",
    [A("Bấm «Gia hạn» khi gói sắp hết", "Gia hạn"), A("Xem lịch hôm nay, bấm «Hủy» nếu cần", "Hủy"), A("Đọc thông báo, bấm «Mở hộp thư» để xem hết", "Mở hộp thư")],
    "Trên điện thoại, lối tắt được ẩn vì thanh dưới đã có đủ các mục chính."],
  ["member", "/app/book", "Đặt sân", nav("Đặt sân"),
    "Chọn ngày và môn, rồi chạm một giờ trống (ô viền xanh có dấu +) để giữ sân 5 phút. Thẻ giữ chỗ hiện đồng hồ đếm ngược, giá, và các cách trả: trừ giờ trong gói, thanh toán online hoặc chuyển khoản VietQR. Giờ đã qua được thu gọn. Trên điện thoại có dải «Giờ còn trống» để chọn theo giờ, hệ thống tự gán sân. Cột phải (máy tính) hoặc cuối trang (điện thoại) là các sân sắp tới của bạn, có «Đổi giờ» và «Hủy».",
    "Hội viên muốn chơi.",
    [A("Chọn ngày, chọn môn"), A("Chạm một giờ trống để giữ sân"), A("Bấm «Có mã khuyến mãi?» trước khi chọn giờ nếu có mã", "Có mã khuyến mãi?"), A("Chọn cách trả tiền trên thẻ giữ chỗ"), A("Bấm «Đổi giờ» ở sân đã đặt", "Đổi giờ")],
    "C2, C4, C8, C10: Mã VietQR khi chuyển khoản (C2), giới hạn 2 lượt/ngày (C4), dải «Giờ còn trống» (C8), đếm ngược 5 phút (C10)."],
  ["member", "/app/classes", "Lớp học", nav("Lớp học"),
    "Các lớp do huấn luyện viên dạy, lọc theo môn. Mỗi thẻ cho biết trình độ, huấn luyện viên, sân, lịch trong tuần và số chỗ còn lại. Lớp đầy thì vào danh sách chờ. Cuối trang là sổ «Điểm danh của tôi».",
    "Hội viên muốn học có người dạy.",
    [A("Lọc theo môn"), A("Bấm «Đăng ký»", "Đăng ký"), A("Bấm «Rời lớp này» để thôi học", "Rời lớp này"), A("Cuộn xuống xem sổ điểm danh của mình")],
    "C5: Chi tiết lớp ghi rõ điều kiện gói tập và số buổi sử dụng.", "Cuộn xuống: sổ điểm danh của tôi"],
  ["member", "/app/train", "Tiến độ tập luyện", nav("Tiến độ", "sheet"),
    "Mục tiêu cá nhân, trình độ hiện tại, các buổi sắp tới kèm giáo án, bài tập về nhà và nhận xét của huấn luyện viên. AI chỉ gợi ý; huấn luyện viên duyệt thì hội viên mới thấy.",
    "Hội viên đang học lớp.",
    [A("Chọn mục tiêu của mình"), A("Đánh dấu bài tập đã làm (khi có bài)"), A("Đọc nhận xét của huấn luyện viên")],
    "Mục nào chưa có nội dung thì hiện một dòng giải thích thay vì để trống."],
  ["member", "/app/plans", "Gói tập", nav("Gói tập", "sheet"),
    "Các gói đang bán: môn, giá, thời hạn và quyền lợi (chỉ ghi những gì gói thật sự có). Bấm «Mua hoặc gia hạn» để đặt gói, trước khi trả tiền đã thấy ngày hết hạn mới; tiền trả tại quầy lễ tân.",
    "Hội viên muốn mua hoặc gia hạn gói.",
    [A("Nhập mã khuyến mãi nếu có"), A("So sánh các gói"), A("Bấm «Mua hoặc gia hạn»", "Mua hoặc gia hạn")],
    "Trang này không thu tiền online. Lễ tân thu ở màn «Thanh toán» (S19) hoặc trong hồ sơ hội viên (S25)."],
  ["member", "/app/points", "Điểm thưởng", nav("Điểm", "sheet"),
    "Số dư điểm, hạng hội viên và giá trị quy đổi. Mỗi 10.000đ chi tiêu được 1 điểm, 1 điểm trị giá 100đ. Đổi điểm lấy mã giảm giá (tối thiểu 50 điểm) và xem lịch sử đổi.",
    "Hội viên.",
    [A("Xem số dư và hạng"), A("Nhập số điểm, bấm «Nhận mã»", "Nhận mã"), A("Xem lịch sử đổi điểm")],
    null],
  ["member", "/app/pass", "Mã QR vào cổng", nav("Mã QR"),
    "Mã QR tự đổi mỗi phút để lễ tân quét khi vào trung tâm (chụp màn hình lại cũng vô dụng). Nếu trung tâm bật chế độ tự vào cổng, hội viên quét mã trên màn hình lễ tân hoặc dán vào ô «Mã từ màn hình lễ tân» rồi bấm «Vào cổng».",
    "Hội viên khi đến trung tâm.",
    [A("Đưa mã QR cho lễ tân quét"), A("Bấm «Mã mới» nếu mã hết hạn", "Mã mới"), A("Tự vào cổng bằng mã (chỉ khi quản lý bật)")],
    null],
  ["member", "/app/assistant", "Trợ lý", "Nút trợ lý (biểu tượng chat) ở thanh trên",
    "Chat hỏi nhanh: giờ mở cửa, gói nào đang bán, ai dạy cầu lông, hủy sân thế nào. Trả lời dựa trên dữ liệu thật của trung tâm. Gõ «ticket:» ở đầu câu để gửi ghi chú cho lễ tân.",
    "Hội viên có thắc mắc.",
    [A("Bấm câu hỏi gợi ý hoặc tự gõ"), A("Gõ «ticket: …» để nhắn lễ tân")],
    "Trợ lý không tư vấn y tế. Việc đặt sân và đăng ký lớp vẫn làm ở màn tương ứng."],
  ["member", "/app/notifications", "Thông báo", "Biểu tượng chuông ở thanh trên",
    "Hộp thư của hội viên trong một bảng: mỗi dòng có tiêu đề, một dòng tóm tắt nội dung và thời gian. Dòng chưa đọc có chấm xanh và chữ đậm. Mở một dòng để xem đầy đủ và đi tới màn liên quan.",
    "Hội viên.",
    [A("Mở một thông báo"), A("Bấm «Đánh dấu tất cả đã đọc»", "Đánh dấu tất cả đã đọc")],
    null],
  ["member", "/account", "Tài khoản", "Bấm avatar góc trên phải → «Cài đặt tài khoản»",
    "Bốn tab: Hồ sơ (thông tin cá nhân, ghi chú sức khoẻ), Bảo mật (đổi mật khẩu), Biên lai (mở PDF), Hỗ trợ (gửi tin cho lễ tân và đọc phản hồi). Số điện thoại và email không tự đổi được ở đây.",
    "Mọi người đã đăng nhập (hội viên, lễ tân, huấn luyện viên, quản lý).",
    [A("Sửa hồ sơ", "Hồ sơ"), A("Đổi mật khẩu", "Bảo mật"), A("Xem biên lai", "Biên lai"), A("Nhắn lễ tân", "Hỗ trợ")],
    "Muốn đổi số điện thoại hay email thì nhờ lễ tân."],
  ["member", "/pay/return", "Kết quả thanh toán online", "Tự chuyển về sau khi trả tiền online",
    "Trang hội viên thấy khi quay lại từ cổng thanh toán online. Nó tự kiểm tra và báo một trong các kết quả: đang chờ ngân hàng, đã thanh toán (sân hoặc gói được xác nhận, có biên lai), đã hủy, hoặc chưa rõ.",
    "Hội viên vừa trả tiền online.",
    [A("Đọc kết quả"), A("Quay lại xem sân hoặc gói đã đặt")],
    "Ảnh là trang mở thẳng, không qua cổng thanh toán, nên hiện trạng thái «chưa rõ»."],

  // ── Receptionist (S16 - S26)
  ["receptionist", "/desk", "Quầy lễ tân", nav("Quầy"),
    "Màn làm việc chính của lễ tân. Thanh trên cùng: mở hoặc đóng ca thu ngân, số khoản chờ thu, lối sang sơ đồ sân. Cột trái: tìm hội viên và thêm hội viên mới (3 bước: hồ sơ, gói tập, thanh toán). Cột phải: khối «Ngay lúc này» (C9: số sân đang chơi, số khách vào trong 1 giờ tới, số sân trống giờ này), lối tắt và yêu cầu hỗ trợ từ ứng dụng.",
    "Lễ tân.",
    [A("Bấm «Mở ca» trước khi thu tiền", "Mở ca"), A("Tìm hội viên theo tên, số điện thoại hoặc mã"), A("Thêm hội viên mới: bấm «Tạo hồ sơ»", "Tạo hồ sơ"), A("Xem «Ngay lúc này» (C9), bấm «Sơ đồ sân» để mở lưới", "Sơ đồ sân"), A("Trả lời yêu cầu hỗ trợ", "Trả lời")],
    "C9: Khối «Ngay lúc này» hiển thị tình trạng sân theo thời gian thực. Trên điện thoại, cột phải xếp xuống dưới cột trái."],
  ["receptionist", "/desk/gate", "Cổng", nav("Cổng"),
    "Quét mã QR của hội viên để cho vào. Máy quét cầm tay tự gõ vào ô đang chọn; không có mã thì chuyển sang «Không có mã» và nhập số điện thoại. Kết quả hợp lệ hay không và lý do hiện ngay. Bên dưới là danh sách người đã qua cổng hôm nay.",
    "Lễ tân đứng cổng.",
    [A("Quét QR bằng máy quét", "Quét mã"), A("Nhập số điện thoại khi không có mã", "Không có mã"), A("Bấm «Hiện» để hiện mã tự vào cổng", "Hiện")],
    "Ghi nhận vào cổng không trừ buổi và không đổi gói tập."],
  ["receptionist", "/desk/courts", "Sơ đồ sân", nav("Sân"),
    "Lưới cả ngày của mọi sân, bắt đầu từ giờ hiện tại (giờ đã qua được thu gọn, bấm để hiện lại). Ô trống có viền xanh và dấu +, bấm để bán cho khách vãng lai ngay tại quầy. Bấm ô đã đặt để xem ai đang giữ sân và đến khi nào.",
    "Lễ tân.",
    [A("Chọn ngày và môn"), A("Bấm ô trống để bán cho khách vãng lai"), A("Bấm ô đã đặt để xem chi tiết")],
    "Màu các ô xem ở trang «Đọc lưới sân» đầu tài liệu."],
  ["receptionist", "/desk/payments", "Thanh toán", nav("Thanh toán"),
    "Hàng việc tiền tại quầy: gói đặt trong ứng dụng đang chờ thu, chuyển khoản cần đối soát, hoàn tiền chờ quản lý duyệt, và toàn bộ biên lai (lọc theo cách trả và khoảng ngày). Phải mở ca thu ngân mới thu được tiền.",
    "Lễ tân (thu tiền) và quản lý (duyệt hoàn tiền).",
    [A("Chọn cách trả, bấm thu tiền (cần mở ca trước)", "Mở ca trước"), A("Đối soát chuyển khoản: xác nhận đã nhận hoặc báo không thấy"), A("Tìm và mở biên lai")],
    "C1: Bảng biên lai có phân trang 10/25/50/100 dòng. Ảnh chụp khi chưa mở ca nên nút thu tiền đang mờ. Chúng tôi không mở ca giả để chụp."],
  ["receptionist", "/desk/series", "Đặt sân cố định", nav("Đặt cố định", "sheet"),
    "Đặt cùng sân, cùng giờ, mỗi tuần, trả trước cả đợt và được giảm giá. Chọn khách, sân, ngày đầu tiên, giờ bắt đầu và số tuần (4 đến 12), hệ thống kiểm tra từng tuần có trống không. Bên dưới là các đợt đang chạy.",
    "Lễ tân.",
    [A("Nhập số điện thoại khách (hoặc tên nếu là khách lẻ)"), A("Chọn sân, ngày, giờ, số tuần"), A("Bấm «Kiểm tra các tuần»", "Kiểm tra các tuần")],
    "Cần mở ca thu ngân trước khi thu tiền cả đợt."],
  ["receptionist", "/desk/at-risk", "Sắp rời bỏ", nav("Sắp rời bỏ", "more"),
    "Danh sách hội viên có thể sắp rời bỏ: vắng liên tiếp, lâu không đến, gói sắp hết hoặc chưa từng đến. Lọc theo nhóm, sắp xếp theo mức khẩn cấp. Gọi theo số trên dòng, gọi xong bấm «Ghi nhận liên hệ».",
    "Lễ tân, để chăm sóc khách.",
    [A("Chọn nhóm cần gọi", "Cần gọi"), A("Gọi theo số điện thoại trên dòng"), A("Bấm «Ghi nhận liên hệ»", "Ghi nhận liên hệ")],
    "Muốn bán gói cho người này, mở hồ sơ hội viên (S25)."],
  ["receptionist", "/desk/classes", "Lớp học (quầy)", nav("Lớp học", "more"),
    "Xem các lớp: trạng thái, trình độ, huấn luyện viên, sân, lịch và sĩ số. Bấm «Buổi học & học viên» để xem từng buổi và danh sách người học.",
    "Lễ tân.",
    [A("Xem các lớp và chỗ còn trống"), A("Bấm «Buổi học & học viên»", "Buổi học & học viên")],
    "Màn này chỉ để xem. Hội viên tự đăng ký lớp ở màn «Lớp học» (S07)."],
  ["receptionist", "/desk/gear", "Dụng cụ", nav("Dụng cụ", "more"),
    "Cho thuê vợt, bóng, ống cầu vào tài khoản hội viên hoặc cho khách theo số điện thoại. Kho tự trừ khi cho thuê và cộng lại khi trả. Bên dưới là các món đang cho thuê.",
    "Lễ tân.",
    [A("Chọn món, người thuê và số lượng"), A("Bấm «Cho thuê»", "Cho thuê"), A("Khi khách trả, bấm «Nhận lại»", "Nhận lại")],
    null],
  ["receptionist", "/desk/maintenance", "Bảo trì", nav("Bảo trì", "more"),
    "Báo cái gì đang hỏng (đèn, lưới, máy bơm...), gắn vào một sân và mức khẩn cấp; có thể khoá sân không cho đặt đến khi sửa xong. Có số phiếu đang mở, số phiếu khẩn cấp, chi phí sửa trong tháng, và danh sách phiếu để chuyển trạng thái.",
    "Lễ tân và quản lý.",
    [A("Mô tả chỗ hỏng, chọn sân và mức khẩn cấp"), A("Bấm «Gửi phiếu»", "Gửi phiếu"), A("Bấm «Bắt đầu sửa», «Đã sửa xong» hoặc «Hủy phiếu»", "Đã sửa xong")],
    null],
  ["receptionist", "/desk/member/$ID", "Hồ sơ hội viên", "Tìm hội viên ở màn «Quầy» (S16) rồi bấm vào tên",
    "Mọi thứ về một hội viên: thông tin liên hệ, gói đang dùng, các lượt đặt, khoản thanh toán và biên lai, cùng các việc lễ tân làm cho họ.",
    "Lễ tân (quản lý cũng mở được từ màn «Hội viên»).",
    [A("Bấm «Sửa hồ sơ»", "Sửa hồ sơ"), A("Bấm «Đặt lại mật khẩu»", "Đặt lại mật khẩu"), A("Bấm «Thu tiền»", "Thu tiền"), A("Bán thêm gói tập"), A("Xem biên lai, đề nghị hoàn tiền")],
    "Đặt sân hộ làm ở «Sơ đồ sân» (S18)."],
  ["receptionist", "/alerts", "Cảnh báo", "Biểu tượng chuông ở thanh trên",
    "Hộp thư cảnh báo dùng chung cho nhân viên (lễ tân, huấn luyện viên, quản lý), ví dụ học viên vắng ba buổi liên tiếp.",
    "Nhân viên.",
    [A("Mở một cảnh báo"), A("Xử lý rồi đánh dấu đã đọc")],
    "Ảnh có thể đang trống nếu chưa có cảnh báo."],

  // ── Coach (S27 - S31)
  ["coach", "/coach", "Lịch dạy", nav("Lịch"),
    "Màn đầu tiên của huấn luyện viên. Thẻ «Buổi tiếp theo» ở trên cùng: ngày, giờ, môn, trình độ, sân, sĩ số và nút «Điểm danh ngay». Bên dưới là các buổi sắp tới, chia theo ngày, mỗi buổi một dòng gọn.",
    "Huấn luyện viên.",
    [A("Đọc thẻ «Buổi tiếp theo»"), A("Bấm «Điểm danh ngay»", "Điểm danh ngay"), A("Bấm một buổi trong danh sách để mở sổ của buổi đó")],
    null],
  ["coach", "/coach/attendance", "Điểm danh", nav("Điểm danh"),
    "Việc của một buổi chia thành 4 bước đánh số: 1 Điểm danh, 2 Kết quả, 3 Giáo án buổi tập, 4 Bài tập về nhà. Ở bước 1, mỗi học viên có 4 nút: Có mặt, Đến muộn, Vắng, Có phép; ghi chú sức khoẻ hiện ngay dưới tên. Sổ tự khoá sau một thời gian, sửa sau đó phải ghi lý do.",
    "Huấn luyện viên.",
    [A("Đổi buổi ở ô «Đổi buổi khác»"), A("Bấm trạng thái của từng học viên"), A("Bấm «Đánh dấu tất cả có mặt»", "Đánh dấu tất cả có mặt"), A("Bấm «Lưu điểm danh»", "Lưu điểm danh"), A("Bấm số 2, 3, 4 để sang kết quả, giáo án, bài tập")],
    "Ảnh trang sau là bước 3 (giáo án); bước 2 và 4 làm tương tự.",
    "Bước 3: giáo án buổi tập", 2],
  ["coach", "/coach/classes", "Lớp học (huấn luyện viên)", nav("Lớp học"),
    "Danh sách các lớp huấn luyện viên được phân công giảng dạy: môn, trình độ, lịch học, sân và sĩ số học viên (đã đăng ký / sức chứa). Thống kê tổng số lớp, số lớp đang mở, tổng số học viên và nút xem chi tiết buổi học cùng danh sách học viên.",
    "Huấn luyện viên.",
    [A("Xem thống kê các lớp đang phụ trách"), A("Bấm «Chi tiết» để xem học viên và buổi học", "Chi tiết")],
    null],
  ["coach", "/coach/student/$ID", "Hồ sơ học viên", "Bấm tên học viên trong sổ điểm danh (S28)",
    "Phần trên: tên, mục tiêu, trình độ, số buổi có mặt, muộn, vắng, có phép, và khung ghi chú sức khoẻ. Phần dưới chia thẻ: Tiến độ (trình độ, nhận xét), Ghi chú của huấn luyện viên, Lịch sử (buổi gần đây và bài tập).",
    "Huấn luyện viên.",
    [A("Đọc ghi chú sức khoẻ"), A("Xem số buổi có mặt, muộn, vắng, có phép"), A("Chuyển giữa các thẻ Tiến độ, Ghi chú, Lịch sử")],
    "Số «có mặt» chỉ tăng khi huấn luyện viên đã lưu điểm danh.",
    "Thẻ Lịch sử: buổi gần đây và bài tập", 2],
  ["coach", "/coach/earnings", "Thu nhập", nav("Thu nhập"),
    "Tiền huấn luyện viên nhận theo tháng: một khoản cho mỗi buổi đã dạy, cộng thêm cho mỗi học viên có mặt. Có tổng đã kiếm, số buổi, số lượt học viên, mức trả đang áp dụng, danh sách buổi trong tháng và các tháng đã chốt.",
    "Huấn luyện viên.",
    [A("Chọn tháng bằng hai nút mũi tên"), A("Đối chiếu từng buổi đã dạy")],
    "Tháng chưa chốt thì số liệu còn có thể thay đổi."],

  // ── Manager (S32 - S43)
  ["manager", "/manager", "Báo cáo", nav("Báo cáo"),
    "Bức tranh kinh doanh theo khoảng thời gian: doanh thu, hoàn tiền, giờ sân dùng từ gói (so với kỳ trước), biểu đồ theo cách trả và theo nguồn thu, công suất sân, giờ đông khách, hội viên mới và lớp học. Xuất Excel, PDF hoặc CSV.",
    "Quản lý, chủ trung tâm.",
    [A("Chọn Hôm nay / 7 ngày / Tháng này / Tuỳ chọn", "Hôm nay"), A("Lọc theo cách trả tiền"), A("Xuất Excel, PDF, CSV", "Xuất Excel")],
    "Ảnh chụp lúc đầu ngày đang chọn «Hôm nay» nên doanh thu còn 0đ; chọn 7 ngày hoặc Tháng này để thấy số liệu. Ảnh trang sau là phần công suất sân.",
    "Cuộn xuống: công suất sân và lớp học"],
  ["manager", "/manager/classes", "Lớp học (quản lý)", nav("Lớp học", "sheet"),
    "Tạo lớp: môn, trình độ, sân, huấn luyện viên, các ngày trong tuần, giờ bắt đầu, ngày đầu tiên và sức chứa; hệ thống chặn trùng lịch sân hoặc trùng huấn luyện viên. Dời, hủy buổi, đổi huấn luyện viên hay hủy lớp làm trong «Buổi học & học viên».",
    "Quản lý.",
    [A("Điền biểu mẫu lớp mới"), A("Bấm «Tạo và đăng»", "Tạo và đăng"), A("Mở «Buổi học & học viên» để dời hoặc hủy buổi", "Buổi học & học viên")],
    null],
  ["manager", "/manager/members", "Hội viên", nav("Hội viên"),
    "Danh sách mọi hội viên, lọc nhanh theo gói (đang hiệu lực, hết hạn tuần này, hết hạn, chưa có gói), tìm theo tên, số điện thoại hoặc mã, lọc trạng thái và môn. Bấm một dòng để mở hồ sơ.",
    "Quản lý.",
    [A("Chọn nhóm lọc", "Tất cả"), A("Tìm theo tên, số điện thoại hoặc mã"), A("Mở hồ sơ hội viên (S25)")],
    null],
  ["manager", "/manager/attendance", "Điểm danh (báo cáo)", nav("Điểm danh"),
    "Hội viên có thực sự đến tập không: tỉ lệ điểm danh, số có mặt, vắng, có phép, theo từng lớp và huấn luyện viên, trong khoảng ngày chọn. Tab «Sắp rời bỏ» liệt kê ai cần gọi trước khi rời đi.",
    "Quản lý.",
    [A("Chọn khoảng ngày"), A("Xem theo lớp"), A("Xuất Excel hoặc PDF", "Xuất Excel")],
    null],
  ["manager", "/manager/staff", "Nhân viên", nav("Nhân viên", "sheet"),
    "Tài khoản lễ tân và huấn luyện viên chỉ được cấp ở đây (hội viên tự đăng ký). Đổi vai trò, đặt lại mật khẩu, đăng xuất mọi nơi, khoá hoặc mở khoá tài khoản.",
    "Quản lý.",
    [A("Bấm «Thêm nhân viên»", "Thêm nhân viên"), A("Bấm «Đặt lại mật khẩu»", "Đặt lại mật khẩu"), A("Bấm «Khoá» để khoá tài khoản", "Khoá")],
    "Nhân viên mới phải đổi mật khẩu ở lần đăng nhập đầu tiên."],
  ["manager", "/manager/plans", "Gói tập (quản lý)", nav("Gói tập", "more", "Kinh doanh"),
    "Mọi gói, cả đang bán và đã ngừng. Mỗi thẻ ghi môn, trạng thái bán, giá và quyền lợi. Gói không bao giờ bị xoá: ngừng bán thì hội viên đang dùng vẫn giữ nguyên.",
    "Quản lý.",
    [A("Bấm «Gói mới»", "Gói mới"), A("Bấm «Chi tiết» để sửa giá, quyền lợi", "Chi tiết"), A("«Ngừng bán» hoặc «Bán lại»", "Ngừng bán")],
    null],
  ["manager", "/manager/promos", "Khuyến mãi", nav("Khuyến mãi", "more", "Kinh doanh"),
    "Mã giảm giá theo % hoặc số tiền, có mức tối đa, phạm vi áp dụng, thời hạn và giới hạn lượt dùng. Mỗi mã hiện số lượt đã dùng và tổng tiền đã giảm.",
    "Quản lý.",
    [A("Bấm «Mã mới»", "Mã mới"), A("«Tạm dừng» hoặc «Tiếp tục» một mã", "Tạm dừng"), A("«Ai đã dùng» để xem lượt dùng", "Ai đã dùng")],
    null],
  ["manager", "/manager/prices", "Bảng giá", nav("Bảng giá", "more", "Kinh doanh"),
    "Giá thuê sân theo môn, loại ngày (thường, cuối tuần, lễ) và khung giờ (thường, cao điểm). Giá mới chỉ áp cho giao dịch mới; lượt đặt và gói đã bán giữ giá cũ.",
    "Quản lý.",
    [A("Mở từng môn"), A("Sửa giá trong ô"), A("Lưu thay đổi")],
    null],
  ["manager", "/manager/commission", "Hoa hồng huấn luyện viên", nav("Hoa hồng", "more", "Kinh doanh"),
    "Tiền trả cho huấn luyện viên theo tháng: tổng còn phải trả, số buổi đã dạy, số lượt học viên. Đặt mức trả mỗi buổi và mỗi học viên cho từng người.",
    "Quản lý.",
    [A("Chọn tháng"), A("Sửa mức trả của một huấn luyện viên"), A("Bấm «Lưu mức trả»", "Lưu mức trả")],
    "Tháng chưa chốt thì số liệu còn có thể thay đổi."],
  ["manager", "/manager/invoices", "Xuất hoá đơn điện tử", nav("Hoá đơn điện tử", "more", "Kinh doanh"),
    "Gửi hoá đơn của tháng cho kế toán dưới dạng bảng tính hoặc file XML để đưa vào hệ thống hoá đơn điện tử. Chọn khoảng ngày, xem số hoá đơn, tổng tiền, VAT và số hoá đơn chưa xuất.",
    "Quản lý, kế toán.",
    [A("Chọn khoảng ngày"), A("Bấm «Tải bảng tính (CSV)»", "Tải bảng tính (CSV)"), A("Bấm «Tải XML»", "Tải XML")],
    "Đây chưa phải hoá đơn phát hành: nhà cung cấp hoá đơn điện tử phát hành từ file này."],
  ["manager", "/manager/audit", "Nhật ký thao tác", nav("Nhật ký", "more", "Hệ thống"),
    "Ai đã làm gì, lúc nào, mới nhất trước: tên thao tác, người làm, vai trò, đối tượng. Mở một dòng để xem giá trị trước và sau. Không ai sửa hay xoá được nhật ký.",
    "Quản lý, để kiểm tra.",
    [A("Lọc theo thao tác, người làm, đối tượng, khoảng ngày"), A("Tìm trong danh sách"), A("Mở một dòng để xem trước và sau")],
    null],
  ["manager", "/manager/courts", "Quản lý sân", nav("Sân", "more", "Vận hành"),
    "Quản lý toàn bộ sân của trung tâm theo môn thể thao: xem mã sân, trạng thái sẵn sàng, bảo trì hoặc đã ngừng sử dụng. Thêm sân mới với mã tự sinh, đổi trạng thái hoặc ngừng sử dụng sân an toàn khi không còn lịch trong tương lai.",
    "Quản lý.",
    [A("Bấm «Thêm sân»", "Thêm sân"), A("Lọc theo môn hoặc trạng thái"), A("Sửa tên hoặc đổi trạng thái sân")],
    "Sân đã ngừng sử dụng không bao giờ bị xoá để bảo toàn lịch sử hoá đơn và đặt sân."],
  ["manager", "/manager/media", "Quản lý ảnh & video", nav("Ảnh & Video", "more", "Hệ thống"),
    "Quản lý thư viện hình ảnh và video hiển thị trên toàn bộ ứng dụng và trang giới thiệu: ảnh nền hero, ảnh sân, cơ sở vật chất, bảng giá, biểu ngữ và ảnh đại diện huấn luyện viên. Hỗ trợ tải lên ảnh mới, chọn từ thư viện có sẵn, khôi phục bản cũ hoặc trở về mặc định.",
    "Quản lý.",
    [A("Lọc theo vị trí (Trang chủ, Biểu ngữ, Thể thao, HLV)"), A("Bấm «Thay ảnh» để tải lên ảnh mới"), A("Khôi phục bản trước hoặc trở về mặc định")],
    "Ảnh tải lên được kiểm tra kích thước và loại tệp an toàn trước khi lưu."],
  ["manager", "/manager/settings", "Cài đặt trung tâm", nav("Cài đặt", "more", "Hệ thống"),
    "Bật hoặc tắt tính năng (sổ điểm danh và giáo án, gợi ý giáo án, trợ lý hội viên), liên kết quản lý sân, và thông tin pháp lý của trung tâm (tên, địa chỉ, mã số thuế).",
    "Quản lý.",
    [A("Bật hoặc tắt tính năng"), A("Bấm «Quản lý sân →»", "Quản lý sân"), A("Cuộn xuống: sửa thông tin trung tâm rồi lưu")],
    "C7: Thay đổi giờ mở cửa trung tâm sẽ cập nhật khung giờ trên lưới sân. Thay đổi áp dụng cho giao dịch mới trong vòng một phút.",
    "Cuộn xuống: thông tin trung tâm"],

  // ── Legal & Public (S44 - S45)
  ["public", "/terms", "Điều khoản sử dụng", "Chân trang hoặc trang tạo tài khoản",
    "Quy định khi dùng app Arena3 và sử dụng dịch vụ tại trung tâm: tài khoản, đặt sân, lớp học, thanh toán và hoàn tiền.",
    "Bất kỳ ai vào website.",
    [A("Đọc quy định sử dụng dịch vụ"), A("Bấm «Quay lại đăng ký» để tiếp tục tạo tài khoản", "Quay lại đăng ký"), A("Bấm «Thông báo về dữ liệu cá nhân» để đọc chính sách bảo mật", "Thông báo về dữ liệu cá nhân")],
    "Trang văn bản pháp lý."],
  ["public", "/privacy", "Thông báo về dữ liệu cá nhân", "Chân trang hoặc trang tạo tài khoản",
    "Thông báo xử lý dữ liệu cá nhân theo Nghị định 13/2023/NĐ-CP: các dữ liệu thu thập, mục đích sử dụng, thời gian lưu trữ và quyền của chủ thể dữ liệu.",
    "Bất kỳ ai vào website.",
    [A("Đọc thông báo dữ liệu cá nhân"), A("Bấm «Quay lại đăng ký» để tiếp tục tạo tài khoản", "Quay lại đăng ký"), A("Bấm «Điều khoản sử dụng» để đọc điều khoản", "Điều khoản sử dụng")],
    "Trang văn bản pháp lý."],
];

const VP = { d: { width: 1440, height: 900 }, m: { width: 390, height: 844 } };
const login = async (phone) =>
  (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, password: "ChangeMe!a3" }) })).json();

// Sessions: reuse saved ones when SESSIONS points at a file of {role: {token, user}}, sign in otherwise.
const sessionsFile = process.env.SESSIONS;
const saved = sessionsFile && existsSync(sessionsFile) ? JSON.parse(readFileSync(sessionsFile, "utf8")) : {};
const local = (p) => String(p ?? "").replace(/^\+84/, "0");
const sessions = {};
for (const [k, r] of Object.entries(ROLES)) {
  if (!r.phone) continue;
  const hit = Object.values(saved).find((s) => local(s?.user?.phone) === r.phone);
  sessions[k] = hit ?? (await login(r.phone));
  if (!hit && sessionsFile) saved[`${k}-${r.phone}`] = sessions[k];
}
if (sessionsFile) writeFileSync(sessionsFile, JSON.stringify(saved));
const demoId = sessions.member.user.id;
const idOf = (i) => `S${String(i + 1).padStart(2, "0")}`;
const marksFile = `${OUT}/marks.json`;
let marksFound = existsSync(marksFile) ? JSON.parse(readFileSync(marksFile, "utf8")) : {};

// Draw numbered circles on the page (fixed to the viewport) for the labels that exist on screen.
const drawMarks = (labels) => {
  const found = [];
  let count = 0;
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
  for (const label of labels) {
    if (!label) { found.push(null); continue; }
    const want = norm(label);
    const cands = [...document.querySelectorAll("button, a, [role=button], [role=tab], label, summary")];
    const el = cands.find((c) => vis(c) && norm(c.textContent ?? "") === want) ?? cands.find((c) => vis(c) && norm(c.textContent ?? "").startsWith(want) && norm(c.textContent ?? "").length < want.length + 18);
    if (!el) { found.push(null); continue; }
    const r = el.getBoundingClientRect();
    count += 1;
    const d = document.createElement("div");
    d.textContent = String(count);
    d.setAttribute("data-mark", "1");
    d.style.cssText = `position:fixed;z-index:2147483647;left:${Math.max(2, r.left - 11)}px;top:${Math.max(2, r.top - 11)}px;width:22px;height:22px;border-radius:50%;background:#e11d74;color:#fff;font:700 12px/22px Arial,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff,0 1px 4px rgba(0,0,0,.45);pointer-events:none`;
    document.body.appendChild(d);
    found.push(count);
  }
  return found;
};

const settle = async (page, route) => {
  await page.goto(base + route, { waitUntil: "networkidle" }).catch(() => undefined);
  await page.waitForTimeout(route === "/" ? 3000 : 1700);
};
const ctxFor = async (browser, size, role, scheme = "light") => {
  const ctx = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1.5,
    colorScheme: scheme,
    isMobile: size.width < 500,
    hasTouch: size.width < 500
  });
  const s = sessions[role];
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem("arena3.lang", "vi");
    if (t) {
      localStorage.setItem("arena3.token", t);
      localStorage.setItem("arena3.user", JSON.stringify(u));
    }
  }, [s?.token ?? null, s?.user ?? null]);
  return ctx;
};

const observedIssues = [];

if (!noShoot) {
  marksFound = {};
  const browser = await chromium.launch({ channel: "chrome" });

  // 1. Regular light mode shots (desktop + mobile)
  for (const [vpName, size] of Object.entries(VP)) {
    for (const role of Object.keys(ROLES)) {
      const ctx = await ctxFor(browser, size, role, "light");
      const page = await ctx.newPage();
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          observedIssues.push({ type: "console", vp: vpName, role, text: msg.text() });
        }
      });
      page.on("response", (res) => {
        if (res.status() >= 400) {
          observedIssues.push({ type: "http", vp: vpName, role, status: res.status(), url: res.url() });
        }
      });

      for (const [i, row] of S.entries()) {
        if (row[0] !== role) continue;
        const currentScreenId = idOf(i);
        await settle(page, row[1].replace("$ID", demoId));
        const labels = row[6].map((a) => a.mark ?? null);
        marksFound[`${currentScreenId}-${vpName}`] = await page.evaluate(`(${drawMarks.toString()})(${JSON.stringify(labels)})`);
        await page.screenshot({ path: `${OUT}/img/${currentScreenId}-${vpName}.jpg`, type: "jpeg", quality: 84 });
        await page.evaluate(() => document.querySelectorAll("[data-mark]").forEach((n) => n.remove()));
        if (vpName === "d" && row[8]) {
          if (row[9] != null) {
            // Opening a tab changes what is shown, not what is stored.
            const tabs = page.getByRole("tab");
            if ((await tabs.count()) > row[9]) await tabs.nth(row[9]).click({ timeout: 4000 }).catch(() => undefined);
            else await page.getByRole("button", { name: new RegExp(`^${row[9] + 1}\\b`) }).first().click({ timeout: 4000 }).catch(() => undefined);
          } else {
            // The part below the first screen (read-only scroll, no clicks).
            await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight, window.innerHeight * 1.05)));
          }
          await page.waitForTimeout(900);
          await page.screenshot({ path: `${OUT}/img/${currentScreenId}-x.jpg`, type: "jpeg", quality: 84 });
        }
        console.log("shot", currentScreenId, vpName, row[1]);
      }
      await ctx.close();
    }
  }

  // 2. The "More" menus (opening a menu changes no data).
  for (const role of ["member", "receptionist", "manager"]) {
    for (const [vpName, size] of Object.entries(VP)) {
      if (role === "member" && vpName === "d") continue;
      const ctx = await ctxFor(browser, size, role, "light");
      const page = await ctx.newPage();
      await settle(page, role === "manager" ? "/manager" : role === "member" ? "/app" : "/desk");
      try {
        // The visible one: on a computer the phone's bottom-bar button is in the page but hidden.
        await page.getByRole("button", { name: /Thêm/ }).filter({ visible: true }).first().click({ timeout: 4000 });
        await page.waitForTimeout(900);
      } catch {
        console.log("no More button", role, vpName);
      }
      await page.screenshot({ path: `${OUT}/img/MORE-${role}-${vpName}.jpg`, type: "jpeg", quality: 84 });
      await ctx.close();
    }
  }

  // 3. Dark mode appendix shots for 6 representative screens (desktop + mobile)
  for (const [vpName, size] of Object.entries(VP)) {
    for (const item of DARK_SCREENS) {
      const ctx = await ctxFor(browser, size, item.role, "dark");
      const page = await ctx.newPage();
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          observedIssues.push({ type: "console_dark", vp: vpName, id: item.id, text: msg.text() });
        }
      });
      await settle(page, item.route.replace("$ID", demoId));
      await page.screenshot({ path: `${OUT}/img/DARK-${item.id}-${vpName}.jpg`, type: "jpeg", quality: 84 });
      console.log("shot dark", item.id, vpName, item.route);
      await ctx.close();
    }
  }

  await browser.close();
  writeFileSync(marksFile, JSON.stringify(marksFound, null, 1));
}

const esc = (x) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const byRole = Object.keys(ROLES).map((k) => ({ k, rows: S.map((r, i) => ({ r, i })).filter((x) => x.r[0] === k) }));
const reachOf = (r) => (typeof r[3] === "string" ? { d: r[3], m: r[3] } : reach(r[3]));
const roleChip = (k) => `<span class="role" style="color:${ROLES[k].color};border-color:${ROLES[k].color}">${ROLES[k].vn}</span>`;
const head = (k, code, title, small = "") => `<header><span class="code" style="background:${ROLES[k]?.color ?? "#141d0f"}">${code}</span><div class="titles"><h2>${esc(title)}${small ? ` <small>${small}</small>` : ""}</h2></div><div class="meta">${ROLES[k] ? roleChip(k) : ""}</div></header>`;
const codeOf = (route) => idOf(S.findIndex((r) => r[1] === route));

// Numbers only for controls that are really visible on the shot.
const actionsHtml = (i, r) => {
  const fd = marksFound[`${idOf(i)}-d`] ?? [];
  return r[6].map((a, k) => (fd[k] ? `<li><b class="num">${fd[k]}</b><span>${esc(a.t)}</span></li>` : `<li class="plain"><span>${esc(a.t)}</span></li>`)).join("");
};

const index =
  byRole
    .map(({ k, rows }) => `<div class="idx-role"><h3 style="color:${ROLES[k].color}">${ROLES[k].vn}</h3><ul>${rows.map(({ r, i }) => `<li><a href="#${idOf(i)}"><b>${idOf(i)}</b> ${esc(r[2])}</a></li>`).join("")}</ul></div>`)
    .join("") +
  `<div class="idx-role"><h3 style="color:#5f6857">Trang hướng dẫn</h3><ul><li><a href="#GLOSS"><b>▶</b> Từ khó hiểu</a></li><li><a href="#GRID"><b>▶</b> Đọc lưới sân</a></li><li><a href="#DAYS"><b>▶</b> Một ngày của từng vai</a></li><li><a href="#MORE"><b>▶</b> Menu «Thêm»</a></li><li><a href="#DARK-APPENDIX"><b>▶</b> Phụ lục: Chế độ tối</a></li><li><a href="#APPENDIX"><b>▶</b> Phụ lục kỹ thuật</a></li></ul></div>`;

const mkPage = (i, r) => {
  const k = r[0];
  const rc = reachOf(r);
  const reachHtml = rc.d === rc.m ? `<p class="from"><b>Vào bằng đâu:</b> ${esc(rc.d)}</p>` : `<p class="from"><b>Máy tính:</b> ${esc(rc.d)}<br><b>Điện thoại:</b> ${esc(rc.m)}</p>`;
  const first = `
<section class="page" id="${idOf(i)}">
  ${head(k, idOf(i), r[2])}
  <div class="shots">
    <figure class="desk"><img src="img/${idOf(i)}-d.jpg" alt=""><figcaption>Trên máy tính</figcaption></figure>
    <figure class="mob"><img src="img/${idOf(i)}-m.jpg" alt=""><figcaption>Trên điện thoại</figcaption></figure>
  </div>
  <div class="info">
    <div><h4>Dùng để làm gì</h4><p>${esc(r[4])}</p>${r[7] ? `<p class="note">${esc(r[7])}</p>` : ""}</div>
    <div><h4>Ai dùng, vào bằng đâu</h4><p>${esc(r[5])}</p>${reachHtml}</div>
    <div><h4>Làm được gì ở đây</h4><ul>${actionsHtml(i, r)}</ul></div>
  </div>
</section>`;
  const more = r[8]
    ? `
<section class="page" id="${idOf(i)}x">
  ${head(k, idOf(i), r[2], "(trang tiếp)")}
  <div class="shots"><figure class="desk wide"><img src="img/${idOf(i)}-x.jpg" alt=""><figcaption>${esc(r[8])}</figcaption></figure></div>
</section>`
    : "";
  return first + more;
};

const pages = byRole.flatMap(({ rows }) => rows.map(({ r, i }) => mkPage(i, r))).join("\n");

const moreMenus = `
<section class="page" id="MORE">
  ${head("", "+", "Menu «Thêm»")}
  <div class="shots">
    <figure class="mob"><img src="img/MORE-member-m.jpg" alt=""><figcaption>Hội viên, điện thoại</figcaption></figure>
    <figure class="mob"><img src="img/MORE-receptionist-m.jpg" alt=""><figcaption>Lễ tân, điện thoại</figcaption></figure>
    <figure class="mob"><img src="img/MORE-manager-m.jpg" alt=""><figcaption>Quản lý, điện thoại</figcaption></figure>
    <figure class="desk narrow"><img src="img/MORE-manager-d.jpg" alt=""><figcaption>Quản lý, máy tính</figcaption></figure>
  </div>
  <div class="info two">
    <div><h4>Vì sao cần</h4><p>Thanh dưới trên điện thoại chỉ giữ 5 mục dùng nhiều nhất, thanh trên máy tính hiện vừa đủ chỗ. Các mục còn lại nằm trong nút «Thêm». Ở quản lý, menu «Thêm» chia ba nhóm: Kinh doanh, Vận hành, Hệ thống.</p></div>
    <div><h4>Mục nào nằm trong «Thêm»</h4><ul>
      <li class="plain"><span><b>Hội viên (điện thoại):</b> Tiến độ, Gói tập, Điểm</span></li>
      <li class="plain"><span><b>Lễ tân:</b> Sắp rời bỏ, Lớp học, Dụng cụ, Bảo trì; trên điện thoại thêm Đặt cố định</span></li>
      <li class="plain"><span><b>Quản lý:</b> Kinh doanh (Gói tập, Khuyến mãi, Bảng giá, Hoa hồng, Hoá đơn điện tử), Vận hành (Đặt cố định, Bảo trì), Hệ thống (Nhật ký, Cài đặt); trên điện thoại thêm Lớp học và Nhân viên</span></li>
    </ul></div>
  </div>
</section>`;

const glossary = `
<section class="page idx" id="GLOSS">
  <h2>Từ khó hiểu, giải thích một lần</h2>
  <dl class="gloss">
    <div><dt>Giữ sân 5 phút</dt><dd>Khi hội viên chạm một giờ trống, sân được giữ riêng 5 phút để họ thanh toán. Hết 5 phút mà chưa trả thì sân trả lại cho người khác.</dd></div>
    <div><dt>Giờ còn trống (điện thoại)</dt><dd>Dải giờ phía trên lưới sân: chạm một giờ là hệ thống tự chọn một sân còn trống trong giờ đó, không cần dò từng sân.</dd></div>
    <div><dt>Mã QR vào cổng</dt><dd>Mã trên điện thoại hội viên, tự đổi mỗi phút. Lễ tân quét để cho vào. Chụp màn hình cũng không dùng lại được.</dd></div>
    <div><dt>Mở ca, ca thu ngân</dt><dd>Mỗi lần lễ tân bắt đầu thu tiền thì mở ca (như mở két). Cuối ca đóng ca để đối chiếu tiền. Chưa mở ca thì không thu được tiền.</dd></div>
    <div><dt>Đối soát chuyển khoản</dt><dd>Kiểm tra khoản khách nói đã chuyển có thật sự vào tài khoản trung tâm chưa. Có thì xác nhận, không thấy thì báo lại.</dd></div>
    <div><dt>Hoàn tiền chờ quản lý</dt><dd>Lễ tân đề nghị trả lại tiền; vượt hạn mức thì quản lý phải đồng ý mới trả. Tránh trả nhầm.</dd></div>
    <div><dt>Đặt sân cố định</dt><dd>Cùng sân, cùng giờ, mỗi tuần, trả trước cả đợt 4 đến 12 tuần và được giảm giá.</dd></div>
    <div><dt>Danh sách chờ</dt><dd>Lớp đầy thì hội viên xếp hàng chờ; có người rời lớp thì người đầu hàng được mời vào.</dd></div>
    <div><dt>Sắp rời bỏ</dt><dd>Hội viên vắng liên tiếp, lâu không đến hoặc gói sắp hết. Nhân viên gọi nhắc để giữ chân họ.</dd></div>
    <div><dt>Điểm thưởng</dt><dd>Mỗi 10.000đ chi tiêu được 1 điểm, 1 điểm trị giá 100đ, đổi thành mã giảm giá.</dd></div>
    <div><dt>Hoa hồng huấn luyện viên</dt><dd>Một khoản cho mỗi buổi đã dạy cộng thêm cho mỗi học viên có mặt, chốt theo tháng.</dd></div>
    <div><dt>Mã xác nhận 6 số</dt><dd>Mã gửi qua email để chứng minh đúng người khi tạo tài khoản hoặc quên mật khẩu.</dd></div>
    <div><dt>Trợ lý AI</dt><dd>Chat trả lời hội viên dựa trên dữ liệu thật của trung tâm. AI chỉ gợi ý; con người duyệt việc quan trọng.</dd></div>
    <div><dt>Nhật ký thao tác</dt><dd>Sổ tự ghi ai làm gì lúc nào, kèm giá trị trước và sau. Không ai sửa hay xoá được.</dd></div>
  </dl>
</section>`;

// The court grid key, drawn with the same colours the app uses (sprout green + earth brown theme).
const SW = [
  ["free", "Trống", "Viền xanh mạ có dấu +. Bấm vào được. Đây là ô nổi bật nhất trên lưới.", "background:#ffffff;box-shadow:inset 0 0 0 1px rgba(63,125,32,.5);color:#3f7d20", "+"],
  ["hold", "Đang giữ chỗ", "Ai đó đang giữ 5 phút để thanh toán. Viền cam hổ phách đứt nét vì trạng thái này tự hết.", "background:repeating-linear-gradient(45deg,rgba(28,38,22,.12) 0 3px,transparent 3px 7px),rgba(178,94,9,.15);border:1px dashed #b25e09", ""],
  ["booked", "Đã đặt", "Đã có người đặt. Nền xanh mạ nhạt, lùi về sau để ô trống nổi lên.", "background:rgba(63,125,32,.18)", ""],
  ["in_use", "Đang dùng", "Đã đặt và đang có người chơi đúng giờ này. Màu đậm duy nhất.", "background:#2f6118", ""],
  ["class", "Lớp", "Giờ của một lớp có huấn luyện viên (màu nâu đất).", "background:#6b4423", ""],
  ["maintenance", "Bảo trì", "Sân đang sửa, không bán. Gạch chéo trên nền nâu gỗ.", "background:repeating-linear-gradient(45deg,rgba(28,38,22,.12) 0 3px,transparent 3px 7px),#efe5d4", ""],
  ["closed", "Đã đóng", "Sân tạm đóng, không bán. Gạch chéo đậm hơn.", "background:repeating-linear-gradient(45deg,rgba(28,38,22,.12) 0 3px,transparent 3px 7px),rgba(201,196,174,.45)", ""],
  ["past", "Đã qua", "Giờ đã kết thúc. Mặc định được thu gọn; bấm «Hiện … giờ đã qua» để xem lại.", "background:rgba(239,229,212,.5)", ""],
];
const gridKey = `
<section class="page idx" id="GRID">
  <h2>Đọc lưới sân</h2>
  <p class="lead">Lưới sân xuất hiện ở trang chủ (S01), màn Đặt sân của hội viên (S06) và Sơ đồ sân của lễ tân (S18). Mỗi hàng là một giờ, mỗi cột là một sân. Cả ba nơi dùng chung bảng màu dưới đây (theme xanh mạ + nâu).</p>
  <div class="key">${SW.map(([, name, what, style, glyph]) => `<div class="kc"><span class="sw" style="${style}">${glyph}</span><div><strong>${name}</strong><span>${what}</span></div></div>`).join("")}</div>
  <p class="lead small">Trên điện thoại, lưới chuyển thành từng thẻ sân vuốt ngang, phía trên có dải «Giờ còn trống». Hàng giờ hiện tại có chấm xanh ở cột giờ.</p>
</section>`;

const dayPage = (k, title, steps, idAttr = "") => `
<section class="page idx day"${idAttr ? ` id="${idAttr}"` : ""}>
  ${head(k, "▶", `Một ngày của ${title}`)}
  <ol class="flow">${steps.map(([route, name, what]) => `<li><a href="#${codeOf(route)}"><b>${codeOf(route)}</b></a><div><strong>${esc(name)}</strong><span>${esc(what)}</span></div></li>`).join("")}</ol>
</section>`;
const days = [
  dayPage("member", "hội viên", [["/app", "Trang chủ hội viên", "Xem lịch hôm nay và gói đang dùng"], ["/app/book", "Đặt sân", "Chạm giờ trống, giữ sân 5 phút, thanh toán"], ["/app/pass", "Mã QR vào cổng", "Đến trung tâm, đưa mã cho lễ tân quét"], ["/app/classes", "Lớp học", "Đăng ký lớp có huấn luyện viên"], ["/app/train", "Tiến độ", "Làm bài tập, đọc nhận xét"]], "DAYS"),
  dayPage("receptionist", "lễ tân", [["/desk", "Quầy", "Mở ca, xem «Ngay lúc này», tìm hội viên"], ["/desk/gate", "Cổng", "Quét QR cho khách vào"], ["/desk/courts", "Sơ đồ sân", "Bán giờ trống cho khách vãng lai"], ["/desk/payments", "Thanh toán", "Thu tiền, đối soát chuyển khoản"], ["/desk/at-risk", "Sắp rời bỏ", "Gọi nhắc hội viên lâu không đến"]]),
  dayPage("coach", "huấn luyện viên", [["/coach", "Lịch dạy", "Xem buổi tiếp theo"], ["/coach/attendance", "Điểm danh", "Đánh dấu từng học viên, lưu sổ, lên giáo án"], ["/coach/student/$ID", "Hồ sơ học viên", "Xem ghi chú sức khoẻ, nhận xét tiến bộ"], ["/coach/earnings", "Thu nhập", "Đối chiếu buổi đã dạy trong tháng"]]),
  dayPage("manager", "quản lý", [["/manager", "Báo cáo", "Xem doanh thu, công suất sân, xuất file"], ["/manager/attendance", "Điểm danh", "Xem ai thực sự đến tập"], ["/manager/plans", "Gói tập", "Tạo hoặc sửa gói đang bán"], ["/manager/staff", "Nhân viên", "Cấp tài khoản lễ tân và huấn luyện viên"], ["/manager/audit", "Nhật ký thao tác", "Kiểm tra ai đã làm gì"]]),
].join("");

// Dark mode appendix (6 representative screens)
const darkAppendix = `
<section class="page idx" id="DARK-APPENDIX">
  <h2>Phụ lục: Chế độ tối (Dark mode)</h2>
  <p class="lead">Giao diện tự động chuyển sang tông màu xanh rêu đậm (#10150d / #182114) kết hợp nâu đất (#c08a5a) và xanh mạ sáng (#8bc34a) khi thiết bị bật chế độ tối. Bảng màu tối tuân thủ nghiêm ngặt tiêu chuẩn tương phản WCAG AA, cho trải nghiệm êm dịu ban đêm.</p>
  <div class="key">
    <div class="kc"><span class="sw" style="background:#10150d;box-shadow:inset 0 0 0 1px #2a3824;color:#e9eee0">Aa</span><div><strong>Nền chính (#10150d)</strong><span>Xanh rêu gần đen, giảm mỏi mắt, tương phản 15.66:1</span></div></div>
    <div class="kc"><span class="sw" style="background:#8bc34a;color:#10180a">Aa</span><div><strong>Xanh mạ sáng (#8bc34a)</strong><span>Nút chính chữ tối trên nền sáng, tương phản 8.64:1</span></div></div>
    <div class="kc"><span class="sw" style="background:#c08a5a;color:#10150d">Aa</span><div><strong>Nâu đất (#c08a5a)</strong><span>Điểm nhấn phụ, badge trạng thái và lớp học</span></div></div>
    <div class="kc"><span class="sw" style="background:#3d2815;color:#faebd7">Aa</span><div><strong>Thẻ hội viên (#3d2815)</strong><span>Tông nâu gỗ sẫm, chữ sáng ấm tương phản 13.34:1</span></div></div>
  </div>
  <p class="lead small">Dưới đây là 6 màn hình tiêu biểu đại diện cho khách vãng lai, hội viên, lễ tân và quản lý ở chế độ tối.</p>
</section>
` + DARK_SCREENS.map((item) => `
<section class="page" id="DARK-${item.id}">
  ${head(item.role, item.id, item.title, "(Chế độ tối)")}
  <div class="shots">
    <figure class="desk"><img src="img/DARK-${item.id}-d.jpg" alt=""><figcaption>Trên máy tính (chế độ tối)</figcaption></figure>
    <figure class="mob"><img src="img/DARK-${item.id}-m.jpg" alt=""><figcaption>Trên điện thoại (chế độ tối)</figcaption></figure>
  </div>
  <div class="info">
    <div><h4>Giao diện tối</h4><p>Màn hình ${esc(item.title)} hiển thị trên nền xanh rêu đậm (#10150d), các thẻ card dùng nền #182114 với viền phân cách tự nhiên.</p></div>
    <div><h4>Độ tương phản</h4><p>Chữ chính (#e9eee0) đạt tỉ lệ 15.66:1 so với nền; các nút hành động chữ tối trên nền xanh mạ sáng (#8bc34a) đạt 8.64:1, vượt chuẩn WCAG AA.</p></div>
    <div><h4>Tự động thích ứng</h4><p>Tự động kích hoạt theo cài đặt prefers-color-scheme của hệ thống hoặc trình duyệt mà không cần nút gạt thủ công.</p></div>
  </div>
</section>`).join("\n");

// Two tables side by side, so every row fits on one A4 page.
const appRows = S.map((r, i) => `<tr><td>${idOf(i)}</td><td>${esc(r[2])}</td><td>${ROLES[r[0]].vn}</td><td><code>${esc(r[1].replace("$ID", "{id}"))}</code></td></tr>`);
const half = Math.ceil(appRows.length / 2);
const appTable = (rows) => `<table class="app"><tr><th>Mã</th><th>Tên màn hình</th><th>Vai trò</th><th>Đường dẫn</th></tr>${rows.join("")}</table>`;
const appendix = `
<section class="page idx" id="APPENDIX">
  <h2>Phụ lục kỹ thuật (cho người làm phần mềm)</h2>
  <div class="app-cols">${appTable(appRows.slice(0, half))}${appTable(appRows.slice(half))}</div>
</section>`;

const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Arena3: Từ điển màn hình</title>
<link rel="stylesheet" href="../../node_modules/@fontsource/be-vietnam-pro/400.css">
<link rel="stylesheet" href="../../node_modules/@fontsource/be-vietnam-pro/600.css">
<link rel="stylesheet" href="../../node_modules/@fontsource/be-vietnam-pro/700.css">
<style>
@page { size: A4 landscape; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; font-family: "Be Vietnam Pro", "Segoe UI", system-ui, sans-serif; color: #1c2616; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { width: 297mm; height: 210mm; padding: 9mm 11mm; page-break-after: always; display: flex; flex-direction: column; gap: 4mm; overflow: hidden; background: #f6f5ee }
.cover { justify-content: center; padding: 18mm 22mm; background: #141d0f; color: #f6f5ee }
.cover .brand { display: flex; align-items: center; gap: 4mm; margin-bottom: 8mm; font-size: 14pt; font-weight: 700 }
.cover .brand i { width: 11mm; height: 11mm; border-radius: 2.5mm; background: #3f7d20; display: inline-block }
.cover h1 { font-size: 36pt; margin: 0 0 5mm; font-weight: 700; letter-spacing: -.5px; line-height: 1.1 }
.cover p { font-size: 12.5pt; max-width: 205mm; line-height: 1.55; margin: 0 0 2.5mm; color: #e6eed9 }
.cover .legend { display: flex; gap: 3mm; margin-top: 8mm; flex-wrap: wrap }
.cover .legend span { padding: 1.8mm 4mm; border-radius: 99px; background: #ffffff; color: #1c2616; font-size: 10.5pt; font-weight: 600; border-left: 5mm solid }
.cover .how { margin-top: 5mm; color: #f6f5ee } .cover .how .num { display: inline-block; vertical-align: middle; margin-right: 2mm }
.idx { padding: 10mm 12mm }
.idx h2 { margin: 0 0 5mm; font-size: 20pt; letter-spacing: -.3px; color: #1c2616 }
.idx-wrap { columns: 3; column-gap: 8mm; font-size: 9pt }
.idx-role { break-inside: avoid; margin-bottom: 4mm }
.idx-role h3 { margin: 0 0 1.5mm; font-size: 11pt }
.idx-role ul { list-style: none; margin: 0; padding: 0 }
.idx-role li { border-bottom: .2mm solid #e4e1d3; padding: .8mm 0 }
.idx-role a { color: inherit; text-decoration: none } .idx-role b { color: #5f6857; font-weight: 600; margin-right: 1.5mm }
.gloss { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3.5mm 7mm; margin: 0; font-size: 8.8pt; line-height: 1.4 }
.gloss dt { font-weight: 700; color: #356b1b; margin-bottom: .5mm } .gloss dd { margin: 0; color: #4a5443 }
.lead { font-size: 10.5pt; color: #4a5443; max-width: 230mm; margin: 0 0 6mm; line-height: 1.5 } .lead.small { margin-top: 6mm; font-size: 9.5pt }
.key { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 10mm }
.kc { display: flex; gap: 4mm; align-items: center; background: #ffffff; border-radius: 3mm; padding: 3.5mm 4mm; box-shadow: 0 0 0 .3mm #e4e1d3 }
.sw { width: 16mm; height: 9mm; border-radius: 1.2mm; flex: none; display: grid; place-items: center; font-weight: 700; font-size: 13pt }
.kc strong { display: block; font-size: 11pt; color: #1c2616 } .kc span { color: #4a5443; font-size: 9pt; line-height: 1.4 }
.day header { margin-bottom: 5mm }
.flow { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4mm }
.flow li { display: flex; align-items: center; gap: 5mm; padding: 4mm 5mm; background: #ffffff; border-radius: 3mm; box-shadow: 0 0 0 .3mm #e4e1d3; position: relative }
.flow li:not(:last-child)::after { content: "▼"; position: absolute; left: 11mm; bottom: -4.6mm; font-size: 8pt; color: #c9c4ae; background: #f6f5ee; line-height: 1 }
.flow a { color: #fff; background: #141d0f; border-radius: 2mm; padding: 1.5mm 3mm; text-decoration: none; font-size: 12pt }
.flow strong { display: block; font-size: 13pt; color: #1c2616 } .flow span { color: #4a5443; font-size: 10.5pt }
.app-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; align-items: start }
.app { border-collapse: collapse; width: 100%; font-size: 8pt; line-height: 1.25 } .app th, .app td { border-bottom: .2mm solid #e4e1d3; padding: 1mm 2mm; text-align: left } .app th { color: #5f6857; font-size: 7.6pt; font-weight: 600 }
header { display: flex; align-items: center; gap: 4mm }
.code { color: #fff; font-weight: 700; font-size: 13pt; padding: 1.5mm 3.2mm; border-radius: 2mm }
.titles h2 { margin: 0; font-size: 20pt; line-height: 1.1; letter-spacing: -.3px; color: #1c2616 } .titles small { font-size: 11pt; color: #5f6857; font-weight: 400 }
.meta { margin-left: auto }
.role { border: .35mm solid; border-radius: 99px; padding: .6mm 3mm; font-size: 9pt; font-weight: 600; background: #ffffff }
code { font-family: Consolas, monospace; font-size: 8pt; color: #4a5443 }
.shots { display: flex; gap: 5mm; align-items: flex-start; flex: 1; min-height: 0 }
figure { margin: 0 } figcaption { font-size: 7.5pt; color: #5f6857; text-align: center; margin-top: 1mm; font-weight: 600 }
.desk img { width: 188mm; height: auto; display: block; border-radius: 2mm; box-shadow: 0 0 0 .3mm #c9c4ae, 0 1mm 3mm rgba(28,38,22,.1) }
.desk.wide img { width: 260mm }
.desk.narrow img { width: 110mm }
.mob img { height: 113mm; width: auto; display: block; border-radius: 4mm; border: .6mm solid #141d0f; box-shadow: 0 1mm 3mm rgba(28,38,22,.18) }
.info { display: grid; grid-template-columns: 1.4fr 1fr 1.1fr; gap: 6mm; font-size: 9pt; line-height: 1.42 }
.info.two { grid-template-columns: 1fr 1.6fr }
.info h4 { margin: 0 0 1mm; font-size: 8pt; font-weight: 700; color: #5f6857 }
.info p { margin: 0 0 1mm } .info .from { color: #1c2616; margin-top: 1.5mm }
.info .note { color: #7a4207; background: #efe5d4; border-radius: 1.5mm; padding: 1mm 2mm; font-size: 8.3pt }
.info ul { margin: 0; padding: 0; list-style: none } .info li { margin-bottom: .8mm; display: flex; gap: 2mm; align-items: flex-start }
.info li.plain::before { content: "•"; width: 5mm; text-align: center; flex: none; color: #c9c4ae }
.num { background: #e11d74; color: #fff; width: 5mm; height: 5mm; flex: none; border-radius: 50%; text-align: center; font: 700 8pt/5mm Arial }
</style></head><body>
<section class="page cover">
  <div class="brand"><i></i>Arena3</div>
  <h1>Từ điển màn hình</h1>
  <p>Ảnh chụp thật của từng màn hình trong giao diện mới (tiếng Việt), kèm lời giải thích: màn hình để làm gì, ai dùng, vào bằng đâu, và làm được gì ở đó.</p>
  <p>Mỗi trang là một màn hình: bên trái là ảnh trên máy tính (1440×900), bên phải là ảnh trên điện thoại (390×844). Màn nào cần xem thêm có một trang tiếp theo. Tên người, gói và giá là dữ liệu mẫu.</p>
  <p class="how"><b class="num">1</b> Số hồng trên ảnh chỉ đúng nút được nhắc ở cột «Làm được gì ở đây».</p>
  <p><b>${S.length} màn hình</b> · ${Object.keys(ROLES).length} nhóm người dùng · Ngày chụp: <b>15/10/2026</b> · Nhánh: <b>working</b> · <b>Theme xanh mạ + nâu</b></p>
  <div class="legend">${Object.values(ROLES).map((r) => `<span style="border-left-color:${r.color}">${r.vn}</span>`).join("")}</div>
</section>
<section class="page idx"><h2>Mục lục</h2><div class="idx-wrap">${index}</div></section>
${glossary}
${gridKey}
${days}
${pages}
${moreMenus}
${darkAppendix}
${appendix}
</body></html>`;

writeFileSync(`${OUT}/index.html`, html);
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(`${OUT}/index.html`)).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
await page.pdf({ path: "docs/Arena3-Screen-Dictionary.pdf", width: "297mm", height: "210mm", printBackground: true });
await browser.close();
console.log("ok -> docs/Arena3-Screen-Dictionary.pdf");
