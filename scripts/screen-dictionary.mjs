// Screen dictionary: a real screenshot of every screen, one page each, with a plain-language description.
//   node scripts/screen-dictionary.mjs            -> shoots, builds docs/screen-dictionary/index.html and docs/Arena3-Screen-Dictionary.pdf
//   node scripts/screen-dictionary.mjs --no-shoot -> rebuild the document from the existing images
// Needs the app running on http://127.0.0.1:8080 (seeded demo data). It only READS: it never clicks a button
// that writes (no booking, payment, shift, promo...), so it is safe on any database.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const base = process.env.BASE ?? "http://127.0.0.1:8080";
const noShoot = process.argv.includes("--no-shoot");
const OUT = "docs/screen-dictionary";
mkdirSync(`${OUT}/img`, { recursive: true });

const ROLES = {
  public: { vn: "Khách (chưa đăng nhập)", phone: null, color: "#6b5b45" },
  member: { vn: "Hội viên", phone: "0901230107", color: "#1f5c43" },
  receptionist: { vn: "Lễ tân", phone: "0900000002", color: "#7a4e0c" },
  coach: { vn: "Huấn luyện viên", phone: "0901110011", color: "#1c4e7a" },
  manager: { vn: "Quản lý", phone: "0900000001", color: "#8a2424" },
};

// How a screen is reached: label + where. where: dock (top bar and bottom bar) | sheet (top bar; phone via "Thêm") | more (via "Thêm" on both).
const nav = (label, where = "dock") => ({ label, where });
const reach = (n) => {
  const L = `«${n.label}»`;
  if (n.where === "more") return { d: `Thanh trên: «Thêm» → ${L}`, m: `Thanh dưới: «Thêm» → ${L}` };
  if (n.where === "sheet") return { d: `Thanh trên: ${L}`, m: `Thanh dưới: «Thêm» → ${L}` };
  return { d: `Thanh trên: ${L}`, m: `Thanh dưới: ${L}` };
};

