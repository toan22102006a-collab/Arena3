#!/usr/bin/env node
/**
 * Live checks for the FIXLIST Phase 3 features (availability calendar,
 * rescheduling a booking, a member's own attendance). Run against a dev server
 * on in-memory PGLite, never production: it creates members and bookings.
 *
 *   BASE=http://127.0.0.1:8080 node scripts/arena3-phase3-check.mjs
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
const seedMember = await login("0901230101");
const stamp = String(Date.now()).slice(-7);
const ict = (d) => new Date(Date.now() + d * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
const at = (date, hour) => `${date}T${String(hour).padStart(2, "0")}:00:00+07:00`;

async function newMember(prefix, name) {
  const made = await req("/members", {
    method: "POST",
    token: desk.token,
    body: { full_name: `${name} ${stamp}`, phone: `${prefix}${stamp}`, pii_consent: true },
  });
  if (made.status !== 201) fail(`create member ${name}`, made);
  return login(made.data.user.phone, made.data.temp_password);
}

// ---- M-03: which days still have a free slot ------------------------------
{
  const m = await newMember("097", "Calendar Check");
  const cal = await req("/availability?sport=badminton&days=14", { token: m.token });
  ok(cal.status === 200 && cal.data.days.length === 14, "M-03 two weeks come back in one read", cal);
  const day = cal.data.days[3];
  const occ = await req(`/occupancy?date=${day.date}`, { token: m.token });
  const courts = occ.data.courts.filter((c) => c.sport === "badminton" && c.status === "ready");
  ok(day.total > 0 && day.free <= day.total && day.free > 0, "M-03 a day has a total and a free count", day);

  // Take a slot and the day's free count drops by exactly one.
  const court = courts[0];
  const busy = new Set(occ.data.slots.filter((s) => s.court_id === court.id).map((s) => new Date(s.start).getTime()));
  let hour = 7;
  while (busy.has(new Date(at(day.date, hour)).getTime())) hour += 1;
  const h = await req("/bookings", { method: "POST", token: m.token, body: { court_id: court.id, start_at: at(day.date, hour) }, idem: true });
  ok(h.status === 201, "M-03 hold a slot on that day", h);
  const after = await req(`/availability?sport=badminton&from=${day.date}&days=1`, { token: m.token });
  ok(after.data.days[0].free === day.free - 1, "M-03 the held slot is no longer counted free", { before: day, after: after.data.days[0] });
  await req(`/bookings/${h.data.booking.id}/cancel`, { method: "POST", token: m.token });

  const tooMany = await req("/availability?days=400", { token: m.token });
  ok(tooMany.status === 400 && tooMany.data.field === "days", "M-03 days is bounded and names the field", tooMany);
  const badSport = await req("/availability?sport=golf", { token: m.token });
  ok(badSport.status === 400 && badSport.data.field === "sport", "M-03 unknown sport names the field", badSport);
  const noAuth = await req("/availability");
  ok(noAuth.status === 401, "M-03 needs a signed-in user", noAuth);
}

// ---- M-04: move a booking ----------------------------------------------------
{
  const m = await newMember("098", "Move Check");
  const rival = await newMember("099", "Move Rival");
  // A weekday: weekend badminton turns peak-priced at 08:00, which would reprice every move below.
  let ahead = 3;
  while ([0, 6].includes(new Date(`${ict(ahead)}T12:00:00Z`).getUTCDay())) ahead += 1;
  const date = ict(ahead);
  const occ = await req(`/occupancy?date=${date}`, { token: m.token });
  // The demo diary differs on every start, so look across the courts for three free hours in a row
  // that start early enough to share one off-peak price (a move across a price band is refused before the clash is looked at).
  let court;
  let hour;
  for (const c of occ.data.courts.filter((x) => x.sport === "badminton" && x.status === "ready")) {
    const busy = new Set(occ.data.slots.filter((s) => s.court_id === c.id).map((s) => new Date(s.start).getTime()));
    const free = (h) => !busy.has(new Date(at(date, h)).getTime());
    const h = [7, 8, 9].find((x) => free(x) && free(x + 1) && free(x + 2));
    if (h != null) {
      court = c;
      hour = h;
      break;
    }
  }
  if (!court) fail("M-04 found three free hours in a row on some badminton court", occ.data);

  const h = await req("/bookings", { method: "POST", token: m.token, body: { court_id: court.id, start_at: at(date, hour) }, idem: true });
  ok(h.status === 201, "M-04 hold a slot", h);
  const bid = h.data.booking.id;
  const viaTransfer = await req(`/bookings/${bid}/confirm`, { method: "POST", token: m.token, body: { method: "transfer" }, idem: true });
  ok(viaTransfer.status === 202, "M-04 member promises a transfer", viaTransfer);

  const early = await req(`/bookings/${bid}/reschedule`, { method: "POST", token: m.token, body: { start_at: at(date, hour + 1) } });
  ok(early.status === 409, "M-04 a booking still on hold cannot be moved", early);

  const conf = await req(`/bookings/${bid}/transfer-confirm`, { method: "POST", token: desk.token });
  ok(conf.status === 200 && conf.data.booking.status === "confirmed", "M-04 reception confirms the transfer", conf);

  const list = await req("/me/bookings", { token: m.token });
  const mine = list.data.items?.find((b) => b.id === bid);
  ok(list.status === 200 && mine?.can_move === true && list.data.window_hours >= 0, "M-04 my bookings say it can be moved", list);

  const rivalHold = await req("/bookings", { method: "POST", token: rival.token, body: { court_id: court.id, start_at: at(date, hour + 1) }, idem: true });
  ok(rivalHold.status === 201, "M-04 a rival holds the next hour", rivalHold);
  const clash = await req(`/bookings/${bid}/reschedule`, { method: "POST", token: m.token, body: { start_at: at(date, hour + 1) } });
  ok(clash.status === 409 && clash.data.code === "CONFLICT_SLOT", "M-04 moving onto a taken slot is CONFLICT_SLOT", clash);
  const still = await req(`/bookings/${bid}`, { token: m.token });
  ok(
    new Date(still.data.start_at).getTime() === new Date(at(date, hour)).getTime() && still.data.status === "confirmed",
    "M-04 a refused move leaves the booking where it was",
    still.data,
  );
  await req(`/bookings/${rivalHold.data.booking.id}/cancel`, { method: "POST", token: rival.token });

  const same = await req(`/bookings/${bid}/reschedule`, { method: "POST", token: m.token, body: { start_at: at(date, hour) } });
  ok(same.status === 400 && same.data.field === "start_at", "M-04 the slot you already have is a field error", same);
  const noStart = await req(`/bookings/${bid}/reschedule`, { method: "POST", token: m.token, body: {} });
  ok(noStart.status === 400 && noStart.data.field === "start_at", "M-04 missing time names the field", noStart);
  const past = await req(`/bookings/${bid}/reschedule`, { method: "POST", token: m.token, body: { start_at: at(ict(-1), 9) } });
  ok(past.status === 422 && past.data.br === "BR-66", "M-04 the past is BR-66", past);
  const closed = await req(`/bookings/${bid}/reschedule`, { method: "POST", token: m.token, body: { start_at: at(date, 3) } });
  ok(closed.status === 422 && closed.data.br === "BR-35", "M-04 outside opening hours is BR-35", closed);
  const staff = await req(`/bookings/${bid}/reschedule`, { method: "POST", token: desk.token, body: { start_at: at(date, hour + 2) } });
  ok(staff.status === 403, "M-04 only the member moves their own booking", staff);
  const other = await req(`/bookings/${bid}/reschedule`, { method: "POST", token: rival.token, body: { start_at: at(date, hour + 2) } });
  ok(other.status === 403, "M-04 another member cannot move it", other);

  // A free hour of the same price: the booking moves, and nothing else changes.
  let moved = null;
  for (const h2 of [hour + 1, hour + 2]) {
    const r = await req(`/bookings/${bid}/reschedule`, { method: "POST", token: m.token, body: { start_at: at(date, h2) } });
    if (r.status === 200) {
      moved = { h2, r };
      break;
    }
    ok(r.status === 409 && r.data.new_price_vnd !== undefined, "M-04 a different price is refused with both amounts", r);
  }
  if (moved) {
    const b = moved.r.data.booking;
    ok(
      b.status === "confirmed" && new Date(b.start_at).getTime() === new Date(at(date, moved.h2)).getTime(),
      "M-04 the booking now sits at the new hour",
      b,
    );
    const after = await req(`/occupancy?date=${date}`, { token: m.token });
    const rows = after.data.slots.filter((s) => s.ref === bid);
    ok(
      rows.length === 1 && new Date(rows[0].start).getTime() === new Date(at(date, moved.h2)).getTime(),
      "M-04 exactly one occupancy, at the new hour",
      rows,
    );
    const freed = after.data.slots.some(
      (s) => s.court_id === court.id && new Date(s.start).getTime() === new Date(at(date, hour)).getTime(),
    );
    ok(!freed, "M-04 the old hour is free again", after.data.slots);
  }

  // Inside the cancel window the move is refused, like a refund would be.
  const settings = await req("/settings", { token: mgr.token });
  const old = settings.data.cancel_court_hours;
  const set = await req("/settings", { method: "PATCH", token: mgr.token, body: { cancel_court_hours: 168 } });
  ok(set.status === 200, "M-04 widen the window for the check", set);
  const late = await req(`/bookings/${bid}/reschedule`, { method: "POST", token: m.token, body: { start_at: at(date, hour + 2) } });
  ok(late.status === 409 && late.data.window_hours === 168, "M-04 inside the cancel window the move is refused", late);
  const listLate = await req("/me/bookings", { token: m.token });
  ok(listLate.data.items.find((b) => b.id === bid)?.can_move === false, "M-04 my bookings stop offering the move", listLate.data);
  await req("/settings", { method: "PATCH", token: mgr.token, body: { cancel_court_hours: old } });
  await req(`/bookings/${bid}/cancel`, { method: "POST", token: m.token });
}

// ---- M-05: a member sees their own attendance --------------------------------
{
  const mine = await req("/me/attendance", { token: seedMember.token });
  ok(mine.status === 200 && Array.isArray(mine.data.items), "M-05 a member reads their attendance", mine);
  const keys = Object.keys(mine.data.counts).sort().join(",");
  ok(keys === "absent,excused,late,present", "M-05 only the four existing statuses", mine.data.counts);
  ok(
    mine.data.items.every((r) => r.result === null || ["present", "late", "absent", "excused"].includes(r.result)),
    "M-05 every mark is one of the four",
    mine.data.items,
  );
  const staff = await req("/me/attendance", { token: desk.token });
  ok(staff.status === 403, "M-05 staff have no member attendance view", staff);
  const fresh = await newMember("094", "Attendance Check");
  const none = await req("/me/attendance", { token: fresh.token });
  ok(none.status === 200 && none.data.items.length === 0, "M-05 a member in no class sees nothing, not somebody else's rows", none);
}

console.log(`\n${passed} checks passed`);
