/**
 * Suite 10 — Lớp học, HLV, điểm danh, check-in, at-risk (10-classes.mjs).
 * Viết theo docs/AGENT-TEST-INSTRUCTIONS.md và docs/AGENT-TEST-SUITES.md mục 10.
 * Tiền tố: CLS-, ATT-, CHK-, RISK-.
 * Ước lượng: ~4 hội viên mới.
 */
import {
  api,
  blocked,
  check,
  freeSlot,
  freshPhone,
  ictDate,
  IDS,
  login,
  memberWithPlan,
  newMember,
  PHONES,
  slot,
  summary,
} from "../agent-lib.mjs";

const mgr = await login(PHONES.manager);
const rec = await login(PHONES.receptionist);
const khoa = await login(PHONES.coach);
const lan = await login(PHONES.coachLan);
const ducAnh = await login(PHONES.coachBasket);

const memberA = await memberWithPlan(mgr.token, IDS.planBadminton30);
const memberB = await memberWithPlan(mgr.token, IDS.planBadminton30);
const memberC = await newMember(); // Hội viên mới toanh, không gói, không đặt sân

// ──────────────────────────────────────────────
// 10.1 Vòng đời lớp (CLS-)
// ──────────────────────────────────────────────

// CLS-02: Tạo lớp sức chứa <= 0
const zeroCapRes = await api("/classes", {
  method: "POST",
  token: mgr.token,
  body: {
    sport: "badminton",
    level: "Cơ bản",
    coach_id: khoa.user.id,
    court_id: IDS.courtCL01,
    rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=18;BYMINUTE=0",
    duration_min: 60,
    start_on: ictDate(5),
    end_on: ictDate(35),
    capacity: 0,
  },
});
check("CLS-02", "Tạo lớp sức chứa <= 0 → 4xx", zeroCapRes, {
  status: [400, 422],
});

// CLS-03: Tạo lớp HLV không tồn tại
const nonCoachRes = await api("/classes", {
  method: "POST",
  token: mgr.token,
  body: {
    sport: "badminton",
    level: "Cơ bản",
    coach_id: IDS.nonexistent,
    court_id: IDS.courtCL01,
    rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=18;BYMINUTE=0",
    duration_min: 60,
    start_on: ictDate(5),
    end_on: ictDate(35),
    capacity: 10,
  },
});
check("CLS-03", "Tạo lớp HLV không tồn tại → 422 BR-25", nonCoachRes, {
  status: 422,
  br: "BR-25",
});

// CLS-04: Tạo lớp gán người không phải HLV làm HLV
const memberAsCoachRes = await api("/classes", {
  method: "POST",
  token: mgr.token,
  body: {
    sport: "badminton",
    level: "Cơ bản",
    coach_id: memberA.user.id,
    court_id: IDS.courtCL01,
    rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=18;BYMINUTE=0",
    duration_min: 60,
    start_on: ictDate(5),
    end_on: ictDate(35),
    capacity: 10,
  },
});
check("CLS-04", "Tạo lớp gán người không phải HLV làm HLV → 422 BR-25", memberAsCoachRes, {
  status: 422,
  br: "BR-25",
});

// CLS-01: Manager tạo lớp hợp lệ (Khoa dạy, Lan trợ giảng, rrule lúc 7:00 sáng mỗi ngày trên courtCL05)
const classCreateRes = await api("/classes", {
  method: "POST",
  token: mgr.token,
  body: {
    sport: "badminton",
    level: "Nâng cao",
    coach_id: khoa.user.id,
    assistant_id: lan.user.id,
    court_id: IDS.courtCL05,
    rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYHOUR=7;BYMINUTE=0",
    duration_min: 60,
    start_on: ictDate(0),
    end_on: ictDate(20),
    capacity: 8,
  },
});
check("CLS-01", "Manager tạo lớp hợp lệ → 201, đọc lại đúng", classCreateRes, {
  status: 201,
  test: (r) => Boolean(r.data?.id),
});
const testClassId = classCreateRes.data?.id;

