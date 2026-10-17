/**
 * 14a-deep-input.mjs — Kiểm thử biên cho mọi trường đầu vào trên các route ghi
 * Theo đặc tả docs/AGENT-TEST-ROUND2.md Bước 5 (14a) và yêu cầu Vòng 3.
 * Quét toàn diện các route POST/PATCH/PUT trích xuất từ router.ts.
 * Mọi lỗi 500 được ghi lại kèm route, handler, payload và nguyên nhân lỗi.
 */
import {
  api,
  check,
  IDS,
  login,
  newMember,
  PHONES,
  slot,
  summary,
} from "../agent-lib.mjs";
import { writeFileSync } from "node:fs";

console.log("=== 14a — KIỂM THỬ BIÊN MỌI TRƯỜNG ĐẦU VÀO (FUZZ INPUTS) ===");

const mgr = await login(PHONES.manager);
const rec = await login(PHONES.receptionist);
const coach = await login(PHONES.coach);
const member = await newMember();

// Mở ca cho lễ tân
await api("/shifts/open", { method: "POST", token: rec.token, body: { initial_cash_vnd: 100000 } });

const longString = "A".repeat(10000);
const nulString = "Arena\x00Test";
const unicodeString = "🏸 Sân Trung Tâm Arena 3 🔥 Số 1!";

const serverErrors500 = [];

// Helper sinh giá trị dị thường theo loại
function getMutationValue(type) {
  switch (type) {
    case "empty_str": return "";
    case "null": return null;
    case "num": return 12345;
    case "str": return "invalid_string";
    case "arr": return [1, 2, 3];
    case "obj": return { nested: "object" };
    case "long_str": return longString;
    case "nul_byte": return nulString;
    case "unicode": return unicodeString;
    case "special_char": return "!@#$%^&*()";
    case "neg_num": return -1;
    case "zero": return 0;
    case "float": return 12.34;
    case "huge_num": return 1e15;
    case "nan_str": return "NaN";
    case "invalid_date": return "not-a-date";
    case "feb_31": return "2026-02-31T10:00:00Z";
    case "past_date": return "2020-01-01T00:00:00Z";
    case "future_far": return "2099-12-31T23:59:59Z";
    case "midnight": return "2026-10-20T00:00:00+07:00";
    case "invalid_uuid": return "not-a-uuid-format";
    case "nonexistent_uuid": return IDS.nonexistent;
    case "invalid_enum": return "UNKNOWN_ENUM_VALUE";
    case "invalid_time": return "25:99";
    default: return null;
  }
}

