/**
 * Suite 06 — classes, enrolment, waitlist, sessions, attendance, training (F4).
 *
 * UNVALIDATED: written from the handler code and never run by its author. A FAIL
 * here may be a mistake in this script, not in the app. Triage every FAIL as
 * docs/AGENT-TEST-INSTRUCTIONS.md ("Phân loại FAIL") says before you report it.
 *
 *   node scripts/tests/agent/06-classes.mjs
 *
 * Needs a FRESH database (restart scripts/tests/start-safe-server.mjs first).
 * Creates ~13 members, ~12 classes and one plan.
 *
 * Case ids: CL- classes (create, publish, list, detail, edit, cancel),
 * EN- enrol / leave, WL- waitlist, SS- session cancel / reschedule,
 * CC- change coach, AT- attendance, TR- training (results, plans, homework,
 * students, goal, coach views).
 */
// fixed by agent: import newMember helper
import { api, blocked, check, ictDate, ictDateOf, ictHour, IDS, login, memberWithPlan, newMember, PHONES, summary } from "../agent-lib.mjs";

const mgr = await login(PHONES.manager);
const rec = await login(PHONES.receptionist);
const khoa = await login(PHONES.coach);
const lan = await login(PHONES.coachLan);
const ducAnh = await login(PHONES.coachBasket);
const bao = await login(PHONES.memberNoPlan);

const SEED_COACH = "00000000-0000-0000-0000-000000000003";
const SEED_CLASS = "30000000-0000-0000-0000-000000000001"; // Khoa, assistant Lan, has past "done" sessions
const COURT = {
  CL06: "10000000-0000-0000-0000-000000000006",
  CL07: "10000000-0000-0000-0000-000000000007",
  CL08: "10000000-0000-0000-0000-000000000008",
  CL09: "10000000-0000-0000-0000-000000000009",
  CL10: "10000000-0000-0000-0000-000000000012",
  CL11: "10000000-0000-0000-0000-000000000013",
  CL12: "10000000-0000-0000-0000-000000000014",
};
const ALL_DAYS = "MO,TU,WE,TH,FR,SA,SU";
const N = IDS.nonexistent;
const HOUR = 3600e3;

