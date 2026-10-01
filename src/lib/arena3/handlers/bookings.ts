import type { Sql } from "@/lib/db";
import { err, isConflictSlot } from "../errors";
import {
  audit,
  enqueue,
  enqueueReceipt,
  getSettings,
  issueInvoice,
  nextCode,
  readJson,
  str,
  userDebt,
} from "../helpers";
import { isValidVnPhone, normalizePhone } from "../phone";
import { applyDiscount, lookupPrice, memberDiscount } from "../pricing";
import { requireRole, type PublicUser } from "../session";
import { ictClock, ictDateString, ictDateTime, ictStamp, roundVnd } from "../time";
import { one } from "../tx";

async function courtById(sql: Sql, id: string) {
  const c = await one<{
    id: string;
    court_code: string;
    sport: string;
    status: string;
  }>(sql, `select id, court_code, sport, status from courts where id = $1`, [id]);
  if (!c) throw err.notFound("No such court.");
  return c;
}

function slotBounds(startAt: Date, slotMin: number) {
  const end = new Date(startAt.getTime() + slotMin * 60_000);
  return { start: startAt, end };
}

async function assertBookWindow(
  sql: Sql,
  start: Date,
  opts: { walkIn: boolean; settings: Awaited<ReturnType<typeof getSettings>> },
) {
  const now = new Date();
  if (!opts.walkIn && start < now) throw err.br("BR-66", "You cannot book a slot in the past.");
  if (opts.walkIn && start < now) {
    const remain = (start.getTime() + opts.settings.slot_minutes * 60_000 - now.getTime()) / 60_000;
    if (remain < 20) throw err.br("BR-66", "Walk-ins need at least 20 minutes left in the slot.");
  }
  const date = ictDateString(start);
  const open = ictDateTime(date, opts.settings.open_time.slice(0, 5));
  const close = ictDateTime(date, opts.settings.close_time.slice(0, 5));
  if (start < open || start >= close) throw err.br("BR-35", "That is outside opening hours.");
  if (!opts.walkIn) {
    const ahead = opts.settings.book_ahead_days;
    const max = new Date(now.getTime() + ahead * 86400000);
    if (start > max) throw err.br("BR-32", `You can book at most ${ahead} days ahead.`);
  }
}

async function countSlotsToday(sql: Sql, userId: string, start: Date) {
  const date = ictDateString(start);
  const row = await one<{ n: number }>(
    sql,
    `select count(*)::int as n from court_bookings
      where user_id = $1
        and status in ('confirmed','in_use')
        and (start_at at time zone 'Asia/Ho_Chi_Minh')::date = $2::date`,
    [userId, date],
  );
  return row?.n ?? 0;
}

async function overlapClass(sql: Sql, userId: string, start: Date, end: Date) {
  return one(
    sql,
    `select s.id, s.start_at, cl.level, c.court_code
       from sessions s
       join classes cl on cl.id = s.class_id
       join enrollments e on e.class_id = cl.id and e.user_id = $1 and e.status = 'confirmed'
       join courts c on c.id = s.court_id
      where s.status = 'scheduled'
        and tstzrange(s.start_at, s.end_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
      limit 1`,
    [userId, start.toISOString(), end.toISOString()],
  );
}

export async function occupancyGet(sql: Sql, request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? ictDateString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw err.validation("date YYYY-MM-DD.");
  const start = ictDateTime(date, "00:00");
  const end = new Date(ictDateTime(date, "23:59").getTime() + 60_000);
  const rows = await sql.query<{
    court_id: string;
    start_at: string;
    end_at: string;
    kind: string;
    ref_id: string;
    convert_group_id: string | null;
  }>(
    `select court_id, start_at, end_at, kind, ref_id, convert_group_id from occupancies
      where start_at < $2 and end_at > $1
      order by court_id, start_at`,
    [start.toISOString(), end.toISOString()],
  );
  const courts = await sql.query(
    `select id, court_code, sport, status, convertible, pair_court_id from courts order by court_code`,
  );
  return {
    status: 200,
    body: {
      date,
      courts,
      slots: rows.map((r) => ({
        court_id: r.court_id,
        start: r.start_at,
        end: r.end_at,
        kind: r.kind,
        ref: r.ref_id,
        convert_group_id: r.convert_group_id,
      })),
    },
  };
}

