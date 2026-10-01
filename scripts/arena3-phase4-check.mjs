#!/usr/bin/env node
/**
 * Live checks for Phase 4A: the class lifecycle (cancel / move a session,
 * change the coach, edit / close / cancel a class) and the manager member
 * list. Run it ONCE per fresh in-memory server, never against production or a
 * database you care about: it creates staff, members, a plan sale and classes,
 * and a second run on the same server finds the first run's classes in the way.
 *
 * Set DATABASE_URL empty: the dev server picks up .env.local, which points at the
 * real database.
 *
 *   DATABASE_URL= DATABASE_URL_UNPOOLED= PGLITE_DATA_DIR=memory npm run dev -- --port 8090
 *   BASE=http://127.0.0.1:8090 node scripts/arena3-phase4-check.mjs
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

const mgr = await login("0900000001");
const desk = await login("0900000002");
const stamp = String(Date.now()).slice(-7);
// Taking cash at the desk needs a shift (BR-49); one already open is fine.
const shift = await req("/shifts/current", { token: desk.token });
if (!shift.data?.shift) {
  const opened = await req("/shifts/open", { method: "POST", token: desk.token });
  if (opened.status >= 400) fail("open shift", opened);
}
const hoursFromNow = (h) => new Date(Date.now() + h * 3600000);

async function newCoach(tag, phonePrefix) {
  const made = await req("/staff", {
    method: "POST",
    token: mgr.token,
    body: { full_name: `Coach ${tag} ${stamp}`, phone: `${phonePrefix}${stamp}`, role: "coach", sports: ["basketball"] },
  });
  if (made.status !== 201) fail(`create coach ${tag}`, made);
  return { id: made.data.staff.id, phone: `${phonePrefix}${stamp}`, temp: made.data.temp_password };
}

const coachA = await newCoach("A", "081");
const coachB = await newCoach("B", "082");
const coachBadSport = await req("/staff", {
  method: "POST",
  token: mgr.token,
  body: { full_name: `Coach Swim ${stamp}`, phone: `083${stamp}`, role: "coach", sports: ["badminton"] },
});

// A member on a per-session plan (8 sessions, basketball).
const plans = (await req("/plans")).data.items;
const quotaPlan = plans.find((p) => p.session_quota != null && p.sport_scope === "basketball");
if (!quotaPlan) fail("no basketball per-session plan in the seed", plans);
async function memberWithPlan(prefix, name, plan) {
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
  return { ...session, userId: made.data.user.id };
}
const quotaLeft = async (m) => {
  const me = await req("/me", { token: m.token });
  return me.data.subscriptions.find((s) => s.sport_scope === "basketball")?.session_left;
};
const m1 = await memberWithPlan("084", "Lifecycle One", quotaPlan);
const m2 = await memberWithPlan("085", "Lifecycle Two", quotaPlan);

// A basketball class that runs every day at 20:00 for the next fortnight.
const occ = await req(`/occupancy?date=${new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)}`, { token: mgr.token });
const courts = occ.data.courts.filter((c) => c.sport === "basketball" && c.status === "ready");
let cls = null;
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
        capacity: 2,
        rrule: `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYHOUR=${hour}`,
        duration_min: 60,
        start_on: new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10),
        end_on: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
      },
    });
    if (made.status !== 201) fail("create class", made);
    const pub = await req(`/classes/${made.data.id}/publish`, { method: "POST", token: mgr.token });
    if (pub.status === 200 && pub.data.sessions.length >= 6) {
      cls = { id: made.data.id, court, hour, sessions: pub.data.sessions };
      break;
    }
  }
  if (cls) break;
}
if (!cls) fail("could not publish a class with free slots");
const cid = cls.id;

for (const m of [m1, m2]) {
  const e = await req(`/classes/${cid}/enroll`, { method: "POST", token: m.token });
  if (e.status !== 201) fail("enroll", e);
}
const baseline = await quotaLeft(m1);

const detail = async () => (await req(`/classes/${cid}`, { token: mgr.token })).data;
const sessionsOf = async () => (await detail()).sessions;
const upcoming = (await sessionsOf()).filter((s) => s.status === "scheduled" && new Date(s.start_at) > hoursFromNow(30));
ok(upcoming.length >= 4, "a published class has sessions to work with", upcoming.length);

// ---- cancel one session (BR-26) ---------------------------------------------
{
  const target = upcoming[0];
  const noReason = await req(`/sessions/${target.id}/cancel`, { method: "POST", token: mgr.token, body: {} });
  ok(noReason.status === 400 && noReason.data.field === "reason", "cancel needs a reason, naming the field", noReason);
  const asMember = await req(`/sessions/${target.id}/cancel`, { method: "POST", token: m1.token, body: { reason: "x" } });
  ok(asMember.status === 403, "a member cannot cancel a session", asMember);
  const asDesk = await req(`/sessions/${target.id}/cancel`, { method: "POST", token: desk.token, body: { reason: "x" } });
  ok(asDesk.status === 403, "reception cannot cancel a session", asDesk);

  const done = await req(`/sessions/${target.id}/cancel`, { method: "POST", token: mgr.token, body: { reason: "Floor repairs" } });
  ok(done.status === 200 && done.data.notified === 2 && done.data.refunded === 2, "cancelling notifies both members and gives each a session back (BR-26)", done);
  ok((await quotaLeft(m1)) === baseline + 1, "a per-session plan gets exactly +1", { baseline, now: await quotaLeft(m1) });
  const after = (await sessionsOf()).find((s) => s.id === target.id);
  ok(after.status === "cancelled", "the session shows as cancelled", after);
  const again = await req(`/sessions/${target.id}/cancel`, { method: "POST", token: mgr.token, body: { reason: "Again" } });
  ok(again.status === 409 && again.data.code === "CONFLICT_STATE", "cancelling twice is a state conflict, not a second refund", again);
  ok((await quotaLeft(m1)) === baseline + 1, "…and no second refund", await quotaLeft(m1));
  const inbox = await req("/me/notifications", { token: m1.token });
  const note = (inbox.data.items ?? []).find((n) => n.template === "class_changed" && n.payload?.kind === "session_cancelled");
  ok(!!note && note.payload.reason === "Floor repairs", "the member's inbox says why", inbox.data);
}

// ---- move one session (BR-21, BR-28) ----------------------------------------
{
  const target = upcoming[1];
  const old = new Date(target.start_at);
  const noStart = await req(`/sessions/${target.id}/reschedule`, { method: "POST", token: mgr.token, body: {} });
  ok(noStart.status === 400 && noStart.data.field === "start_at", "moving needs a new start, naming the field", noStart);
  const past = await req(`/sessions/${target.id}/reschedule`, {
    method: "POST",
    token: mgr.token,
    body: { start_at: hoursFromNow(-2).toISOString() },
  });
  ok(past.status === 400, "cannot move a session into the past", past);

  // Onto the next session of the same class — the same court, so BR-21 must refuse.
  const sibling = upcoming[2];
  const clash = await req(`/sessions/${target.id}/reschedule`, {
    method: "POST",
    token: mgr.token,
    body: { start_at: sibling.start_at },
  });
  ok(clash.status === 409 && clash.data.code === "CONFLICT_SLOT", "moving onto another session of the court is CONFLICT_SLOT (BR-21)", clash);
  const still = (await sessionsOf()).find((s) => s.id === target.id);
  ok(new Date(still.start_at).getTime() === old.getTime(), "a refused move leaves the session where it was", still);

  // A free hour the same day (the class runs at `cls.hour`, an hour the seed leaves empty).
  const to = new Date(old.getTime() + 2 * 3600000);
  const moved = await req(`/sessions/${target.id}/reschedule`, {
    method: "POST",
    token: mgr.token,
    body: { start_at: to.toISOString() },
  });
  ok(moved.status === 200 && new Date(moved.data.start_at).getTime() === to.getTime(), "a session moves to a free time", moved);
  const list = await sessionsOf();
  const now = list.find((s) => s.id === target.id);
  ok(new Date(now.start_at).getTime() === to.getTime(), "the class shows the new time", now);
  ok(
    new Date(now.end_at).getTime() - new Date(now.start_at).getTime() === 3600000,
    "the session keeps its length",
    now,
  );
  const coachToken = (await login(coachA.phone, coachA.temp)).token;
  const sched = await req("/coach/schedule", { token: coachToken });
  ok(
    sched.data.items.some((s) => s.id === target.id && new Date(s.start_at).getTime() === to.getTime()),
    "the coach's schedule moved with it",
    sched.data.items.length,
  );
  const inbox = await req("/me/notifications", { token: m2.token });
  ok(
    (inbox.data.items ?? []).some((n) => n.template === "class_changed" && n.payload?.kind === "session_moved"),
    "members are told about the move",
    inbox.data,
  );
  // The nightly generator must not mint a second session at the old time.
  const publishAgain = await req(`/classes/${cid}/publish`, { method: "POST", token: mgr.token });
  ok(publishAgain.status === 200, "re-running the generator is harmless", publishAgain);
  const afterGen = (await sessionsOf()).filter((s) => new Date(s.start_at).getTime() === old.getTime());
  ok(afterGen.length === 0, "the generator does not recreate the moved-from slot (original_start_at)", afterGen);

  // BR-28: a session starting within 12 hours needs a reason. A one-off class
  // starting a couple of hours from now makes that deterministic; it only
  // exists when there is still room in the (centre-time) day for it.
  const ictHour = new Date(Date.now() + 7 * 3600000).getUTCHours();
  if (ictHour <= 20) {
    const soonHour = ictHour + 2;
    let soon = null;
    for (const court of courts) {
      const made = await req("/classes", {
        method: "POST",
        token: mgr.token,
        body: {
          sport: "basketball",
          level: "beginner",
          coach_id: coachB.id,
          court_id: court.id,
          capacity: 2,
          rrule: `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYHOUR=${soonHour}`,
          duration_min: 60,
          start_on: new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10),
          end_on: new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10),
        },
      });
      const pub = await req(`/classes/${made.data.id}/publish`, { method: "POST", token: mgr.token });
      if (pub.status === 200 && pub.data.sessions.length) {
        soon = pub.data.sessions[0];
        break;
      }
    }
    if (soon) {
      const bare = await req(`/sessions/${soon.id}/reschedule`, {
        method: "POST",
        token: mgr.token,
        body: { start_at: new Date(new Date(soon.start_at).getTime() + 3600000).toISOString() },
      });
      ok(bare.status === 422 && bare.data.br === "BR-28" && bare.data.field === "reason", "a late move without a reason is BR-28", bare);
      // A server that has run this script before may hold the next hour already;
      // a busy slot is not what this check is about, so try the following ones.
      let reasoned;
      for (const hours of [1, 2, 3, 4, 5, 6]) {
        reasoned = await req(`/sessions/${soon.id}/reschedule`, {
          method: "POST",
          token: mgr.token,
          body: { start_at: new Date(new Date(soon.start_at).getTime() + hours * 3600000).toISOString(), reason: "Hall double-booked" },
        });
        if (reasoned.status !== 409) break;
      }
      ok(reasoned.status === 200, "…and with a reason it goes through", reasoned);
    } else {
      console.log("skip  BR-28 late move (no court free in the next two hours)");
    }
  } else {
    console.log("skip  BR-28 late move (too late in the day to schedule a class two hours out)");
  }
}

// ---- change the coach (BR-23, BR-27) ----------------------------------------
{
  const noCoach = await req(`/classes/${cid}/coach`, { method: "POST", token: mgr.token, body: {} });
  ok(noCoach.status === 400 && noCoach.data.field === "coach_id", "changing the coach needs one, naming the field", noCoach);
  const same = await req(`/classes/${cid}/coach`, { method: "POST", token: mgr.token, body: { coach_id: coachA.id } });
  ok(same.status === 400, "the same coach is refused", same);
  const wrongSport = await req(`/classes/${cid}/coach`, {
    method: "POST",
    token: mgr.token,
    body: { coach_id: coachBadSport.data.staff.id },
  });
  ok(wrongSport.status === 422 && wrongSport.data.br === "BR-23", "a coach who does not teach the sport is BR-23", wrongSport);
  const notCoach = await req(`/classes/${cid}/coach`, { method: "POST", token: mgr.token, body: { coach_id: desk.user.id } });
  ok(notCoach.status === 422 && notCoach.data.br === "BR-23", "a non-coach is refused", notCoach);
  const asCoach = await req(`/classes/${cid}/coach`, {
    method: "POST",
    token: (await login(coachA.phone, coachA.temp)).token,
    body: { coach_id: coachB.id },
  });
  ok(asCoach.status === 403, "a coach cannot reassign their own class", asCoach);

  const swap = await req(`/classes/${cid}/coach`, { method: "POST", token: mgr.token, body: { coach_id: coachB.id, reason: "Illness" } });
  ok(swap.status === 200 && swap.data.sessions_moved > 0, "the manager puts another coach on the class", swap);
  const detailNow = await detail();
  ok(detailNow.class.coach_id === coachB.id, "the class shows the new coach", detailNow.class);
  const aSched = await req("/coach/schedule", { token: (await login(coachA.phone, coachA.temp)).token });
  const bSched = await req("/coach/schedule", { token: (await login(coachB.phone, coachB.temp)).token });
  ok(!aSched.data.items.some((s) => s.class_id === cid), "the old coach loses the sessions from their schedule (BR-27)", aSched.data.items.length);
  ok(bSched.data.items.some((s) => s.class_id === cid), "the new coach has them", bSched.data.items.length);
}

// ---- edit capacity, close, reopen -------------------------------------------
{
  const low = await req(`/classes/${cid}`, { method: "PATCH", token: mgr.token, body: { capacity: 1 } });
  ok(low.status === 422 && low.data.br === "BR-22", "capacity cannot drop under the enrolled count", low);
  const bad = await req(`/classes/${cid}`, { method: "PATCH", token: mgr.token, body: { capacity: 0 } });
  ok(bad.status === 400 && bad.data.field === "capacity", "a nonsense capacity names the field", bad);
  const up = await req(`/classes/${cid}`, { method: "PATCH", token: mgr.token, body: { capacity: 3 } });
  ok(up.status === 200 && up.data.class.capacity === 3, "capacity can grow", up);
  const closed = await req(`/classes/${cid}`, { method: "PATCH", token: mgr.token, body: { status: "closed" } });
  ok(closed.status === 200 && closed.data.class.status === "closed", "enrolment can be closed", closed);
  const late = await memberWithPlan("086", "Lifecycle Late", quotaPlan);
  const refused = await req(`/classes/${cid}/enroll`, { method: "POST", token: late.token });
  ok(refused.status === 422 && refused.data.br === "BR-67", "a closed class takes no new members", refused);
  const reopen = await req(`/classes/${cid}`, { method: "PATCH", token: mgr.token, body: { status: "open" } });
  ok(reopen.status === 200 && reopen.data.class.status === "open", "…and can be reopened", reopen);
  const asMember = await req(`/classes/${cid}`, { method: "PATCH", token: m1.token, body: { capacity: 99 } });
  ok(asMember.status === 403, "a member cannot edit a class", asMember);
  const badStatus = await req(`/classes/${cid}`, { method: "PATCH", token: mgr.token, body: { status: "draft" } });
  ok(badStatus.status === 400 && badStatus.data.field === "status", "an unknown status names the field", badStatus);
}

// ---- cancel the whole class --------------------------------------------------
{
  const noReason = await req(`/classes/${cid}`, { method: "PATCH", token: mgr.token, body: { status: "cancelled" } });
  ok(noReason.status === 400 && noReason.data.field === "reason", "cancelling a class needs a reason", noReason);
  const before = await quotaLeft(m2);
  const gone = await req(`/classes/${cid}`, { method: "PATCH", token: mgr.token, body: { status: "cancelled", reason: "Coach left" } });
  ok(gone.status === 200 && gone.data.sessions_cancelled > 0 && gone.data.refunded === 2, "the class is cancelled with every upcoming session", gone);
  ok((await quotaLeft(m2)) === before + 1, "each member gets their session back once", { before, now: await quotaLeft(m2) });
  const d = await detail();
  ok(d.class.status === "cancelled" && d.class.enrolled_count === 0, "the class is cancelled and empty", d.class);
  ok(d.sessions.every((s) => s.status !== "scheduled" || new Date(s.end_at) < new Date()), "no upcoming session is left scheduled", d.sessions);
  const noEnroll = await req(`/classes/${cid}/enroll`, { method: "POST", token: m1.token });
  ok(noEnroll.status === 422, "nobody can join a cancelled class", noEnroll);
  const patchAgain = await req(`/classes/${cid}`, { method: "PATCH", token: mgr.token, body: { capacity: 5 } });
  ok(patchAgain.status === 409, "a cancelled class cannot be edited", patchAgain);
  for (const action of ["cancel_session", "reschedule_session", "change_coach", "edit_class", "cancel_class"]) {
    const rows = await req(`/audit?action=${action}&limit=5`, { token: mgr.token });
    ok((rows.data.items ?? []).length > 0, `${action} left an audit row (BR-61)`, rows);
  }
  // The freed court is bookable again.
  const mem = await req("/me", { token: m1.token });
  ok(mem.status === 200, "members still sign in", mem.status);
}

// ---- manager member list (FR-MEM-04) -----------------------------------------
{
  const bare = await memberWithPlan("087", "Directory Bare", null);
  const dir = (qs, token = mgr.token) => req(`/directory/members?${qs}`, { token });
  const denied = await dir("", desk.token);
  ok(denied.status === 403, "only a manager reads the member list", denied);
  const byStamp = await dir(`q=${stamp}`);
  const names = (byStamp.data.items ?? []).map((m) => m.full_name);
  ok(byStamp.status === 200 && byStamp.data.total >= 3, "search by phone digits finds the new members", byStamp);
  ok(names.some((n) => n.startsWith("Lifecycle One")) && names.some((n) => n.startsWith("Directory Bare")), "both members are listed", names);
  const one = byStamp.data.items.find((m) => m.id === m1.userId);
  ok(one && one.plan_state === "active" && one.sport_scope === "basketball" && one.plan_name, "a member with a plan shows it", one);
  const none = byStamp.data.items.find((m) => m.id === bare.userId);
  ok(none && none.plan_state === "none" && none.plan_name === null && none.debt_vnd === 0, "a member without a plan says so", none);
  const byName = await dir(`q=${encodeURIComponent("lifecycle one")}`);
  ok(byName.data.items.some((m) => m.id === m1.userId), "search by name ignores case", byName);
  const noPlan = await dir(`q=${stamp}&plan=none`);
  ok(noPlan.data.items.every((m) => m.plan_state === "none") && noPlan.data.items.some((m) => m.id === bare.userId), "the no-plan filter keeps only members without one", noPlan);
  const bb = await dir(`q=${stamp}&sport=basketball`);
  ok(bb.data.items.some((m) => m.id === m1.userId) && !bb.data.items.some((m) => m.id === bare.userId), "the sport filter follows the plan's sport", bb);
  const vb = await dir(`q=${stamp}&sport=volleyball`);
  ok(!vb.data.items.some((m) => m.id === m1.userId), "a basketball plan is not a volleyball one", vb);
  const page = await dir(`q=${stamp}&limit=1&offset=1`);
  ok(page.data.items.length === 1 && page.data.total === byStamp.data.total, "paging keeps the total", page);
  for (const [qs, field] of [["status=gone", "status"], ["sport=chess", "sport"], ["plan=maybe", "plan"], ["limit=0", "limit"]]) {
    const bad = await dir(qs);
    ok(bad.status === 400 && bad.data.field === field, `a bad ${field} names the field`, bad);
  }
}

console.log(`\n${passed} checks passed`);
