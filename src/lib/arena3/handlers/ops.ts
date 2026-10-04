import type { Sql } from "@/lib/db";
import { err, isConflictSlot } from "../errors";
import { flagOn, flagsMap, requireFlag, type FlagKey } from "../flags";
import { audit, enqueue, getSettings, num, readJson, str } from "../helpers";
import { limit, RULES } from "../ratelimit";
import { requireRole, type PublicUser } from "../session";
import { isValidVnPhone, normalizePhone } from "../phone";
import { generateAssistantReply, type ChatTurn } from "../gemini";
import { COACHES } from "../coaches";
import { ATTENDANCE_LOCK_HOURS, attendanceLocked, isAttResult, ticketBody } from "../rules";
import { checkAbsentStreaks, sessionScope } from "./training";
import { addDays, ictDateString } from "../time";
import { one } from "../tx";
import { payosConfigured } from "../payos";
import { parseInteger } from "../validate";

export async function flagsGet(sql: Sql) {
  return {
    status: 200,
    body: {
      flags: await flagsMap(sql),
      /*
       * Whether online payment can be offered at all.
       *
       * Not a feature flag a manager toggles — it is simply whether the centre
       * has put payOS credentials in the environment. The screens need to know
       * so they can leave the button out rather than offer one that fails, and
       * only the answer crosses the wire; the keys themselves never leave the
       * server.
       */
      capabilities: { online_payment: payosConfigured() },
    },
  };
}

export async function flagsPatch(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["manager"]);
  const b = await readJson(request);
  for (const key of ["F4", "F5", "F6"] as FlagKey[]) {
    if (typeof b[key] === "boolean") {
      await sql.query(`insert into feature_flags (key, enabled) values ($1,$2)
        on conflict (key) do update set enabled = excluded.enabled`, [key, b[key]]);
    }
  }
  await audit(sql, user.id, "patch_flags", "flags", null, null, b);
  return flagsGet(sql);
}

export async function subscriptionFreeze(sql: Sql, id: string, request: Request, user: PublicUser) {
  requireRole(user, ["manager", "receptionist"]);
  const days = num((await readJson(request)).days) ?? 7;
  if (days < 1 || days > 90) throw err.validation("Freeze length must be 1–90 days.");
  const settings = await getSettings(sql);
  const sub = await one<{
    id: string;
    status: string;
    frozen_days: number;
    end_on: string;
    user_id: string;
  }>(sql, `select id, status, frozen_days, end_on::text, user_id from subscriptions where id = $1 for update`, [id]);
  if (!sub) throw err.notFound();
  if (sub.status !== "active") throw err.br("BR-14", "Only an active plan can be frozen.");
  if (sub.frozen_days + days > settings.freeze_max_days_year) {
    throw err.br("BR-15", `Over the limit of ${settings.freeze_max_days_year} freeze days a year.`);
  }
  const end = addDays(sub.end_on, days);
  await sql.query(
    `update subscriptions set status = 'frozen', frozen_days = frozen_days + $2, end_on = $3 where id = $1`,
    [id, days, end],
  );
  await audit(sql, user.id, "freeze_sub", "subscription", id, sub, { days, end });
  return { status: 200, body: await one(sql, `select * from subscriptions where id = $1`, [id]) };
}

export async function subscriptionUnfreeze(sql: Sql, id: string, user: PublicUser) {
  requireRole(user, ["manager", "receptionist"]);
  const sub = await one<{ status: string }>(sql, `select status from subscriptions where id = $1 for update`, [id]);
  if (!sub) throw err.notFound();
  if (sub.status !== "frozen") throw err.conflictState("That plan is not frozen.");
  await sql.query(`update subscriptions set status = 'active' where id = $1`, [id]);
  await audit(sql, user.id, "unfreeze_sub", "subscription", id);
  return { status: 200, body: await one(sql, `select * from subscriptions where id = $1`, [id]) };
}

