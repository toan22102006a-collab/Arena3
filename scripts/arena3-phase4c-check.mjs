#!/usr/bin/env node
/**
 * Live checks for Phase 4C: the F4 training module — attendance rules, session
 * results, student profile, reviews, homework, session plans, gate check-in.
 * Run it ONCE per fresh in-memory server, never against production or a database
 * you care about: it creates staff, members, a plan sale and a class.
 *
 * Set DATABASE_URL empty: the dev server picks up .env.local, which points at the
 * real database.
 *
 *   DATABASE_URL= DATABASE_URL_UNPOOLED= PGLITE_DATA_DIR=memory npm run dev -- --port 8090
 *   BASE=http://127.0.0.1:8090 node scripts/arena3-phase4c-check.mjs
 *
 * The 2-hour attendance lock (BR-53) cannot be reached over HTTP — every session
 * the seed and the generator create is in the future — so the lock rule is
 * covered by unit tests in src/lib/arena3/arena3.test.ts.
 */
const BASE = (process.env.BASE ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PASS = "ChangeMe!a3";
let passed = 0;

function fail(msg, extra) {
  console.error("FAIL", msg, extra === undefined ? "" : JSON.stringify(extra));
  process.exit(1);
}
function ok(cond, msg, extra) {
  if (!cond) fail(msg, extra);
  passed += 1;
  console.log("ok  ", msg);
}

async function req(path, { method = "GET", token, body, idem } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (idem) headers["idempotency-key"] = crypto.randomUUID();
  const res = await fetch(`${BASE}/v1${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function login(phone, password = PASS) {
  const r = await req("/auth/login", { method: "POST", body: { login: phone, password } });
  if (r.status !== 200 || !r.data?.token) fail(`login ${phone}`, r);
  return r.data;
}

const ictDate = (d) => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const mgr = await login("0900000001");
const desk = await login("0900000002");
const stamp = String(Date.now()).slice(-7);
const shift = await req("/shifts/current", { token: desk.token });
if (!shift.data?.shift) {
  const opened = await req("/shifts/open", { method: "POST", token: desk.token });
  if (opened.status >= 400) fail("open shift", opened);
}

async function newCoach(tag, prefix) {
  const made = await req("/staff", {
    method: "POST",
    token: mgr.token,
    body: { full_name: `Coach ${tag} ${stamp}`, phone: `${prefix}${stamp}`, role: "coach", sports: ["basketball"] },
  });
  if (made.status !== 201) fail(`create coach ${tag}`, made);
  const session = await login(`${prefix}${stamp}`, made.data.temp_password);
  return { id: made.data.staff.id, token: session.token };
}
const coachA = await newCoach("A", "091");
const coachB = await newCoach("B", "092");

const plans = (await req("/plans")).data.items;
const quotaPlan = plans.find((p) => p.session_quota != null && p.sport_scope === "basketball");
if (!quotaPlan) fail("no basketball per-session plan in the seed", plans);
async function newMember(prefix, name, plan) {
  const made = await req("/members", {
    method: "POST",
    token: desk.token,
    body: { full_name: `${name} ${stamp}`, phone: `${prefix}${stamp}`, pii_consent: true },
  });
  if (made.status !== 201) fail(`create member ${name}`, made);
  if (plan) {
    const order = await req("/subscriptions", {
      method: "POST",
      token: desk.token,
      body: { plan_id: plan.id, user_id: made.data.user.id },
    });
    if (order.status !== 201) fail("order plan", order);
    const pay = await req("/payments", {
      method: "POST",
      token: desk.token,
      idem: true,
      body: { ref_type: "subscription", ref_id: order.data.subscription.id, method: "cash", amount_vnd: plan.price_vnd },
    });
    if (pay.status !== 201) fail("pay plan", pay);
  }
  const session = await login(made.data.user.phone, made.data.temp_password);
  const me = await req("/me", { token: session.token });
  return {
    token: session.token,
    id: made.data.user.id,
    phone: made.data.user.phone,
    code: me.data.user?.member_code ?? made.data.user.member_code,
  };
}
const m1 = await newMember("087", "Training One", quotaPlan);
const m2 = await newMember("088", "Training Two", quotaPlan);
const m3 = await newMember("089", "Training Three", null);
const quotaLeft = async (m) =>
  (await req("/me", { token: m.token })).data.subscriptions.find((s) => s.sport_scope === "basketball")?.session_left;

// A basketball class that runs every day for the next three weeks.
const today = ictDate(new Date());
const occ = await req(`/occupancy?date=${today}`, { token: mgr.token });
const courts = occ.data.courts.filter((c) => c.sport === "basketball" && c.status === "ready");
let cid = null;
for (const court of courts) {
  for (const hour of [20, 21, 19, 6]) {
    const made = await req("/classes", {
      method: "POST",
      token: mgr.token,
      body: {
        sport: "basketball",
        level: "beginner",
        coach_id: coachA.id,
        court_id: court.id,
        capacity: 5,
        rrule: `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYHOUR=${hour}`,
        duration_min: 60,
        start_on: today,
        end_on: ictDate(new Date(Date.now() + 24 * 86400000)),
      },
    });
    if (made.status !== 201) fail("create class", made);
    const pub = await req(`/classes/${made.data.id}/publish`, { method: "POST", token: mgr.token });
    if (pub.status === 200 && pub.data.sessions.length >= 14) {
      cid = made.data.id;
      break;
    }
  }
  if (cid) break;
}
if (!cid) fail("could not publish a class with free slots");
for (const m of [m1, m2]) {
  const e = await req(`/classes/${cid}/enroll`, { method: "POST", token: m.token });
  if (e.status !== 201) fail("enroll", e);
}
const sessions = (await req(`/classes/${cid}`, { token: mgr.token })).data.sessions
  .filter((s) => s.status === "scheduled" && new Date(s.start_at) > new Date())
  .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
ok(sessions.length >= 14, "the class has a fortnight of future sessions", sessions.length);
const [s0, s1, s2, s3] = sessions;
const bySt = (iso, days) => sessions.find((s) => new Date(s.start_at).getTime() === new Date(iso).getTime() + days * 86400000);

// ---- the F4 switch (BR-62) ---------------------------------------------------
{
  await req("/flags", { method: "PATCH", token: mgr.token, body: { F4: false } });
  const off = await req(`/sessions/${s0.id}/attendance`, { token: coachA.token });
  ok(off.status === 403 && off.data.br === "BR-62" && off.data.flag === "F4", "F4 off answers 403 with BR-62", off);
  const offMe = await req("/me/training", { token: m1.token });
  ok(offMe.status === 403, "F4 off also closes the member's progress page", offMe);
  const offGate = await req("/desk/gate-checkin", { method: "POST", token: desk.token, body: { code: m1.code } });
  ok(offGate.status === 403, "F4 off closes the gate check-in too", offGate);
  const on = await req("/flags", { method: "PATCH", token: mgr.token, body: { F4: true } });
  ok(on.status === 200 && on.data.flags.F4 === true, "F4 back on", on);
}

// ---- attendance (BR-53, BR-57, BR-58, BR-59) ----------------------------------
const att = (token, id, items, extra = {}) =>
  req(`/sessions/${id}/attendance`, { method: "POST", token, body: { items, ...extra } });
const inboxOf = async (token) => (await req("/me/notifications", { token })).data.items ?? [];
const streakAlerts = async (token, uid) =>
  (await inboxOf(token)).filter((n) => n.template === "absent_streak" && n.payload?.user_id === uid).length;
{
  const other = await req(`/sessions/${s0.id}/attendance`, { token: coachB.token });
  ok(other.status === 403, "a coach cannot read another coach's register (BR-59)", other);
  const otherPost = await att(coachB.token, s0.id, [{ user_id: m1.id, result: "present" }]);
  ok(otherPost.status === 403, "…or write to it (BR-59)", otherPost);
  const asMember = await req(`/sessions/${s0.id}/attendance`, { token: m1.token });
  ok(asMember.status === 403, "a member cannot read a register", asMember);
  const bad = await att(coachA.token, s0.id, [{ user_id: m1.id, result: "sick" }]);
  ok(bad.status === 400 && bad.data.field === "result", "an unknown result is refused, naming the field", bad);
  const stranger = await att(coachA.token, s0.id, [{ user_id: m3.id, result: "present" }]);
  ok(stranger.status === 400 && stranger.data.field === "user_id", "a student who is not enrolled cannot be marked", stranger);
  const none = await att(coachA.token, s0.id, []);
  ok(none.status === 400, "an empty register is refused", none);

  const good = await att(coachA.token, s0.id, [
    { user_id: m1.id, result: "late" },
    { user_id: m2.id, result: "present" },
  ]);
  ok(good.status === 200 && good.data.session.locked === false, "the class coach saves the register; it is open", good.data?.session);
  ok(
    good.data.items.find((i) => i.id === m1.id)?.result === "late" &&
      good.data.items.find((i) => i.id === m2.id)?.result === "present",
    "…and the marks read back",
    good.data.items,
  );
  const resave = await att(coachA.token, s0.id, [{ user_id: m1.id, result: "present" }]);
  ok(resave.status === 200 && resave.data.items.find((i) => i.id === m1.id)?.result === "present", "the coach may correct within the window", resave.data?.items);
  const byMgr = await att(mgr.token, s0.id, [{ user_id: m1.id, result: "present" }]);
  ok(byMgr.status === 200, "a manager may also save a register", byMgr);
  const gone = await req(`/sessions/${s0.id}/attendance`, { method: "POST", token: coachA.token, body: { items: [{ user_id: m1.id, result: "present" }] } });
  ok(gone.status === 200, "saving the same mark again is harmless", gone);
}

// BR-58: three absences in a row alert the manager and the coach.
{
  const before = await streakAlerts(mgr.token, m1.id);
  await att(coachA.token, s0.id, [{ user_id: m1.id, result: "absent" }, { user_id: m2.id, result: "absent" }]);
  await att(coachA.token, s1.id, [{ user_id: m1.id, result: "absent" }, { user_id: m2.id, result: "absent" }]);
  ok((await streakAlerts(mgr.token, m1.id)) === before, "two absences in a row raise nothing yet");
  await att(coachA.token, s2.id, [{ user_id: m1.id, result: "absent" }, { user_id: m2.id, result: "excused" }]);
  ok((await streakAlerts(mgr.token, m1.id)) === before + 1, "the third absence in a row alerts the manager (BR-58)");
  ok((await streakAlerts(coachA.token, m1.id)) === 1, "…and the class coach");
  ok((await streakAlerts(coachB.token, m1.id)) === 0, "…but not another coach");
  await att(coachA.token, s2.id, [{ user_id: m1.id, result: "absent" }]);
  ok((await streakAlerts(mgr.token, m1.id)) === before + 1, "saving the same register again does not alert twice");
  await att(coachA.token, s3.id, [{ user_id: m2.id, result: "absent" }]);
  ok((await streakAlerts(mgr.token, m2.id)) === 0, "an excused absence breaks the streak");
  const enrol = await req(`/classes/${cid}/roster`, { token: coachA.token });
  ok(enrol.data.items.some((i) => i.id === m1.id), "BR-58 does not un-enrol the student", enrol.data);
}

// ---- session results (FR-TRN-05) ----------------------------------------------
const results = (token, id, items) => req(`/sessions/${id}/results`, { method: "PUT", token, body: { items } });
{
  const base = await quotaLeft(m1);
  const put = await results(coachA.token, s0.id, [
    { user_id: m1.id, plan_pct: 80, metrics: { smash_count: 12, serve_pct: 70 }, note: "Sharper footwork" },
  ]);
  const row = put.data?.items?.find((i) => i.user_id === m1.id);
  ok(put.status === 200 && row?.plan_pct === 80 && row.metrics.smash_count === 12, "the coach logs a student's result", put);
  const get = await req(`/sessions/${s0.id}/results`, { token: coachA.token });
  ok(get.data.items.find((i) => i.user_id === m1.id)?.note === "Sharper footwork", "…and it reads back", get.data);
  ok((await results(coachA.token, s0.id, [{ user_id: m1.id, plan_pct: 101 }])).status === 400, "plan completion above 100 is refused");
  ok((await results(coachA.token, s0.id, [{ user_id: m1.id, metrics: { serve_pct: 120 } }])).status === 400, "a percentage metric above 100 is refused");
  ok((await results(coachA.token, s0.id, [{ user_id: m1.id, metrics: { speed: 3 } }])).status === 400, "an unknown metric is refused");
  ok((await results(coachA.token, s0.id, [{ user_id: m3.id, plan_pct: 50 }])).status === 400, "a student outside the class is refused");
  ok((await results(coachB.token, s0.id, [{ user_id: m1.id, plan_pct: 50 }])).status === 403, "another coach cannot log results (BR-59)");
  ok((await results(m1.token, s0.id, [{ user_id: m1.id, plan_pct: 50 }])).status === 403, "a member cannot log results");
  ok((await req(`/sessions/${s0.id}/results`, { token: desk.token })).status === 403, "reception cannot read results");
  const cleared = await results(coachA.token, s0.id, [{ user_id: m1.id }]);
  ok(cleared.data.items.find((i) => i.user_id === m1.id)?.plan_pct === null, "a blank row clears the result", cleared.data);
  await results(coachA.token, s0.id, [{ user_id: m1.id, plan_pct: 90, metrics: { freethrow_pct: 55 } }]);
  ok((await quotaLeft(m1)) === base, "results never touch the membership balance (BR-56)", { base, now: await quotaLeft(m1) });
}

// ---- profile, goal, level, notes, reviews (FR-TRN-03, -06) --------------------
{
  await req("/me", { method: "PATCH", token: m1.token, body: { full_name: `Training One ${stamp}`, health_notes: "Mild asthma" } });
  const p = await req(`/students/${m1.id}/profile`, { token: coachA.token });
  ok(p.status === 200 && p.data.student.health_notes === "Mild asthma", "the student's own coach sees their health notes (BR-55)", p.data?.student);
  ok((await req(`/students/${m1.id}/profile`, { token: coachB.token })).status === 403, "another coach cannot open the profile (BR-55)");
  ok((await req(`/students/${m1.id}/profile`, { token: desk.token })).status === 403, "reception cannot open the profile");
  ok((await req(`/students/${m1.id}/profile`, { token: m2.token })).status === 403, "a member cannot open somebody's profile");
  ok((await req(`/students/${m1.id}/profile`, { token: mgr.token })).status === 200, "a manager can");
  ok((await req(`/students/${m3.id}/profile`, { token: coachA.token })).status === 403, "a coach cannot open a student of nobody's class");
  ok((await req(`/students/not-a-uuid/profile`, { token: mgr.token })).status === 404, "a malformed id is a 404");

  const goal = await req("/me/training-goal", { method: "PUT", token: m1.token, body: { goal: "compete" } });
  ok(goal.status === 200 && goal.data.goal === "compete", "a member sets their goal", goal);
  ok((await req("/me/training-goal", { method: "PUT", token: m1.token, body: { goal: "fame" } })).status === 400, "an unknown goal is refused");
  ok((await req("/me/training-goal", { method: "PUT", token: coachA.token, body: { goal: "fun" } })).status === 403, "a coach cannot set a member's goal");

  const lvl = await req(`/students/${m1.id}/level`, { method: "PUT", token: coachA.token, body: { sport: "basketball", level: "intermediate" } });
  ok(lvl.status === 200, "the coach assesses a level", lvl);
  ok((await req(`/students/${m1.id}/level`, { method: "PUT", token: coachA.token, body: { sport: "basketball", level: "pro" } })).status === 400, "an unknown level is refused");
  ok((await req(`/students/${m1.id}/level`, { method: "PUT", token: coachB.token, body: { sport: "basketball", level: "advanced" } })).status === 403, "another coach cannot");
  ok((await req(`/students/${m1.id}/level`, { method: "PUT", token: m1.token, body: { sport: "basketball", level: "advanced" } })).status === 403, "a member cannot rate themselves");

  const note = await req(`/students/${m1.id}/notes`, { method: "POST", token: coachA.token, body: { body: "Left-handed, favours the baseline" } });
  ok(note.status === 201, "the coach keeps a private note", note);
  ok((await req(`/students/${m1.id}/notes`, { method: "POST", token: coachA.token, body: { body: "  " } })).status === 400, "a blank note is refused");

  const rv = { sport: "basketball", period_weeks: 4, technique: 4, fitness: 3, attitude: 5, comment: "Good month" };
  const made = await req(`/students/${m1.id}/reviews`, { method: "POST", token: coachA.token, body: rv });
  ok(made.status === 201, "the coach writes a review", made);
  ok((await req(`/students/${m1.id}/reviews`, { method: "POST", token: coachA.token, body: { ...rv, period_weeks: 3 } })).status === 400, "a 3-week review is refused");
  ok((await req(`/students/${m1.id}/reviews`, { method: "POST", token: coachA.token, body: { ...rv, technique: 6 } })).status === 400, "a score above 5 is refused");
  ok((await req(`/students/${m1.id}/reviews`, { method: "POST", token: coachB.token, body: rv })).status === 403, "another coach cannot review");
  const second = await req(`/students/${m1.id}/reviews`, { method: "POST", token: coachA.token, body: { ...rv, technique: 5 } });
  const after = await req(`/students/${m1.id}/profile`, { token: coachA.token });
  ok(second.status === 201 && after.data.reviews.length === 2, "a second review is a second row — reviews are append-only", after.data.reviews);
  ok(after.data.notes.length === 1 && after.data.goal === "compete" && after.data.levels[0]?.level === "intermediate", "the profile gathers goal, level and notes", after.data);
  ok((await inboxOf(m1.token)).some((n) => n.template === "review_added"), "the member is told a review arrived");

  const mine = await req("/me/training", { token: m1.token });
  ok(mine.status === 200 && mine.data.reviews.length === 2 && mine.data.goal === "compete", "the member sees their own progress (FR-TRN-08)", mine.data);
  ok(!("notes" in mine.data), "…without the coach's private notes", Object.keys(mine.data));
  ok(!JSON.stringify(mine.data).includes("favours the baseline"), "…the note text never reaches them");
  ok((await req("/me/training", { token: coachA.token })).status === 403, "/me/training is for members");
}

// ---- homework (FR-TRN-07, BR-56) ----------------------------------------------
{
  const base = await quotaLeft(m1);
  const due = ictDate(new Date(Date.now() + 5 * 86400000));
  const hw = { class_id: cid, title: "Wall passes", body: "3 sets of 20", checklist: ["Set 1", "Set 2", "Set 3"], due_on: due };
  const made = await req("/homework", { method: "POST", token: coachA.token, body: hw });
  ok(made.status === 201 && made.data.recipients === 2, "homework for a class reaches every enrolled student", made);
  ok((await req("/homework", { method: "POST", token: coachB.token, body: hw })).status === 403, "another coach cannot set it (BR-59)");
  ok((await req("/homework", { method: "POST", token: coachA.token, body: { ...hw, title: " " } })).status === 400, "a title is required");
  ok((await req("/homework", { method: "POST", token: coachA.token, body: { ...hw, user_id: m1.id } })).status === 400, "a class and a student together are refused");
  ok((await req("/homework", { method: "POST", token: coachA.token, body: { title: "x" } })).status === 400, "no target is refused");
  ok((await req("/homework", { method: "POST", token: coachA.token, body: { ...hw, due_on: "2020-01-01" } })).status === 400, "a due date in the past is refused");
  ok((await req("/homework", { method: "POST", token: coachA.token, body: { ...hw, checklist: "Set 1" } })).status === 400, "a malformed checklist is refused");
  ok((await req("/homework", { method: "POST", token: m1.token, body: hw })).status === 403, "a member cannot set homework");

  const mine = await req("/me/homework", { token: m1.token });
  const item = mine.data.items.find((i) => i.id === made.data.id);
  ok(!!item && item.checklist.length === 3 && item.completed_at === null, "the student sees it", mine.data);
  ok((await inboxOf(m1.token)).some((n) => n.template === "homework_assigned"), "…and is notified");
  ok((await req("/me/homework", { token: m3.token })).data.items.length === 0, "a student outside the class sees nothing");

  const part = await req(`/me/homework/${made.data.id}`, { method: "PUT", token: m1.token, body: { done_items: [0, 1] } });
  ok(part.status === 200 && part.data.completed === false, "ticking some items leaves it open", part);
  const full = await req(`/me/homework/${made.data.id}`, { method: "PUT", token: m1.token, body: { done_items: [0, 1, 2, 9, 2] } });
  ok(full.status === 200 && full.data.completed === true && full.data.done_items.length === 3, "ticking every item completes it; stray ticks are ignored", full);
  const untick = await req(`/me/homework/${made.data.id}`, { method: "PUT", token: m1.token, body: { done_items: [0] } });
  ok(untick.data.completed === false, "unticking reopens it", untick);
  ok((await req(`/me/homework/${made.data.id}`, { method: "PUT", token: m3.token, body: { done_items: [0] } })).status === 404, "a student cannot tick somebody else's homework");
  ok((await req(`/me/homework/${made.data.id}`, { method: "PUT", token: coachA.token, body: { done_items: [0] } })).status === 403, "a coach cannot tick it");
  await req(`/me/homework/${made.data.id}`, { method: "PUT", token: m1.token, body: { done_items: [0, 1, 2] } });

  const list = await req("/homework", { token: coachA.token });
  const row = list.data.items.find((i) => i.id === made.data.id);
  ok(row?.recipients === 2 && row.completed === 1, "the coach sees who has finished", row);
  ok(!(await req("/homework", { token: coachB.token })).data.items.some((i) => i.id === made.data.id), "another coach does not see it");

  const solo = await req("/homework", { method: "POST", token: coachA.token, body: { user_id: m2.id, title: "Stretch routine" } });
  ok(solo.status === 201 && solo.data.recipients === 1, "homework for one student reaches only them", solo);
  const done = await req(`/me/homework/${solo.data.id}`, { method: "PUT", token: m2.token, body: { done: true } });
  ok(done.data.completed === true, "a checklist-free task is finished by an explicit done", done);
  ok((await req("/homework", { method: "POST", token: coachA.token, body: { user_id: m3.id, title: "x" } })).status === 403, "a coach cannot set homework for a stranger");
  ok((await quotaLeft(m1)) === base, "homework never touches the membership balance (BR-56)");
}

// ---- training plans (FR-TRN-04) -----------------------------------------------
const blocks = [
  { title: "Dynamic warm-up", minutes: 10, phase: "warm-up" },
  { title: "Lay-ups both sides", minutes: 20, phase: "technique" },
];
{
  const mk = (token, body) => req("/training-plans", { method: "POST", token, body });
  const made = await mk(coachA.token, { class_id: cid, session_id: s0.id, title: "Week 1", payload: { blocks } });
  ok(made.status === 201 && made.data.session_id === s0.id && made.data.payload.blocks[1].order === 2, "the coach publishes a plan for one session", made);
  ok((await mk(coachB.token, { class_id: cid, payload: { blocks } })).status === 403, "another coach cannot add to the class (BR-59)");
  ok((await mk(coachA.token, { class_id: cid, payload: { blocks: [] } })).status === 400, "a plan with no blocks is refused");
  ok((await mk(coachA.token, { class_id: cid, payload: { blocks: [{ title: "x", minutes: 10, phase: "nap" }] } })).status === 400, "an unknown phase is refused");
  ok((await mk(coachA.token, { class_id: cid, payload: { blocks: [{ title: "x", minutes: 0 }] } })).status === 400, "zero minutes is refused");
  ok((await mk(coachA.token, { payload: { blocks } })).status === 400, "a plan needs a class or a student");
  ok((await mk(coachA.token, { class_id: cid, session_id: crypto.randomUUID(), payload: { blocks } })).status === 400, "a session outside the class is refused");
  ok((await mk(m1.token, { class_id: cid, payload: { blocks } })).status === 403, "a member cannot write plans");

  const seen = await req("/training-plans?mine=1", { token: m1.token });
  ok(seen.data.items.some((p) => p.id === made.data.id), "an enrolled member sees the published plan");
  ok(!(await req("/training-plans?mine=1", { token: m3.token })).data.items.some((p) => p.id === made.data.id), "a stranger does not");
  const next = await req("/me/training", { token: m1.token });
  ok(next.data.next_sessions[0]?.plans.some((p) => p.id === made.data.id), "the member's next session carries its plan", next.data.next_sessions);

  // second plan, results on its target a week on, then duplicate the week
  const p1 = await mk(coachA.token, { class_id: cid, session_id: s1.id, payload: { blocks } });
  const t0 = bySt(s0.start_at, 7);
  const t1 = bySt(s1.start_at, 7);
  ok(!!t0 && !!t1, "the following week has sessions to copy onto");
  await results(coachA.token, t1.id, [{ user_id: m1.id, plan_pct: 60 }]);
  const from = ictDate(new Date(s0.start_at));
  ok((await req(`/classes/${cid}/plans/duplicate-week`, { method: "POST", token: coachB.token, body: { from } })).status === 403, "another coach cannot duplicate");
  ok((await req(`/classes/${cid}/plans/duplicate-week`, { method: "POST", token: coachA.token, body: { from: "soon" } })).status === 400, "a bad date is refused");
  const dup = await req(`/classes/${cid}/plans/duplicate-week`, { method: "POST", token: coachA.token, body: { from } });
  ok(dup.status === 200 && dup.data.copied === 1, "duplicating the week copies what is free", dup);
  ok(dup.data.skipped.some((s) => s.session_id === t1.id && s.reason === "has_results"), "…and skips a session that already has results", dup.data);
  const again = await req(`/classes/${cid}/plans/duplicate-week`, { method: "POST", token: coachA.token, body: { from } });
  ok(again.data.copied === 0 && again.data.skipped.some((s) => s.session_id === t0.id && s.reason === "has_plan"), "a second run copies nothing and says why", again.data);

  const copy = (await req(`/training-plans?class_id=${cid}`, { token: coachA.token })).data.items.find((p) => p.session_id === t0.id);
  ok(copy && copy.published === false, "a copy arrives as a draft", copy);
  ok(!(await req("/training-plans?mine=1", { token: m1.token })).data.items.some((p) => p.id === copy.id), "…so students do not see it yet");
  ok((await req(`/training-plans/${copy.id}`, { method: "PATCH", token: coachB.token, body: { published: true } })).status === 403, "another coach cannot publish it");
  const pub = await req(`/training-plans/${copy.id}`, { method: "PATCH", token: coachA.token, body: { published: true } });
  ok(pub.status === 200 && pub.data.published === true, "the coach publishes the copy", pub);
  ok((await req("/training-plans?mine=1", { token: m1.token })).data.items.some((p) => p.id === copy.id), "…and now they do");
  void p1;
}

// ---- gate check-in (FR-TRN-02, BR-54) -----------------------------------------
{
  const a = await req("/desk/gate-checkin", { method: "POST", token: desk.token, body: { code: m1.code } });
  ok(a.status === 200 && a.data.member.id === m1.id && a.data.duplicate === false, "reception checks a member in by code", a);
  ok(a.data.plans.length >= 1 && Array.isArray(a.data.warnings), "…and sees their plan", a.data);
  const b = await req("/desk/gate-checkin", { method: "POST", token: desk.token, body: { phone: m1.phone } });
  ok(b.status === 200 && b.data.duplicate === true && b.data.checked_in_at === a.data.checked_in_at, "a second scan within five minutes is the same visit", b.data);
  const c = await req("/desk/gate-checkin", { method: "POST", token: desk.token, body: { member_id: m3.id } });
  ok(c.status === 200 && c.data.warnings.some((w) => w.kind === "no_plan"), "a member with no plan is flagged", c.data);
  ok((await req("/desk/gate-checkin", { method: "POST", token: desk.token, body: { code: "ZZ-NOPE" } })).status === 404, "an unknown code is a 404");
  ok((await req("/desk/gate-checkin", { method: "POST", token: desk.token, body: {} })).status === 400, "an empty scan is refused");
  ok((await req("/desk/gate-checkin", { method: "POST", token: m1.token, body: { code: m1.code } })).status === 403, "a member cannot check themselves in");
  ok((await req("/desk/gate-checkin", { method: "POST", token: coachA.token, body: { code: m1.code } })).status === 403, "a coach cannot use the gate");
  const list = await req("/desk/gate-checkins", { token: desk.token });
  ok(list.data.items.filter((i) => i.user_id === m1.id).length === 1 && list.data.items.some((i) => i.user_id === m3.id), "today's list has one entry per visit", list.data);
  const prof = await req(`/students/${m3.id}/profile`, { token: mgr.token });
  ok(prof.data.attendance.present === 0 && prof.data.attendance.late === 0, "a gate scan never marks a session present (BR-54)", prof.data.attendance);
}

console.log(`\n${passed} checks passed`);