const t = (iso) => new Date(iso).getTime();
const ictHourOf = (ms) => (new Date(ms).getUTCHours() + 7) % 24;
const ictIso = (date, hour, minute = 0) =>
  new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`).toISOString();
const idOf = (r) => r.data?.id ?? r.data?.class?.id;
const itemsOf = (r) => (Array.isArray(r.data) ? r.data : r.data?.items ?? []);
const fieldIs = (f) => (r) => r.data?.field === f;
const rrule = (hour, days = ALL_DAYS) => `FREQ=WEEKLY;BYDAY=${days};BYHOUR=${hour}`;
const enrollmentOf = (r) => r.data?.enrollment;
const fake = (data) => ({ status: 200, data, ms: 0, request: "computed by the script" });

const classBody = (extra = {}) => ({
  sport: "badminton",
  level: "agent-test",
  coach_id: khoa.user.id,
  court_id: COURT.CL11,
  rrule: rrule(9),
  start_on: ictDate(2),
  end_on: ictDate(40),
  capacity: 12,
  duration_min: 60,
  ...extra,
});

const createClass = (tok, body) => api("/classes", { method: "POST", token: tok, body });
const publish = (tok, id) => api(`/classes/${id}/publish`, { method: "POST", token: tok });
const enroll = (tok, id, body = {}) => api(`/classes/${id}/enroll`, { method: "POST", token: tok, body });
const leave = (tok, enrollmentId) => api(`/enrollments/${enrollmentId}`, { method: "DELETE", token: tok });
const patchClass = (tok, id, body) => api(`/classes/${id}`, { method: "PATCH", token: tok, body });
const detail = (tok, id) => api(`/classes/${id}`, { token: tok });
const cancelSession = (tok, id, body) => api(`/sessions/${id}/cancel`, { method: "POST", token: tok, body });
const reschedule = (tok, id, body) => api(`/sessions/${id}/reschedule`, { method: "POST", token: tok, body });
const setCoach = (tok, id, body) => api(`/classes/${id}/coach`, { method: "POST", token: tok, body });
const attGet = (tok, id) => api(`/sessions/${id}/attendance`, { token: tok });
const attPost = (tok, id, body) => api(`/sessions/${id}/attendance`, { method: "POST", token: tok, body });
const putResults = (tok, id, body) => api(`/sessions/${id}/results`, { method: "PUT", token: tok, body });
const createTPlan = (tok, body) => api("/training-plans", { method: "POST", token: tok, body });
const patchTPlan = (tok, id, body) => api(`/training-plans/${id}`, { method: "PATCH", token: tok, body });
const fromTemplate = (tok, body) => api("/training-plans/from-template", { method: "POST", token: tok, body });
const postHomework = (tok, body) => api("/homework", { method: "POST", token: tok, body });
const cancelClass = (id, reason) => patchClass(mgr.token, id, { status: "cancelled", reason });
const accept = (tok, offerId) => api(`/waitlist/${offerId}/accept`, { method: "POST", token: tok });

/** Create + publish a class, trying each hour until it gets `min` sessions; cancel the misses. */
async function openClass(label, spec, hours, min = 1) {
  for (const hour of hours) {
    const c = await createClass(mgr.token, classBody({ ...spec, rrule: rrule(hour) }));
    const id = idOf(c);
    if (c.status !== 201 || !id) {
      console.log(`setup ${label} @${hour}h: create → ${c.status} ${JSON.stringify(c.data)}`);
      continue;
    }
    const p = await publish(mgr.token, id);
    const sessions = p.data?.sessions ?? [];
    if (p.status === 200 && sessions.length >= min) {
      console.log(`setup ${label}: class ${id} at ${hour}h, ${sessions.length} sessions`);
      return { id, hour, sessions: [...sessions].sort((a, b) => t(a.start_at) - t(b.start_at)), skipped: p.data.skipped ?? [] };
    }
    console.log(`setup ${label} @${hour}h: publish → ${p.status}, ${sessions.length} sessions; trying the next hour`);
    await cancelClass(id, "agent setup: hour busy");
  }
  return null;
}

/** A class whose first session starts in less than 12 hours (for BR-24 and BR-27). */
async function soonClass(maxHours = 4) {
  const coaches = [lan.user.id, SEED_COACH, khoa.user.id];
  const courts = [
    COURT.CL08,
    COURT.CL07,
    COURT.CL06,
    COURT.CL12,
    COURT.CL10,
    "10000000-0000-0000-0000-000000000001",
    "10000000-0000-0000-0000-000000000002",
    "10000000-0000-0000-0000-000000000003",
    "10000000-0000-0000-0000-000000000004",
    "10000000-0000-0000-0000-000000000005",
  ];
  let fallback = null;
  for (let delta = 1; delta <= 24; delta++) {
    const rawH = ictHour() + delta;
    const hour = rawH % 24;
    const startDay = Math.floor(rawH / 24);
    if (hour < 6 || hour > 21) continue;
    for (const coach_id of coaches) {
      for (const court_id of courts) {
        const c = await createClass(
          mgr.token,
          classBody({ coach_id, court_id, rrule: rrule(hour), start_on: ictDate(startDay), end_on: ictDate(startDay + 2) }),
        );
        const id = idOf(c);
        if (c.status !== 201 || !id) continue;
        const p = await publish(mgr.token, id);
        const soon = (p.data?.sessions ?? []).find((s) => t(s.start_at) > Date.now() && t(s.start_at) - Date.now() < maxHours * HOUR);
        if (soon) {
          console.log(`setup L: class ${id} at ${hour}h on court ${court_id}, near session ${soon.start_at} (< ${maxHours}h away)`);
          return { id, soon, court_id, sessions: p.data.sessions };
        }
        const anyFuture = (p.data?.sessions ?? []).find((s) => t(s.start_at) > Date.now());
        if (anyFuture && !fallback) {
          fallback = { id, soon: anyFuture, court_id, sessions: p.data.sessions };
        } else {
          await cancelClass(id, "agent setup: no near session");
        }
      }
    }
  }
  return fallback;
}

/** Find a notification by template; payload may come back as a JSON string. */
async function findNotification(tok, template, pred = () => true) {
  const r = await api("/me/notifications", { token: tok });
  for (const n of r.data?.items ?? []) {
    let p = n.payload;
    if (typeof p === "string") {
      try {
        p = JSON.parse(p);
      } catch {
        p = {};
      }
    }
    if (n.template === template && pred(p ?? {})) return { ...n, payload: p ?? {} };
  }
  return null;
}

// ───── 1. Create: roles and validation ─────
check("CL-01", "anonymous cannot create a class", await api("/classes", { method: "POST", body: classBody() }), { status: 401 });
for (const [id, who, tok] of [
  ["CL-02", "a coach", khoa.token],
  ["CL-03", "a receptionist", rec.token],
  ["CL-04", "a member", bao.token],
]) {
  check(id, `${who} cannot create a class`, await createClass(tok, classBody({ court_id: IDS.courtCL04 })), { status: 403 });
}

const invalidCreates = [
  ["CL-05", "duration 90 min is refused", { duration_min: 90 }, { status: 422 }],
  ["CL-06", "missing sport", { sport: undefined }, { status: 422 }],
  ["CL-07", "missing coach_id", { coach_id: undefined }, { status: 422 }],
  ["CL-08", "missing rrule", { rrule: undefined }, { status: 422 }],
  ["CL-09", "missing start_on", { start_on: undefined }, { status: 422 }],
  ["CL-10", "missing court_id", { court_id: undefined }, { status: 422 }],
  ["CL-11", "a receptionist as coach → BR-25", { coach_id: rec.user.id }, { status: 422, br: "BR-25" }],
  ["CL-12", "a basketball coach on a badminton class → BR-25", { coach_id: ducAnh.user.id }, { status: 422, br: "BR-25" }],
  ["CL-13", "an unknown coach id → BR-25", { coach_id: N }, { status: 422, br: "BR-25" }],
  ["CL-14", "coach_id that is not a uuid → 400", { coach_id: "abc" }, { status: 400 }],
  ["CL-15", "capacity 0", { capacity: 0 }, { status: 422 }],
  ["CL-16", "capacity -1", { capacity: -1 }, { status: 422 }],
  ["CL-17", "level of 25 characters", { level: "L".repeat(25) }, { status: 400 }],
  ["CL-18", "start_on that is not a date", { start_on: "not-a-date" }, { status: 400 }],
];
for (const [id, title, extra, exp] of invalidCreates) {
  check(id, title, await createClass(mgr.token, classBody({ court_id: IDS.courtCL04, ...extra })), exp);
}

// Candidates: an unknown court / assistant hits a foreign key the error mapper does not know (→ 500).
check("CL-19", "unknown court_id is refused cleanly (4xx, not 500)", await createClass(mgr.token, classBody({ court_id: N })), {
  status: [400, 404, 422],
});
check(
  "CL-20",
  "unknown assistant_id is refused cleanly (4xx, not 500)",
  await createClass(mgr.token, classBody({ court_id: IDS.courtCL04, assistant_id: N })),
  { status: [400, 404, 422] },
);

const advisoryCreates = [
  ["CL-21", "capacity 1000 should be refused (edit allows max 200)", { capacity: 1000 }],
  ["CL-22", "BYHOUR=25 should be refused", { rrule: rrule(25) }],
  ["CL-23", "start_on after end_on should be refused", { start_on: ictDate(30), end_on: ictDate(5) }],
  ["CL-24", "a badminton class on a basketball court should be refused", { court_id: IDS.courtBR01 }],
  ["CL-25", "a member as assistant should be refused", { assistant_id: bao.user.id }],
];
for (const [id, title, extra] of advisoryCreates) {
  const r = await createClass(mgr.token, classBody({ court_id: IDS.courtCL04, rrule: rrule(6), ...extra }));
  check(id, title, r, { status: [400, 409, 422], advisory: true });
  if (r.status === 201 && idOf(r)) await cancelClass(idOf(r), "agent cleanup");
}

const daily = await createClass(mgr.token, classBody({ court_id: IDS.courtCL04, rrule: "FREQ=DAILY" }));
check("CL-26", "rrule without BYDAY/BYHOUR does not crash the create", daily, { notStatus: 500 });
if (daily.status === 201 && idOf(daily)) {
  check("CL-27", "publishing a FREQ=DAILY class does not crash", await publish(mgr.token, idOf(daily)), { notStatus: 500 });
  await cancelClass(idOf(daily), "agent cleanup");
} else {
  blocked("CL-27", "publish a FREQ=DAILY class", "the create was refused (that is fine)");
}

// ───── 2. Setup: class A (Khoa, capacity 2) and the publish clash probes ─────
const A = await openClass("A", { capacity: 2 }, [13, 14, 15, 12, 16, 17, 7], 5);
if (!A) {
  blocked("SETUP-A", "class A (Khoa, CL-11, capacity 2)", "no hour gave 5 sessions — read the 'setup A' lines above");
  summary();
  process.exit(1);
}
const H = A.hour;
const aTimes = new Set(A.sessions.map((s) => t(s.start_at)));
const KHOA_BUSY = new Set([H, 8, 9, 10, 11, 18, 19, 20, 21]); // Khoa's seed classes + class A

check(
  "CL-28",
  "publish only makes sessions between start_on and now+14 days",
  fake(A.sessions),
  {
    test: () => A.sessions.every((s) => ictDateOf(s.start_at) >= ictDate(2) && t(s.start_at) <= Date.now() + 15 * 24 * HOUR),
    why: "a session falls outside [start_on, now+14d]",
  },
);
check("CL-29", "publishing again adds no duplicate sessions", await publish(mgr.token, A.id), {
  status: 200,
  test: (r) => (r.data?.sessions ?? []).length === 0,
  why: "re-publish created sessions again",
});
check("CL-30", "a coach cannot publish", await publish(khoa.token, A.id), { status: 403 });
check("CL-31", "publish an unknown class → 404", await publish(mgr.token, N), { status: 404 });
check("CL-32", "publish a non-uuid id → 400", await publish(mgr.token, "abc"), { status: 400 });

const courtProbe = await createClass(mgr.token, classBody({ coach_id: SEED_COACH, court_id: COURT.CL11, rrule: rrule(H) }));
if (idOf(courtProbe)) {
  check("CL-33", "publish skips dates whose court is taken (reason court)", await publish(mgr.token, idOf(courtProbe)), {
    status: 200,
    test: (r) =>
      (r.data?.skipped ?? []).some((s) => s.reason === "court") && !(r.data?.sessions ?? []).some((s) => aTimes.has(t(s.start_at))),
    why: "expected skipped[].reason = 'court' on class A's dates and no session on top of class A",
  });
  await cancelClass(idOf(courtProbe), "agent probe done");
  check("CL-34", "publishing a cancelled class → 409", await publish(mgr.token, idOf(courtProbe)), { status: 409 });
} else {
  blocked("CL-33", "court clash probe", `create → ${courtProbe.status} ${JSON.stringify(courtProbe.data)}`);
}

const coachProbe = await createClass(mgr.token, classBody({ court_id: COURT.CL09, rrule: rrule(H) }));
if (idOf(coachProbe)) {
  check("CL-35", "publish skips dates whose coach is busy (reason coach)", await publish(mgr.token, idOf(coachProbe)), {
    status: 200,
    test: (r) =>
      (r.data?.skipped ?? []).some((s) => s.reason === "coach") && !(r.data?.sessions ?? []).some((s) => aTimes.has(t(s.start_at))),
    why: "expected skipped[].reason = 'coach' on class A's dates (Khoa teaches A then)",
  });
  await cancelClass(idOf(coachProbe), "agent probe done");
} else {
  blocked("CL-35", "coach clash probe", `create → ${coachProbe.status} ${JSON.stringify(coachProbe.data)}`);
}

const D = await createClass(mgr.token, classBody({ court_id: IDS.courtCL05, rrule: rrule(6) }));
const dId = idOf(D);
check("CL-36", "manager creates a class → 201, status draft", D, {
  status: 201,
  test: (r) => (r.data?.status ?? r.data?.class?.status) === "draft",
  why: "a new class must start as draft",
});

// ───── 3. Setup: classes B (Lan, same hour as A), S (sessions), Q (capacity 1), L (session < 4 h away) ─────
const B = await openClass("B", { coach_id: lan.user.id, court_id: COURT.CL12 }, [H], 1);
const overlapAB = !!B && B.sessions.some((s) => aTimes.has(t(s.start_at)));
if (!overlapAB) console.log("note: classes A and B share no session time → EN-16 and CC-08 will be BLOCKED");
const S = await openClass(
  "S",
  { coach_id: SEED_COACH, court_id: COURT.CL10 },
  [14, 15, 16, 13, 12, 17, 7].filter((h) => !KHOA_BUSY.has(h)),
  8,
);
const Q = await openClass(
  "Q",
  { coach_id: SEED_COACH, court_id: COURT.CL09, capacity: 1 },
  [16, 17, 7, 12, 13, 14, 15].filter((h) => h !== H && h !== S?.hour),
  1,
);
const L = await soonClass();

// ───── 4. List, detail, roster ─────
check("CL-37", "anonymous list: 200, only open classes, includes A", await api("/classes"), {
  status: 200,
  test: (r) => itemsOf(r).every((c) => !c.status || c.status === "open") && itemsOf(r).some((c) => c.id === A.id),
  why: "list must include class A and nothing that is not open",
});
check("CL-38", "a member's list hides the draft class", await api("/classes", { token: bao.token }), {
  status: 200,
  test: (r) => !itemsOf(r).some((c) => c.id === dId),
  why: "draft class D is visible to a member",
});
check("CL-39", "the manager's list shows the draft class", await api("/classes", { token: mgr.token }), {
  status: 200,
  test: (r) => itemsOf(r).some((c) => c.id === dId),
  why: "draft class D missing from the manager's list (check paging before calling it a bug)",
});
check("CL-40", "?sport=basketball returns only basketball", await api("/classes?sport=basketball"), {
  status: 200,
  test: (r) => itemsOf(r).every((c) => c.sport === "basketball") && !itemsOf(r).some((c) => c.id === A.id),
});

for (const [id, who, tok, status] of [
  ["CL-41", "the manager", mgr.token, 200],
  ["CL-42", "a receptionist", rec.token, 200],
  ["CL-43", "the class coach (Khoa)", khoa.token, 200],
  ["CL-44", "another coach (Lan)", lan.token, 403],
  ["CL-45", "a member", bao.token, 403],
]) {
  check(id, `class detail as ${who} → ${status}`, await detail(tok, A.id), {
    status,
    test: status === 200 ? (r) => r.data?.class?.id === A.id && Array.isArray(r.data?.sessions) && Array.isArray(r.data?.roster) : undefined,
    why: "detail must return {class, sessions[], roster[]}",
  });
}
check("CL-46", "detail of an unknown class → 404", await detail(mgr.token, N), { status: 404 });
check("CL-47", "detail with a non-uuid id → 400", await detail(mgr.token, "abc"), { status: 400 });
check("CL-48", "the assistant (Lan) can open the seed class detail", await detail(lan.token, SEED_CLASS), { status: 200 });
check("CL-49", "roster as the class coach → 200", await api(`/classes/${A.id}/roster`, { token: khoa.token }), { status: 200 });
check("CL-50", "roster as a coach of another sport → 403", await api(`/classes/${A.id}/roster`, { token: ducAnh.token }), { status: 403 });
check("CL-51", "roster as a member → 403", await api(`/classes/${A.id}/roster`, { token: bao.token }), { status: 403 });

// ───── 5. Enrol ─────
const M1 = await memberWithPlan(mgr.token, IDS.planBadminton30);
const M2 = await memberWithPlan(mgr.token, IDS.planBadminton30);
const M3 = await memberWithPlan(mgr.token, IDS.planBadminton30);
const M4 = await memberWithPlan(mgr.token, IDS.planBadminton30);

const e1 = await enroll(M1.token, A.id);
check("EN-01", "a member with a badminton plan enrols → 201 confirmed", e1, {
  status: 201,
  test: (r) => enrollmentOf(r)?.status === "confirmed" && !r.data?.waitlisted,
});
check("EN-02", "enrolling twice → BR-22", await enroll(M1.token, A.id), { status: 422, br: "BR-22" });
const e2 = await enroll(rec.token, A.id, { user_id: M2.user.id });
check("EN-03", "a receptionist enrols a member by user_id → 201", e2, {
  status: 201,
  test: (r) => enrollmentOf(r)?.status === "confirmed",
});
const e3 = await enroll(M3.token, A.id);
check("EN-04", "class full (2/2) → waitlisted", e3, { status: 201, test: (r) => r.data?.waitlisted === true });
const e4 = await enroll(M4.token, A.id);
check("EN-05", "the second waitlisted member queues behind the first", e4, {
  status: 201,
  test: (r) =>
    r.data?.waitlisted === true &&
    (enrollmentOf(e3)?.waitlist_pos == null || enrollmentOf(r)?.waitlist_pos > enrollmentOf(e3).waitlist_pos),
});
check("EN-06", "a waitlisted member enrolling again gets the same row back", await enroll(M3.token, A.id), {
  status: 201,
  test: (r) => enrollmentOf(r)?.id === enrollmentOf(e3)?.id,
  why: "a second waitlist row was created",
});
check("EN-07", "detail roster shows 2 confirmed + 2 waitlisted", await detail(mgr.token, A.id), {
  status: 200,
  test: (r) => {
    const ro = r.data?.roster ?? [];
    return ro.filter((x) => x.status === "confirmed").length === 2 && ro.filter((x) => x.status === "waitlisted").length === 2;
  },
});
check("EN-08", "a coach cannot enrol", await enroll(khoa.token, A.id), { status: 403 });
check("EN-09", "a member cannot enrol someone else", await enroll(M1.token, A.id, { user_id: M2.user.id }), { status: 403 });
check("EN-10", "a member without a plan → BR-19", await enroll(bao.token, A.id), { status: 422, br: "BR-19" });
const basket = await memberWithPlan(mgr.token, IDS.planBasketball30);
check("EN-11", "a basketball plan cannot join a badminton class → BR-19", await enroll(basket.token, A.id), { status: 422, br: "BR-19" });
if (dId) check("EN-12", "enrolling in a draft class → BR-18", await enroll(M1.token, dId), { status: 422, br: "BR-18" });
else blocked("EN-12", "enrol in a draft class", "draft class D was not created (CL-36)");
check("EN-13", "enrolling in an unknown class → 404", await enroll(M1.token, N), { status: 404 });
check("EN-14", "enrolling with a non-uuid class id → 400", await enroll(M1.token, "abc"), { status: 400 });
check("EN-15", "anonymous cannot enrol", await api(`/classes/${A.id}/enroll`, { method: "POST", body: {} }), { status: 401 });
if (overlapAB) check("EN-16", "a class at the same time as one you are in → BR-22", await enroll(M2.token, B.id), { status: 422, br: "BR-22" });
else blocked("EN-16", "time overlap → BR-22", "classes A and B share no session time");

// BR-20: a per-session plan with 1 session left
const qPlan = await api("/plans", {
  method: "POST",
  token: mgr.token,
  body: {
    name: `Agent 1-session plan ${Date.now()}`,
    sport_scope: "badminton",
    price_vnd: 100000,
    duration_days: 30,
    court_hours: 2,
    court_discount_pct: 10,
    session_quota: 1,
  },
});
if (qPlan.status === 201 && qPlan.data?.id && B) {
  const MQ = await memberWithPlan(mgr.token, qPlan.data.id);
  const sessionsLeft = async () =>
    (await api("/me", { token: MQ.token })).data?.subscriptions?.find((s) => s.id === MQ.subscription.id)?.session_left;
  const eq = await enroll(MQ.token, B.id);
  check("EN-17", "a 1-session plan enrols → 201", eq, { status: 201, test: (r) => enrollmentOf(r)?.status === "confirmed" });
  const left0 = await sessionsLeft();
  check("EN-18", "enrolling uses one session (session_left 1 → 0)", fake({ session_left: left0 }), {
    test: () => left0 === 0,
    why: `session_left is ${left0}`,
  });
  check("EN-19", "no sessions left → BR-20", await enroll(MQ.token, A.id), { status: 422, br: "BR-20" });
  check("EN-20", "leaving refunds the session", await leave(MQ.token, enrollmentOf(eq)?.id), { status: 200 });
  const left1 = await sessionsLeft();
  check("EN-21", "session_left back to 1 after leaving", fake({ session_left: left1 }), {
    test: () => left1 === 1,
    why: `session_left is ${left1}`,
  });
} else {
  blocked("EN-17", "BR-20 per-session plan", `POST /plans → ${qPlan.status} ${JSON.stringify(qPlan.data)}; class B ${B ? "ok" : "missing"}`);
}

// ───── 6. Leave ─────
check("EN-22", "a member cannot cancel someone else's enrolment", await leave(M3.token, enrollmentOf(e1)?.id), { status: 403 });
check("EN-23", "cancel an unknown enrolment → 404", await leave(mgr.token, N), { status: 404 });
check("EN-24", "cancel with a non-uuid id → 400", await leave(mgr.token, "abc"), { status: 400 });
if (B) {
  const MX = await memberWithPlan(mgr.token, IDS.planBadminton30);
  const ex = await enroll(MX.token, B.id);
  check(
    "EN-25",
    "a coach who does not teach the class cannot cancel a member's enrolment (candidate F-23)",
    await leave(ducAnh.token, enrollmentOf(ex)?.id),
    { status: 403 },
  );
  const MR = await memberWithPlan(mgr.token, IDS.planBadminton30);
  const er = await enroll(MR.token, B.id);
  check("EN-26", "a receptionist cancels a member's enrolment → 200", await leave(rec.token, enrollmentOf(er)?.id), { status: 200 });
} else {
  blocked("EN-25", "coach cancels someone's enrolment", "class B missing");
}
if (L) {
  const ML = await memberWithPlan(mgr.token, IDS.planBadminton30);
  const el = await enroll(ML.token, L.id);
  check("EN-27", "enrol in the class that starts soon → 201", el, { status: 201 });
  let patchApplied = false;
  const hoursToSession = (t(L.soon.start_at) - Date.now()) / HOUR;
  if (hoursToSession >= 4) {
    await api("/settings", { method: "PATCH", token: mgr.token, body: { cancel_class_hours: Math.ceil(hoursToSession) + 2 } });
    patchApplied = true;
  }
  check("EN-28", "leaving less than 4 h before the next session → BR-24", await leave(ML.token, enrollmentOf(el)?.id), {
    status: 422,
    br: "BR-24",
  });
  if (patchApplied) {
    await api("/settings", { method: "PATCH", token: mgr.token, body: { cancel_class_hours: 4 } });
  }
} else {
  blocked("EN-27", "leave < 4 h before → BR-24", "no class with a session in the next 4 h could be set up");
}

// ───── 7. Waitlist ─────
check("WL-01", "a confirmed member leaves → 200", await leave(M1.token, enrollmentOf(e1)?.id), { status: 200 });
check("WL-02", "enrolled_count drops to 1", await detail(mgr.token, A.id), {
  status: 200,
  test: (r) => r.data?.class?.enrolled_count === 1,
  why: "class.enrolled_count should be 1",
});
check("WL-03", "cancelling a cancelled enrolment → 409", await leave(M1.token, enrollmentOf(e1)?.id), { status: 409 });
const offer3 = await findNotification(M3.token, "waitlist_offer", (p) => p.class_id === A.id);
check("WL-04", "the first in the queue gets a waitlist_offer notification", fake(offer3), {
  test: () => !!offer3?.payload?.offer_id,
  why: "no waitlist_offer for class A in M3's /me/notifications",
});
const offer4early = await findNotification(M4.token, "waitlist_offer", (p) => p.class_id === A.id);
check("WL-05", "the second in the queue gets no offer yet", fake(offer4early), { test: () => !offer4early, why: "M4 already has an offer" });
if (offer3?.payload?.offer_id) {
  const oid = offer3.payload.offer_id;
  check("WL-06", "someone else cannot accept the offer", await accept(M4.token, oid), { status: 403 });
  check("WL-07", "accept an unknown offer → 404", await accept(M3.token, N), { status: 404 });
  check("WL-08", "accept a non-uuid offer → 400", await accept(M3.token, "abc"), { status: 400 });
  check("WL-09", "the offered member accepts → 200", await accept(M3.token, oid), { status: 200 });
  check("WL-10", "after accepting, the member is confirmed", await detail(mgr.token, A.id), {
    status: 200,
    test: (r) => (r.data?.roster ?? []).some((x) => x.id === M3.user.id && x.status === "confirmed"),
  });
  check("WL-11", "accepting twice → 409", await accept(M3.token, oid), { status: 409 });
} else {
  blocked("WL-06", "waitlist accept cases", "M3 has no offer (WL-04)");
}
check("WL-12", "raise capacity to 3 → 200", await patchClass(mgr.token, A.id, { capacity: 3 }), { status: 200 });
const offer4 = await findNotification(M4.token, "waitlist_offer", (p) => p.class_id === A.id);
check("WL-13", "raising capacity invites the next in the queue", fake(offer4), { test: () => !!offer4?.payload?.offer_id });
if (offer4?.payload?.offer_id) check("WL-14", "the next member accepts → 200", await accept(M4.token, offer4.payload.offer_id), { status: 200 });
else blocked("WL-14", "second accept", "M4 has no offer (WL-13)");

if (Q) {
  const [Q1, Q2, Q3, Q4] = [
    await memberWithPlan(mgr.token, IDS.planBadminton30),
    await memberWithPlan(mgr.token, IDS.planBadminton30),
    await memberWithPlan(mgr.token, IDS.planBadminton30),
    await memberWithPlan(mgr.token, IDS.planBadminton30),
  ];
  const q1 = await enroll(Q1.token, Q.id);
  check("WL-15", "capacity-1 class: first member confirmed", q1, { status: 201, test: (r) => enrollmentOf(r)?.status === "confirmed" });
  await enroll(Q2.token, Q.id);
  const q4 = await enroll(Q4.token, Q.id);
  check("WL-16", "a waitlisted member can leave the queue → 200", await leave(Q4.token, enrollmentOf(q4)?.id), { status: 200 });
  check("WL-17", "the confirmed member leaves → 200", await leave(Q1.token, enrollmentOf(q1)?.id), { status: 200 });
  const offerQ2 = await findNotification(Q2.token, "waitlist_offer", (p) => p.class_id === Q.id);
  check("WL-18", "the waiting member gets the offer", fake(offerQ2), { test: () => !!offerQ2?.payload?.offer_id });
  check("WL-19", "while an offer is pending, a newcomer is waitlisted (no queue jumping)", await enroll(Q3.token, Q.id), {
    status: 201,
    test: (r) => r.data?.waitlisted === true,
    why: "the newcomer took the seat that was offered to the queue",
  });
  if (offerQ2?.payload?.offer_id) {
    check("WL-20", "the offered member can still take the seat", await accept(Q2.token, offerQ2.payload.offer_id), { status: 200 });
  }
} else {
  blocked("WL-15", "capacity-1 queue cases", "class Q could not be set up");
}

// ───── 8. Session cancel and reschedule (class S) ─────
if (S) {
  const s = S.sessions;
  check("SS-01", "a coach cannot cancel a session", await cancelSession(lan.token, s[0].id, { reason: "x" }), { status: 403 });
  check("SS-02", "a receptionist cannot cancel a session", await cancelSession(rec.token, s[0].id, { reason: "x" }), { status: 403 });
  check("SS-03", "cancel without a reason → 400 field reason", await cancelSession(mgr.token, s[0].id, {}), {
    status: 400,
    test: fieldIs("reason"),
  });
  check("SS-04", "cancel an unknown session → 404", await cancelSession(mgr.token, N, { reason: "x" }), { status: 404 });
  check("SS-05", "cancel a non-uuid session → 400", await cancelSession(mgr.token, "abc", { reason: "x" }), { status: 400 });
  check("SS-06", "cancel with a reason → 200", await cancelSession(mgr.token, s[0].id, { reason: "agent test: rain" }), {
    status: 200,
    test: (r) => r.data?.ok === true && typeof r.data?.notified === "number",
  });
  check("SS-07", "cancel the same session again → 409", await cancelSession(mgr.token, s[0].id, { reason: "again" }), { status: 409 });
  check("SS-08", "class detail shows the session as cancelled", await detail(mgr.token, S.id), {
    status: 200,
    test: (r) => (r.data?.sessions ?? []).find((x) => x.id === s[0].id)?.status === "cancelled",
  });
  const seed = await detail(mgr.token, SEED_CLASS);
  const doneSession = (seed.data?.sessions ?? []).find((x) => x.status === "done");
  if (doneSession) check("SS-09", "cancel a finished (done) session → 409", await cancelSession(mgr.token, doneSession.id, { reason: "x" }), { status: 409 });
  else blocked("SS-09", "cancel a done session", "the seed class has no done session");

  check("SS-10", "a coach cannot reschedule", await reschedule(lan.token, s[1].id, { start_at: s[1].start_at }), { status: 403 });
  check("SS-11", "reschedule without start_at → 400", await reschedule(mgr.token, s[1].id, {}), { status: 400, test: fieldIs("start_at") });
  check("SS-12", "reschedule to 'not-a-date' → 400", await reschedule(mgr.token, s[1].id, { start_at: "not-a-date" }), {
    status: 400,
    test: fieldIs("start_at"),
  });
  check("SS-13", "reschedule into the past → 400", await reschedule(mgr.token, s[1].id, { start_at: ictIso(ictDate(-1), 10) }), {
    status: 400,
    test: fieldIs("start_at"),
  });
  check("SS-14", "reschedule to the same time → 400", await reschedule(mgr.token, s[1].id, { start_at: s[1].start_at }), { status: 400 });
  check("SS-15", "reschedule a cancelled session → 409", await reschedule(mgr.token, s[0].id, { start_at: s[1].start_at }), {
    status: 409,
  });
  let moved = null;
  for (const off of [1, 2, 3, -1, -2, -3, 4, -4]) {
    const at = t(s[1].start_at) + off * HOUR;
    const h = ictHourOf(at);
    if (KHOA_BUSY.has(h) || h < 6 || h > 21) continue;
    const r = await reschedule(mgr.token, s[1].id, { start_at: new Date(at).toISOString() });
    if (r.status === 409 && r.data?.code === "CONFLICT_SLOT") continue;
    moved = r;
    break;
  }
  if (moved) check("SS-16", "a move more than 12 h ahead needs no reason → 200", moved, { status: 200 });
  else blocked("SS-16", "valid reschedule", "every nearby hour clashed (409 CONFLICT_SLOT)");
  check("SS-17", "moving onto another session of the same class → 409 CONFLICT_SLOT", await reschedule(mgr.token, s[2].id, { start_at: s[3].start_at }), {
    status: 409,
    code: "CONFLICT_SLOT",
  });
  check(
    "SS-18",
    "moving a session to 03:00 should be refused (outside opening hours)",
    await reschedule(mgr.token, s[4].id, { start_at: ictIso(ictDateOf(s[4].start_at), 3) }),
    { status: [400, 409, 422], advisory: true },
  );
  const offGrid = KHOA_BUSY.has(S.hour + 1) ? -17 : 17;
  check(
    "SS-19",
    "moving a session off the slot grid (:17) should be refused",
    await reschedule(mgr.token, s[5].id, { start_at: new Date(t(s[5].start_at) + offGrid * 60e3).toISOString() }),
    { status: [400, 409, 422], advisory: true },
  );
  check(
    "SS-20",
    "moving a session past the class end_on should be refused",
    await reschedule(mgr.token, s[6].id, { start_at: ictIso(ictDate(60), S.hour) }),
    { status: [400, 409, 422], advisory: true },
  );
} else {
  blocked("SS-01", "session cancel / reschedule cases", "class S could not be set up");
}
const L12 = L ?? await soonClass(12);
if (L12) {
  const startMs = t(L12.soon.start_at);
  const now = Date.now();
  const candidates = [startMs - HOUR, startMs + HOUR, startMs + 24 * HOUR];
  const validTarget = candidates.find((ms) => ms > now + 30 * 60e3 && ictHourOf(ms) >= 6 && ictHourOf(ms) <= 21);
  const newAt = new Date(validTarget ?? (startMs + 24 * HOUR)).toISOString();
  check("SS-21", "moving a session that starts in < 12 h without a reason → BR-27", await reschedule(mgr.token, L12.soon.id, { start_at: newAt }), {
    status: 422,
    br: "BR-27",
  });
  let resOk = await reschedule(mgr.token, L12.soon.id, { start_at: newAt, reason: "agent test: coach late" });
  if (resOk.status === 409 && resOk.data?.code === "CONFLICT_SLOT") {
    for (let offset = 1; offset <= 72; offset++) {
      const at = t(L12.soon.start_at) + offset * HOUR;
      const h = ictHourOf(at);
      if (h < 6 || h > 21) continue;
      const tryRes = await reschedule(mgr.token, L12.soon.id, { start_at: new Date(at).toISOString(), reason: "agent test: coach late" });
      if (tryRes.status === 200) {
        resOk = tryRes;
        break;
      }
    }
  }
  check(
    "SS-22",
    "the same move with a reason → 200",
    resOk,
    { status: 200 },
  );
} else {
  blocked("SS-21", "reschedule < 12 h → BR-27", "no class with a session in the next 12 h could be set up");
}

// ───── 9. Change coach ─────
if (S) {
  check("CC-01", "a coach cannot change the coach", await setCoach(lan.token, S.id, { coach_id: khoa.user.id }), { status: 403 });
  check("CC-02", "missing coach_id → 400", await setCoach(mgr.token, S.id, {}), { status: 400, test: fieldIs("coach_id") });
  check("CC-03", "the same coach → 400", await setCoach(mgr.token, S.id, { coach_id: SEED_COACH }), { status: 400, test: fieldIs("coach_id") });
  check("CC-04", "a coach of another sport → BR-25", await setCoach(mgr.token, S.id, { coach_id: ducAnh.user.id }), { status: 422, br: "BR-25" });
  check("CC-05", "a receptionist as coach → BR-25", await setCoach(mgr.token, S.id, { coach_id: rec.user.id }), { status: 422, br: "BR-25" });
  check("CC-06", "an unknown coach → BR-25", await setCoach(mgr.token, S.id, { coach_id: N }), { status: 422, br: "BR-25" });
} else {
  blocked("CC-01", "change coach validation", "class S could not be set up");
}
check("CC-07", "change coach of an unknown class → 404", await setCoach(mgr.token, N, { coach_id: lan.user.id }), { status: 404 });
if (overlapAB) {
  check("CC-08", "a coach who teaches elsewhere at that time → 409 CONFLICT_SLOT", await setCoach(mgr.token, A.id, { coach_id: lan.user.id }), {
    status: 409,
    code: "CONFLICT_SLOT",
  });
} else {
  blocked("CC-08", "coach clash", "classes A and B share no session time");
}
check("CC-09", "the class assistant cannot become its coach → 400", await setCoach(mgr.token, SEED_CLASS, { coach_id: lan.user.id }), {
  status: 400,
  test: fieldIs("coach_id"),
});
if (S) {
  check("CC-10", "a free coach takes over → 200, sessions moved", await setCoach(mgr.token, S.id, { coach_id: khoa.user.id }), {
    status: 200,
    test: (r) => r.data?.sessions_moved >= 1,
  });
}

// ───── 10. Attendance ─────
const s0 = A.sessions[0].id;
const s1 = A.sessions[1].id;
check("AT-01", "the class coach reads attendance → 200, not locked", await attGet(khoa.token, s0), {
  status: 200,
  test: (r) => r.data?.session?.locked === false && Array.isArray(r.data?.items),
});
for (const [id, who, tok] of [
  ["AT-02", "a receptionist", rec.token],
  ["AT-03", "a member", M2.token],
  ["AT-04", "a coach of another sport", ducAnh.token],
  ["AT-05", "a coach who does not teach the class", lan.token],
]) {
  check(id, `${who} cannot read attendance`, await attGet(tok, s0), { status: 403 });
}
check("AT-06", "attendance of an unknown session → 404", await attGet(khoa.token, N), { status: 404 });
check("AT-07", "attendance with a non-uuid id → 404", await attGet(khoa.token, "abc"), { status: 404 });
check("AT-08", "empty items → 400 field items", await attPost(khoa.token, s0, { items: [] }), { status: 400, test: fieldIs("items") });
check("AT-09", "user_id not a uuid → 400", await attPost(khoa.token, s0, { items: [{ user_id: "x", result: "present" }] }), {
  status: 400,
  test: fieldIs("user_id"),
});
check("AT-10", "unknown result value → 400", await attPost(khoa.token, s0, { items: [{ user_id: M2.user.id, result: "maybe" }] }), {
  status: 400,
  test: fieldIs("result"),
});
check("AT-11", "a member not in the class → 400", await attPost(khoa.token, s0, { items: [{ user_id: bao.user.id, result: "present" }] }), {
  status: 400,
  test: fieldIs("user_id"),
});
check(
  "AT-12",
  "marking attendance for a session that has not started should be refused",
  await attPost(khoa.token, s1, { items: [{ user_id: M2.user.id, result: "present" }] }),
  { status: [400, 409, 422], advisory: true },
);
const seedDetail = await detail(mgr.token, SEED_CLASS);
const seedDone = (seedDetail.data?.sessions ?? []).find((x) => x.status === "done");
const seedStudent = (seedDetail.data?.roster ?? []).find((x) => x.status === "confirmed");
if (seedDone && seedStudent) {
  const item = [{ user_id: seedStudent.id, result: "late" }];
  check("AT-13", "a coach cannot change a locked session → BR-35", await attPost(khoa.token, seedDone.id, { items: item }), {
    status: 422,
    br: "BR-35",
  });
  check("AT-14", "the manager needs a reason for a locked session", await attPost(mgr.token, seedDone.id, { items: item }), {
    status: 400,
    test: fieldIs("reason"),
  });
  check("AT-15", "a 2-character reason is too short", await attPost(mgr.token, seedDone.id, { items: item, reason: "ab" }), {
    status: 400,
    test: fieldIs("reason"),
  });
  check(
    "AT-16",
    "the manager corrects a locked session with a reason → 200",
    await attPost(mgr.token, seedDone.id, { items: item, reason: "agent test correction" }),
    { status: 200 },
  );
  check("AT-17", "a done session reads as locked", await attGet(khoa.token, seedDone.id), {
    status: 200,
    test: (r) => r.data?.session?.locked === true,
  });
} else {
  blocked("AT-13", "locked attendance cases", "seed class has no done session or no confirmed student");
}
if (S) check("AT-18", "attendance on a cancelled session → 409", await attPost(mgr.token, S.sessions[0].id, { items: [{ user_id: M2.user.id, result: "present" }] }), { status: 409 });
check("AT-19", "a member reads their own attendance → 200", await api("/me/attendance", { token: M2.token }), { status: 200 });

// ───── 11. Session results ─────
const resultItem = (extra = {}) => ({ user_id: M2.user.id, plan_pct: 80, metrics: { smash_count: 20 }, note: "ok", ...extra });
for (const [id, who, tok] of [
  ["TR-01", "a receptionist", rec.token],
  ["TR-02", "a member", M2.token],
  ["TR-03", "a coach who does not teach the class", lan.token],
]) {
  check(id, `${who} cannot post results`, await putResults(tok, s0, { items: [resultItem()] }), { status: 403 });
}
const badResults = [
  ["TR-04", "empty items", [], "items"],
  ["TR-05", "plan_pct 101", [resultItem({ plan_pct: 101 })], "plan_pct"],
  ["TR-06", "plan_pct -1", [resultItem({ plan_pct: -1 })], "plan_pct"],
  ["TR-07", "plan_pct 50.5", [resultItem({ plan_pct: 50.5 })], "plan_pct"],
  ["TR-08", "smash_count 1001", [resultItem({ metrics: { smash_count: 1001 } })], "smash_count"],
  ["TR-09", "smash_count 1.5", [resultItem({ metrics: { smash_count: 1.5 } })], "smash_count"],
  ["TR-10", "an unknown metric key", [resultItem({ metrics: { foo: 1 } })], "metrics"],
  ["TR-11", "metrics that is not an object", [resultItem({ metrics: "x" })], "metrics"],
  ["TR-12", "note of 1001 characters", [resultItem({ note: "n".repeat(1001) })], "note"],
  ["TR-13", "a member not in the class", [resultItem({ user_id: bao.user.id })], "user_id"],
  ["TR-14", "user_id not a uuid", [resultItem({ user_id: "x" })], "user_id"],
];
for (const [id, title, items, field] of badResults) {
  check(id, `results: ${title} → 400 field ${field}`, await putResults(khoa.token, s0, { items }), { status: 400, test: fieldIs(field) });
}
check("TR-15", "results: serve_pct 101 → 400", await putResults(khoa.token, s0, { items: [resultItem({ metrics: { serve_pct: 101 } })] }), {
  status: 400,
  test: (r) => ["serve_pct", "metrics"].includes(r.data?.field),
});

// ───── 12. Training plans ─────
const block = (extra = {}) => ({
  title: "Warm-up jog",
  minutes: 10,
  phase: "warm-up",
  intensity: "light",
  description: "Easy jog and dynamic stretches.",
  ...extra,
});
const planBody = (extra = {}) => ({
  class_id: A.id,
  session_id: s0,
  title: "Agent plan",
  payload: { blocks: [block(), block({ title: "Drills", minutes: 30, phase: "technique", intensity: "medium" })] },
  ...extra,
});
const tplan = await createTPlan(khoa.token, planBody());
const tplanId = tplan.data?.id;
check("TR-16", "the coach writes a plan for a session → 201 published", tplan, {
  status: 201,
  test: (r) => r.data?.published === true && "warnings" in (r.data ?? {}),
});
const badPlans = [
  ["TR-17", "no class_id or user_id", { class_id: undefined, session_id: undefined }, "class_id"],
  ["TR-18", "no payload", { payload: undefined }, "payload"],
  ["TR-19", "zero blocks", { payload: { blocks: [] } }, "blocks"],
  ["TR-20", "13 blocks", { payload: { blocks: Array.from({ length: 13 }, () => block()) } }, "blocks"],
  ["TR-21", "a block of 0 minutes", { payload: { blocks: [block({ minutes: 0 })] } }, "blocks"],
  ["TR-22", "a block of 181 minutes", { payload: { blocks: [block({ minutes: 181 })] } }, "blocks"],
  ["TR-23", "phase 'nap'", { payload: { blocks: [block({ phase: "nap" })] } }, "phase"],
  ["TR-24", "intensity 'extreme'", { payload: { blocks: [block({ intensity: "extreme" })] } }, "intensity"],
  ["TR-25", "a block without description", { payload: { blocks: [block({ description: undefined })] } }, "blocks"],
  ["TR-26", "title of 121 characters", { title: "t".repeat(121) }, "title"],
];
if (B) badPlans.push(["TR-27", "a session of another class", { session_id: B.sessions[0].id }, "session_id"]);
for (const [id, title, extra, field] of badPlans) {
  check(id, `plan: ${title} → 400 field ${field}`, await createTPlan(khoa.token, planBody(extra)), { status: 400, test: fieldIs(field) });
}
for (const [id, who, tok] of [
  ["TR-28", "a coach who does not teach the class", lan.token],
  ["TR-29", "a coach of another sport", ducAnh.token],
  ["TR-30", "a receptionist", rec.token],
]) {
  check(id, `${who} cannot write a plan for class A`, await createTPlan(tok, planBody()), { status: 403 });
}
const tplBody = (payloadExtra = {}, extra = {}) => ({
  is_template: true,
  title: "Agent template",
  payload: { sport: "badminton", level: "beginner", blocks: [block()], ...payloadExtra },
  ...extra,
});
check("TR-31", "a template tied to a class → 400 field class_id", await createTPlan(khoa.token, tplBody({}, { class_id: A.id })), {
  status: 400,
  test: fieldIs("class_id"),
});
check("TR-32", "a template without sport → 400 field sport", await createTPlan(khoa.token, tplBody({ sport: undefined })), {
  status: 400,
  test: fieldIs("sport"),
});
const tpl = await createTPlan(khoa.token, tplBody());
const tplId = tpl.data?.id;
check("TR-33", "a valid template → 201, not published", tpl, { status: 201, test: (r) => r.data?.published === false });
if (tplanId) {
  check("TR-34", "PATCH with nothing to change → 400", await patchTPlan(khoa.token, tplanId, {}), { status: 400 });
  check("TR-35", "PATCH title of 121 characters → 400", await patchTPlan(khoa.token, tplanId, { title: "t".repeat(121) }), { status: 400 });
  check("TR-36", "another coach cannot edit the plan", await patchTPlan(lan.token, tplanId, { title: "x" }), { status: 403 });
  check("TR-37", "a coach of another sport cannot edit the plan", await patchTPlan(ducAnh.token, tplanId, { title: "x" }), { status: 403 });
}
if (tplId) check("TR-38", "publishing a template → 409", await patchTPlan(khoa.token, tplId, { published: true }), { status: 409 });

const goodResults = await putResults(khoa.token, s0, { items: [resultItem()] });
check("TR-39", "valid results → 200", goodResults, {
  status: 200,
  test: (r) => (r.data?.items ?? []).some((x) => x.user_id === M2.user.id),
});
check("TR-40", "read results → 200", await api(`/sessions/${s0}/results`, { token: khoa.token }), { status: 200 });
if (tplanId) {
  check("TR-41", "changing a plan whose session has results → BR-48", await patchTPlan(khoa.token, tplanId, { payload: { blocks: [block()] } }), {
    status: 422,
    br: "BR-48",
  });
  check("TR-42", "renaming that plan is still allowed → 200", await patchTPlan(khoa.token, tplanId, { title: "Agent plan (renamed)" }), {
    status: 200,
  });
} else {
  blocked("TR-41", "BR-48 on PATCH", "the plan was not created (TR-16)");
}
if (tplId) {
  check("TR-43", "from-template into a session with results → BR-48", await fromTemplate(khoa.token, { template_id: tplId, class_id: A.id, session_id: s0 }), {
    status: 422,
    br: "BR-48",
  });
  check("TR-44", "from-template into a fresh session → 201", await fromTemplate(khoa.token, { template_id: tplId, class_id: A.id, session_id: s1 }), {
    status: 201,
  });
} else {
  blocked("TR-43", "from-template cases", "the template was not created (TR-33)");
}
check("TR-45", "from-template with an unknown template → 404", await fromTemplate(khoa.token, { template_id: N, class_id: A.id, session_id: s1 }), {
  status: 404,
});
check("TR-46", "from-template with a non-uuid template → 400", await fromTemplate(khoa.token, { template_id: "x", class_id: A.id, session_id: s1 }), {
  status: 400,
});
check("TR-47", "a new plan for a session that has results should be refused (BR-48)", await createTPlan(khoa.token, planBody()), {
  status: 422,
  br: "BR-48",
  advisory: true,
});

// ───── 13. Homework ─────
const hwBody = (extra = {}) => ({
  class_id: A.id,
  title: "Footwork drills",
  body: "Do these before Friday.",
  checklist: ["Skipping 3x50", "Wall rally 10 min"],
  due_on: ictDate(7),
  ...extra,
});
const badHomework = [
  ["TR-48", "empty title", { title: "" }, "title"],
  ["TR-49", "title of 121 characters", { title: "t".repeat(121) }, "title"],
  ["TR-50", "body of 4001 characters", { body: "b".repeat(4001) }, "body"],
  ["TR-51", "21 checklist items", { checklist: Array.from({ length: 21 }, (_, i) => `item ${i}`) }, "checklist"],
  ["TR-52", "checklist that is not a list", { checklist: "x" }, "checklist"],
  ["TR-53", "due_on 2026-13-45", { due_on: "2026-13-45" }, "due_on"],
  ["TR-54", "due_on yesterday", { due_on: ictDate(-1) }, "due_on"],
  ["TR-55", "both class_id and user_id", { user_id: M2.user.id }, "class_id"],
  ["TR-56", "neither class_id nor user_id", { class_id: undefined }, "class_id"],
];
for (const [id, title, extra, field] of badHomework) {
  check(id, `homework: ${title} → 400 field ${field}`, await postHomework(khoa.token, hwBody(extra)), { status: 400, test: fieldIs(field) });
}
if (S) check("TR-57", "homework for a class with no students → 422", await postHomework(mgr.token, hwBody({ class_id: S.id })), { status: 422 });
for (const [id, who, tok] of [
  ["TR-58", "a coach who does not teach the class", lan.token],
  ["TR-59", "a member", M2.token],
  ["TR-60", "a receptionist", rec.token],
]) {
  check(id, `${who} cannot set homework for class A`, await postHomework(tok, hwBody()), { status: 403 });
}
const rosterA = (await detail(mgr.token, A.id)).data?.roster ?? [];
const confirmedA = rosterA.filter((x) => x.status === "confirmed").length;
const hw = await postHomework(khoa.token, hwBody());
const hwId = hw.data?.id;
const recipientsOf = (r) => (Array.isArray(r.data?.recipients) ? r.data.recipients.length : Number(r.data?.recipients));
check("TR-61", `homework for class A → 201, ${confirmedA} recipients`, hw, {
  status: 201,
  test: (r) => recipientsOf(r) === confirmedA,
  why: "recipients should equal the confirmed students of class A",
});
check("TR-62", "homework for one student → 201, 1 recipient", await postHomework(khoa.token, hwBody({ class_id: undefined, user_id: M2.user.id })), {
  status: 201,
  test: (r) => recipientsOf(r) === 1,
});
// fixed by agent: bao is enrolled in Khoa's class in seed; fresh member guarantees coach does not teach them
const nonStudent = await newMember();
check("TR-63", "homework for a student the coach does not teach → 403", await postHomework(khoa.token, hwBody({ class_id: undefined, user_id: nonStudent.user.id })), {
  status: 403,
});
check("TR-64", "the student sees the homework", await api("/me/homework", { token: M2.token }), {
  status: 200,
  test: (r) => itemsOf(r).some((h) => h.id === hwId),
});
if (hwId) {
  check("TR-65", "ticking every item completes the homework", await api(`/me/homework/${hwId}`, { method: "PUT", token: M2.token, body: { done_items: [0, 1], done: true } }), {
    status: 200,
    test: (r) => r.data?.completed === true,
  });
  check("TR-66", "a member who left the class cannot tick it → 404", await api(`/me/homework/${hwId}`, { method: "PUT", token: M1.token, body: { done_items: [0] } }), {
    status: 404,
  });
  check("TR-67", "a member who never had it → 404", await api(`/me/homework/${hwId}`, { method: "PUT", token: bao.token, body: { done_items: [0] } }), {
    status: 404,
  });
  check("TR-68", "a coach cannot tick member homework → 403", await api(`/me/homework/${hwId}`, { method: "PUT", token: khoa.token, body: { done_items: [0] } }), {
    status: 403,
  });
}
check("TR-69", "tick with a non-uuid id → 404", await api("/me/homework/abc", { method: "PUT", token: M2.token, body: { done_items: [0] } }), { status: 404 });
check("TR-70", "the coach lists homework of class A", await api(`/homework?class_id=${A.id}`, { token: khoa.token }), { status: 200 });

// ───── 14. Students ─────
const student = (path) => `/students/${M2.user.id}${path}`;
for (const [id, who, tok, status] of [
  ["TR-71", "the class coach", khoa.token, 200],
  ["TR-72", "a coach who does not teach the student", lan.token, 403],
  ["TR-73", "a coach of another sport", ducAnh.token, 403],
  ["TR-74", "the manager", mgr.token, 200],
  ["TR-75", "a receptionist", rec.token, 403],
]) {
  check(id, `student profile as ${who} → ${status}`, await api(student("/profile"), { token: tok }), { status });
}
check("TR-76", "profile of a coach (not a member) → 404", await api(`/students/${lan.user.id}/profile`, { token: mgr.token }), { status: 404 });
check("TR-77", "profile with a non-uuid id → 404", await api("/students/abc/profile", { token: mgr.token }), { status: 404 });
check("TR-78", "level: sport 'tennis' → 400", await api(student("/level"), { method: "PUT", token: khoa.token, body: { sport: "tennis", level: "beginner" } }), {
  status: 400,
  test: fieldIs("sport"),
});
check("TR-79", "level: level 'pro' → 400", await api(student("/level"), { method: "PUT", token: khoa.token, body: { sport: "badminton", level: "pro" } }), {
  status: 400,
  test: fieldIs("level"),
});
check("TR-80", "level: valid → 200", await api(student("/level"), { method: "PUT", token: khoa.token, body: { sport: "badminton", level: "intermediate" } }), {
  status: 200,
  test: (r) => r.data?.level === "intermediate",
});
check("TR-81", "note: empty → 400", await api(student("/notes"), { method: "POST", token: khoa.token, body: { body: "" } }), { status: 400 });
check("TR-82", "note: 2001 characters → 400", await api(student("/notes"), { method: "POST", token: khoa.token, body: { body: "n".repeat(2001) } }), {
  status: 400,
});
check("TR-83", "note: valid → 201", await api(student("/notes"), { method: "POST", token: khoa.token, body: { body: "Grip is better this week." } }), {
  status: 201,
});
// fixed by agent: studentReviewPost handler requires sport field (SPORTS enum)
const review = (extra = {}) => ({ sport: "badminton", period_weeks: 2, technique: 4, fitness: 3, attitude: 5, comment: "Good progress.", ...extra });
const postReview = (tok, body) => api(student("/reviews"), { method: "POST", token: tok, body });
for (const [id, title, extra] of [
  ["TR-84", "period_weeks 3", { period_weeks: 3 }],
  ["TR-85", "technique 0", { technique: 0 }],
  ["TR-86", "technique 6", { technique: 6 }],
  ["TR-87", "technique 2.5", { technique: 2.5 }],
  ["TR-88", "comment of 2001 characters", { comment: "c".repeat(2001) }],
]) {
  check(id, `review: ${title} → 400`, await postReview(khoa.token, review(extra)), { status: 400 });
}
check("TR-89", "review: attitude given as the string '3' is accepted → 201", await postReview(khoa.token, review({ attitude: "3" })), { status: 201 });
check("TR-90", "review: valid 4-week review → 201", await postReview(khoa.token, review({ period_weeks: 4 })), { status: 201 });
const reviewNote = await findNotification(M2.token, "review_added");
check("TR-91", "the student is notified of the review", fake(reviewNote), { test: () => !!reviewNote, why: "no review_added notification" });
check("TR-92", "a coach who does not teach the student cannot review", await postReview(lan.token, review()), { status: 403 });

// ───── 15. Training goal, member training, coach views ─────
const goal = (tok, value) => api("/me/training-goal", { method: "PUT", token: tok, body: { goal: value } });
check("TR-93", "member sets goal 'weight' → 200", await goal(M2.token, "weight"), { status: 200, test: (r) => r.data?.goal === "weight" });
check("TR-94", "goal 'fly' → 400 field goal", await goal(M2.token, "fly"), { status: 400, test: fieldIs("goal") });
check("TR-95", "goal null clears it → 200", await goal(M2.token, null), { status: 200 });
check("TR-96", "a coach has no training goal → 403", await goal(khoa.token, "weight"), { status: 403 });
check("TR-97", "member training page → 200", await api("/me/training", { token: M2.token }), { status: 200 });
check("TR-98", "coach schedule → 200", await api("/coach/schedule", { token: khoa.token }), { status: 200 });
check("TR-99", "coach classes → 200 and lists class A", await api("/coach/classes", { token: khoa.token }), {
  status: 200,
  test: (r) => JSON.stringify(r.data).includes(A.id),
});
check("TR-100", "a member cannot open the coach schedule", await api("/coach/schedule", { token: M2.token }), { status: 403 });
check("TR-101", "a member cannot open coach classes", await api("/coach/classes", { token: M2.token }), { status: 403 });

// ───── 16. Edit, close and cancel a class (last: it changes A and S for good) ─────
check("CL-52", "a coach cannot edit a class", await patchClass(khoa.token, A.id, { level: "x" }), { status: 403 });
check("CL-53", "edit an unknown class → 404", await patchClass(mgr.token, N, { level: "x" }), { status: 404 });
for (const [id, value] of [
  ["CL-54", 0],
  ["CL-55", 201],
  ["CL-56", "abc"],
  ["CL-57", 1.5],
]) {
  check(id, `capacity ${JSON.stringify(value)} → 400 field capacity`, await patchClass(mgr.token, A.id, { capacity: value }), {
    status: 400,
    test: fieldIs("capacity"),
  });
}
check("CL-58", "capacity below the enrolled count → BR-21", await patchClass(mgr.token, A.id, { capacity: 1 }), { status: 422, br: "BR-21" });
check("CL-59", "empty level → 400", await patchClass(mgr.token, A.id, { level: "" }), { status: 400, test: fieldIs("level") });
check("CL-60", "level of 25 characters → 400", await patchClass(mgr.token, A.id, { level: "L".repeat(25) }), { status: 400, test: fieldIs("level") });
check("CL-61", "status 'draft' → 400", await patchClass(mgr.token, A.id, { status: "draft" }), { status: 400, test: fieldIs("status") });
check("CL-62", "status 'foo' → 400", await patchClass(mgr.token, A.id, { status: "foo" }), { status: 400, test: fieldIs("status") });
if (dId) check("CL-63", "opening a draft by PATCH → 409", await patchClass(mgr.token, dId, { status: "open" }), { status: 409 });
check("CL-64", "rename the level → 200", await patchClass(mgr.token, A.id, { level: "agent-test-2" }), {
  status: 200,
  test: (r) => r.data?.class?.level === "agent-test-2",
});
check("CL-65", "close the class → 200", await patchClass(mgr.token, A.id, { status: "closed" }), { status: 200 });
check("CL-66", "enrolling in a closed class → BR-18", await enroll(M1.token, A.id), { status: 422, br: "BR-18" });
check("CL-67", "reopen the class → 200", await patchClass(mgr.token, A.id, { status: "open" }), { status: 200 });
if (S) {
  check("CL-68", "cancel a class without a reason → 400", await patchClass(mgr.token, S.id, { status: "cancelled" }), {
    status: 400,
    test: fieldIs("reason"),
  });
  check("CL-69", "cancel a class with a reason → 200", await cancelClass(S.id, "agent test: coach left"), {
    status: 200,
    test: (r) => r.data?.ok === true && r.data?.sessions_cancelled >= 1,
  });
  check("CL-70", "editing a cancelled class → 409", await patchClass(mgr.token, S.id, { capacity: 10 }), { status: 409 });
  check("CL-71", "publishing a cancelled class → 409", await publish(mgr.token, S.id), { status: 409 });
  check("CL-72", "changing the coach of a cancelled class → 409", await setCoach(mgr.token, S.id, { coach_id: lan.user.id }), { status: 409 });
  check("CL-73", "enrolling in a cancelled class → BR-18", await enroll(M1.token, S.id), { status: 422, br: "BR-18" });
} else {
  blocked("CL-68", "cancel class cases", "class S could not be set up");
}

summary();