export async function waitlistAccept(sql: Sql, offerId: string, user: PublicUser) {
  const offer = await one<{
    id: string;
    enrollment_id: string;
    status: string;
    expires_at: string;
  }>(sql, `select * from waitlist_offers where id = $1 for update`, [offerId]);
  if (!offer) throw err.notFound();
  if (offer.status !== "pending") throw err.conflictState();
  if (new Date(offer.expires_at) < new Date()) throw err.br("BR-25", "That offer has expired.");
  const enr = await one<{ id: string; class_id: string; user_id: string; status: string }>(
    sql,
    `select * from enrollments where id = $1 for update`,
    [offer.enrollment_id],
  );
  if (!enr || enr.user_id !== user.id) throw err.forbidden();
  const cl = await one<{ enrolled_count: number; capacity: number }>(
    sql,
    `select enrolled_count, capacity from classes where id = $1 for update`,
    [enr.class_id],
  );
  if (!cl) throw err.notFound();
  if (cl.enrolled_count >= cl.capacity) throw err.br("BR-22", "The class just filled up.");
  await sql.query(
    `update enrollments set status = 'confirmed', waitlist_pos = null where id = $1`,
    [enr.id],
  );
  await sql.query(
    `update classes set enrolled_count = enrolled_count + 1 where id = $1 and enrolled_count < capacity`,
    [enr.class_id],
  );
  await sql.query(`update waitlist_offers set status = 'accepted' where id = $1`, [offerId]);
  return { status: 200, body: { ok: true } };
}

export async function inviteWaitlist(sql: Sql, classId: string) {
  const pending = await one(
    sql,
    `select o.id from waitlist_offers o
       join enrollments e on e.id = o.enrollment_id
      where e.class_id = $1 and o.status = 'pending' and o.expires_at > now()
      limit 1`,
    [classId],
  );
  if (pending) return;
  const next = await one<{ id: string; user_id: string }>(
    sql,
    `select id, user_id from enrollments
      where class_id = $1 and status = 'waitlisted'
      order by waitlist_pos nulls last, id
      limit 1`,
    [classId],
  );
  if (!next) return;
  const settings = await getSettings(sql);
  const hours = settings.waitlist_offer_hours || 2;
  const offer = await one<{ id: string }>(
    sql,
    `insert into waitlist_offers (enrollment_id, expires_at, status)
     values ($1, now() + ($2 * interval '1 hour'), 'pending')
     returning id`,
    [next.id, hours],
  );
  await enqueue(sql, "inapp", "waitlist_offer", next.user_id, { offer_id: offer!.id, class_id: classId }, `wl|${offer!.id}`);
}

export async function equipmentList(sql: Sql) {
  const items = await sql.query(`select * from equipment_items order by name`);
  return { status: 200, body: { items } };
}

export async function equipmentLoan(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const b = await readJson(request);
  const item_id = str(b.item_id);
  if (!item_id) throw err.field("item_id", "Choose the gear to rent out.");
  const qty = parseInteger("qty", "Quantity", b.qty ?? 1, 1, 99);

  // A member rents against their account — the phone on the loan is theirs, so
  // the loan list can name them. A guest has only the number they give.
  const memberId = str(b.user_id);
  let phone: string;
  if (memberId) {
    const m = await one<{ phone: string; status: string }>(
      sql,
      `select phone, status from users where id = $1 and role = 'member'`,
      [memberId],
    );
    if (!m) throw err.field("user_id", "That member account was not found.");
    if (m.status !== "active") throw err.field("user_id", "That member account is not active.");
    phone = m.phone;
  } else {
    phone = normalizePhone(str(b.phone) ?? "");
    if (!phone) throw err.field("phone", "Enter the guest's phone number, or pick a member.");
    if (!isValidVnPhone(phone)) throw err.field("phone", "That phone number is not valid.");
  }

  const item = await one<{ stock: number; rent_vnd: number; name: string }>(
    sql,
    `select stock, rent_vnd, name from equipment_items where id = $1 for update`,
    [item_id],
  );
  if (!item) throw err.notFound();
  if (item.stock < qty) {
    throw err.br("BR-38", `Only ${item.stock} ${item.name} left — you asked for ${qty}.`, { available: item.stock });
  }
  await sql.query(`update equipment_items set stock = stock - $2 where id = $1`, [item_id, qty]);
  const loan = await one(
    sql,
    `insert into equipment_loans (item_id, booking_id, phone, qty, due_at)
     values ($1,$2,$3,$4, now() + interval '3 hours')
     returning *`,
    [item_id, str(b.booking_id) ?? null, phone, qty],
  );
  await audit(sql, user.id, "loan_out", "equipment", item_id, null, loan);
  return { status: 201, body: { loan, rent_vnd: item.rent_vnd * qty } };
}