export async function courtsList(sql: Sql) {
  const items = await sql.query(`select id, court_code, sport, status, convertible, pair_court_id from courts order by court_code`);
  return { status: 200, body: { items } };
}

const COURT_STATUSES = ["ready", "maintenance", "closed"] as const;

/**
 * Take a court out of service, or put it back.
 *
 * Closing a court does not cancel what is already on it: bookings that were
 * paid for stay honoured, and the desk sorts those out with the members
 * directly. The status only gates *new* holds — `bookingsHold` refuses
 * anything that is not `ready`. Surfacing the count of live occupancies in the
 * response lets the manager see what they have just committed the desk to.
 */
export async function courtsPatch(sql: Sql, id: string, request: Request, user: PublicUser) {
  requireRole(user, ["manager"]);
  const b = await readJson(request);
  const status = str(b.status);
  if (!status || !(COURT_STATUSES as readonly string[]).includes(status)) {
    throw err.validation(`status must be one of ${COURT_STATUSES.join(", ")}.`);
  }
  const cur = await courtById(sql, id);
  if (cur.status === status) return { status: 200, body: { court: cur, upcoming: 0 } };
  const reason = str(b.reason) ?? null;
  await sql.query(`update courts set status = $2 where id = $1`, [id, status]);
  const live = await one<{ n: number }>(
    sql,
    `select count(*)::int as n from occupancies where court_id = $1 and end_at > now()`,
    [id],
  );
  await audit(sql, user.id, "patch_court", "court", id, { from: cur.status, to: status, reason });
  const court = await one(
    sql,
    `select id, court_code, sport, status, convertible, pair_court_id from courts where id = $1`,
    [id],
  );
  return { status: 200, body: { court, upcoming: live?.n ?? 0 } };
}

export async function bookingsHold(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["member"]);
  const b = await readJson(request);
  const courtId = str(b.court_id);
  const startAt = str(b.start_at);
  if (!courtId || !startAt) throw err.validation("court_id and start_at are required.");
  const settings = await getSettings(sql);
  const start = new Date(startAt);
  const { end } = slotBounds(start, settings.slot_minutes);
  await assertBookWindow(sql, start, { walkIn: false, settings });
  const court = await courtById(sql, courtId);
  if (court.status !== "ready") throw err.br("BR-35", "That court is not available.");
  const debt = await userDebt(sql, user.id);
  if (debt > settings.debt_limit_vnd) throw err.br("BR-44", "Your balance is over the limit — settle it at the desk.");
  const n = await countSlotsToday(sql, user.id, start);
  if (n >= settings.max_slots_per_day) throw err.br("BR-32", "You can hold at most 2 slots a day.");
  const overlap = await overlapClass(sql, user.id, start, end);
  if (overlap && b.confirm_overlap !== true) {
    throw err.br("BR-39C", "This slot clashes with a class you are in. Confirm to hold it anyway.", {
      requires_confirm: true,
    });
  }
  const disc = await memberDiscount(sql, user.id, court.sport);
  const list = await lookupPrice(sql, { sport: court.sport, courtId, start });
  const price = applyDiscount(list.price_vnd, disc.pct, settings.round_vnd);
  const bookingIdRow = await one<{ id: string }>(sql, `select gen_random_uuid() as id`);
  const bookingId = bookingIdRow!.id;
  const holdUntil = new Date(Date.now() + settings.hold_minutes * 60_000);
  let occId: string;
  try {
    const occ = await one<{ booking_replace_hold: string }>(
      sql,
      `select booking_replace_hold($1::uuid, null, $2::uuid, $3::timestamptz, $4::timestamptz, $5::uuid) as booking_replace_hold`,
      [user.id, courtId, start.toISOString(), end.toISOString(), bookingId],
    );
    occId = occ!.booking_replace_hold;
  } catch (e) {
    if (isConflictSlot(e)) throw err.conflictSlot("Someone just took that slot.");
    throw e;
  }
  const code = await nextCode(sql, "CRT");
  await sql.query(
    `insert into court_bookings
       (id, code, court_id, user_id, start_at, end_at, status, channel, price_vnd, discount_pct, vat_rate, hold_until, occupancy_id)
     values ($1,$2,$3,$4,$5,$6,'hold','app',$7,$8,$9,$10,$11)`,
    [
      bookingId,
      code,
      courtId,
      user.id,
      start.toISOString(),
      end.toISOString(),
      price,
      disc.pct,
      Number(settings.vat_rate),
      holdUntil.toISOString(),
      occId,
    ],
  );
  const booking = await one(sql, `select * from court_bookings where id = $1`, [bookingId]);
  return {
    status: 201,
    body: { booking, hold_until: holdUntil.toISOString(), price, list_price: list.price_vnd },
  };
}

