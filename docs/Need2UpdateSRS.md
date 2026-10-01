# Thông tin cho Sports Center Management System

## Tổng quan

- Bán cái gì: hiện tại thì trung tâm sẽ bán gói thành viên (chứa sessions lớp học hoặc là số giờ thuê sân tùy gói) và cả cho thuê sân lẻ theo giờ.
- Cho ai: chủ yếu là bán gói thành viên cho member đã có tài khoản (tức là khách vãng lai lần đầu vào app chưa có tài khoản thì phải đăng kí tạo tài khoản thì mới đăng kí mua gói được) hoặc là khách vãng lai cũng có thể đăng kí mua gói tài khoản trực tiếp tại quầy lễ tân thì Lễ tân sẽ vừa tạo tài khoản + nhận tiền thanh toán + kích hoạt gói cho tài khoản, và cho member hoặc khách vãng lai thuê sân tại quầy.
- Ai vận hành: chưa rõ câu hỏi lắm nhưng tôi nghĩ là System Admin sẽ vận hành hệ thống này hoặc cũng có thể là cả System Admin, Center Manager, Receptionist đều vận hành hệ thống này.
- Tiền đi vào đâu thì có lẽ là sẽ vào tài khoản một thành viên cho nhóm vì đây là một môn học và chủ yếu học cách vận hành một hệ thống.

Actor & Usecase:

- Member: Logout, mua hoặc gia hạn gói thành viên, ghi danh vào một lớp, rời một lớp, đặt slot cho sân hoặc lớp, xem schedule (Hiện tại đang thấy là xem được thông tin gói quota còn lại, hạn sử dụng của gói, môn thể thao, mã member, class đã book có sân học và giờ học và huấn luyện viên trưởng, sân đã book, xem được thông báo bên dưới - Tức là có NOTIFICATION nhưng trong web và tạm thời chưa có gửi qua EMAIL hay SMS), có update profile, có hỏi AI assistant. ====> Còn thiếu: Có tính năng nâng gói không?, chưa có schedule trực quan để xem ngày nào có slot đặt, có tính năng thay đổi slot sau khi book thành công không?, CHƯA CÓ HỦY GÓI THÀNH VIÊN, THIẾU TÍNH NĂNG XEM ĐIỂM DANH và theo dõi tiến trình tập luyện, CHECK lại về tính năng nhận thông báo qua EMAIL và SMS.
- Coach: Hiện tại chỉ có xem lớp dạy theo môn phụ trách (bao gồm thông tin là môn, giờ bắt đầu và giờ kết thúc, sân nào, bao nhiêu học sinh trên tổng học sinh), điểm danh (toàn bộ tên và mã số của học sinh và điểm dang theo 4 trạng thái là Present - Late - Absent - Excused), nhờ AI suggest kế hoạch dạy cho lớp (dựa trên Sport + Level + Focus), logout, update profile. ====> Còn thiếu: Không có ngày dạy cụ thể, có tính năng đánh giá quá trình trong từng ngày của học viên không?, có cần bài test đánh giá cho học viên không?, có thêm tài liệu dạy học không?.
- Receptionist: Logout, mở ca và đóng ca (có hiện số tiền thu trong ca), tìm member's account (theo tên/số điện thoại/mã), xem thông tin member, tạo tài khoản member mới, xem sân trống trên schedule và hỗ trợ đặt sân cho khách tại quầy (này là sẽ thực hiện thanh toán và chuyển trạng thái sân luôn), PHẦN PAYMENT CHƯA HIỂU LẮM (hiện tại có các chỗ để hiển thị các lượt đặt gói nhưng chưa được thanh toán và cần thanh toán để active gói & hiển thị refund cần chờ hành động của manager & lịch sử hóa đơn & chưa rõ chỗ back to the desk), cho mượn dụng cụ tập luyện (để cho mượn thì cần: loại dụng cụ & sđt member mượn & số lượng | có hiển thị thông tin về các loại dụng cụ, số lượng trong kho và giá cho thuê mỗi cái của từng loại | có lịch sử cho mượn và có nút lấy lại), nên đem receipts trong account setting ra ngoài cải thiện UX. ====> Còn thiếu:
- Center Manager: logout, xem và xuất CSV báo cáo (theo ngày, tuần, tháng, custom - xem được tổng doanh thu, refunds, số giờ )

#### Xíu fix:

- Cần xem lại phần UX xem ngày dạy và học của coach và member.
- Tại sao tài khoản Nguyễn Trọng Toàn active rồi nhỉ => cần check xem vừa tạo tài khoản mới thì tìm bên Receptionist xem có active khi mà chưa mua và thanh toán gói không.

- Payment receptionist,

#### Chừng nữa fix:

- Check lại luồng đăng kí thành viên mới bên Receptionist + Luồng đặt sân bên Receptionist.
- Cần test 2 máy xem một bên thanh toán bằng role member xem bên Receptionist có hiện hóa đơn hay gì trong account setting không.
- Về vấn đề member đánh giá coach và coach đánh giá member / xem coach info, contact qua lại / lời khuyên advise (tính năng commend).
- Cần tìm thêm về việc có tính năng thay đổi sau khi đã book không (xử lí khi kẹt đột xuất).
- Hệ thống hiện tại chưa có system admin để phân role hoặc là cấp tài khoản cho các role ngoài member.
- Nếu khách vãng lai thuê sân tại quầy thì có cần lưu lại tài khoản không hay chỉ cần lấy thông tin như tên và số điện thoại xong update trạng thái sân đó là được.
- CÁC ROLE khác member nếu cũng muốn mua gói hay là thuê sân trên web thì sao. Hiện tại ai vận hành chưa rõ lắm nhưng có thể là sẽ thêm role system admin.
- Check xem hiện tại khi khách vãng lai thuê sân hoặc tạo tài khoản mua gói ở lễ tân thì tài khoản mới có được lưu vào hệ thống không, gói của tài khoản có được kích hoạt không, sân có được đánh là đã cho thuê không.
- Chưa rõ về chỗ đặt sân trong Lễ Tân không biết là đang chọn sân nào luôn chỗ cái bảng.
- Chú ý xem hiện tại là member khi gói chưa active thì không được ghi dang vào lớp, đặt sân không được giảm giá và không được trả bằng quota giờ.
