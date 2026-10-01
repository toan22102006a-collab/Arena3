import type { Sql } from "@/lib/db";
import { err } from "../errors";
import {
  audit,
  enqueueReceipt,
  getSettings,
  issueInvoice,
  nextCode,
  num,
  readJson,
  str,
  subscriptionDebt,
} from "../helpers";
import { methodLabelVi } from "../labels";
import { renderInvoicePdf } from "../pdf";
import { validatePriceRules } from "../rules";
import { requireRole, type PublicUser } from "../session";
import { addDays, ictDateString } from "../time";
import { one } from "../tx";

export async function shiftOpen(sql: Sql, user: PublicUser) {
  requireRole(user, ["receptionist"]);
  const existing = await one(
    sql,
    `select id from cashier_shifts where receptionist_id = $1 and closed_at is null`,
    [user.id],
  );
  if (existing) throw err.conflictState("A till shift is already open.");
  const row = await one(
    sql,
    `insert into cashier_shifts (receptionist_id) values ($1) returning *`,
    [user.id],
  );
  return { status: 201, body: { shift: row } };
}

export async function shiftCurrent(sql: Sql, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const row = await one(
    sql,
    `select * from cashier_shifts where receptionist_id = $1 and closed_at is null`,
    [user.id],
  );
  if (!row) throw err.notFound("No till shift is open.");
  const totals = await one<{ cash: number; all: number }>(
    sql,
    `select coalesce(sum(amount_vnd) filter (where method = 'cash' and status = 'posted'),0)::int as cash,
            coalesce(sum(amount_vnd) filter (where status = 'posted' and method <> 'quota'),0)::int as all
       from payments where shift_id = $1`,
    [(row as { id: string }).id],
  );
  return { status: 200, body: { shift: row, totals } };
}

export async function shiftClose(sql: Sql, id: string, request: Request, user: PublicUser) {
  requireRole(user, ["receptionist"]);
  const b = await readJson(request);
  const cash = num(b.cash_declared_vnd);
  if (cash == null) throw err.validation("cash_declared_vnd is required.");
  const sh = await one<{ id: string; receptionist_id: string; closed_at: string | null }>(
    sql,
    `select * from cashier_shifts where id = $1 for update`,
    [id],
  );
  if (!sh) throw err.notFound();
  if (sh.receptionist_id !== user.id) throw err.forbidden();
  if (sh.closed_at) throw err.conflictState("That shift is already closed.");
  await sql.query(
    `update cashier_shifts set closed_at = now(), cash_declared_vnd = $2 where id = $1`,
    [id, cash],
  );
  const actual = await one<{ cash: number }>(
    sql,
    `select coalesce(sum(amount_vnd) filter (where method='cash' and status='posted'),0)::int as cash
       from payments where shift_id = $1`,
    [id],
  );
  await audit(sql, user.id, "close_shift", "shift", id, null, {
    declared: cash,
    actual: actual?.cash,
  });
  return {
    status: 200,
    body: { ok: true, cash_declared_vnd: cash, cash_system_vnd: actual?.cash ?? 0 },
  };
}

async function activateSubscription(sql: Sql, subId: string) {
  const sub = await one<{
    id: string;
    status: string;
    end_on: string;
    start_on: string;
    plan_id: string;
    user_id: string;
    court_hours_left: string | number;
    session_left: number | null;
  }>(sql, `select * from subscriptions where id = $1 for update`, [subId]);
  if (!sub) throw err.notFound();
  const plan = await one<{
    duration_days: number | null;
    court_hours: number;
    session_quota: number | null;
    carry_over_hours: boolean;
    price_vnd: number;
  }>(sql, `select * from membership_plans where id = $1`, [sub.plan_id]);
  if (!plan) throw err.notFound();
  const today = ictDateString();
  const duration = plan.duration_days ?? 365;
  if (sub.status === "active" && sub.end_on >= today) {
    const end = addDays(sub.end_on, duration);
    await sql.query(
      `update subscriptions
          set end_on = $2,
              court_hours_left = court_hours_left + $3,
              session_left = case when session_left is null and $4::int is null then null
                                  else coalesce(session_left,0) + coalesce($4,0) end
        where id = $1`,
      [sub.id, end, plan.court_hours, plan.session_quota],
    );
  } else {
    const end = addDays(today, duration);
    const hours = plan.carry_over_hours ? Number(sub.court_hours_left) + plan.court_hours : plan.court_hours;
    await sql.query(
      `update subscriptions
          set status = 'active', start_on = $2, end_on = $3,
              court_hours_left = $4, session_left = $5
        where id = $1`,
      [sub.id, today, end, hours, plan.session_quota],
    );
  }
}

