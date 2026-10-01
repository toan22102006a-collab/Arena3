import type { Sql } from "@/lib/db";
import { err, isConflictSlot } from "../errors";
import { flagOn, flagsMap, requireFlag, type FlagKey } from "../flags";
import { audit, enqueue, getSettings, num, readJson, str } from "../helpers";
import { limit, RULES } from "../ratelimit";
import { requireRole, type PublicUser } from "../session";
import { isValidVnPhone, normalizePhone } from "../phone";
import { generateAssistantReply, type ChatTurn } from "../gemini";
import { COACHES } from "../coaches";
import { ticketBody } from "../rules";
import { addDays, ictDateString } from "../time";
import { one } from "../tx";
import { payosConfigured } from "../payos";

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

export async function convertSlot(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["manager", "receptionist"]);
  const b = await readJson(request);
  const court_id = str(b.court_id);
  const start_at = str(b.start_at);
  const end_at = str(b.end_at);
  if (!court_id || !start_at || !end_at) throw err.validation("court_id, start_at and end_at are required.");
  const ref = crypto.randomUUID();
  try {
    const occ = await one<{ occupancy_attach_convert: string }>(
      sql,
      `select occupancy_attach_convert($1::uuid, $2::timestamptz, $3::timestamptz, $4::uuid) as occupancy_attach_convert`,
      [court_id, start_at, end_at, ref],
    );
    await audit(sql, user.id, "convert_court", "occupancy", occ!.occupancy_attach_convert);
    return { status: 201, body: { occupancy_id: occ!.occupancy_attach_convert, ref } };
  } catch (e) {
    if (isConflictSlot(e)) throw err.conflictSlot("Cannot convert — the paired court is busy.");
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("COURT_NOT_CONVERTIBLE")) throw err.br("BR-39G", "That court cannot be converted.");
    throw e;
  }
}

export async function convertRelease(sql: Sql, groupId: string, user: PublicUser) {
  requireRole(user, ["manager", "receptionist"]);
  await sql.query(`select occupancy_release_convert($1::uuid)`, [groupId]);
  await audit(sql, user.id, "convert_release", "occupancy", groupId);
  return { status: 200, body: { ok: true } };
}

export async function equipmentList(sql: Sql) {
  const items = await sql.query(`select * from equipment_items order by name`);
  return { status: 200, body: { items } };
}

export async function equipmentLoan(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const b = await readJson(request);
  const item_id = str(b.item_id);
  const phone = normalizePhone(str(b.phone) ?? "");
  const qty = num(b.qty) ?? 1;
  if (!item_id || !isValidVnPhone(phone) || qty < 1) throw err.validation("Gear, phone or quantity is missing.");
  const item = await one<{ stock: number; rent_vnd: number; name: string }>(
    sql,
    `select stock, rent_vnd, name from equipment_items where id = $1 for update`,
    [item_id],
  );
  if (!item) throw err.notFound();
  if (item.stock < qty) throw err.br("BR-38", "That gear is out of stock.");
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
  await sql.query(
    `update equipment_loans set status = 'returned', returned_at = now() where id = $1`,
    [id],
  );
  await sql.query(`update equipment_items set stock = stock + $2 where id = $1`, [loan.item_id, loan.qty]);
  return { status: 200, body: { ok: true } };
}

export async function loansOpen(sql: Sql, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const items = await sql.query(
    `select l.*, i.name, i.sku from equipment_loans l
       join equipment_items i on i.id = l.item_id
      where l.status = 'out'
      order by l.due_at`,
  );
  return { status: 200, body: { items } };
}

export async function sessionAttendanceGet(sql: Sql, sessionId: string, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const session = await one<{ id: string; class_id: string; status: string }>(
    sql,
    `select id, class_id, status from sessions where id = $1`,
    [sessionId],
  );
  if (!session) throw err.notFound();
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

export async function sessionAttendancePost(sql: Sql, sessionId: string, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const session = await one<{ id: string; status: string; end_at: string }>(
    sql,
    `select id, status, end_at from sessions where id = $1`,
    [sessionId],
  );
  if (!session) throw err.notFound();
  if (session.status === "done") throw err.br("BR-27", "Attendance for this session is locked.");
  const b = await readJson(request);
  const items = Array.isArray(b.items) ? b.items : [];
  for (const it of items) {
    const uid = str(it.user_id);
    const result = str(it.result) ?? "present";
    if (!uid) continue;
    await sql.query(
      `delete from attendance where session_id = $1 and user_id = $2 and kind = 'session'`,
      [sessionId, uid],
    );
    await sql.query(
      `insert into attendance (kind, user_id, session_id, result)
       values ('session', $1, $2, $3::att_result)`,
      [uid, sessionId, result],
    );
  }
  await audit(sql, user.id, "attendance", "session", sessionId);
  return sessionAttendanceGet(sql, sessionId, user);
}

export async function trainingList(sql: Sql, request: Request, user: PublicUser) {
  await requireFlag(sql, "F4");
  const url = new URL(request.url);
  const classId = url.searchParams.get("class_id");
  const mine = url.searchParams.get("mine") === "1";
  const items = await sql.query(
    `select * from training_plans
      where published = true
        and ($1::uuid is null or class_id = $1)
        and (
          $2::boolean is false
          or user_id = $3
          or (user_id is null and class_id is null)
          or (user_id is null and class_id in (
                select class_id from enrollments where user_id = $3 and status = 'confirmed'
              ))
        )
      order by id desc
      limit 40`,
    [classId, mine || user.role === "member", user.id],
  );
  return { status: 200, body: { items } };
}

export async function trainingCreate(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["coach", "manager"]);
  await requireFlag(sql, "F4");
  const b = await readJson(request);
  const payload = b.payload ?? {};
  const row = await one(
    sql,
    `insert into training_plans (scope, class_id, user_id, source, published, payload)
     values ($1,$2,$3,$4, coalesce($5,true), $6::jsonb)
     returning *`,
    [
      str(b.scope) ?? "class",
      str(b.class_id) ?? null,
      str(b.user_id) ?? null,
      str(b.source) ?? "coach",
      b.published !== false,
      JSON.stringify(payload),
    ],
  );
  return { status: 201, body: row };
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