type HeldBooking = {
  id: string;
  code?: string;
  user_id: string;
  status: string;
  hold_until: string | null;
  transfer_requested_at: string | null;
  occupancy_id: string | null;
  court_id: string;
  start_at: string;
  end_at: string;
  price_vnd: number;
  discount_pct: number;
  vat_rate: string | number;
  quota_hours: string | number;
};

/**
 * Turn a held booking into a paid, confirmed one: money in, slot locked,
 * invoice issued, member told.
 *
 * Shared by the member confirming at the moment of booking and by the desk
 * confirming a bank transfer hours later, because those two have to leave the
 * database in exactly the same state — a transfer reconciled at reception must
 * produce the same payment row and the same receipt as any other booking, or
 * the member ends up with a court and no proof they paid for it.
 */
export async function settleHeldBooking(
  sql: Sql,
  booking: HeldBooking,
  court: { court_code: string },
  opts: {
    method: string;
    payAmount: number;
    quotaHours: number;
    /** Whose name goes on the receipt. */
    buyerName: string;
    /** Who pressed the button — the member, or the receptionist. */
    actorId: string;
    /**
     * Settle against a payment row that already exists, instead of writing one.
     * Set by the payOS path, where the row was created as `pending` when the
     * link was issued.
     */
    existingPaymentId?: string;
  },
) {
  // An online payment already has its row: it was written as `pending` when the
  // payOS link was issued, and the gateway's confirmation flipped it to
  // `posted`. Writing a second one here would double the day's takings.
  const pay = opts.existingPaymentId
    ? { id: opts.existingPaymentId }
    : await one<{ id: string }>(
        sql,
        `insert into payments (code, user_id, method, amount_vnd, vat_rate, status, ref_type, ref_id, created_by, capture_mode)
         values ($1,$2,$3,$4,$5,'posted','booking',$6,$7,'manual') returning id`,
        [
          await nextCode(sql, "PAY"),
          booking.user_id,
          opts.method,
          opts.payAmount,
          Number(booking.vat_rate),
          booking.id,
          opts.actorId,
        ],
      );
  try {
    await sql.query(`select occupancy_confirm_hold($1::uuid)`, [booking.occupancy_id]);
  } catch {
    throw err.holdExpired();
  }
  await sql.query(
    `update court_bookings
        set status = 'confirmed', quota_hours = $2, price_vnd = $3,
            hold_until = null, transfer_requested_at = null
      where id = $1`,
    [booking.id, opts.quotaHours, opts.payAmount],
  );
  const settings = await getSettings(sql);
  const invoiceId = await issueInvoice(sql, {
    paymentId: pay!.id,
    buyerName: opts.buyerName,
    amountVnd: opts.payAmount,
    vatRate: Number(booking.vat_rate ?? 0),
    description:
      `Thuê sân ${court.court_code} — ` +
      `${ictStamp(booking.start_at)}–${ictClock(booking.end_at)}`,
    unit: "giờ",
    settings,
  });
  await enqueue(
    sql,
    "inapp",
    "booking_confirmed",
    booking.user_id,
    { booking_id: booking.id, code: booking.code },
    `booking_confirmed|${booking.id}`,
  );
  // Paid with plan hours is still a transaction worth a record, but it is not a
  // receipt for money — there is nothing for the member to have been charged.
  if (opts.payAmount > 0) {
    await enqueueReceipt(sql, booking.user_id, {
      payment_id: pay!.id,
      invoice_id: invoiceId,
      amount_vnd: opts.payAmount,
      method: opts.method,
    });
  }
  const fresh = await one(sql, `select * from court_bookings where id = $1`, [booking.id]);
  const payment = await one(sql, `select * from payments where id = $1`, [pay!.id]);
  return { booking: fresh, payment, invoice_id: invoiceId };
}

