#!/usr/bin/env node
/**
 * Live checks for the FIXLIST Phase 2 fixes (staff accounts, D-01, plans, audit,
 * revenue, notifications). Run against a dev server on in-memory PGLite
 * (`DATABASE_URL= PGLITE_DATA_DIR=memory npm run dev`), never against production:
 * it creates staff accounts and plans.
 *
 *   BASE=http://127.0.0.1:8080 node scripts/arena3-phase2-check.mjs
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
const member = await login("0901230101");
const stamp = String(Date.now()).slice(-7);
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

// ---- R-01 / R-02 / R-03: staff accounts ------------------------------------
{
  const phone = `095${stamp}`;
  const noMember = await req("/staff", { token: member.token });
  ok(noMember.status === 403, "R-01 a member cannot list staff", noMember);
  const noDesk = await req("/staff", {
    method: "POST",
    token: desk.token,
    body: { full_name: "Nope", phone, role: "coach", sports: ["badminton"] },
  });
  ok(noDesk.status === 403, "R-01 reception cannot create staff", noDesk);

  const regPhone = `096${stamp}`;
  const reg = await req("/auth/register", {
    method: "POST",
    body: { full_name: "Sneaky Staff", phone: regPhone, password: PASS, role: "manager" },
  });
  const regLogin = reg.status < 300 ? await req("/auth/login", { method: "POST", body: { login: regPhone, password: PASS } }) : null;
  ok(
    reg.status >= 400 || regLogin?.data?.user?.role === "member",
    "R-02 self-registration cannot produce a staff role",
    { reg, role: regLogin?.data?.user?.role },
  );

  const badRole = await req("/staff", { method: "POST", token: mgr.token, body: { full_name: "X", phone, role: "manager" } });
  ok(badRole.status === 400 && badRole.data.field === "role", "R-01 only receptionist or coach can be issued, naming the field", badRole);
  const noSports = await req("/staff", {
    method: "POST",
    token: mgr.token,
    body: { full_name: "Coach Nosports", phone, role: "coach", sports: [] },
  });
  ok(noSports.status === 400 && noSports.data.field === "sports", "R-01 a coach needs a sport", noSports);

  const made = await req("/staff", {
    method: "POST",
    token: mgr.token,
    body: { full_name: `Coach Check ${stamp}`, phone, role: "coach", sports: ["badminton"] },
  });
  ok(
    made.status === 201 && made.data.temp_password && made.data.staff.issued_by,
    "R-01 manager issues a coach with a one-time password and a recorded issuer",
    made,
  );
  const dup = await req("/staff", { method: "POST", token: mgr.token, body: { full_name: "Dup", phone, role: "receptionist" } });
  ok(dup.status === 422 && dup.data.br === "BR-01", "R-01 a phone that already has an account is BR-01", dup);

  const id = made.data.staff.id;
  const first = await req("/auth/login", { method: "POST", body: { login: phone, password: made.data.temp_password } });
  ok(first.status === 200 && first.data.user.must_change_password === true, "R-01 the temporary password forces a change", first);

  const lock = await req(`/staff/${id}`, { method: "PATCH", token: mgr.token, body: { status: "locked" } });
  ok(lock.status === 200 && lock.data.staff.status === "locked", "R-03 manager locks the account", lock);
  const afterLock = await req("/me", { token: first.data.token });
  ok(afterLock.status === 401 || afterLock.status === 403, "R-03 a locked account keeps no working session", afterLock);
  const loginLocked = await req("/auth/login", { method: "POST", body: { login: phone, password: made.data.temp_password } });
  ok(loginLocked.status >= 400, "R-03 a locked account cannot sign in", loginLocked);
  const unlock = await req(`/staff/${id}`, { method: "PATCH", token: mgr.token, body: { status: "active" } });
  ok(unlock.status === 200 && unlock.data.staff.status === "active", "R-03 manager unlocks it", unlock);

  const role = await req(`/staff/${id}`, { method: "PATCH", token: mgr.token, body: { role: "receptionist" } });
  ok(role.status === 200 && role.data.staff.role === "receptionist", "R-03 role changes coach to receptionist", role);
  const selfLock = await req(`/staff/${mgr.user.id}`, { method: "PATCH", token: mgr.token, body: { status: "locked" } });
  ok(selfLock.status === 403, "R-03 a manager cannot lock themselves", selfLock);

  const reset = await req(`/staff/${id}/reset-password`, { method: "POST", token: mgr.token });
  ok(
    reset.status === 200 && reset.data.temp_password && reset.data.temp_password !== made.data.temp_password,
    "R-03 password reset returns a new one-time password",
    reset,
  );
  const re = await req("/auth/login", { method: "POST", body: { login: phone, password: reset.data.temp_password } });
  ok(re.status === 200, "R-03 the reset password signs in", re);
  const rev = await req(`/staff/${id}/revoke-sessions`, { method: "POST", token: mgr.token });
  ok(rev.status === 200 && rev.data.revoked >= 1, "R-03 sign-out-everywhere revokes open sessions", rev);
  const gone = await req("/me", { token: re.data.token });
  ok(gone.status === 401 || gone.status === 403, "R-03 the revoked session no longer works", gone);

  const audit = await req("/audit?entity=user&limit=200", { token: mgr.token });
  const acts = new Set(audit.data.items.filter((a) => a.entity_id === id).map((a) => a.action));
  ok(
    ["create_staff", "lock_staff", "unlock_staff", "change_staff_role", "reset_staff_password", "revoke_staff_sessions"].every((a) => acts.has(a)),
    "R-01 every staff change is in the audit log with its actor",
    [...acts],
  );
}

// ---- D-01: no plan activation before the money is in -----------------------
{
  const plans = (await req("/plans", { token: desk.token })).data.items;
  const plan = plans.find((p) => p.is_on_sale && p.price_vnd > 1000);
  await req("/shifts/open", { method: "POST", token: desk.token });
  const ph = `097${stamp}`;
  const m = await req("/members", { method: "POST", token: desk.token, body: { full_name: "D01 Check", phone: ph, pii_consent: true } });
  const uid = m.data.user.id;
  const sub = await req("/subscriptions", { method: "POST", token: desk.token, body: { plan_id: plan.id, user_id: uid } });
  const sid = sub.data.subscription.id;
  const pay = (a) =>
    req("/payments", {
      method: "POST",
      token: desk.token,
      idem: true,
      body: { ref_type: "subscription", ref_id: sid, method: "cash", amount_vnd: a },
    });
  const state = async () => ((await req(`/members/${uid}`, { token: desk.token })).data.subscriptions ?? []).find((x) => x.id === sid);

  ok((await state()).status === "pending", "D-01 a new plan waits for payment", await state());
  const zero = await pay(0);
  ok(zero.status === 400 && zero.data.field === "amount_vnd", "D-01 a zero payment is refused naming amount_vnd", zero);
  const neg = await pay(-5000);
  ok(neg.status === 400 && neg.data.field === "amount_vnd", "D-01 a negative payment is refused", neg);
  ok((await state()).status === "pending", "D-01 nothing activated after refused payments", await state());
  const over = await pay(plan.price_vnd + 1);
  ok(over.status >= 400, "D-01 paying more than is owed is refused", over);
  const half = await pay(Math.floor(plan.price_vnd / 2));
  ok(half.status === 201, "D-01 a partial payment is taken", half);
  const full = await pay(plan.price_vnd - Math.floor(plan.price_vnd / 2));
  ok(full.status === 201 && (await state()).status === "active", "D-01 the plan activates once it is paid in full", await state());
  const endBefore = (await state()).end_on;
  const odd = await pay(1);
  ok(odd.status >= 400 && (await state()).end_on === endBefore, "D-01 a token payment cannot extend an active plan", odd);
}

// ---- G-04 / G-05: plans are never deleted, and have a detail view ----------
{
  const body = { name: "Bad plan", sport_scope: "badminton", price_vnd: "800000", duration_days: "30", court_hours: "2", court_discount_pct: "10" };
  const bad = await req("/plans", { method: "POST", token: mgr.token, body: { ...body, price_vnd: "abc" } });
  ok(bad.status === 400 && bad.data.field === "price_vnd", "G-04 a bad price is a 400 naming the field", bad);
  const high = await req("/plans", { method: "POST", token: mgr.token, body: { ...body, court_discount_pct: "150" } });
  ok(high.status === 400 && high.data.field === "court_discount_pct", "G-04 a discount over 100% is refused", high);
  const made = await req("/plans", { method: "POST", token: mgr.token, body: { ...body, name: `Check plan ${stamp}`, is_on_sale: true } });
  ok(made.status === 201, "G-04 a valid plan is created", made);
  const pid = made.data.id ?? made.data.plan?.id;
  const del = await req(`/plans/${pid}`, { method: "DELETE", token: mgr.token });
  ok(del.status >= 400, "G-04 there is no delete route for a plan", del);
  const off = await req(`/plans/${pid}`, { method: "PATCH", token: mgr.token, body: { is_on_sale: false } });
  ok(off.status === 200, "G-04 a plan can be taken off sale", off);
  const one = await req(`/plans/${pid}`, { token: mgr.token });
  ok(one.status === 200 && one.data.plan.is_on_sale === false && one.data.holders.ever === 0, "G-05 plan detail shows status and holders", one);
  const memberView = await req(`/plans/${pid}`, { token: member.token });
  ok(memberView.status === 403, "G-05 plan detail is manager-only", memberView);
}

// ---- G-06 / G-09: audit filters; nothing deletes a row ---------------------
{
  const all = await req("/audit?limit=10", { token: mgr.token });
  ok(
    all.status === 200 && all.data.items.length <= 10 && Array.isArray(all.data.actors) && Array.isArray(all.data.entities),
    "G-06 audit returns a page with filter choices",
    Object.keys(all.data ?? {}),
  );
  const actor = all.data.actors.find((a) => a.role === "manager") ?? all.data.actors[0];
  const byActor = await req(`/audit?actor=${actor.id}`, { token: mgr.token });
  ok(byActor.data.items.length > 0 && byActor.data.items.every((a) => a.actor_id === actor.id), "G-06 filter by actor", byActor.data.items.length);
  const ent = all.data.entities[0];
  const byEnt = await req(`/audit?entity=${ent}`, { token: mgr.token });
  ok(byEnt.data.items.every((a) => a.entity === ent), "G-06 filter by entity", ent);
  const byDay = await req(`/audit?from=${today}&to=${today}`, { token: mgr.token });
  ok(byDay.status === 200 && byDay.data.items.length > 0, "G-06 filter by date", byDay.status);
  const future = await req("/audit?from=2999-01-01", { token: mgr.token });
  ok(future.status === 200 && future.data.items.length === 0, "G-06 a window with nothing in it is empty", future.data.items.length);
  const badDate = await req("/audit?from=yesterday", { token: mgr.token });
  ok(badDate.status === 400 && badDate.data.field === "from", "G-06 a bad date is a 400 naming the field", badDate);
  const delAudit = await req("/audit", { method: "DELETE", token: mgr.token });
  ok(delAudit.status >= 400, "G-09 there is no way to delete audit rows through the API", delAudit);
}

// ---- G-07: revenue by source and by shift ----------------------------------
{
  const rev = await req(`/reports/revenue?from=${today}&to=${today}`, { token: mgr.token });
  const shiftSum = (rev.data.by_shift ?? []).reduce((a, r) => a + r.takings_vnd - r.refunds_vnd, 0);
  ok(rev.status === 200 && shiftSum === rev.data.totals.revenue_vnd, "G-07 shifts add up to revenue", { shiftSum, totals: rev.data.totals });
  const bySource = Object.values(rev.data.by_source).reduce((a, n) => a + n, 0);
  ok(bySource === rev.data.totals.gross_vnd, "G-07 sources add up to gross takings", { bySource, totals: rev.data.totals });
}

// ---- G-08: the member's notifications have their own endpoint --------------
{
  const n = await req("/me/notifications", { token: member.token });
  ok(n.status === 200 && Array.isArray(n.data.items) && Number.isInteger(n.data.unread), "G-08 notifications and unread count", n);
}

console.log(`\n${passed} checks passed`);