// Danh sách các route ghi đại diện cho các handler chính trong router.ts
const fuzzTargets = [
  // 1. Auth & Me
  {
    route: "POST /auth/login",
    method: "POST",
    path: "/auth/login",
    token: undefined,
    handler: "authH.login (src/lib/arena3/handlers/auth.ts)",
    base: { login: "0900000001", password: "ChangeMe!a3" },
    fields: {
      login: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "unicode"],
      password: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
    },
  },
  {
    route: "POST /auth/register",
    method: "POST",
    path: "/auth/register",
    token: undefined,
    handler: "authH.register (src/lib/arena3/handlers/auth.ts)",
    base: { full_name: "Fuzz Test", phone: "0981999888", password: "Password123!", pii_consent: true },
    fields: {
      full_name: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "unicode"],
      phone: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "special_char"],
      password: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
      pii_consent: ["null", "str", "num", "arr", "obj"],
    },
  },
  {
    route: "POST /auth/otp/verify",
    method: "POST",
    path: "/auth/otp/verify",
    token: undefined,
    handler: "authH.verifyOtp (src/lib/arena3/handlers/auth.ts)",
    base: { phone: "0981999888", otp: "123456" },
    fields: {
      phone: ["empty_str", "null", "num", "arr", "obj", "nul_byte"],
      otp: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
    },
  },
  {
    route: "PATCH /me",
    method: "PATCH",
    path: "/me",
    token: member.token,
    handler: "authH.mePatch (src/lib/arena3/handlers/auth.ts)",
    base: { full_name: "Member New Name" },
    fields: {
      full_name: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "unicode"],
    },
  },
  {
    route: "POST /me/password",
    method: "POST",
    path: "/me/password",
    token: member.token,
    handler: "authH.mePassword (src/lib/arena3/handlers/auth.ts)",
    base: { current_password: "Password123!", new_password: "NewPassword123!" },
    fields: {
      current_password: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
      new_password: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
    },
  },

  // 2. Staff & Members
  {
    route: "POST /staff",
    method: "POST",
    path: "/staff",
    token: mgr.token,
    handler: "staffH.staffCreate (src/lib/arena3/handlers/staff.ts)",
    base: { full_name: "Staff Test", phone: "0988111222", role: "coach", password: "Password123!" },
    fields: {
      full_name: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
      phone: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
      role: ["empty_str", "null", "num", "arr", "obj", "invalid_enum"],
      password: ["empty_str", "null", "num", "arr", "obj", "long_str"],
    },
  },
  {
    route: "POST /members",
    method: "POST",
    path: "/members",
    token: rec.token,
    handler: "memberH.membersCreate (src/lib/arena3/handlers/members.ts)",
    base: { full_name: "Desk Member", phone: "0977666555" },
    fields: {
      full_name: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "unicode"],
      phone: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
    },
  },
  {
    route: "PATCH /members/:id",
    method: "PATCH",
    path: `/members/${member.user.id}`,
    token: rec.token,
    handler: "memberH.membersUpdate (src/lib/arena3/handlers/members.ts)",
    base: { full_name: "Desk Member Updated" },
    fields: {
      full_name: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
      status: ["empty_str", "null", "num", "arr", "obj", "invalid_enum"],
    },
  },

  // 3. Courts & Settings
  {
    route: "PATCH /courts/:id",
    method: "PATCH",
    path: `/courts/${IDS.courtCL01}`,
    token: mgr.token,
    handler: "bookH.courtsPatch (src/lib/arena3/handlers/bookings.ts)",
    base: { name: "Sân CL 01 VIP", status: "ready", hourly_rate_vnd: 80000 },
    fields: {
      name: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "unicode"],
      status: ["empty_str", "null", "num", "arr", "obj", "invalid_enum", "nul_byte"],
      hourly_rate_vnd: ["null", "str", "arr", "obj", "neg_num", "zero", "float", "huge_num", "nan_str"],
    },
  },
  {
    route: "PATCH /settings",
    method: "PATCH",
    path: "/settings",
    token: mgr.token,
    handler: "deskH.settingsPatch (src/lib/arena3/handlers/desk.ts)",
    base: { open_time: "06:00", close_time: "22:00", hold_minutes: 5 },
    fields: {
      open_time: ["empty_str", "null", "num", "arr", "obj", "invalid_time", "nul_byte"],
      close_time: ["empty_str", "null", "num", "arr", "obj", "invalid_time", "nul_byte"],
      hold_minutes: ["null", "str", "arr", "obj", "neg_num", "zero", "huge_num", "nan_str"],
    },
  },

  // 4. Plans & Subscriptions
  {
    route: "POST /plans",
    method: "POST",
    path: "/plans",
    token: mgr.token,
    handler: "planH.plansCreate (src/lib/arena3/handlers/plans.ts)",
    base: { name: "Gói Fuzz Test", sport_scope: "badminton", duration_days: 30, price_vnd: 500000, court_hours: 10 },
    fields: {
      name: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "unicode"],
      sport_scope: ["empty_str", "null", "num", "arr", "obj", "invalid_enum"],
      duration_days: ["null", "str", "arr", "obj", "neg_num", "zero", "float", "huge_num"],
      price_vnd: ["null", "str", "arr", "obj", "neg_num", "zero", "float", "huge_num"],
      court_hours: ["null", "str", "arr", "obj", "neg_num", "float", "huge_num"],
    },
  },
  {
    route: "POST /subscriptions",
    method: "POST",
    path: "/subscriptions",
    token: mgr.token,
    handler: "planH.subscriptionsCreate (src/lib/arena3/handlers/plans.ts)",
    base: { plan_id: IDS.planBadminton30, user_id: member.user.id },
    fields: {
      plan_id: ["empty_str", "null", "num", "arr", "obj", "invalid_uuid", "nonexistent_uuid", "nul_byte"],
      user_id: ["empty_str", "null", "num", "arr", "obj", "invalid_uuid", "nonexistent_uuid", "nul_byte"],
    },
  },
  {
    route: "POST /subscriptions/:id/freeze",
    method: "POST",
    path: `/subscriptions/${IDS.nonexistent}/freeze`,
    token: rec.token,
    handler: "opsH.subscriptionFreeze (src/lib/arena3/handlers/ops.ts)",
    base: { days: 7 },
    fields: {
      days: ["empty_str", "null", "str", "arr", "obj", "neg_num", "zero", "float", "huge_num"],
    },
  },

  // 5. Bookings & Desk
  {
    route: "POST /bookings",
    method: "POST",
    path: "/bookings",
    token: member.token,
    handler: "bookH.bookingsHold (src/lib/arena3/handlers/bookings.ts)",
    base: { court_id: IDS.courtCL02, start_at: slot(5, 14) },
    fields: {
      court_id: ["empty_str", "null", "num", "arr", "obj", "invalid_uuid", "nonexistent_uuid"],
      start_at: ["empty_str", "null", "num", "arr", "obj", "invalid_date", "feb_31", "past_date", "future_far", "midnight", "nul_byte"],
    },
  },
  {
    route: "POST /walk-in",
    method: "POST",
    path: "/walk-in",
    token: rec.token,
    handler: "deskH.walkInPost (src/lib/arena3/handlers/desk.ts)",
    base: { court_id: IDS.courtCL03, start_at: slot(5, 15), guest_name: "Walkin Fuzz", guest_phone: "0918222333", method: "cash" },
    fields: {
      court_id: ["empty_str", "null", "num", "arr", "obj", "invalid_uuid", "nonexistent_uuid"],
      start_at: ["empty_str", "null", "num", "arr", "obj", "invalid_date", "feb_31", "past_date", "future_far", "nul_byte"],
      guest_name: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "unicode"],
      guest_phone: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
      method: ["empty_str", "null", "num", "arr", "obj", "invalid_enum"],
    },
  },
  {
    route: "POST /payments",
    method: "POST",
    path: "/payments",
    token: mgr.token,
    handler: "deskH.paymentsCreate (src/lib/arena3/handlers/desk.ts)",
    base: { ref_type: "subscription", ref_id: IDS.nonexistent, method: "cash", amount_vnd: 500000 },
    fields: {
      ref_type: ["empty_str", "null", "num", "arr", "obj", "invalid_enum", "nul_byte"],
      ref_id: ["empty_str", "null", "num", "arr", "obj", "invalid_uuid", "nonexistent_uuid", "nul_byte"],
      method: ["empty_str", "null", "num", "arr", "obj", "invalid_enum"],
      amount_vnd: ["null", "str", "arr", "obj", "neg_num", "zero", "float", "huge_num"],
    },
  },
  {
    route: "POST /shifts/:id/close",
    method: "POST",
    path: `/shifts/00000000-0000-0000-0000-000000000001/close`,
    token: rec.token,
    handler: "deskH.shiftClose (src/lib/arena3/handlers/desk.ts)",
    base: { cash_declared_vnd: 100000 },
    fields: {
      cash_declared_vnd: ["null", "str", "arr", "obj", "neg_num", "float", "huge_num", "nan_str"],
    },
  },

  // 6. Classes & Sessions
  {
    route: "POST /classes",
    method: "POST",
    path: "/classes",
    token: mgr.token,
    handler: "classH.classesCreate (src/lib/arena3/handlers/classes.ts)",
    base: {
      sport: "badminton",
      level: "beginner",
      capacity: 10,
      coach_id: coach.user.id,
      court_id: IDS.courtCL01,
      rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9",
      start_on: "2026-11-01",
      end_on: "2026-11-30",
      duration_min: 60,
    },
    fields: {
      sport: ["empty_str", "null", "num", "arr", "obj", "invalid_enum"],
      capacity: ["null", "str", "arr", "obj", "neg_num", "zero", "float", "huge_num"],
      coach_id: ["empty_str", "null", "num", "arr", "obj", "invalid_uuid", "nonexistent_uuid"],
      court_id: ["empty_str", "null", "num", "arr", "obj", "invalid_uuid", "nonexistent_uuid"],
      assistant_id: ["invalid_uuid", "nonexistent_uuid"],
    },
  },
  {
    route: "POST /sessions/:id/attendance",
    method: "POST",
    path: `/sessions/${IDS.nonexistent}/attendance`,
    token: coach.token,
    handler: "opsH.sessionAttendancePost (src/lib/arena3/handlers/ops.ts)",
    base: { user_id: member.user.id, status: "attended" },
    fields: {
      user_id: ["empty_str", "null", "num", "arr", "obj", "invalid_uuid", "nonexistent_uuid"],
      status: ["empty_str", "null", "num", "arr", "obj", "invalid_enum"],
    },
  },

  // 7. Promotions
  {
    route: "POST /promotions",
    method: "POST",
    path: "/promotions",
    token: mgr.token,
    handler: "promoH.promosCreate (src/lib/arena3/handlers/promos.ts)",
    base: { code: "FUZZPROMO", kind: "percent", value: 10, start_at: slot(1, 8), end_at: slot(10, 22), name: "Fuzz Promo" },
    fields: {
      code: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "unicode"],
      kind: ["empty_str", "null", "num", "arr", "obj", "invalid_enum"],
      value: ["null", "str", "arr", "obj", "neg_num", "zero", "float", "huge_num"],
      start_at: ["empty_str", "null", "num", "arr", "obj", "invalid_date", "feb_31", "nul_byte"],
      end_at: ["empty_str", "null", "num", "arr", "obj", "invalid_date", "feb_31", "nul_byte"],
    },
  },
  {
    route: "POST /promotions/validate",
    method: "POST",
    path: "/promotions/validate",
    token: member.token,
    handler: "promoH.promosValidate (src/lib/arena3/handlers/promos.ts)",
    base: { code: "SUMMER50K", scope: "plan", plan_id: IDS.planBadminton30 },
    fields: {
      code: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
      scope: ["empty_str", "null", "num", "arr", "obj", "invalid_enum"],
      plan_id: ["empty_str", "null", "num", "arr", "obj", "invalid_uuid", "nonexistent_uuid"],
    },
  },

  // 8. Work Orders, Tickets, Contacts
  {
    route: "POST /work-orders",
    method: "POST",
    path: "/work-orders",
    token: mgr.token,
    handler: "xH.workOrdersCreate (src/lib/arena3/handlers/extras.ts)",
    base: { court_id: IDS.courtCL01, title: "Sửa lưới", description: "Lưới bị rách", priority: "normal" },
    fields: {
      court_id: ["empty_str", "null", "num", "arr", "obj", "invalid_uuid", "nonexistent_uuid"],
      title: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "unicode"],
      description: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "unicode"],
    },
  },
  {
    route: "POST /tickets",
    method: "POST",
    path: "/tickets",
    token: member.token,
    handler: "opsH.ticketsCreate (src/lib/arena3/handlers/ops.ts)",
    base: { title: "Hỗ trợ đặt sân", description: "Không huỷ được sân", priority: "normal" },
    fields: {
      title: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "unicode"],
      description: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte", "unicode"],
    },
  },
  {
    route: "POST /contacts",
    method: "POST",
    path: "/contacts",
    token: member.token,
    handler: "attH.contactCreate (src/lib/arena3/handlers/attendance.ts)",
    base: { full_name: "Liên hệ test", email: "contact@arena3.vn", message: "Yêu cầu tư vấn" },
    fields: {
      full_name: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
      email: ["empty_str", "null", "num", "arr", "obj", "nul_byte"],
      message: ["empty_str", "null", "num", "arr", "obj", "long_str", "nul_byte"],
    },
  },
  {
    route: "POST /series/preview",
    method: "POST",
    path: "/series/preview",
    token: rec.token,
    handler: "xH.seriesPreview (src/lib/arena3/handlers/extras.ts)",
    base: { court_id: IDS.courtCL01, first_date: "2026-11-01", start_local: "10:00", weeks: 4, phone: "0912345678" },
    fields: {
      court_id: ["empty_str", "null", "num", "arr", "obj", "invalid_uuid", "nonexistent_uuid"],
      first_date: ["empty_str", "null", "num", "arr", "obj", "invalid_date", "feb_31"],
      weeks: ["null", "str", "arr", "obj", "neg_num", "zero", "float", "huge_num"],
    },
  },
];