/**
 * What the money actually bought, as it should read on the invoice.
 *
 * The goods line used to be the literal string "Thu ngan" for everything that
 * was not a plan, so a member who paid for a court got an invoice saying
 * "1 x Thu ngan". The payment already knows its `ref_type`/`ref_id`; this looks
 * through to the thing itself so the line names the court and the hour.
 */
async function describePayment(
  sql: Sql,
  refType: string,
  refId: string,
): Promise<{ description: string; unit: string }> {
  if (refType === "subscription") {
    const row = await one<{ name: string }>(
      sql,
      `select p.name from subscriptions s join membership_plans p on p.id = s.plan_id where s.id = $1`,
      [refId],
    );
    return { description: row ? `Gói hội viên — ${row.name}` : "Gói hội viên", unit: "gói" };
  }
  if (refType === "booking") {
    const row = await one<{ court_code: string; window: string }>(
      sql,
      `select c.court_code,
              to_char(b.start_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
                || '–' || to_char(b.end_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') as window
         from court_bookings b join courts c on c.id = b.court_id
        where b.id = $1`,
      [refId],
    );
    return {
      description: row ? `Thuê sân ${row.court_code} — ${row.window}` : "Thuê sân",
      unit: "giờ",
    };
  }
  if (refType === "walkin") return { description: "Vé lẻ vào cửa", unit: "lượt" };
  if (refType === "equipment") return { description: "Thuê thiết bị", unit: "lượt" };
  return { description: "Dịch vụ tại trung tâm", unit: "lượt" };
}

export async function paymentsCreate(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const b = await readJson(request);
  const ref_type = str(b.ref_type);
  const ref_id = str(b.ref_id);
  const method = str(b.method);
  const amount = num(b.amount_vnd);
  if (!ref_type || !ref_id || !method || amount == null) {
    throw err.validation("ref_type, ref_id, method and amount_vnd are required.");
  }
  const settings = await getSettings(sql);
  let shiftId: string | null = str(b.shift_id) ?? null;
  if (user.role === "receptionist") {
    const sh = await one<{ id: string }>(
      sql,
      `select id from cashier_shifts where receptionist_id = $1 and closed_at is null`,
      [user.id],
    );
    if (!sh) throw err.br("BR-49", "The front desk needs an open shift.");
    shiftId = sh.id;
  }
  let buyer = user.full_name;
  let userId: string | null = null;
  if (ref_type === "subscription") {
    const sub = await one<{ user_id: string; plan_id: string }>(
      sql,
      `select user_id, plan_id from subscriptions where id = $1`,
      [ref_id],
    );
    if (!sub) throw err.notFound("No such plan.");
    userId = sub.user_id;
    const u = await one<{ full_name: string }>(sql, `select full_name from users where id = $1`, [userId]);
    buyer = u?.full_name ?? buyer;
  }
  const payCode = await nextCode(sql, "PAY");
  const pay = await one<{ id: string }>(
    sql,
    `insert into payments (code, user_id, shift_id, method, amount_vnd, vat_rate, status, ref_type, ref_id, created_by)
     values ($1,$2,$3,$4,$5,$6,'posted',$7,$8,$9) returning id`,
    [payCode, userId, shiftId, method, amount, Number(settings.vat_rate), ref_type, ref_id, user.id],
  );
  if (ref_type === "subscription") {
    const plan = await one<{ price_vnd: number }>(
      sql,
      `select p.price_vnd from subscriptions s join membership_plans p on p.id = s.plan_id where s.id = $1`,
      [ref_id],
    );
    const debt = await subscriptionDebt(sql, ref_id);
    const deposit = settings.deposit_pct_activates;
    const paidEnough =
      deposit != null
        ? (plan!.price_vnd - debt) / plan!.price_vnd >= deposit / 100
        : debt <= 0;
    if (paidEnough) await activateSubscription(sql, ref_id);
  }
  const item = await describePayment(sql, ref_type, ref_id);
  const invoiceId = await issueInvoice(sql, {
    paymentId: pay!.id,
    buyerName: buyer,
    amountVnd: amount,
    vatRate: Number(settings.vat_rate ?? 0),
    description: item.description,
    unit: item.unit,
    settings,
  });
  await enqueueReceipt(sql, userId, {
    payment_id: pay!.id,
    invoice_id: invoiceId,
    amount_vnd: amount,
    method,
  });
  const payment = await one(sql, `select * from payments where id = $1`, [pay!.id]);
  const invoice = await one(sql, `select * from invoices where id = $1`, [invoiceId]);
  await audit(sql, user.id, "create_payment", "payment", pay!.id);
  return { status: 201, body: { payment, invoice } };
}