export async function equipmentReturn(sql: Sql, id: string, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const loan = await one<{ id: string; item_id: string; qty: number; status: string }>(
    sql,
    `select * from equipment_loans where id = $1 for update`,
    [id],
  );
  if (!loan) throw err.notFound();
  if (loan.status !== "out") throw err.conflictState();
  // Lock the item row so a return and a rental cannot interleave on the count.
  await sql.query(`select 1 from equipment_items where id = $1 for update`, [loan.item_id]);
  await sql.query(
    `update equipment_loans set status = 'returned', returned_at = now() where id = $1`,
    [id],
  );
  await sql.query(`update equipment_items set stock = stock + $2 where id = $1`, [loan.item_id, loan.qty]);
  await audit(sql, user.id, "loan_return", "equipment", loan.item_id, null, { loan_id: id, qty: loan.qty });
  return { status: 200, body: { ok: true } };
}

export async function loansOpen(sql: Sql, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const items = await sql.query(
    `select l.*, i.name, i.sku,
            m.full_name as member_name, m.member_code
       from equipment_loans l
       join equipment_items i on i.id = l.item_id
       left join users m on m.phone = l.phone and m.role = 'member'
      where l.status = 'out'
      order by l.due_at`,
  );
  return { status: 200, body: { items } };
}

export async function sessionAttendanceGet(sql: Sql, sessionId: string, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  // BR-59: a coach reads the register of their own classes only.
  const scope = await sessionScope(sql, sessionId, user);
  const session = {
    id: scope.id,
    class_id: scope.class_id,
    status: scope.status,
    start_at: scope.start_at,
    end_at: scope.end_at,
    locked: attendanceLocked(new Date(scope.end_at).getTime(), Date.now(), scope.status),
    lock_at: new Date(new Date(scope.end_at).getTime() + ATTENDANCE_LOCK_HOURS * 3_600_000).toISOString(),
  };
  const roster = await sql.query(
    `select u.id, u.full_name, u.member_code, u.health_notes,
            a.result, a.at
       from enrollments e
       join users u on u.id = e.user_id
       left join attendance a on a.session_id = $1 and a.user_id = u.id and a.kind = 'session'
      where e.class_id = $2 and e.status = 'confirmed'
      order by u.full_name`,
    [sessionId, session.class_id],
  );
  return { status: 200, body: { session, items: roster } };
}

/**
 * A member's own attendance (M-05): one line per session of the classes they
 * are in that has already run, with the mark the coach gave — present, late,
 * absent or excused — or null when none has been recorded. Only the caller's
 * own rows; there is no id parameter to point it at somebody else.
 */
export async function meAttendance(sql: Sql, user: PublicUser) {
  requireRole(user, ["member"]);
  await requireFlag(sql, "F4");
  const items = await sql.query<{
    session_id: string;
    start_at: string;
    end_at: string;
    sport: string;
    level: string;
    court_code: string;
    result: string | null;
  }>(
    `select s.id as session_id, s.start_at, s.end_at, cl.sport::text as sport, cl.level,
            c.court_code, a.result::text as result
       from sessions s
       join classes cl on cl.id = s.class_id
       join courts c on c.id = s.court_id
       left join attendance a on a.session_id = s.id and a.user_id = $1 and a.kind = 'session'
      where s.start_at < now()
        and s.status <> 'cancelled'
        and (a.id is not null
             or exists (select 1 from enrollments e
                         where e.class_id = cl.id and e.user_id = $1 and e.status = 'confirmed'))
      order by s.start_at desc
      limit 60`,
    [user.id],
  );
  const counts = { present: 0, late: 0, absent: 0, excused: 0 } as Record<string, number>;
  for (const r of items) if (r.result && r.result in counts) counts[r.result]++;
  return { status: 200, body: { items, counts } };
}