/**
 * What a member is allowed to settle their own booking with.
 *
 * `quota` spends hours they already bought, and `transfer` only asks reception
 * to go and look at the bank — neither one posts money. Everything else means
 * "cash/card changed hands", which is a claim only somebody standing at the
 * till can make.
 *
 * Without this list `method` went from the request body straight into the
 * payment row, so a member could POST `{"method":"cash"}` and mark their own
 * booking paid for money nobody had collected. `gateway` is absent on purpose:
 * an online payment becomes real when payOS confirms it, never because a
 * client said so.
 */
const MEMBER_SETTLE_METHODS = new Set(["quota", "transfer"]);

export async function bookingsConfirm(sql: Sql, id: string, request: Request, user: PublicUser) {
  requireRole(user, ["member"]);
  const b = await readJson(request);
  const method = str(b.method) ?? "transfer";
  if (!MEMBER_SETTLE_METHODS.has(method)) {
    throw err.forbidden(
      "Pay online, or pay at the front desk — a booking cannot be marked paid from the app.",
    );
  }
  const settings = await getSettings(sql);
  const booking = await one<HeldBooking>(
    sql,
    `select * from court_bookings where id = $1 for update`,
    [id],
  );
  if (!booking) throw err.notFound();
  if (booking.user_id !== user.id) throw err.forbidden();
  if (booking.status !== "hold") throw err.conflictState("That booking is no longer on hold.");
  if (booking.transfer_requested_at) {
    throw err.conflictState("Reception is already checking the bank for this one.");
  }
  if (!booking.hold_until || new Date(booking.hold_until) < new Date()) {
    throw err.holdExpired();
  }
  const court = await courtById(sql, booking.court_id);

  /*
   * A bank transfer is a promise, not a payment.
   *
   * Nothing is posted and nothing is confirmed here: the slot stays on hold —
   * still blocking the court, still swept by expire_holds if the money never
   * arrives — on a longer clock, because five minutes is the wrong amount of
   * time to give somebody who has to open a banking app. Reception confirms it
   * against the statement, and only then does a payment row exist.
   */
  if (method === "transfer") {
    const until = new Date(Date.now() + settings.transfer_hold_minutes * 60_000);
    await sql.query(
      `update court_bookings set hold_until = $2, transfer_requested_at = now() where id = $1`,
      [booking.id, until.toISOString()],
    );
    await enqueue(
      sql,
      "inapp",
      "transfer_requested",
      user.id,
      { booking_id: booking.id, code: booking.code, amount_vnd: booking.price_vnd },
      `transfer_requested|${booking.id}`,
    );
    const fresh = await one(sql, `select * from court_bookings where id = $1`, [id]);
    return {
      status: 202,
      body: {
        booking: fresh,
        payment: null,
        invoice_id: null,
        awaiting_transfer: true,
        hold_until: until.toISOString(),
        amount_vnd: booking.price_vnd,
      },
    };
  }

  let payAmount = booking.price_vnd;
  let quotaHours = 0;
  if (method === "quota") {
    const disc = await memberDiscount(sql, user.id, court.sport);
    if (disc.court_hours_left < 1) throw err.br("BR-17", "You have no court hours left on your plan.");
    payAmount = 0;
    quotaHours = 1;
    await sql.query(
      `update subscriptions set court_hours_left = court_hours_left - 1 where id = $1 and court_hours_left >= 1`,
      [disc.sub_id],
    );
  }
  const settled = await settleHeldBooking(sql, booking, court, {
    method,
    payAmount,
    quotaHours,
    buyerName: user.full_name,
    actorId: user.id,
  });
  return { status: 200, body: settled };
}