export async function paymentsRefund(sql: Sql, id: string, request: Request, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const b = await readJson(request);
  const amount = num(b.amount_vnd);
  const reason = str(b.reason) ?? "";
  if (amount == null || amount === 0) throw err.validation("amount_vnd must not be zero.");
  const orig = await one<{
    id: string;
    amount_vnd: number;
    user_id: string | null;
    vat_rate: string | number;
    ref_type: string;
    ref_id: string;
    // `for update` so two clicks on the same payment queue behind each other
    // rather than both reading a ledger neither of them has written to yet.
  }>(sql, `select * from payments where id = $1 for update`, [id]);

  if (!orig) throw err.notFound();
  if (orig.amount_vnd <= 0) throw err.validation("That row is already a refund.");
  const settings = await getSettings(sql);
  const signed = amount > 0 ? -amount : amount;

  /*
   * How much of this money is still the centre's to give back.
   *
   * Comparing against `orig.amount_vnd` alone — which is all this did — asks
   * "is one refund too big?" and never "have we already given this back?".
   * Nothing links a refund row to its parent payment, so the same 1,500,000đ
   * payment could be refunded 1,500,000đ as many times as somebody pressed the
   * button. The ledger for the booking or subscription is what actually has to
   * balance, so that is what is counted: everything posted in, less everything
   * already sent back or waiting on a manager to send it back.
   */
  const ledger = await one<{ taken: number; returned: number }>(
    sql,
    `select coalesce(sum(amount_vnd) filter (where amount_vnd > 0 and status = 'posted'), 0)::int as taken,
            coalesce(sum(-amount_vnd) filter (where amount_vnd < 0 and status in ('posted','refund_pending')), 0)::int as returned
       from payments
      where ref_type = $1 and ref_id = $2`,
    [orig.ref_type, orig.ref_id],
  );
  const refundable = Math.min(
    orig.amount_vnd,
    Number(ledger?.taken ?? 0) - Number(ledger?.returned ?? 0),
  );
  if (refundable <= 0) throw err.validation("This payment has already been refunded in full.");
  if (Math.abs(signed) > refundable) {
    throw err.validation(`The refund is larger than the ${refundable.toLocaleString("en-US")}đ still refundable.`);
  }

  const needMgr = Math.abs(signed) >= settings.refund_manager_vnd;
  if (needMgr && user.role !== "manager") {
    const payCode = await nextCode(sql, "PAY");
    const row = await one(
      sql,
      `insert into payments (code, user_id, method, amount_vnd, vat_rate, status, ref_type, ref_id, created_by)
       values ($1,$2,'cash',$3,$4,'refund_pending',$5,$6,$7) returning *`,
      [payCode, orig.user_id, signed, orig.vat_rate, orig.ref_type, orig.ref_id, user.id],
    );
    await audit(sql, user.id, "refund_pending", "payment", (row as { id: string }).id, null, { reason });
    return { status: 201, body: { payment: row } };
  }
  const payCode = await nextCode(sql, "PAY");
  const row = await one(
    sql,
    `insert into payments (code, user_id, method, amount_vnd, vat_rate, status, ref_type, ref_id, created_by)
     values ($1,$2,'cash',$3,$4,'posted',$5,$6,$7) returning *`,
    [payCode, orig.user_id, signed, orig.vat_rate, orig.ref_type, orig.ref_id, user.id],
  );
  await audit(sql, user.id, "refund", "payment", (row as { id: string }).id, null, { reason });
  return { status: 201, body: { payment: row } };
}