export async function sessionAttendancePost(sql: Sql, sessionId: string, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const session = await sessionScope(sql, sessionId, user);
  if (session.status === "cancelled") throw err.conflictState("That session was cancelled.");
  const b = await readJson(request);
  const raw = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : [];
  if (raw.length === 0) throw err.field("items", "Nothing to save.");

  // BR-53: the register closes two hours after the session. Past that only a
  // manager may correct it, and must say why — the reason is kept in the audit.
  let reason: string | null = null;
  if (attendanceLocked(new Date(session.end_at).getTime(), Date.now(), session.status)) {
    if (user.role !== "manager") {
      throw err.br("BR-53", "This register closed 2 hours after the session. Ask a manager to correct it.");
    }
    reason = (str(b.reason) ?? "").trim();
    if (reason.length < 3) throw err.field("reason", "Say why this closed register is being changed.");
  }

  const marks = new Map<string, string>();
  for (const [i, it] of raw.entries()) {
    const uid = str(it.user_id);
    if (!uid || !/^[0-9a-f-]{36}$/i.test(uid)) throw err.field("user_id", `Row ${i + 1}: missing student.`, { index: i });
    const result = str(it.result) ?? "present";
    if (!isAttResult(result)) {
      throw err.field("result", `Row ${i + 1}: result must be present, late, absent or excused.`, { index: i });
    }
    const enrolled = await one(
      sql,
      `select 1 as ok from enrollments where class_id = $1 and user_id = $2 and status = 'confirmed'`,
      [session.class_id, uid],
    );
    if (!enrolled) throw err.field("user_id", `Row ${i + 1}: that student is not in this class.`, { index: i });
    marks.set(uid, result);
  }

  const before: Record<string, string | null> = {};
  for (const [uid, result] of marks) {
    const prev = await one<{ result: string | null }>(
      sql,
      `select result::text as result from attendance where session_id = $1 and user_id = $2 and kind = 'session' limit 1`,
      [session.id, uid],
    );
    before[uid] = prev?.result ?? null;
    await sql.query(`delete from attendance where session_id = $1 and user_id = $2 and kind = 'session'`, [session.id, uid]);
    await sql.query(
      `insert into attendance (kind, user_id, session_id, result) values ('session', $1, $2, $3::att_result)`,
      [uid, session.id, result],
    );
  }
  await audit(
    sql,
    user.id,
    reason ? "attendance_correct" : "attendance",
    "session",
    session.id,
    before,
    { marks: Object.fromEntries(marks), ...(reason ? { reason } : {}) },
  );
  // BR-58: only a fresh absence can start or extend a streak.
  const absent = [...marks].filter(([, r]) => r === "absent").map(([uid]) => uid);
  await checkAbsentStreaks(sql, session.class_id, absent);
  return sessionAttendanceGet(sql, session.id, user);
}

export async function trainingList(sql: Sql, request: Request, user: PublicUser) {
  await requireFlag(sql, "F4");
  const url = new URL(request.url);
  const classId = url.searchParams.get("class_id");
  const mine = url.searchParams.get("mine") === "1";
  const items = await sql.query(
    `select p.*, s.start_at as session_start
       from training_plans p
       left join sessions s on s.id = p.session_id
      where not p.is_template
        and ($1::uuid is null or p.class_id = $1)
        and (
          case
            when $2::boolean then
              p.published = true
              and (p.user_id = $3
                   or (p.user_id is null and p.class_id is null)
                   or (p.user_id is null and p.class_id in (
                         select class_id from enrollments where user_id = $3 and status = 'confirmed')))
            when $4::text = 'coach' then
              p.created_by = $3
              or p.class_id in (select id from classes where coach_id = $3 or assistant_id = $3)
            else true
          end
        )
      order by coalesce(s.start_at, p.created_at) desc, p.id
      limit 60`,
    [classId && /^[0-9a-f-]{36}$/i.test(classId) ? classId : null, mine || user.role === "member", user.id, user.role],
  );
  return { status: 200, body: { items } };
}

