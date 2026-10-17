/**
 * repro-F23.mjs — Tái hiện F-23: HLV môn khác (Đức Anh) xoá ghi danh học viên lớp của HLV khác (Khoa)
 */
import { api, ictDate, IDS, login, memberWithPlan, PHONES } from "../agent-lib.mjs";

console.log("=== REPRO F-23: Cross-coach authorization breach ===");

const mgr = await login(PHONES.manager);
const khoa = await login(PHONES.coach); // HLV cầu lông
const ducAnh = await login(PHONES.coachBasket); // HLV bóng rổ

// 1. Tạo 1 lớp cầu lông do Khoa phụ trách
// Chọn slot Chủ Nhật tuần sau lúc 14:00 để tránh 100% xung đột với seed data
const startOn = ictDate(7);
const endOn = ictDate(21);
const crCl = await api("/classes", {
  method: "POST",
  token: mgr.token,
  body: {
    sport: "badminton",
    level: "repro-f23",
    capacity: 5,
    coach_id: khoa.user.id,
    court_id: IDS.courtCL02, // dùng sân CL02
    rrule: "FREQ=WEEKLY;BYDAY=SU;BYHOUR=14",
    start_on: startOn,
    end_on: endOn,
    duration_min: 60,
  },
});

if (crCl.status !== 201 || !crCl.data?.id) {
  console.error("LỖI DỰNG DỮ LIỆU: Tạo lớp thất bại:", crCl.status, JSON.stringify(crCl.data));
  process.exit(1);
}
const classId = crCl.data.id;

const pubRes = await api(`/classes/${classId}/publish`, { method: "POST", token: mgr.token });
if (pubRes.status !== 200) {
  console.error("LỖI DỰNG DỮ LIỆU: Publish lớp thất bại:", pubRes.status, JSON.stringify(pubRes.data));
  process.exit(1);
}

// 2. Tạo học viên có gói cầu lông và ghi danh vào lớp
const student = await memberWithPlan(mgr.token, IDS.planBadminton30);
const enrRes = await api(`/classes/${classId}/enroll`, { method: "POST", token: student.token });
if (enrRes.status !== 201 || !enrRes.data?.enrollment?.id) {
  console.error("LỖI DỰNG DỮ LIỆU: Ghi danh thất bại:", enrRes.status, JSON.stringify(enrRes.data));
  process.exit(1);
}
const enrId = enrRes.data.enrollment.id;

// 3. THỰC NGHIỆM F-23: Đức Anh (HLV bóng rổ) gọi DELETE /enrollments/:id đối với học viên lớp cầu lông
const delRes = await api(`/enrollments/${enrId}`, { method: "DELETE", token: ducAnh.token });
console.log(`[F-23 Gốc] DELETE /enrollments/${enrId} by coach_other (Duc Anh): status=${delRes.status}, expected=403`);

// Kỳ vọng nghiệp vụ: Đức Anh không phải HLV lớp này -> 403 Forbidden
// Thực tế ứng dụng: Handler chỉ kiểm tra (user.role === 'member' && enr.user_id !== user.id). Vì role='coach' nên cho qua -> 200 OK
const isHit = delRes.status === 200;

console.log(JSON.stringify({
  reproduced: isHit,
  delStatus: delRes.status,
  expected: 403,
  finding: "F-23",
}));

if (!isHit) {
  console.error("Không tái hiện được F-23! delStatus =", delRes.status);
}