export async function paymentsApproveRefund(sql: Sql, id: string, user: PublicUser) {
  requireRole(user, ["manager"]);
  const p = await one<{ id: string; status: string }>(
    sql,
    `select * from payments where id = $1 for update`,
    [id],
  );
  if (!p) throw err.notFound();
  if (p.status !== "refund_pending") throw err.conflictState();
  await sql.query(`update payments set status = 'posted' where id = $1`, [id]);
  return { status: 200, body: { status: "posted" } };
}

export async function paymentsRejectRefund(sql: Sql, id: string, user: PublicUser) {
  requireRole(user, ["manager"]);
  const p = await one<{ id: string; status: string }>(
    sql,
    `select * from payments where id = $1 for update`,
    [id],
  );
  if (!p) throw err.notFound();
  if (p.status !== "refund_pending") throw err.conflictState();
  await sql.query(`update payments set status = 'refund_rejected' where id = $1`, [id]);
  return { status: 200, body: { status: "refund_rejected" } };
}

/** How many receipts the reconciliation list will show at once. */
const RECEIPT_CAP = 60;

/**
 * Everything at the desk that is still waiting on money.
 *
 * Three queues that until now had no screen anywhere. A plan a member ordered
 * in the app sits at `pending` until somebody takes payment for it, and the
 * only way to find one was to already know whose profile to open. A refund a
 * receptionist raised above their own limit sits at `refund_pending` until a
 * manager signs it off, and the approve/reject endpoints existed with nothing
 * to call them. A member who chose "Bank transfer" in the app leaves their slot
 * on a long hold with nothing posted, waiting for somebody here to find the
 * money on the statement — that is the one queue where the centre is holding a
 * court open on trust, so it goes first. And transfers already reconciled land
 * in the last list, which is a record rather than a queue and carries no
 * actions: it exists to be read back against the bank line by line.
 */