export async function trainingSuggest(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F5");
  const b = await readJson(request);
  const sport = str(b.sport) ?? "badminton";
  const level = str(b.level) ?? "beginner";
  const goal = str(b.goal) ?? "core technique";
  const drills: Record<string, Record<string, string[]>> = {
    badminton: {
      beginner: ["Six-corner footwork 8′", "Deep clears 12′", "Net shots 10′", "Game to 11"],
      intermediate: ["Smash off the step 12′", "Flat drive exchanges 10′", "Net coverage 8′", "Set to 21"],
      advanced: ["Jump smash 10′", "Cross-court attack", "Low defence", "Umpired match play"],
    },
    basketball: {
      beginner: ["Shooting form 10′", "Two-hand dribbling", "Lay-ups both sides", "Half-court 3v3"],
      intermediate: ["Pick and roll", "Three-point footwork", "2-3 zone defence", "Full-court 5v5"],
    },
    volleyball: {
      beginner: ["Low digs", "Underarm serve", "Setting", "Six-touch rotation"],
      intermediate: ["Jump serve", "Two-player block", "Outside hitting", "Match set"],
    },
  };
  const list = drills[sport]?.[level] ?? drills.badminton.beginner;
  const payload = {
    sport,
    level,
    goal,
    source: "ai",
    generated_on: ictDateString(),
    blocks: list.map((title, i) => ({ order: i + 1, title, minutes: 10 + i })),
    note: "A coach reviews this before it goes out. AI never overwrites a published plan.",
  };
  return { status: 200, body: { payload } };
}

// ticketBody() moved to ../rules — a Unicode-hardened version (zero-width
// characters, the full-width "：" an IME can produce) that still collapses
// repeated "ticket:" prefixes the same way. Re-exported here so nothing
// importing it from this module has to change.
export { ticketBody };

export async function assistantChat(sql: Sql, request: Request, user: PublicUser) {
  await requireFlag(sql, "F6");
  const body = await readJson(request);
  const message = (str(body.message) ?? "").trim().slice(0, 800);
  if (message.length < 2) throw err.validation("Type a question first.");
  // Every turn that falls through to the model costs a call upstream.
  limit(`ai:${user.id}`, RULES.assistant, "questions");
  const q = message.toLowerCase();

  if (/ticket:|complaint|feedback|khiếu nại|góp ý/.test(q) || q.startsWith("ticket:")) {
    const note = ticketBody(message);
    // "ticket:" and nothing else. Opening a blank request would put a row at the
    // desk that nobody can answer, so ask for the rest before writing anything.
    if (note.length < 2) {
      return {
        status: 200,
        body: {
          reply: "Tell me what happened after «ticket:» and I'll pass it to the front desk.",
          source: "rules" as const,
        },
      };
    }
    const t = await one<{ id: string }>(
      sql,
      `insert into tickets (user_id, body) values ($1,$2) returning id`,
      [user.id, note],
    );
    await audit(sql, user.id, "assistant", "chat", user.id, null, { q: note.slice(0, 200), source: "ticket" });
    return {
      status: 200,
      body: {
        reply: `Opened request ${t!.id.slice(0, 8)} for the front desk. Reception replies during opening hours.`,
        source: "rules" as const,
      },
    };
  }

  const settings = await getSettings(sql);
  const plans = await sql.query<{ name: string; price_vnd: number; sport_scope: string; court_hours: number }>(
    `select name, price_vnd, sport_scope, court_hours from membership_plans where is_on_sale = true order by price_vnd`,
  );
  const classes = await sql.query<{
    sport: string;
    level: string;
    rrule: string;
    enrolled_count: number;
    capacity: number;
    coach_name: string | null;
  }>(
    `select cl.sport, cl.level, cl.rrule, cl.enrolled_count, cl.capacity, u.full_name as coach_name
       from classes cl
       left join users u on u.id = cl.coach_id
      where cl.status = 'open'`,
  );
  const subs = await sql.query<{ plan_name: string; status: string; end_on: string; court_hours_left: string | number }>(
    `select p.name as plan_name, s.status, s.end_on::text, s.court_hours_left
       from subscriptions s join membership_plans p on p.id = s.plan_id
      where s.user_id = $1 and s.status in ('active','frozen','pending')
      order by s.end_on desc limit 3`,
    [user.id],
  );
  const todayBookings = await sql.query<{ court_code: string; start_at: string; status: string }>(
    `select c.court_code, b.start_at::text, b.status
       from court_bookings b join courts c on c.id = b.court_id
      where b.user_id = $1
        and b.status in ('hold','confirmed')
        and b.start_at >= now() - interval '12 hours'
        and b.start_at < now() + interval '24 hours'
      order by b.start_at`,
    [user.id],
  );

  const facts = [
    `Centre: Arena3. Open ${settings.open_time.slice(0, 5)}–${settings.close_time.slice(0, 5)} ICT every day.`,
    `Court holds last ${settings.hold_minutes} minutes. Cancel a court at least ${settings.cancel_court_hours}h ahead, a class at least ${settings.cancel_class_hours}h ahead. No-shows are not refunded.`,
    `Waitlists are first-come; an offer stands for ${settings.waitlist_offer_hours}h. Under-${settings.minor_age}s cannot book or enrol on their own.`,
    `Plans on sale:\n${plans.map((p) => `• ${p.name} (${p.sport_scope}): ${p.price_vnd.toLocaleString("en-US")}đ · ${p.court_hours} court hours`).join("\n") || "—"}`,
    `Open classes:\n${classes.map((c) => `• ${c.sport} ${c.level} · coach ${c.coach_name ?? "—"} · ${c.enrolled_count}/${c.capacity}`).join("\n") || "No classes are open."}`,
    `Coaches:\n${COACHES.map((c) => `• ${c.name} — ${c.title}. ${c.blurb}`).join("\n")}`,
    `Member asking: ${user.full_name} (${user.member_code ?? "no member code yet"}).`,
    `Their plans:\n${subs.map((s) => `• ${s.plan_name} · ${s.status} · through ${s.end_on.slice(0, 10)} · ${s.court_hours_left} court hours left`).join("\n") || "No plan yet."}`,
    `Today / next 24h:\n${todayBookings.map((b) => `• ${b.court_code} ${b.start_at} (${b.status})`).join("\n") || "Nothing booked."}`,
  ].join("\n\n");

  const system = `You are the Arena3 front-desk assistant inside the member app. Answer in English, keep it short (2–8 sentences), and stay strictly inside the DATA BLOCK.
No medical advice, no discounts beyond the listed plans, never invent a free slot.
Only name coaches, plans and classes that appear in the data block.
If you do not know: tell them to ask the desk or type «ticket: …».
You can walk them through Book / Classes / Plans in the app. Payment is taken at the desk after they order in the app.

DATA BLOCK:
${facts}`;

  const history = parseHistory(body.history);
  const turns: ChatTurn[] = [...history, { role: "user", text: message }];

  const ai = await generateAssistantReply(system, turns);
  const reply = ai?.text ?? ruleReply(q, settings, plans, classes);
  const source = ai?.source ?? "rules";

  await audit(sql, user.id, "assistant", "chat", user.id, null, {
    q: message.slice(0, 200),
    source,
  });
  return { status: 200, body: { reply, source } };
}