/**
 * Reception has seen the money land in the bank account.
 *
 * Staff-only on purpose: the member asking for this would be marking their own
 * transfer as received, which is the whole thing this queue exists to prevent.
 */
export async function bookingsTransferConfirm(sql: Sql, id: string, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const booking = await one<HeldBooking>(
    sql,
    `select * from court_bookings where id = $1 for update`,
    [id],
  );
  if (!booking) throw err.notFound();
  if (!booking.transfer_requested_at) {
    throw err.conflictState("No transfer was requested for this booking.");
  }
  if (booking.status !== "hold") throw err.conflictState("That booking is no longer on hold.");
  // The hold is checked, not waived. A slot whose clock ran out has already
  // been handed back by the sweeper or is about to be, and confirming it would
  // sell a court that somebody else may already have booked.
  if (!booking.hold_until || new Date(booking.hold_until) < new Date()) {
    throw err.holdExpired();
  }
  const court = await courtById(sql, booking.court_id);
  const buyer = await one<{ full_name: string }>(sql, `select full_name from users where id = $1`, [
    booking.user_id,
  ]);
  const settled = await settleHeldBooking(sql, booking, court, {
    method: "transfer",
    payAmount: booking.price_vnd,
    quotaHours: 0,
    buyerName: buyer?.full_name ?? "Khach le",
    actorId: user.id,
  });
  await audit(sql, user.id, "transfer_confirm", "booking", booking.id);
  return { status: 200, body: settled };
}

/** The money never arrived, or arrived wrong. The slot goes back on sale. */
export async function bookingsTransferReject(
  sql: Sql,
  id: string,
  request: Request,
  user: PublicUser,
) {
  requireRole(user, ["receptionist", "manager"]);
  const reason = str((await readJson(request)).reason) ?? null;
  const booking = await one<HeldBooking>(
    sql,
    `select * from court_bookings where id = $1 for update`,
    [id],
  );
  if (!booking) throw err.notFound();
  if (!booking.transfer_requested_at) {
    throw err.conflictState("No transfer was requested for this booking.");
  }
  if (booking.status !== "hold") throw err.conflictState("That booking is no longer on hold.");
  await sql.query(`select occupancy_release_booking($1::uuid, 'cancelled'::booking_status)`, [id]);
  await sql.query(`update court_bookings set hold_until = null where id = $1`, [id]);
  await enqueue(
    sql,
    "inapp",
    "transfer_rejected",
    booking.user_id,
    { booking_id: booking.id, code: booking.code, reason },
    `transfer_rejected|${booking.id}`,
  );
  await audit(sql, user.id, "transfer_reject", "booking", booking.id, null, { reason });
  return { status: 200, body: { booking_id: id, released: true } };
}