export async function paymentsPending(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const sp = new URL(request.url).searchParams;
  const days = Math.min(30, Math.max(1, Number(sp.get("days") ?? 7) || 7));

  // The desk home wants a badge number and nothing else. Running three joined
  // queries — including sixty transfers with their invoices — on every visit to
  // the front page, to render a single digit, is work nobody ever reads.
  if (sp.get("brief") === "1") {
    const counts = await one<{ orders: number; refunds: number; awaiting: number }>(
      sql,
      `select (select count(*) from subscriptions where status = 'pending')::int as orders,
              (select count(*) from payments where status = 'refund_pending')::int as refunds,
              (select count(*) from court_bookings
                where status = 'hold' and transfer_requested_at is not null
                  and hold_until > now())::int as awaiting`,
    );
    return {
      status: 200,
      body: {
        waiting:
          Number(counts?.orders ?? 0) + Number(counts?.refunds ?? 0) + Number(counts?.awaiting ?? 0),
      },
    };
  }

  // Slots the centre is holding open against a promise to transfer. Expired
  // holds are left out: the sweeper has already handed those courts back, so
  // showing them would invite a receptionist to confirm money into a booking
  // that no longer owns its slot.
  const awaiting = await sql.query(
    `select b.id, b.code, b.price_vnd, b.start_at, b.end_at,
            b.transfer_requested_at, b.hold_until,
            c.court_code, c.sport,
            u.full_name as member_name, u.member_code, u.phone
       from court_bookings b
       join courts c on c.id = b.court_id
       left join users u on u.id = b.user_id
      where b.status = 'hold'
        and b.transfer_requested_at is not null
        and b.hold_until > now()
      order by b.transfer_requested_at asc`,
  );

  // `paid_vnd` rather than the debt view: the desk wants to see a part payment
  // for what it is ("2 of 5 taken"), not just the balance left over.
  const orders = await sql.query(
    `select s.id, s.sport_scope, s.start_on::text as ordered_on, s.end_on::text as end_on,
            u.id as user_id, u.full_name, u.phone, u.member_code,
            pl.name as plan_name, pl.price_vnd,
            coalesce(sum(p.amount_vnd) filter (where p.status = 'posted'), 0)::int as paid_vnd
       from subscriptions s
       join users u on u.id = s.user_id
       join membership_plans pl on pl.id = s.plan_id
       left join payments p on p.ref_type = 'subscription' and p.ref_id = s.id
      where s.status = 'pending'
      group by s.id, s.sport_scope, s.start_on, s.end_on,
               u.id, u.full_name, u.phone, u.member_code, pl.name, pl.price_vnd
      order by s.start_on asc, u.full_name asc`,
  );

  const refunds = await sql.query(
    `select p.id, p.code, p.amount_vnd, p.created_at, p.ref_type, p.ref_id,
            u.full_name as member_name, u.member_code,
            r.full_name as raised_by
       from payments p
       left join users u on u.id = p.user_id
       left join users r on r.id = p.created_by
      where p.status = 'refund_pending'
      order by p.created_at asc`,
  );

  /*
   * Every posted payment, whatever it was paid with.
   *
   * This list was filtered to `method = 'transfer'`, which made it a bank
   * reconciliation tool and nothing else. But a receipt is a receipt: cash taken
   * at the counter, a card tapped, a plan paid off, a court settled in the app —
   * each one issues an invoice, and none of them appeared anywhere at reception.
   * A member coming back with "I paid on Tuesday, can I have that again?" had to
   * be met by somebody guessing which queue to open.
   *
   * `taken_by` comes along because with cash in the list the obvious next
   * question is whose till it went into.
   */
  const receipts = await sql.query(
    `select p.id, p.code, p.method, p.amount_vnd, p.created_at, p.ref_type, p.ref_id,
            p.capture_mode, p.provider,
            u.full_name as member_name, u.member_code,
            s.full_name as taken_by,
            i.id as invoice_id
       from payments p
       left join users u on u.id = p.user_id
       left join users s on s.id = p.created_by
       left join invoices i on i.payment_id = p.id
      where p.status = 'posted'
        and p.created_at >= now() - ($1::int * interval '1 day')
      order by p.created_at desc
      limit $2`,
    [days, RECEIPT_CAP + 1],
  );

  // One row over the cap is fetched purely to answer "is there more?" — the
  // desk reads this list back against a bank statement, so a silently truncated
  // list is worse than a short one that admits it is short.
  const capped = receipts.length > RECEIPT_CAP;

  return {
    status: 200,
    body: { awaiting, orders, refunds, receipts: receipts.slice(0, RECEIPT_CAP), days, capped },
  };
}

/**
 * Clear a plan order the member never came in to pay for.
 *
 * `sub_status` has no `cancelled` member, and migrating a production enum for
 * a row nobody will ever open again is a poor trade — so an abandoned order is
 * retired as `expired`. It leaves the queue, it releases the one-pending-per-
 * sport slot so the member can order again, and the audit row records who
 * retired it. An order with money already against it is not eligible: a desk
 * screen should not be able to make a payment stop pointing at anything.
 */