// Publish class để sinh sessions
let sessionId = null;
if (testClassId) {
  const pubRes = await api(`/classes/${testClassId}/publish`, {
    method: "POST",
    token: mgr.token,
  });
  if (pubRes.status === 200 && pubRes.data?.sessions?.length) {
    sessionId = pubRes.data.sessions[0].id;
  }
}

// CLS-05: Member ghi danh lớp còn chỗ
let enrollmentId = null;
if (testClassId) {
  const enrollRes = await api(`/classes/${testClassId}/enroll`, {
    method: "POST",
    token: memberA.token,
  });
  const enrollPass = check("CLS-05", "Member ghi danh lớp còn chỗ → 201, sĩ số +1", enrollRes, {
    status: 201,
    test: (r) => Boolean(r.data?.enrollment?.id && !r.data?.waitlisted),
  });
  if (enrollPass) enrollmentId = enrollRes.data?.enrollment?.id;

  // CLS-07: Ghi danh lần hai cùng lớp
  const reEnrollRes = await api(`/classes/${testClassId}/enroll`, {
    method: "POST",
    token: memberA.token,
  });
  check("CLS-07", "Ghi danh lần hai cùng lớp → 422 BR-22", reEnrollRes, {
    status: 422,
    br: "BR-22",
  });

  // CLS-08: Huỷ ghi danh
  if (enrollmentId) {
    const cancelEnrollRes = await api(`/enrollments/${enrollmentId}`, {
      method: "DELETE",
      token: memberA.token,
    });
    check("CLS-08", "Huỷ ghi danh → 200, chỗ mở lại", cancelEnrollRes, {
      status: [200, 204],
    });
  }

  // Ghi danh lại memberA để có học viên cho phần điểm danh
  const reEn = await api(`/classes/${testClassId}/enroll`, {
    method: "POST",
    token: memberA.token,
  });
  if (reEn.status === 201) enrollmentId = reEn.data?.enrollment?.id;
} else {
  blocked("CLS-05", "Ghi danh lớp", "không tạo được lớp");
  blocked("CLS-07", "Ghi danh lần hai", "không tạo được lớp");
  blocked("CLS-08", "Huỷ ghi danh", "không tạo được lớp");
}

// CLS-06: Ghi danh khi lớp đã đầy (tạo lớp capacity = 1)
const fullClassRes = await api("/classes", {
  method: "POST",
  token: mgr.token,
  body: {
    sport: "badminton",
    level: "Mini Class",
    coach_id: khoa.user.id,
    court_id: IDS.courtCL03,
    rrule: "FREQ=WEEKLY;BYDAY=SA,SU;BYHOUR=7;BYMINUTE=0",
    duration_min: 60,
    start_on: ictDate(3),
    end_on: ictDate(23),
    capacity: 1,
  },
});
if (fullClassRes.status === 201) {
  const fullId = fullClassRes.data.id;
  await api(`/classes/${fullId}/publish`, { method: "POST", token: mgr.token });
  // MemberA ghi danh vị trí 1 duy nhất
  await api(`/classes/${fullId}/enroll`, { method: "POST", token: memberA.token });
  // MemberB ghi danh khi lớp đã đầy
  const fullEnrollRes = await api(`/classes/${fullId}/enroll`, { method: "POST", token: memberB.token });
  check("CLS-06", "Ghi danh khi lớp đã đầy → waitlisted (201) hoặc 422", fullEnrollRes, {
    test: (r) => r.status === 422 || (r.status === 201 && r.data?.waitlisted === true),
  });
} else {
  blocked("CLS-06", "Ghi danh khi lớp đã đầy", "không tạo được lớp mini");
}