// [role, route, title, nav|string, purpose, who, actions[{t, mark}], note, extra (caption of the scrolled-down shot)]
// `mark` = visible label of the button; if it is found on screen a numbered circle is drawn on the shot.
const A = (t, mark) => ({ t, mark });
const S = [
  // ── Public
  ["public", "/", "Trang chủ", "Mở website của trung tâm", "Giới thiệu trung tâm cho người lạ: giờ mở cửa, số giờ sân còn trống hôm nay, bảng giá, lớp học, huấn luyện viên, gói tập.", "Bất kỳ ai vào website, chưa cần tài khoản.", [A("Bấm «Đặt sân» để cuộn tới lịch sân trống ngay trong trang", "Đặt sân"), A("Xem bảng giá, lớp, huấn luyện viên khi cuộn xuống"), A("Đăng nhập hoặc Tham gia", "Đăng nhập"), A("Đổi ngôn ngữ EN | VI")], "Ảnh chỉ là phần đầu trang. Bảng giá, lớp học, huấn luyện viên nằm phía dưới khi cuộn."],
  ["public", "/login", "Đăng nhập", "Bấm «Đăng nhập» ở trang chủ", "Cửa vào của mọi người. Nhập số điện thoại (hoặc email) và mật khẩu, hệ thống tự đưa bạn đến đúng khu theo vai trò: quản lý, lễ tân, huấn luyện viên hay hội viên.", "Hội viên và nhân viên đã có tài khoản.", [A("Nhập số điện thoại hoặc email, và mật khẩu"), A("Bấm «Quên mật khẩu» nếu quên", "Quên mật khẩu"), A("Bấm «Tạo tài khoản» nếu chưa có", "Tạo tài khoản")], "Hàng «Tài khoản demo» (các nút Quản lý / Lễ tân / HLV) chỉ có ở bản xem thử, để người xem đăng nhập nhanh. Bản thật không có."],
  ["public", "/register", "Tạo tài khoản", "Bấm «Tạo tài khoản» ở trang đăng nhập", "Người mới tự tạo tài khoản hội viên: họ tên, số điện thoại, ngày sinh, mật khẩu (từ 8 ký tự, có chữ và số). Sau đó hệ thống gửi mã xác nhận 6 số để chứng minh đúng số điện thoại.", "Người chưa là hội viên.", [A("Điền họ tên, số điện thoại, ngày sinh, mật khẩu"), A("Bấm «Gửi mã xác nhận»", "Gửi mã xác nhận"), A("Nhập mã 6 số để hoàn tất")], "Ảnh là bước đầu (điền thông tin). Bước nhập mã chỉ hiện sau khi bấm gửi mã nên không có trong ảnh."],
  ["public", "/forgot", "Quên mật khẩu", "Bấm «Quên mật khẩu» ở trang đăng nhập", "Lấy lại mật khẩu: nhập số điện thoại, hệ thống gửi mã 6 số qua email (hết hạn sau 5 phút). Nếu tài khoản không có email, nhờ lễ tân đặt lại mật khẩu tạm.", "Ai quên mật khẩu.", [A("Nhập số điện thoại, bấm «Gửi mã»", "Gửi mã"), A("Nhập mã 6 số và mật khẩu mới")], "Ảnh là bước đầu. Bước nhập mã và mật khẩu mới chỉ hiện sau khi gửi mã."],

  // ── Member
  ["member", "/app", "Trang chủ hội viên", nav("Lịch"), "Màn hình đầu tiên sau khi đăng nhập: gói tập đang có (hoặc lời mời mua gói nếu chưa có), sân và lớp sắp tới, thông báo mới.", "Hội viên.", [A("Xem gói tập còn hiệu lực"), A("Xem sân và lớp sắp tới; bấm «Hủy» nếu muốn hủy"), A("Đọc thông báo mới")], "Ảnh minh họa hội viên chưa có gói đang hiệu lực. Khi đã có gói, trang hiện gói và ngày hết hạn."],
  ["member", "/app/book", "Đặt sân", nav("Đặt sân"), "Chọn ngày và môn, bấm vào khung giờ còn trống để giữ sân trong 5 phút, rồi thanh toán (bằng giờ trong gói, chuyển khoản hoặc thanh toán online). Có ô nhập mã khuyến mãi. Phía dưới là các sân sắp tới của bạn, có nút đổi giờ.", "Hội viên muốn chơi.", [A("Chọn ngày và môn (cầu lông, bóng rổ, bóng chuyền)"), A("Bấm một khung giờ trống để giữ sân"), A("Nhập mã khuyến mãi nếu có"), A("Bấm «Đổi giờ» ở sân đã đặt", "Đổi giờ")], "Hủy sân không nằm ở trang này mà ở Trang chủ hội viên (S05), nút «Hủy» cạnh buổi sắp tới. Ảnh ở trang sau cho thấy lưới giờ.", "Cuộn xuống: lưới giờ trống và sân sắp tới"],
  ["member", "/app/plans", "Gói tập", nav("Gói tập"), "Danh sách gói tập (giá, số buổi, thời hạn, quyền lợi). Hội viên bấm «Mua hoặc gia hạn» để đặt gói, rồi trả tiền tại quầy lễ tân; trước khi trả tiền đã thấy ngày hết hạn mới.", "Hội viên muốn mua hoặc gia hạn gói.", [A("So sánh các gói"), A("Bấm «Mua hoặc gia hạn»", "Mua hoặc gia hạn")], "Trang này không thu tiền online. Lễ tân thu tiền ở màn «Thanh toán» (S17) hoặc trong hồ sơ hội viên (S21). Tên gói là dữ liệu mẫu tiếng Anh."],
  ["member", "/app/classes", "Lớp học", nav("Lớp"), "Các lớp do huấn luyện viên dạy. Xem còn bao nhiêu chỗ, đăng ký hoặc vào danh sách chờ khi lớp đầy. Cuối trang có sổ «Điểm danh của tôi».", "Hội viên muốn học có người dạy.", [A("Bấm «Đăng ký» một lớp"), A("Vào danh sách chờ nếu hết chỗ"), A("Bấm «Rời lớp này» để thôi học", "Rời lớp này"), A("Cuộn xuống xem sổ điểm danh của mình")], "Sổ «Điểm danh của tôi» nằm ở cuối trang (xem ảnh trang sau).", "Cuộn xuống: sổ điểm danh"],
  ["member", "/app/train", "Tiến độ tập luyện", nav("Tiến độ"), "Mục tiêu cá nhân, buổi sắp tới, bài tập về nhà và nhận xét của huấn luyện viên. AI chỉ gợi ý; huấn luyện viên duyệt thì hội viên mới thấy.", "Hội viên đang học lớp.", [A("Đặt mục tiêu của mình"), A("Đánh dấu bài tập đã làm (khi có bài)"), A("Đọc nhận xét của huấn luyện viên")], "Ảnh đang ở trạng thái chưa có bài tập nên mục bài tập trống."],
  ["member", "/app/pass", "Mã QR vào cổng", nav("Mã QR"), "Mã QR tự đổi mỗi phút để đưa lễ tân quét khi vào trung tâm (chụp màn hình lại cũng vô dụng). Nếu trung tâm bật chế độ tự vào cổng, hội viên quét mã trên màn hình lễ tân hoặc dán vào ô «Mã từ màn hình lễ tân» rồi bấm «Vào cổng».", "Hội viên khi đến trung tâm.", [A("Đưa mã QR cho lễ tân quét"), A("Bấm «Mã mới» nếu mã hết hạn", "Mã mới"), A("Tự vào cổng bằng mã (chỉ khi quản lý bật)")], null],
  ["member", "/app/assistant", "Trợ lý", "Nút trợ lý (biểu tượng chat) ở thanh trên", "Chat hỏi nhanh: giờ mở cửa, gói nào đang bán, ai dạy cầu lông, hủy sân thế nào. Trả lời dựa trên dữ liệu thật của trung tâm. Muốn nhắn cho lễ tân, gõ chữ «ticket:» ở đầu câu.", "Hội viên có thắc mắc.", [A("Bấm câu hỏi gợi ý hoặc tự gõ câu hỏi"), A("Gõ «ticket: …» để gửi ghi chú cho lễ tân")], null],
  ["member", "/app/notifications", "Thông báo", "Biểu tượng chuông ở thanh trên", "Hộp thư của hội viên: biên lai mới, đổi lịch sân, phản hồi từ lễ tân. Mục chưa đọc có chấm.", "Hội viên.", [A("Mở một thông báo"), A("Đánh dấu đã đọc")], null],
  ["member", "/account", "Tài khoản", "Bấm avatar góc trên phải → «Cài đặt tài khoản»", "Các tab: Hồ sơ (thông tin cá nhân), Bảo mật (đổi mật khẩu), Biên lai, và Hỗ trợ (gửi tin cho lễ tân). Số điện thoại và email không tự đổi được ở đây; muốn đổi phải nhờ lễ tân.", "Mọi người đã đăng nhập (hội viên, lễ tân, huấn luyện viên, quản lý).", [A("Sửa hồ sơ"), A("Đổi mật khẩu (các máy khác vẫn đang đăng nhập)"), A("Xem biên lai"), A("Gửi tin cho lễ tân ở tab «Hỗ trợ»")], "Đăng xuất khỏi mọi thiết bị do quản lý làm ở màn «Nhân viên» (S33), không có ở đây."],

  // ── Receptionist
  ["receptionist", "/desk", "Quầy lễ tân", nav("Quầy"), "Màn hình làm việc chính của lễ tân: mở ca thu ngân, tìm hội viên, thêm hội viên mới (3 bước: hồ sơ → gói → thanh toán).", "Lễ tân.", [A("Bấm «Mở ca» trước khi thu tiền", "Mở ca"), A("Tìm hội viên theo tên, số điện thoại hoặc mã"), A("Thêm hội viên mới")], null],
  ["receptionist", "/desk/gate", "Cổng", nav("Cổng"), "Quét mã QR của hội viên để cho vào. Máy quét cầm tay tự gõ vào ô đang chọn. Không có mã thì nhập số điện thoại. Hiện ngay kết quả hợp lệ hay không và lý do.", "Lễ tân đứng cổng.", [A("Quét QR bằng máy quét"), A("Nhập số điện thoại khi không có mã"), A("Đọc lý do nếu bị từ chối")], null],
  ["receptionist", "/desk/courts", "Sơ đồ sân", nav("Sân", "sheet"), "Lịch từng sân theo giờ trong ngày: ô nào đã đặt, ô nào trống. Bấm ô trống để đặt giúp khách (đặt sân hộ làm ở đây).", "Lễ tân.", [A("Chọn ngày"), A("Bấm ô trống để đặt giúp khách"), A("Bấm ô đã đặt để xem hoặc đổi")], "Ảnh chụp lúc các ô đều trống."],
  ["receptionist", "/desk/payments", "Thanh toán", nav("Thanh toán"), "Thu tiền tại quầy (tiền mặt, thẻ, chuyển khoản) và xem biên lai. Phải mở ca thu ngân trước mới thu được tiền. Chuyển khoản cần kiểm tra xem tiền đã vào tài khoản chưa. Hoàn tiền do quản lý duyệt.", "Lễ tân (thu tiền) và quản lý (duyệt hoàn tiền).", [A("Bấm «Mở ca trước» nếu chưa mở ca", "Mở ca trước"), A("Thu tiền"), A("Với chuyển khoản: xác nhận đã nhận tiền, hoặc báo không thấy"), A("Xem biên lai")], "Ảnh chụp khi chưa mở ca nên nút thu tiền chưa bấm được. Chúng tôi không mở ca giả để chụp."],
  ["receptionist", "/desk/at-risk", "Sắp rời bỏ", nav("Sắp rời bỏ"), "Danh sách hội viên lâu không đến hoặc gói sắp hết, để gọi nhắc. Bấm số điện thoại trên dòng để gọi, gọi xong bấm «Ghi nhận liên hệ».", "Lễ tân, để chăm sóc khách.", [A("Xem lý do cảnh báo"), A("Gọi theo số điện thoại trên dòng"), A("Bấm «Ghi nhận liên hệ»", "Ghi nhận liên hệ")], "Muốn bán gói cho người này, mở hồ sơ hội viên (S21)."],
  ["receptionist", "/desk/classes", "Lớp học (quầy)", nav("Lớp học", "sheet"), "Xem các lớp: ngày, giờ, huấn luyện viên và số chỗ. Bấm «Buổi học & học viên» để xem từng buổi, sân và danh sách người học.", "Lễ tân.", [A("Xem các lớp và chỗ còn trống"), A("Bấm «Buổi học & học viên»", "Buổi học & học viên")], "Màn này chỉ để xem. Đăng ký lớp do hội viên tự làm ở màn «Lớp học» (S08)."],
  ["receptionist", "/desk/gear", "Dụng cụ", nav("Dụng cụ", "sheet"), "Cho thuê vợt, bóng, dụng cụ vào tài khoản hội viên hoặc cho khách vãng lai theo số điện thoại. Kho tự trừ khi cho thuê và cộng lại khi nhận lại.", "Lễ tân.", [A("Chọn món và số lượng"), A("Chọn người thuê"), A("Bấm «Cho thuê»", "Cho thuê"), A("Khi khách trả, bấm «Nhận lại»")], "Tên món là dữ liệu mẫu tiếng Anh. Ảnh chụp khi chưa có món nào đang cho thuê."],
  ["receptionist", "/desk/member/$ID", "Hồ sơ hội viên", "Tìm hội viên ở màn «Quầy» (S14) rồi bấm vào tên", "Mọi thứ về một hội viên: gói đang dùng, biên lai và các việc lễ tân làm cho họ.", "Lễ tân.", [A("Bấm «Sửa hồ sơ»", "Sửa hồ sơ"), A("Bấm «Đặt lại mật khẩu»", "Đặt lại mật khẩu"), A("Bấm «Thu tiền» hoặc «Thanh toán online»", "Thu tiền"), A("Bấm «Bán thêm gói tập»", "Bán thêm gói tập"), A("Xem biên lai và hoàn tiền")], "Màn này không có đặt sân hộ (làm ở «Sân», S16) và không có sổ điểm danh."],
  ["receptionist", "/alerts", "Cảnh báo", "Biểu tượng chuông ở thanh trên", "Hộp thư cảnh báo cho nhân viên (lễ tân, huấn luyện viên, quản lý đều dùng chung): ví dụ học viên vắng ba buổi liên tiếp.", "Nhân viên.", [A("Mở một cảnh báo"), A("Xử lý rồi đánh dấu đã đọc")], "Ảnh chụp lúc hộp thư đang trống."],

  // ── Coach
  ["coach", "/coach", "Lịch dạy", nav("Lịch"), "Màn hình đầu tiên của huấn luyện viên. Thẻ lớn «Buổi tiếp theo» ở trên cùng cho biết ngay giờ dạy, môn, sân và số học viên, kèm nút to «Điểm danh». Bên dưới là danh sách các buổi sắp tới, chia theo ngày.", "Huấn luyện viên.", [A("Đọc thẻ «Buổi tiếp theo»"), A("Bấm nút «Điểm danh» để vào sổ", "Điểm danh"), A("Bấm một buổi trong danh sách để mở sổ của buổi đó")], "Mỗi buổi chỉ là một dòng gọn (giờ, môn, sân, sĩ số); buổi gần nhất được làm nổi bật để không phải tìm."],
  ["coach", "/coach/attendance", "Điểm danh", nav("Điểm danh"), "Công việc sau buổi dạy được chia thành 4 bước đánh số, mỗi lần chỉ hiện một bước: 1 Điểm danh, 2 Kết quả, 3 Kế hoạch buổi sau, 4 Bài tập. Ở bước 1, mỗi học viên có 4 nút màu (xanh Có mặt, vàng Đến muộn, đỏ Vắng, xám Có phép). Nút «Lưu sổ» dính ở đáy màn hình. Sổ tự khoá sau một thời gian.", "Huấn luyện viên.", [A("Chọn buổi (hoặc đi từ Lịch dạy)"), A("Bấm màu trạng thái của từng học viên"), A("Bấm «Đánh dấu tất cả có mặt»", "Đánh dấu tất cả có mặt"), A("Bấm «Lưu sổ điểm danh»", "Lưu sổ"), A("Bấm số 2, 3, 4 để sang kết quả, kế hoạch, bài tập")], "Ảnh là bước 1 (điểm danh). Ảnh ở trang sau là bước 3 (kế hoạch buổi sau); bước 2 và 4 cùng cách làm.", "Bước 3: kế hoạch buổi sau", 2],
  ["coach", "/coach/student/$ID", "Hồ sơ học viên", "Bấm tên học viên trong sổ điểm danh (S24)", "Phần trên luôn thấy: tên, mục tiêu, trình độ, 4 ô số buổi (có mặt, muộn, vắng, có phép) và khung đỏ ghi chú sức khoẻ nếu có. Phần dưới chia 3 thẻ: Tiến độ (đổi trình độ, nhận xét tiến bộ), Ghi chú của HLV, Lịch sử (các buổi gần đây và bài tập).", "Huấn luyện viên.", [A("Đọc ghi chú sức khoẻ ở khung đỏ"), A("Xem 4 ô số buổi có mặt / muộn / vắng / có phép"), A("Bấm 3 thẻ Tiến độ, Ghi chú, Lịch sử để đổi nội dung")], "Số «có mặt» chỉ tăng khi huấn luyện viên đã lưu điểm danh. Ảnh trang sau là thẻ «Lịch sử».", "Thẻ Lịch sử: buổi gần đây và bài tập", 2],

  // ── Manager
  ["manager", "/manager", "Báo cáo", nav("Báo cáo"), "Bức tranh kinh doanh theo khoảng thời gian: doanh thu, hoàn tiền, giờ sân dùng từ gói, biểu đồ theo phương thức thanh toán và theo nguồn thu. Xuất Excel, PDF hoặc CSV.", "Quản lý, chủ trung tâm.", [A("Chọn Hôm nay / 7 ngày / Tháng này / Tuỳ chọn"), A("Lọc theo phương thức thanh toán"), A("Xuất Excel, PDF, CSV")], null],
  ["manager", "/manager/classes", "Lớp học (quản lý)", nav("Lớp học", "sheet"), "Tạo lớp: môn, trình độ, huấn luyện viên, các ngày trong tuần, giờ và sức chứa; bấm «Tạo và đăng» để hội viên đặt được ngay. Dời hoặc hủy buổi làm trong «Buổi học & học viên».", "Quản lý.", [A("Chọn môn, huấn luyện viên và các ngày"), A("Bấm «Tạo và đăng»", "Tạo và đăng"), A("Mở «Buổi học & học viên» để dời hoặc hủy buổi")], "Ảnh chỉ thấy phần đầu của biểu mẫu."],
  ["manager", "/manager/members", "Hội viên", nav("Hội viên"), "Danh sách mọi hội viên, có tìm kiếm, lọc và chia trang. Mở hồ sơ để xem chi tiết.", "Quản lý.", [A("Tìm theo tên, số điện thoại hoặc mã"), A("Lọc theo trạng thái"), A("Mở hồ sơ")], null],
  ["manager", "/manager/attendance", "Điểm danh (báo cáo)", nav("Điểm danh"), "Thống kê điểm danh: tỉ lệ có mặt theo lớp, theo huấn luyện viên, theo học viên. Có tab «Sắp rời bỏ» và nút xuất Excel, PDF.", "Quản lý.", [A("Chọn khoảng ngày có buổi đã điểm danh"), A("Xem tỉ lệ theo lớp, huấn luyện viên, học viên"), A("Xuất Excel hoặc PDF")], "Ảnh đang chọn khoảng ngày chưa có buổi nào được điểm danh nên số liệu là dấu gạch. Chọn khoảng khác sẽ có số."],
  ["manager", "/manager/plans", "Gói tập (quản lý)", nav("Gói tập", "more"), "Các gói đang bán. Bấm «Gói mới» để tạo; bấm «Chi tiết» để sửa giá và quyền lợi; «Ngừng bán» để ẩn, «Bán lại» để mở lại.", "Quản lý.", [A("Bấm «Gói mới»", "Gói mới"), A("Bấm «Chi tiết» để sửa giá, quyền lợi", "Chi tiết"), A("«Ngừng bán» hoặc «Bán lại»")], "Tên gói là dữ liệu mẫu tiếng Anh."],
  ["manager", "/manager/promos", "Khuyến mãi", nav("Khuyến mãi", "more"), "Tạo mã giảm giá (theo %, theo số tiền), đặt hạn dùng và số lần dùng. Mã đã tạo có nút «Tạm dừng» / «Tiếp tục» và «Ai đã dùng».", "Quản lý.", [A("Bấm «Mã mới»", "Mã mới"), A("«Tạm dừng» hoặc «Tiếp tục» một mã"), A("«Ai đã dùng» để xem lượt dùng")], "Ảnh chụp lúc chưa có mã nào nên danh sách trống."],
  ["manager", "/manager/prices", "Bảng giá", nav("Bảng giá", "more"), "Giá thuê sân theo môn, theo ngày (thường, cuối tuần, lễ) và theo giờ (thường, cao điểm). Giá mới chỉ áp cho giao dịch mới.", "Quản lý.", [A("Mở từng môn"), A("Sửa giá trong ô"), A("Lưu")], null],
  ["manager", "/manager/staff", "Nhân viên", nav("Nhân viên", "sheet"), "Cấp tài khoản cho lễ tân và huấn luyện viên (chỉ tạo ở đây), đặt lại mật khẩu, khoá tài khoản, đăng xuất các phiên đăng nhập.", "Quản lý.", [A("Tạo nhân viên"), A("Đặt lại mật khẩu"), A("Khoá hoặc mở khoá"), A("Đăng xuất mọi nơi")], null],
  ["manager", "/manager/audit", "Nhật ký thao tác", nav("Nhật ký", "more"), "Ai đã làm gì, lúc nào, mới nhất trước. Chỉ xem, không sửa được. Dùng khi cần kiểm tra ai đổi giá, ai hoàn tiền.", "Quản lý, để kiểm tra.", [A("Lọc theo hành động, người, ngày"), A("Tìm trong nhật ký")], "Ảnh chụp lúc nhật ký đang trống nên chưa thấy dòng «ai, làm gì, lúc nào». Ô ngày hiện theo kiểu của trình duyệt (tháng/ngày/năm)."],
  ["manager", "/manager/settings", "Cài đặt", nav("Cài đặt", "more"), "Bật hoặc tắt tính năng (công tắc F4, F5, F6), đưa từng sân vào «Đang mở / Bảo trì / Đã đóng». Cuối trang là thông tin pháp lý của trung tâm: tên, địa chỉ, mã số thuế.", "Quản lý.", [A("Bật hoặc tắt tính năng"), A("Đổi trạng thái từng sân"), A("Cuộn xuống: sửa thông tin trung tâm rồi «Lưu»")], "Thông tin pháp lý nằm phía dưới (xem ảnh trang sau).", "Cuộn xuống: thông tin trung tâm"],
];