export async function subscriptionDecline(sql: Sql, id: string, user: PublicUser) {
  requireRole(user, ["receptionist", "manager"]);
  const sub = await one<{ id: string; status: string }>(
    sql,
    `select id, status from subscriptions where id = $1 for update`,
    [id],
  );
  if (!sub) throw err.notFound();
  if (sub.status !== "pending") throw err.conflictState("That order is no longer waiting for payment.");
  const paid = await one<{ paid: number }>(
    sql,
    `select coalesce(sum(amount_vnd) filter (where status = 'posted'), 0)::int as paid
       from payments where ref_type = 'subscription' and ref_id = $1`,
    [id],
  );
  if (Number(paid?.paid ?? 0) > 0) {
    throw err.conflictState("Money has already been taken against this order — refund it first.");
  }
  await sql.query(`update subscriptions set status = 'expired' where id = $1`, [id]);
  await audit(sql, user.id, "decline_plan_order", "subscription", id);
  return { status: 200, body: { ok: true } };
}

/**
 * Every receipt the signed-in member has paid for, newest first.
 *
 * Invoices hang off payments, and it is the payment that knows whose money it
 * was — so ownership is a join, not a column on the invoice.
 */
export async function invoicesMine(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["member", "receptionist", "manager"]);
  const sp = new URL(request.url).searchParams;
  const take = Math.min(100, Math.max(1, Number(sp.get("limit") ?? 30) || 30));
  const items = await sql.query(
    `select i.id, i.code, i.issued_at::text as issued_at,
            p.code as payment_code, p.method, p.amount_vnd, p.status, p.ref_type
       from invoices i
       join payments p on p.id = i.payment_id
      where p.user_id = $1
      order by i.issued_at desc
      limit $2`,
    [user.id, take],
  );
  return { status: 200, body: { items } };
}

export async function invoicePdf(sql: Sql, id: string, request: Request, user: PublicUser) {
  requireRole(user, ["manager", "receptionist", "member"]);
  const format = new URL(request.url).searchParams.get("format") === "80mm" ? "80mm" : "a5";
  const inv = await one<{
    id: string;
    code: string;
    payment_id: string;
    buyer_name: string;
    buyer_tax_code: string | null;
    buyer_address: string | null;
    form_no: string | null;
    serial_no: string | null;
    seller_legal_name: string | null;
    seller_tax_code: string | null;
    seller_address: string | null;
    subtotal_vnd: number | null;
    vat_rate: string | number | null;
    vat_vnd: number | null;
    total_vnd: number | null;
    issued_at: string;
  }>(
    sql,
    `select id, code, payment_id, buyer_name, buyer_tax_code, buyer_address,
            form_no, serial_no, seller_legal_name, seller_tax_code, seller_address,
            subtotal_vnd, vat_rate, vat_vnd, total_vnd, issued_at::text
       from invoices where id = $1`,
    [id],
  );
  if (!inv) throw err.notFound();
  const pay = await one<{ code: string; method: string; amount_vnd: number; user_id: string | null }>(
    sql,
    `select code, method, amount_vnd, user_id from payments where id = $1`,
    [inv.payment_id],
  );
  // Staff work the till and print anybody's receipt; a member may only see
  // their own. Invoice ids are UUIDs, but "unguessable" is not an access
  // control — without this a member could walk the whole centre's takings.
  if (user.role === "member" && pay?.user_id !== user.id) throw err.notFound();
  const lines = await sql.query<{
    description: string;
    unit: string | null;
    qty: number;
    unit_vnd: number;
    amount_vnd: number;
  }>(`select description, unit, qty, unit_vnd, amount_vnd from invoice_lines where invoice_id = $1`, [id]);

  // The seller block and the tax split are read off the invoice, not off
  // today's settings: an invoice states what was true when it was issued.
  // `settings` is only the fallback for a row written before 0014.
  const settings = await getSettings(sql);
  const total = inv.total_vnd ?? pay?.amount_vnd ?? 0;
  const vatRate = Number(inv.vat_rate ?? 0);
  const subtotal = inv.subtotal_vnd ?? Math.floor(total / (1 + vatRate / 100));

  const bytes = await renderInvoicePdf(
    {
      code: inv.code,
      form_no: inv.form_no,
      serial_no: inv.serial_no,
      issued_at: inv.issued_at,
      seller: {
        legal_name: inv.seller_legal_name ?? settings.legal_name ?? "Arena3 Sports Center",
        tax_code: inv.seller_tax_code ?? settings.tax_code,
        address: inv.seller_address ?? settings.address,
      },
      buyer: { name: inv.buyer_name, tax_code: inv.buyer_tax_code, address: inv.buyer_address },
      pay_code: pay?.code ?? "",
      method_label: methodLabelVi(pay?.method ?? ""),
      lines,
      subtotal_vnd: subtotal,
      vat_rate: vatRate,
      vat_vnd: inv.vat_vnd ?? total - subtotal,
      total_vnd: total,
    },
    format,
  );
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${inv.code}.pdf"`,
    },
  });
}