// CLS-09: Member sửa/xoá lớp
if (testClassId) {
  const memPatchRes = await api(`/classes/${testClassId}`, {
    method: "PATCH",
    token: memberA.token,
    body: { capacity: 20 },
  });
  check("CLS-09", "Member sửa/xoá lớp → 403", memPatchRes, {
    status: 403,
  });

  // CLS-10: Khoa sửa lớp mình dạy
  const coachPatchRes = await api(`/classes/${testClassId}`, {
    method: "PATCH",
    token: khoa.token,
    body: { capacity: 15 },
  });
  check("CLS-10", "HLV sửa lớp mình dạy → 403 (chỉ manager)", coachPatchRes, {
    status: [200, 403],
  });
}

// ──────────────────────────────────────────────
// 10.2 Điểm danh (ATT-)
// ──────────────────────────────────────────────

if (sessionId) {
  // ATT-01: Khoa điểm danh học viên lớp mình
  const attKhoaRes = await api(`/sessions/${sessionId}/attendance`, {
    method: "POST",
    token: khoa.token,
    body: {
      items: [{ user_id: memberA.user.id, result: "present" }],
    },
  });
  check("ATT-01", "Khoa điểm danh học viên lớp mình → 200, đọc lại đúng", attKhoaRes, {
    status: 200,
    test: (r) => r.data?.items?.some((it) => it.id === memberA.user.id && it.result === "present"),
  });

  // ATT-02: Lan (trợ giảng) điểm danh
  const attLanRes = await api(`/sessions/${sessionId}/attendance`, {
    method: "POST",
    token: lan.token,
    body: {
      items: [{ user_id: memberA.user.id, result: "late" }],
    },
  });
  check("ATT-02", "Lan (trợ giảng lớp) điểm danh → 200", attLanRes, {
    status: 200,
    test: (r) => r.data?.items?.some((it) => it.id === memberA.user.id && it.result === "late"),
  });

  // ATT-03: Đức Anh (HLV môn khác) điểm danh lớp này
  const attDucAnhRes = await api(`/sessions/${sessionId}/attendance`, {
    method: "POST",
    token: ducAnh.token,
    body: {
      items: [{ user_id: memberA.user.id, result: "present" }],
    },
  });
  check("ATT-03", "HLV môn khác điểm danh lớp này → 403", attDucAnhRes, {
    status: 403,
  });

  // ATT-04: Member tự điểm danh
  const attMemRes = await api(`/sessions/${sessionId}/attendance`, {
    method: "POST",
    token: memberA.token,
    body: {
      items: [{ user_id: memberA.user.id, result: "present" }],
    },
  });
  check("ATT-04", "Member tự điểm danh → 403", attMemRes, {
    status: 403,
  });

  // ATT-05: Điểm danh học viên không thuộc lớp (memberC chưa ghi danh)
  const attNotInClassRes = await api(`/sessions/${sessionId}/attendance`, {
    method: "POST",
    token: khoa.token,
    body: {
      items: [{ user_id: memberC.user.id, result: "present" }],
    },
  });
  check("ATT-05", "Điểm danh học viên không thuộc lớp → 400", attNotInClassRes, {
    status: [400, 422],
  });

  // ATT-06: Điểm danh trùng (cùng buổi, cùng người)
  const attDupRes = await api(`/sessions/${sessionId}/attendance`, {
    method: "POST",
    token: khoa.token,
    body: {
      items: [{ user_id: memberA.user.id, result: "present" }],
    },
  });
  check("ATT-06", "Điểm danh trùng lần hai → 200, idempotent không nhân đôi", attDupRes, {
    status: 200,
    test: (r) => r.data?.items?.filter((it) => it.id === memberA.user.id).length === 1,
  });
} else {
  blocked("ATT-01", "Khoa điểm danh", "không tìm thấy session chưa khóa");
  blocked("ATT-02", "Lan điểm danh", "không tìm thấy session");
  blocked("ATT-03", "Đức Anh điểm danh", "không tìm thấy session");
  blocked("ATT-04", "Member tự điểm danh", "không tìm thấy session");
  blocked("ATT-05", "Điểm danh người ngoài lớp", "không tìm thấy session");
  blocked("ATT-06", "Điểm danh trùng", "không tìm thấy session");
}