function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const item of raw.slice(-8)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { role?: unknown; text?: unknown };
    const role =
      rec.role === "me" || rec.role === "user" ? "user" : rec.role === "bot" || rec.role === "model" ? "model" : null;
    const text = typeof rec.text === "string" ? rec.text.trim().slice(0, 800) : "";
    if (!role || text.length < 1) continue;
    out.push({ role, text });
  }
  return out;
}

function ruleReply(
  q: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
  plans: Array<{ name: string; price_vnd: number }>,
  classes: Array<{ sport: string; level: string; enrolled_count: number; capacity: number }>,
): string {
  if (/price|cost|how much|plan|giá|gói/.test(q)) {
    return `Plans on sale:\n${plans.map((p) => `• ${p.name}: ${p.price_vnd.toLocaleString("en-US")}đ`).join("\n")}\nPay at the desk after you order in the app.`;
  }
  if (/hour|open|close|what time|giờ|mở cửa/.test(q)) {
    return `Arena3 is open ${settings.open_time.slice(0, 5)}–${settings.close_time.slice(0, 5)} every day (ICT). Court holds last ${settings.hold_minutes} minutes, and you can cancel a court up to ${settings.cancel_court_hours}h before.`;
  }
  if (/class|coach|lesson|lớp|hlv/.test(q)) {
    return classes.length
      ? `Open classes:\n${classes.map((c) => `• ${c.sport} ${c.level} (${c.enrolled_count}/${c.capacity})`).join("\n")}`
      : "No classes are open right now — ask the desk.";
  }
  if (/cancel|book|hold|hủy|đặt sân/.test(q)) {
    return `Book in the app and the slot is held for ${settings.hold_minutes} minutes. Cancel a court at least ${settings.cancel_court_hours}h before you play, a class at least ${settings.cancel_class_hours}h before. No-shows are not refunded.`;
  }
  if (/waitlist|full|queue|chờ|đầy/.test(q)) {
    return `When a class is full you join a first-come waitlist. If a seat frees up you get an offer that stands for ${settings.waitlist_offer_hours}h — claim it in the app.`;
  }
  return "I can help with the timetable, plans, coaches, booking and cancelling, and waitlists at Arena3. Type «ticket: …» to send a note to the desk. I do not give medical advice.";
}