export async function reportsRevenue(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["manager"]);
  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") ?? ictDateString();
  const to = sp.get("to") ?? from;
  const rows = await sql.query<{
    method: string;
    ref_type: string;
    total: number;
    refunded: number;
    cnt: number;
  }>(
    `select method::text, ref_type,
            coalesce(sum(amount_vnd) filter (where amount_vnd >= 0),0)::int as total,
            coalesce(sum(-amount_vnd) filter (where amount_vnd < 0),0)::int as refunded,
            count(*)::int as cnt
       from payments
      where status = 'posted'
        and (created_at at time zone 'Asia/Ho_Chi_Minh')::date between $1::date and $2::date
      group by method, ref_type`,
    [from, to],
  );
  const money = rows.filter((r) => r.method !== "quota");
  const quota = rows.filter((r) => r.method === "quota");
  const gross = money.reduce((s, r) => s + r.total, 0);
  const refund = money.reduce((s, r) => s + r.refunded, 0);
  const by_source: Record<string, number> = {};
  const by_method: Record<string, number> = {};
  for (const r of money) {
    by_source[r.ref_type] = (by_source[r.ref_type] ?? 0) + r.total;
    by_method[r.method] = (by_method[r.method] ?? 0) + r.total;
  }
  const quotaHours = await one<{ hours: string | number }>(
    sql,
    `select coalesce(sum(quota_hours),0) as hours
       from court_bookings
      where quota_hours > 0
        and (start_at at time zone 'Asia/Ho_Chi_Minh')::date between $1::date and $2::date
        and status in ('confirmed','in_use','completed','no_show')`,
    [from, to],
  );
  // Revenue per ICT day, gapless across the whole window.
  //
  // The report could only ever be sliced by method and source, so the manager
  // screen had no way to draw a trend — the one question a revenue report is
  // usually opened to answer. generate_series supplies the days with no
  // takings too: dropping them would make a quiet Tuesday vanish and join
  // Monday straight to Wednesday, which reads as steady trade.
  const by_day = await sql.query<{ day: string; revenue_vnd: number }>(
    `select to_char(d.day, 'YYYY-MM-DD') as day,
            coalesce(sum(p.amount_vnd) filter (where p.method <> 'quota'), 0)::int as revenue_vnd
       from generate_series($1::date, $2::date, interval '1 day') as d(day)
       left join payments p
              on p.status = 'posted'
             and (p.created_at at time zone 'Asia/Ho_Chi_Minh')::date = d.day::date
      group by d.day
      order by d.day`,
    [from, to],
  );
  return {
    status: 200,
    body: {
      from,
      to,
      totals: { revenue_vnd: gross - refund, gross_vnd: gross, refund_vnd: refund, quota_hours: Number(quotaHours?.hours ?? 0) },
      by_source,
      by_method,
      by_day,
      quota_payments: quota,
      lines: money,
    },
  };
}

export async function reportsOccupancy(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["manager"]);
  const date = new URL(request.url).searchParams.get("date") ?? ictDateString();
  const rows = await sql.query<{ court_id: string; court_code: string; minutes: number }>(
    `select c.id as court_id, c.court_code,
            coalesce(sum(
              case when o.start_at is null then 0
                   else extract(epoch from (least(o.end_at, $2::timestamptz) - greatest(o.start_at, $1::timestamptz))) / 60
              end
            ),0)::int as minutes
       from courts c
       left join occupancies o
         on o.court_id = c.id and o.start_at < $2 and o.end_at > $1
      group by c.id, c.court_code
      order by c.court_code`,
    [`${date}T06:00:00+07:00`, `${date}T22:00:00+07:00`],
  );
  const openMin = 16 * 60;
  return {
    status: 200,
    body: {
      date,
      items: rows.map((r) => ({
        ...r,
        pct: Math.round((r.minutes / openMin) * 1000) / 10,
      })),
    },
  };
}