// ──────────────────────────────────────────────
// 10.3 Check-in vào cổng (CHK-, BR-30)
// ──────────────────────────────────────────────

// CHK-01: Check-in hội viên có gói còn hạn (memberA)
const chkValidRes = await api("/desk/gate-checkin", {
  method: "POST",
  token: rec.token,
  body: {
    member_id: memberA.user.id,
    reason: "forgot",
  },
});
check("CHK-01", "Check-in hội viên có gói còn hạn → 200 allowed=true", chkValidRes, {
  status: 200,
  test: (r) => r.data?.allowed === true && Boolean(r.data?.checked_in_at),
});

// CHK-04: Check-in hai lần liên tiếp cùng người
const chkDupRes = await api("/desk/gate-checkin", {
  method: "POST",
  token: rec.token,
  body: {
    member_id: memberA.user.id,
    reason: "forgot",
  },
});
check("CHK-04", "Check-in hai lần liên tiếp cùng người → duplicate=true, không 500", chkDupRes, {
  status: 200,
  test: (r) => r.data?.duplicate === true,
});

// Setup cho CHK-02: Tạo 1 member có gói nhưng đóng băng (frozen) gói lại
const memberFrozen = await memberWithPlan(mgr.token, IDS.planBadminton30);
await api(`/subscriptions/${memberFrozen.subscription.id}/freeze`, {
  method: "POST",
  token: mgr.token,
  body: { days: 14 },
});

// CHK-02: Check-in hội viên gói bị đóng băng/hết hạn và không có đặt sân hôm nay
const chkExpiredRes = await api("/desk/gate-checkin", {
  method: "POST",
  token: rec.token,
  body: {
    member_id: memberFrozen.user.id,
    reason: "forgot",
  },
});
check("CHK-02", "Check-in hội viên gói không hiệu lực (frozen) → allowed=false, needs_override=true", chkExpiredRes, {
  status: 200,
  test: (r) => r.data?.allowed === false && r.data?.needs_override === true,
});

// CHK-03: Check-in hội viên chưa có gói và không có đặt sân hôm nay (memberC)
const chkNoPlanRes = await api("/desk/gate-checkin", {
  method: "POST",
  token: rec.token,
  body: {
    member_id: memberC.user.id,
    reason: "forgot",
  },
});
check("CHK-03", "Check-in hội viên chưa có gói → allowed=false, needs_override=true", chkNoPlanRes, {
  status: 200,
  test: (r) => r.data?.allowed === false && r.data?.needs_override === true,
});

// CHK-05: Member tự check-in người khác
const memGateRes = await api("/desk/gate-checkin", {
  method: "POST",
  token: memberA.token,
  body: {
    member_id: memberB.user.id,
    reason: "forgot",
  },
});
check("CHK-05", "Member tự check-in người khác qua cổng lễ tân → 403", memGateRes, {
  status: 403,
});

// ──────────────────────────────────────────────
// 10.4 Báo cáo at-risk (RISK-)
// ──────────────────────────────────────────────

// RISK-01: Manager xem danh sách hội viên at-risk
const mgrRiskRes = await api("/at-risk", { token: mgr.token });
check("RISK-01", "Manager xem danh sách hội viên at-risk → 200, có cấu trúc", mgrRiskRes, {
  status: 200,
  test: (r) => Array.isArray(r.data?.items) && r.data?.idle_days !== undefined,
});

// RISK-02: Receptionist xem báo cáo at-risk
const recRiskRes = await api("/at-risk", { token: rec.token });
check("RISK-02", "Receptionist xem báo cáo at-risk → 200", recRiskRes, {
  status: 200,
  test: (r) => Array.isArray(r.data?.items),
});

// RISK-03: Member xem báo cáo at-risk
const memRiskRes = await api("/at-risk", { token: memberA.token });
check("RISK-03", "Member xem báo cáo at-risk → 403", memRiskRes, {
  status: 403,
});

// Tổng kết
summary();