const VP = { d: { width: 1366, height: 820 }, m: { width: 390, height: 844 } };
const login = async (phone) =>
  (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, password: "ChangeMe!a3" }) })).json();

const sessions = {};
for (const [k, r] of Object.entries(ROLES)) if (r.phone) sessions[k] = await login(r.phone);
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
    const cands = [...document.querySelectorAll("button, a, [role=button], [role=tab], label, h1, h2, h3, h4, summary")];
    const el = cands.find((c) => vis(c) && norm(c.textContent ?? "") === want) ?? cands.find((c) => vis(c) && norm(c.textContent ?? "").startsWith(want) && norm(c.textContent ?? "").length < want.length + 18);
    if (!el) { found.push(null); continue; }
    const r = el.getBoundingClientRect();
    count += 1;
    const d = document.createElement("div");
    d.textContent = String(count);
    d.setAttribute("data-mark", "1");
    d.style.cssText = `position:fixed;z-index:2147483647;left:${Math.max(2, r.left - 11)}px;top:${Math.max(2, r.top - 11)}px;width:22px;height:22px;border-radius:50%;background:#d6246e;color:#fff;font:700 12px/22px Arial,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff,0 1px 4px rgba(0,0,0,.45);pointer-events:none`;
    document.body.appendChild(d);
    found.push(count);
  }
  return found;
};