export async function ticketsCreate(sql: Sql, request: Request, user: PublicUser) {
  // Same stripping as the assistant route: a member who typed "ticket:" into
  // the support box is repeating the habit the assistant taught them.
  const body = ticketBody(str((await readJson(request)).body) ?? "").slice(0, 2000);
  if (body.length < 2) throw err.validation("The message is empty.");
  const row = await one(sql, `insert into tickets (user_id, body) values ($1,$2) returning *`, [user.id, body]);
  return { status: 201, body: row };
}

/**
 * The member's own side of customer care.
 *
 * Closed tickets come back too. A request that has been answered is the most
 * useful row on this screen — it is the answer — and hiding it the moment the
 * desk replies would mean the reply is only ever seen if the member happens to
 * be looking when the notification lands.
 */
export async function ticketsMine(sql: Sql, user: PublicUser) {
  const items = await sql.query(
    `select t.id, t.body, t.status, t.created_at, t.reply, t.replied_at,
            s.full_name as replied_by_name
       from tickets t
       left join users s on s.id = t.replied_by
      where t.user_id = $1
      order by t.created_at desc
      limit 50`,
    [user.id],
  );
  return { status: 200, body: { items } };
}

export async function ticketsList(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  // The desk works the open queue, but wants to be able to read back what it
  // told somebody last week without opening the database.
  const all = new URL(request.url).searchParams.get("status") === "all";
  const items = await sql.query(
    `select t.id, t.body, t.status, t.created_at, t.reply, t.replied_at,
            u.full_name, u.phone, u.member_code,
            s.full_name as replied_by_name
       from tickets t
       left join users u on u.id = t.user_id
       left join users s on s.id = t.replied_by
      where ($1::bool or t.status = 'open')
      order by t.status = 'open' desc, t.created_at desc
      limit 50`,
    [all],
  );
  return { status: 200, body: { items } };
}

/**
 * Reception answers, and the member is told there is an answer.
 *
 * Replying closes the ticket in the same statement rather than leaving that as
 * a second button: an answered request that stays in the open queue is one a
 * colleague will answer again. Reopening is the member's move — they send
 * another note — which is also the honest signal that the first answer did not
 * land.
 */
export async function ticketReply(sql: Sql, id: string, request: Request, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const reply = (str((await readJson(request)).reply) ?? "").trim().slice(0, 2000);
  if (reply.length < 2) throw err.validation("Write a reply first.");
  const t = await one<{ id: string; user_id: string | null; status: string }>(
    sql,
    `select id, user_id, status from tickets where id = $1 for update`,
    [id],
  );
  if (!t) throw err.notFound();
  const row = await one(
    sql,
    `update tickets
        set reply = $2, replied_at = now(), replied_by = $3, status = 'closed'
      where id = $1
      returning *`,
    [id, reply, user.id],
  );
  // A ticket raised by a walk-in the desk typed in has nobody to notify.
  if (t.user_id) {
    await enqueue(
      sql,
      "inapp",
      "ticket_replied",
      t.user_id,
      { ticket_id: id, reply: reply.slice(0, 200) },
      // Keyed on the reply, not the ticket: if the desk answers again after the
      // member writes back, that second answer is its own notification.
      `ticket_replied|${id}|${Date.now()}`,
    );
  }
  await audit(sql, user.id, "ticket_reply", "ticket", id);
  return { status: 200, body: { ticket: row } };
}

export async function ticketClose(sql: Sql, id: string, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  await sql.query(`update tickets set status = 'closed' where id = $1`, [id]);
  await audit(sql, user.id, "ticket_close", "ticket", id);
  return { status: 200, body: { ok: true } };
}