export async function bookingsCancel(sql: Sql, id: string, user: PublicUser) {
  const booking = await one<{
    id: string;
    user_id: string | null;
    status: string;
    start_at: string;
    price_vnd: number;
    quota_hours: string | number;
    court_id: string;
  }>(sql, `select * from court_bookings where id = $1 for update`, [id]);
  if (!booking) throw err.notFound();
  if (user.role === "member" && booking.user_id !== user.id) throw err.forbidden();
  if (!["hold", "confirmed"].includes(booking.status)) {
    throw err.conflictState("A booking in this state cannot be cancelled.");
  }
  const settings = await getSettings(sql);
  if (booking.status === "hold") {
    await sql.query(`select occupancy_release_booking($1::uuid, 'cancelled'::booking_status)`, [id]);
    return { status: 200, body: { refund: null, booking_id: id } };
  }
  const hoursLeft = (new Date(booking.start_at).getTime() - Date.now()) / 3600000;
  const refundable = hoursLeft >= settings.cancel_court_hours;
  await sql.query(`select occupancy_release_booking($1::uuid, 'cancelled'::booking_status)`, [id]);
  let refund = null;
  if (refundable) {
    const qh = Number(booking.quota_hours) || 0;
    if (qh > 0 && booking.user_id) {
      const court = await courtById(sql, booking.court_id);
      const disc = await memberDiscount(sql, booking.user_id, court.sport);
      if (disc.sub_id) {
        await sql.query(`update subscriptions set court_hours_left = court_hours_left + $2 where id = $1`, [
          disc.sub_id,
          qh,
        ]);
      }
      refund = { kind: "quota", hours: qh };
    } else if (booking.price_vnd > 0) {
      const payCode = await nextCode(sql, "PAY");
      const amount = -booking.price_vnd;
      const needMgr = Math.abs(amount) >= settings.refund_manager_vnd;
      const st = needMgr ? "refund_pending" : "posted";
      refund = await one(
        sql,
        `insert into payments (code, user_id, method, amount_vnd, vat_rate, status, ref_type, ref_id, created_by)
         values ($1,$2,'cash',$3,0,$4,'booking',$5,$6) returning *`,
        [payCode, booking.user_id, amount, st, id, user.id],
      );
    }
  }
  await enqueue(sql, "inapp", "booking_cancelled", booking.user_id, { id }, `booking_cancelled|${id}`);
  await audit(sql, user.id, "cancel_booking", "booking", id);
  return { status: 200, body: { refund, refundable } };
}

export async function bookingsCheckIn(sql: Sql, id: string, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const settings = await getSettings(sql);
  const booking = await one<{
    id: string;
    status: string;
    start_at: string;
  }>(sql, `select * from court_bookings where id = $1 for update`, [id]);
  if (!booking) throw err.notFound();
  if (booking.status !== "confirmed") throw err.conflictState("Only confirmed bookings can be checked in.");
  const start = new Date(booking.start_at).getTime();
  const now = Date.now();
  const min = start - settings.checkin_before_minutes * 60_000;
  const max = start + settings.noshow_grace_minutes * 60_000;
  if (now < min || now > max) {
    throw err.br("BR-39B", "Outside the check-in window of −15/+10 minutes.");
  }
  await sql.query(`update court_bookings set status = 'in_use' where id = $1`, [id]);
  return { status: 200, body: { status: "in_use" } };
}