// Fuzzing vòng lặp
for (const target of fuzzTargets) {
  // Test body null (F-28)
  const bodyNullRes = await api(target.path, {
    method: target.method,
    token: target.token,
    rawBody: "null",
  });
  if (bodyNullRes.status === 500) {
    serverErrors500.push({
      route: target.route,
      handler: target.handler,
      field: "body",
      mutation: "body_null",
      status: 500,
      message: bodyNullRes.data?.message ?? String(bodyNullRes.data),
    });
  }
  check(
    `FZ-${target.route.replace(/[\s\/:]+/g, "_")}-body_null`,
    `${target.route} body=null must reject cleanly, never 500`,
    bodyNullRes,
    {
      notStatus: [500],
      why: bodyNullRes.status === 500 ? `500 Internal Error in ${target.handler}` : "rejected cleanly",
    }
  );

  // Test từng trường
  for (const [field, mutations] of Object.entries(target.fields)) {
    for (const mutType of mutations) {
      const mutVal = getMutationValue(mutType);
      const testBody = { ...target.base, [field]: mutVal };

      const res = await api(target.path, {
        method: target.method,
        token: target.token,
        body: testBody,
      });

      if (res.status === 500) {
        serverErrors500.push({
          route: target.route,
          handler: target.handler,
          field,
          mutation: mutType,
          status: 500,
          message: res.data?.message ?? String(res.data),
        });
      }

      const caseId = `FZ-${target.route.replace(/[\s\/:]+/g, "_")}-${field}-${mutType}`;
      check(
        caseId,
        `${target.route} [${field}=${mutType}] returns 4xx cleanly, never 500`,
        res,
        {
          notStatus: [500],
          why: res.status === 500 ? `500 Server Error in ${target.handler}: ${res.data?.message ?? ""}` : "clean rejection",
        }
      );
    }
  }
}

// Ghi báo cáo lỗi 500
console.log(`\nTổng số lỗi 500 ghi nhận từ 14a: ${serverErrors500.length}`);
writeFileSync("test-output/round3/14a-500-errors.json", JSON.stringify(serverErrors500, null, 2), "utf8");

summary();