export async function settingsGet(sql: Sql, user: PublicUser) {
  requireRole(user, ["manager", "receptionist", "coach"]);
  const row = await one(sql, `select * from center_settings where id = 1`);
  return { status: 200, body: row };
}

export async function settingsPatch(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["manager"]);
  const b = await readJson(request);
  const allowed = [
    "open_time",
    "close_time",
    "hold_minutes",
    "book_ahead_days",
    "max_slots_per_day",
    "cancel_court_hours",
    "cancel_class_hours",
    "noshow_grace_minutes",
    "checkin_before_minutes",
    "debt_limit_vnd",
    "refund_manager_vnd",
    "minor_age",
    "vat_rate",
    "legal_name",
    "tax_code",
    "address",
    "freeze_max_days_year",
    "waitlist_offer_hours",
  ];
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const k of allowed) {
    if (b[k] !== undefined) {
      sets.push(`${k} = $${i}`);
      vals.push(b[k]);
      i += 1;
    }
  }
  if (!sets.length) return { status: 200, body: await one(sql, `select * from center_settings where id = 1`) };
  await sql.query(`update center_settings set ${sets.join(", ")} where id = 1`, vals);
  await audit(sql, user.id, "patch_settings", "settings", "1", null, b);
  return { status: 200, body: await one(sql, `select * from center_settings where id = 1`) };
}

export async function priceRulesGet(sql: Sql) {
  const items = await sql.query(
    `select id, sport, court_id, day_kind, start_local::text, end_local::text, price_vnd, is_peak
       from price_rules order by sport, day_kind, start_local`,
  );
  return { status: 200, body: { items } };
}

export async function priceRulesPut(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["manager"]);
  const b = await readJson(request);
  const items = Array.isArray(b.items) ? b.items : Array.isArray(b) ? b : null;
  if (!items) throw err.validation("items[] is required.");
  // The one thing standing between a fat-fingered (or malicious) PUT and a
  // court quoted at 99,999,999đ. Validate the whole table before touching a
  // row — `delete from price_rules` is not the place to discover row 9 was bad.
  const checked = validatePriceRules(items);
  if (!checked.ok) throw err.validation(checked.message, { index: checked.index });
  const before = await priceRulesGet(sql);
  await sql.query(`delete from price_rules`);
  for (const it of checked.rules) {
    await sql.query(
      `insert into price_rules (sport, court_id, day_kind, start_local, end_local, price_vnd, is_peak)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [it.sport, it.court_id, it.day_kind, it.start_local, it.end_local, it.price_vnd, it.is_peak],
    );
  }
  await audit(sql, user.id, "replace_prices", "price_rules", null, before.body, { items: checked.rules });
  return priceRulesGet(sql);
}

export async function auditList(sql: Sql, request: Request, user: PublicUser) {
  requireRole(user, ["manager"]);
  const sp = new URL(request.url).searchParams;
  // The actor's name, not just their id. An audit log answers "who did this",
  // and a column of UUIDs cannot be read by the person the log is for.
  const items = await sql.query(
    `select a.id, a.at, a.actor_id, u.full_name as actor_name, u.role as actor_role,
            a.action, a.entity, a.entity_id, a.before, a.after
       from audit_logs a
       left join users u on u.id = a.actor_id
      where ($1::text is null or a.action = $1)
      order by a.at desc
      limit 200`,
    [sp.get("action")],
  );
  // The distinct actions present, so the filter offers what actually exists
  // rather than a hard-coded list that drifts from the handlers.
  const actions = await sql.query<{ action: string }>(
    `select distinct action from audit_logs order by action`,
  );
  return { status: 200, body: { items, actions: actions.map((a) => a.action) } };
}