export async function walkIn(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const b = await readJson(request);
  const courtId = str(b.court_id);
  const startAt = str(b.start_at);
  const guest_name = str(b.guest_name);
  const guest_phone_raw = str(b.guest_phone);
  const method = str(b.method) ?? "cash";
  if (!courtId || !startAt || !guest_name || !guest_phone_raw) {
    throw err.validation("Court, time, name or phone is missing.");
  }
  const guest_phone = normalizePhone(guest_phone_raw);
  if (!isValidVnPhone(guest_phone)) throw err.validation("That phone number is not valid.");
  const settings = await getSettings(sql);
  const start = new Date(startAt);
  const { end } = slotBounds(start, settings.slot_minutes);
  await assertBookWindow(sql, start, { walkIn: true, settings });
  const court = await courtById(sql, courtId);
  if (court.status !== "ready") throw err.br("BR-35", "That court is not available.");
  if (user.role === "receptionist") {
    const shift = await one<{ id: string }>(
      sql,
      `select id from cashier_shifts where receptionist_id = $1 and closed_at is null`,
      [user.id],
    );
    if (!shift) throw err.br("BR-49", "Open a till shift before taking payment.");
    (b as { _shift?: string })._shift = shift.id;
  }
  const member = await one<{ id: string; full_name: string }>(
    sql,
    `select id, full_name from users where phone = $1`,
    [guest_phone],
  );
  const list = await lookupPrice(sql, { sport: court.sport, courtId, start });
  let price = list.price_vnd;
  let discount = 0;
  if (member) {
    const disc = await memberDiscount(sql, member.id, court.sport);
    discount = disc.pct;
    price = applyDiscount(list.price_vnd, disc.pct, settings.round_vnd);
  }
  price = roundVnd(price, settings.round_vnd);
  const bookingId = (await one<{ id: string }>(sql, `select gen_random_uuid() as id`))!.id;
  let occId: string;
  try {
    const occ = await one<{ booking_replace_hold: string }>(
      sql,
      `select booking_replace_hold($1::uuid, $2, $3::uuid, $4::timestamptz, $5::timestamptz, $6::uuid) as booking_replace_hold`,
      [member?.id ?? null, guest_phone, courtId, start.toISOString(), end.toISOString(), bookingId],
    );
    occId = occ!.booking_replace_hold;
  } catch (e) {
    if (isConflictSlot(e)) throw err.conflictSlot();
    throw e;
  }
  const code = await nextCode(sql, "CRT");
  await sql.query(
    `insert into court_bookings
       (id, code, court_id, user_id, guest_name, guest_phone, start_at, end_at, status, channel,
        price_vnd, discount_pct, vat_rate, occupancy_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'hold','walkin',$9,$10,$11,$12)`,
    [
      bookingId,
      code,
      courtId,
      member?.id ?? null,
      guest_name,
      guest_phone,
      start.toISOString(),
      end.toISOString(),
      price,
      discount,
      Number(settings.vat_rate),
      occId,
    ],
  );
  await sql.query(`select occupancy_confirm_hold($1::uuid)`, [occId]);
  await sql.query(`update court_bookings set status = 'confirmed', hold_until = null where id = $1`, [
    bookingId,
  ]);
  const payCode = await nextCode(sql, "PAY");
  const shiftId = user.role === "receptionist" ? (b as { _shift?: string })._shift : str(b.shift_id);
  const pay = await one<{ id: string }>(
    sql,
    `insert into payments (code, user_id, shift_id, method, amount_vnd, vat_rate, status, ref_type, ref_id, created_by)
     values ($1,$2,$3,$4,$5,$6,'posted','booking',$7,$8) returning id`,
    [
      payCode,
      member?.id ?? null,
      shiftId ?? null,
      method,
      price,
      Number(settings.vat_rate),
      bookingId,
      user.id,
    ],
  );
  const invoiceId = await issueInvoice(sql, {
    paymentId: pay!.id,
    buyerName: guest_name,
    amountVnd: price,
    vatRate: Number(settings.vat_rate ?? 0),
    description: `Khách vãng lai — sân ${court.court_code} ${ictStamp(start)}`,
    unit: "lượt",
    settings,
  });
  await audit(sql, user.id, "walk_in", "booking", bookingId);
  const booking = await one(sql, `select * from court_bookings where id = $1`, [bookingId]);
  const payment = await one(sql, `select * from payments where id = $1`, [pay!.id]);
  return { status: 201, body: { booking, payment, invoice_id: invoiceId } };
}

export async function bookingGet(sql: Sql, id: string, user: PublicUser) {
  const b = await one(sql, `select * from court_bookings where id = $1`, [id]);
  if (!b) throw err.notFound();
  const row = b as { user_id: string | null };
  if (user.role === "member" && row.user_id !== user.id) throw err.forbidden();
  return { status: 200, body: b };
}