const settle = async (page, route) => {
  await page.goto(base + route, { waitUntil: "networkidle" }).catch(() => undefined);
  await page.waitForTimeout(route === "/" ? 4500 : 1700);
};
const ctxFor = async (browser, size, role) => {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1.5 });
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

if (!noShoot) {
  marksFound = {};
  const browser = await chromium.launch({ channel: "chrome" });
  for (const [vpName, size] of Object.entries(VP)) {
    for (const role of Object.keys(ROLES)) {
      const ctx = await ctxFor(browser, size, role);
      const page = await ctx.newPage();
      for (const [i, row] of S.entries()) {
        if (row[0] !== role) continue;
        await settle(page, row[1].replace("$ID", demoId));
        const labels = row[6].map((a) => a.mark ?? null);
        marksFound[`${idOf(i)}-${vpName}`] = await page.evaluate(`(${drawMarks.toString()})(${JSON.stringify(labels)})`);
        await page.screenshot({ path: `${OUT}/img/${idOf(i)}-${vpName}.jpg`, type: "jpeg", quality: 84 });
        await page.evaluate(() => document.querySelectorAll("[data-mark]").forEach((n) => n.remove()));
        if (vpName === "d" && row[8]) {
          if (row[9] != null) await page.getByRole("tab").nth(row[9]).click({ timeout: 4000 }).catch(() => undefined);
          // The part below the first screen (read-only scroll, no clicks).
          if (row[9] == null) await page.evaluate(() => {
            for (const el of [document.scrollingElement, ...document.querySelectorAll("main, [class*=overflow-y-auto]")]) if (el) el.scrollTop = el.scrollHeight;
            window.scrollTo(0, document.body.scrollHeight);
          });
          await page.waitForTimeout(900);
          await page.screenshot({ path: `${OUT}/img/${idOf(i)}-x.jpg`, type: "jpeg", quality: 84 });
        }
        console.log("shot", idOf(i), vpName, row[1]);
      }
      await ctx.close();
    }
  }

  // Payment return page (what a member sees after paying online).
  for (const [vpName, size] of Object.entries(VP)) {
    const ctx = await ctxFor(browser, size, "member");
    const page = await ctx.newPage();
    await settle(page, "/pay/return");
    await page.screenshot({ path: `${OUT}/img/PAY-${vpName}.jpg`, type: "jpeg", quality: 84 });
    await ctx.close();
  }
  // The "More" menus (opening a menu changes no data).
  for (const role of ["receptionist", "manager"]) {
    for (const [vpName, size] of Object.entries(VP)) {
      const ctx = await ctxFor(browser, size, role);
      const page = await ctx.newPage();
      await settle(page, role === "manager" ? "/manager" : "/desk");
      try {
        await page.getByRole("button", { name: /^Thêm$/ }).last().click({ timeout: 4000 });
        await page.waitForTimeout(900);
      } catch {
        console.log("no More button", role, vpName);
      }
      await page.screenshot({ path: `${OUT}/img/MORE-${role}-${vpName}.jpg`, type: "jpeg", quality: 84 });
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
const head = (k, code, title, small = "") => `<header><span class="code" style="background:${ROLES[k]?.color ?? "#444"}">${code}</span><div class="titles"><h2>${esc(title)}${small ? ` <small>${small}</small>` : ""}</h2></div><div class="meta">${ROLES[k] ? roleChip(k) : ""}</div></header>`;

// Numbers only for buttons that are really visible on the shot.
const actionsHtml = (i, r) => {
  const fd = marksFound[`${idOf(i)}-d`] ?? [];
  return r[6].map((a, k) => (fd[k] ? `<li><b class="num">${fd[k]}</b><span>${esc(a.t)}</span></li>` : `<li class="plain"><span>${esc(a.t)}</span></li>`)).join("");
};

const index = byRole
  .map(({ k, rows }) => `<div class="idx-role"><h3 style="color:${ROLES[k].color}">${ROLES[k].vn}</h3><ul>${rows.map(({ r, i }) => `<li><a href="#${idOf(i)}"><b>${idOf(i)}</b> ${esc(r[2])}</a></li>`).join("")}${k === "member" ? `<li><a href="#PAY"><b>S36</b> Kết quả thanh toán online</a></li>` : ""}</ul></div>`)
  .join("") + `<div class="idx-role"><h3>Trang hướng dẫn</h3><ul><li>Từ khó hiểu</li><li>Một ngày của từng vai</li><li>Cách mở menu «Thêm»</li><li>Phụ lục kỹ thuật</li></ul></div>`;

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
    <div><h4>Dùng để làm gì</h4><p>${esc(r[4])}</p>${r[7] ? `<p class="note">⚠ ${esc(r[7])}</p>` : ""}</div>
    <div><h4>Ai dùng · vào bằng đâu</h4><p>${esc(r[5])}</p>${reachHtml}</div>
    <div><h4>Làm được gì ở đây</h4><ul>${actionsHtml(i, r)}</ul></div>
  </div>
</section>`;
  const more = r[8]
    ? `
<section class="page" id="${idOf(i)}x">
  ${head(k, idOf(i), r[2], "(phần cuộn xuống)")}
  <div class="shots"><figure class="desk wide"><img src="img/${idOf(i)}-x.jpg" alt=""><figcaption>${esc(r[8])}</figcaption></figure></div>
</section>`
    : "";
  return first + more;
};

const payPage = `
<section class="page" id="PAY">
  ${head("member", "S36", "Kết quả thanh toán online")}
  <div class="shots">
    <figure class="desk"><img src="img/PAY-d.jpg" alt=""><figcaption>Trên máy tính</figcaption></figure>
    <figure class="mob"><img src="img/PAY-m.jpg" alt=""><figcaption>Trên điện thoại</figcaption></figure>
  </div>
  <div class="info">
    <div><h4>Dùng để làm gì</h4><p>Trang hội viên thấy khi quay lại từ cổng thanh toán online. Nó tự kiểm tra và báo một trong các kết quả: đang chờ ngân hàng, đã thanh toán (sân hoặc gói được xác nhận, có biên lai), đã hủy, hoặc chưa rõ.</p><p class="note">⚠ Ảnh là trang mở thẳng, không qua cổng thanh toán, nên hiện trạng thái «chưa rõ». Khi thanh toán thật sẽ hiện kết quả cụ thể.</p></div>
    <div><h4>Ai dùng · vào bằng đâu</h4><p>Hội viên vừa trả tiền online.</p><p class="from"><b>Vào bằng đâu:</b> tự chuyển về sau khi thanh toán.</p></div>
    <div><h4>Làm được gì ở đây</h4><ul><li class="plain"><span>Đọc kết quả</span></li><li class="plain"><span>Quay lại xem sân hoặc gói đã đặt</span></li></ul></div>
  </div>
</section>`;

const pages = byRole.flatMap(({ k, rows }) => {
  const out = rows.map(({ r, i }) => mkPage(i, r));
  if (k === "member") out.push(payPage);
  return out;
}).join("\n");

const moreMenus = `
<section class="page" id="MORE">
  ${head("", "+", "Cách mở menu «Thêm»")}
  <div class="shots">
    <figure class="mob"><img src="img/MORE-receptionist-m.jpg" alt=""><figcaption>Lễ tân · điện thoại</figcaption></figure>
    <figure class="mob"><img src="img/MORE-manager-m.jpg" alt=""><figcaption>Quản lý · điện thoại</figcaption></figure>
    <figure class="desk narrow"><img src="img/MORE-manager-d.jpg" alt=""><figcaption>Quản lý · máy tính</figcaption></figure>
  </div>
  <div class="info two">
    <div><h4>Vì sao cần</h4><p>Thanh dưới (điện thoại) và thanh trên (máy tính) chỉ chứa những mục dùng nhiều nhất. Các mục còn lại nằm trong nút «Thêm».</p></div>
    <div><h4>Mục nào nằm trong «Thêm»</h4><ul><li class="plain"><span><b>Lễ tân (điện thoại):</b> Sân, Lớp học, Dụng cụ</span></li><li class="plain"><span><b>Quản lý (điện thoại):</b> Lớp học, Nhân viên, Gói tập, Khuyến mãi, Bảng giá, Nhật ký, Cài đặt</span></li><li class="plain"><span><b>Quản lý (máy tính):</b> Gói tập, Khuyến mãi, Bảng giá, Nhật ký, Cài đặt</span></li></ul></div>
  </div>
</section>`;

const glossary = `
<section class="page idx" id="GLOSS">
  <h2>Từ khó hiểu, giải thích một lần</h2>
  <dl class="gloss">
    <div><dt>Giữ sân 5 phút</dt><dd>Khi hội viên bấm một khung giờ, sân được giữ riêng 5 phút để họ thanh toán. Hết 5 phút mà chưa trả thì sân nhả ra cho người khác.</dd></div>
    <div><dt>Mã QR vào cổng</dt><dd>Mã trên điện thoại hội viên, tự đổi mỗi phút. Lễ tân quét để cho vào. Chụp màn hình cũng không dùng lại được.</dd></div>
    <div><dt>Mở ca / ca thu ngân</dt><dd>Mỗi lần lễ tân bắt đầu thu tiền thì «mở ca» (như mở két). Cuối ngày đóng ca để đối chiếu tiền. Chưa mở ca thì không thu tiền được.</dd></div>
    <div><dt>Đối soát chuyển khoản</dt><dd>Kiểm tra xem khách nói đã chuyển khoản thì tiền có thật sự vào tài khoản trung tâm chưa. Có thì bấm xác nhận, không thấy thì báo lại.</dd></div>
    <div><dt>Hoàn tiền (chờ quản lý duyệt)</dt><dd>Lễ tân đề nghị trả lại tiền; quản lý bấm đồng ý thì mới trả. Tránh trả nhầm.</dd></div>
    <div><dt>Danh sách chờ</dt><dd>Lớp đã đầy thì hội viên xếp hàng chờ; có người rời lớp thì người đầu hàng được vào.</dd></div>
    <div><dt>Sắp rời bỏ</dt><dd>Hội viên lâu không đến hoặc gói sắp hết — nhân viên gọi nhắc để họ ở lại.</dd></div>
    <div><dt>Mã xác nhận 6 số</dt><dd>Mã gửi tới điện thoại hoặc email để chứng minh đúng người (khi tạo tài khoản, quên mật khẩu).</dd></div>
    <div><dt>F4, F5, F6 (ở Cài đặt)</dt><dd>Tên nội bộ của ba công tắc bật/tắt: F4 «Sổ điểm danh và kế hoạch buổi học», F5 «Gợi ý kế hoạch» (mẫu bài tập theo môn, huấn luyện viên vẫn phải duyệt), F6 «Trợ lý hội viên».</dd></div>
    <div><dt>Trợ lý AI</dt><dd>Chat trả lời hội viên dựa trên dữ liệu thật của trung tâm (lịch, gói, huấn luyện viên). AI chỉ gợi ý; nhân viên duyệt các việc quan trọng.</dd></div>
    <div><dt>Phiên đăng nhập</dt><dd>Mỗi thiết bị đang đăng nhập là một phiên. «Đăng xuất mọi nơi» (ở màn Nhân viên) cắt tất cả.</dd></div>
    <div><dt>Nhật ký thao tác</dt><dd>Cuốn sổ tự ghi ai làm gì lúc nào. Không ai sửa hay xoá được.</dd></div>
  </dl>
</section>`;

const dayPage = (k, title, steps) => `
<section class="page idx day">
  ${head(k, "▶", `Một ngày của ${title}`)}
  <ol class="flow">${steps.map(([code, name, what]) => `<li><a href="#${code}"><b>${code}</b></a><div><strong>${esc(name)}</strong><span>${esc(what)}</span></div></li>`).join("")}</ol>
</section>`;
const days = [
  dayPage("member", "hội viên", [["S05", "Trang chủ hội viên", "Xem gói và lịch sắp tới"], ["S06", "Đặt sân", "Chọn giờ trống, giữ sân 5 phút, thanh toán"], ["S10", "Mã QR vào cổng", "Đến trung tâm, đưa mã cho lễ tân quét"], ["S08", "Lớp học", "Đăng ký lớp có huấn luyện viên"], ["S09", "Tiến độ", "Làm bài tập, đọc nhận xét"]]),
  dayPage("receptionist", "lễ tân", [["S14", "Quầy", "Mở ca, tìm hội viên"], ["S15", "Cổng", "Quét QR cho khách vào"], ["S17", "Thanh toán", "Thu tiền, xem biên lai"], ["S21", "Hồ sơ hội viên", "Bán gói, đặt lại mật khẩu"], ["S18", "Sắp rời bỏ", "Gọi nhắc hội viên lâu không đến"]]),
  dayPage("coach", "huấn luyện viên", [["S23", "Lịch dạy", "Xem buổi sắp tới"], ["S24", "Điểm danh", "Bấm «Điểm danh», chọn màu cho từng em, lưu sổ"], ["S25", "Hồ sơ học viên", "Xem mục tiêu, giao bài, nhận xét"]]),
  dayPage("manager", "quản lý", [["S26", "Báo cáo", "Xem doanh thu, xuất Excel hoặc PDF"], ["S30", "Gói tập", "Tạo hoặc sửa gói đang bán"], ["S33", "Nhân viên", "Cấp tài khoản lễ tân và huấn luyện viên"], ["S34", "Nhật ký thao tác", "Kiểm tra ai đã làm gì"]]),
].join("");

const appendix = `
<section class="page idx">
  <h2>Phụ lục kỹ thuật (cho người làm phần mềm)</h2>
  <table class="app"><tr><th>Mã</th><th>Tên màn hình</th><th>Vai trò</th><th>Đường dẫn</th></tr>
  ${S.map((r, i) => `<tr><td>${idOf(i)}</td><td>${esc(r[2])}</td><td>${ROLES[r[0]].vn}</td><td><code>${esc(r[1].replace("$ID", "{id}"))}</code></td></tr>`).join("")}
  <tr><td>S36</td><td>Kết quả thanh toán online</td><td>Hội viên</td><td><code>/pay/return</code></td></tr></table>
</section>`;

const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Arena3 — Từ điển màn hình</title>
<style>
@page { size: A4 landscape; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: #1c1a16; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { width: 297mm; height: 210mm; padding: 9mm 11mm; page-break-after: always; display: flex; flex-direction: column; gap: 4mm; overflow: hidden; background: #fbf8f1 }
.cover { justify-content: center; padding: 18mm 22mm; background: #17301f; color: #f7f0e1 }
.cover h1 { font-size: 38pt; margin: 0 0 4mm; font-weight: 600; letter-spacing: -.5px }
.cover p { font-size: 13pt; max-width: 200mm; line-height: 1.5; margin: 0 0 2.5mm; opacity: .92 }
.cover .legend { display: flex; gap: 4mm; margin-top: 7mm; flex-wrap: wrap }
.cover .legend span { padding: 2mm 4mm; border-radius: 99px; background: #fff; color: #1c1a16; font-size: 11pt; font-weight: 600; border-left: 5mm solid }
.cover .how { margin-top: 5mm } .cover .how .num { display: inline-block; vertical-align: middle; margin-right: 2mm }
.idx { background: #fbf8f1; padding: 10mm 12mm }
.idx h2 { margin: 0 0 5mm; font-size: 20pt }
.idx-wrap { columns: 3; column-gap: 8mm; font-size: 9pt }
.idx-role { break-inside: avoid; margin-bottom: 4mm }
.idx-role h3 { margin: 0 0 1.5mm; font-size: 11pt }
.idx-role ul { list-style: none; margin: 0; padding: 0 }
.idx-role li { border-bottom: .2mm dotted #cfc6b3; padding: .8mm 0 }
.idx-role a { color: inherit; text-decoration: none }
.gloss { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3.5mm 7mm; margin: 0; font-size: 8.8pt; line-height: 1.38 }
.gloss dt { font-weight: 700; color: #1f5c43; margin-bottom: .5mm } .gloss dd { margin: 0; color: #3b362b }
.day header { margin-bottom: 5mm }
.flow { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4mm }
.flow li { display: flex; align-items: center; gap: 5mm; padding: 4mm 5mm; background: #fff; border: .3mm solid #d9d0bd; border-radius: 3mm; position: relative }
.flow li:not(:last-child)::after { content: "▼"; position: absolute; left: 11mm; bottom: -4.6mm; font-size: 9pt; color: #a79c84; background: #fbf8f1; line-height: 1 }
.flow a { color: #fff; background: #333; border-radius: 2mm; padding: 1.5mm 3mm; text-decoration: none; font-size: 12pt }
.flow strong { display: block; font-size: 13pt } .flow span { color: #5b5242; font-size: 10.5pt }
.app { border-collapse: collapse; width: 100%; font-size: 7pt; line-height: 1.15 } .app th, .app td { border-bottom: .2mm solid #d9d0bd; padding: .2mm 2mm; text-align: left } .app th { color: #7a705c; text-transform: uppercase; font-size: 7.2pt; letter-spacing: .08em }
header { display: flex; align-items: center; gap: 4mm }
.code { color: #fff; font-weight: 700; font-size: 13pt; padding: 1.5mm 3.2mm; border-radius: 2mm }
.titles h2 { margin: 0; font-size: 20pt; line-height: 1.1 } .titles small { font-size: 11pt; color: #7a705c; font-weight: 400 }
.meta { margin-left: auto }
.role { border: .35mm solid; border-radius: 99px; padding: .6mm 3mm; font-size: 9pt; font-weight: 600; background: #fff }
code { font-family: Consolas, monospace; font-size: 8pt; color: #5b5242 }
.shots { display: flex; gap: 5mm; align-items: flex-start; flex: 1; min-height: 0 }
figure { margin: 0 } figcaption { font-size: 7.5pt; color: #8a806c; text-align: center; margin-top: 1mm; text-transform: uppercase; letter-spacing: .08em }
.desk img { width: 188mm; height: auto; display: block; border-radius: 2mm; border: .3mm solid #cfc6b3; box-shadow: 0 1mm 3mm rgba(0,0,0,.12) }
.desk.wide img { width: 275mm }
.desk.narrow img { width: 120mm }
.mob img { height: 113mm; width: auto; display: block; border-radius: 4mm; border: .6mm solid #2a2620; box-shadow: 0 1mm 3mm rgba(0,0,0,.18) }
.info { display: grid; grid-template-columns: 1.35fr 1fr 1.1fr; gap: 6mm; font-size: 9.2pt; line-height: 1.4 }
.info.two { grid-template-columns: 1fr 1.6fr }
.info h4 { margin: 0 0 1mm; font-size: 8pt; text-transform: uppercase; letter-spacing: .09em; color: #7a705c }
.info p { margin: 0 0 1mm } .info .from { color: #3b362b; margin-top: 1.5mm }
.info .note { color: #8a4b00; background: #fdf0d6; border-radius: 1.5mm; padding: 1mm 2mm; font-size: 8.4pt }
.info ul { margin: 0; padding: 0; list-style: none } .info li { margin-bottom: .8mm; display: flex; gap: 2mm; align-items: flex-start }
.info li.plain::before { content: "•"; width: 5mm; text-align: center; flex: none }
.num { background: #d6246e; color: #fff; width: 5mm; height: 5mm; flex: none; border-radius: 50%; text-align: center; font: 700 8pt/5mm Arial }
</style></head><body>
<section class="page cover">
  <h1>Arena3 — Từ điển màn hình</h1>
  <p>Ảnh chụp thật của từng màn hình trong ứng dụng (đang ở chế độ tiếng Việt), kèm lời giải thích: màn hình này để làm gì, ai dùng, vào bằng đâu, và làm được gì ở đó.</p>
  <p>Mỗi trang là một màn hình: bên trái là ảnh trên máy tính, bên phải là ảnh trên điện thoại. Ảnh là phần đầu của màn hình; màn nào dài hơn thì có thêm một trang ảnh phần cuộn xuống. Tên người, gói, giá là dữ liệu mẫu (nên có chỗ còn tiếng Anh hoặc đang trống).</p>
  <p class="how"><b class="num">1</b> Số hồng trên ảnh chỉ đúng nút được nhắc ở cột «Làm được gì ở đây».</p>
  <p>${S.length + 1} màn hình · ${Object.keys(ROLES).length} nhóm người dùng.</p>
  <div class="legend">${Object.values(ROLES).map((r) => `<span style="border-left-color:${r.color}">${r.vn}</span>`).join("")}</div>
</section>
<section class="page idx"><h2>Mục lục</h2><div class="idx-wrap">${index}</div></section>
${glossary}
${days}
${pages}
${moreMenus}
${appendix}
</body></html>`;

writeFileSync(`${OUT}/index.html`, html);
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(`${OUT}/index.html`)).href, { waitUntil: "load" });
await page.waitForTimeout(800);
await page.pdf({ path: "docs/Arena3-Screen-Dictionary.pdf", width: "297mm", height: "210mm", printBackground: true });
await browser.close();
console.log("ok -> docs/Arena3-Screen-Dictionary.pdf");
