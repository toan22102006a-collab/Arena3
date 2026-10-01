import type { Sql } from "@/lib/db";
import { err } from "../errors";
import {
  audit,
  enqueueReceipt,
  getSettings,
  issueInvoice,
  nextCode,
  nextOrderCode,
  readJson,
  str,
} from "../helpers";
import {
  cancelPaymentLink,
  createPaymentLink,
  describeForGateway,
  payosConfigured,
  readPaymentLink,
  verifyWebhook,
} from "../payos";
import { requireRole, type PublicUser } from "../session";
import { one } from "../tx";
import { settleHeldBooking } from "./bookings";

/**
 * Online payment through payOS.
 *
 * The rule the whole file is built around: **money is posted when payOS says
 * it moved, and at no other moment.** A customer landing back on the return URL
 * proves nothing — that address can be opened by anybody, in any order, any
 * number of times. Every path that posts money here has first either polled
 * payOS or verified a webhook signature.
 *
 * Both the member's phone and the front desk use the same two endpoints. The
 * desk case is the common one in this centre: the customer is standing at the
 * counter, reception raises the link, shows the QR on screen, and the customer
 * scans it with their banking app. Reception never types "received" — the
 * confirmation comes from payOS, and the payment is stamped `capture_mode =
 * 'auto'` so the till can tell the two kinds of money apart.
 */

/** A payment the gateway has been told about but has not confirmed. */
type PendingPayment = {
  id: string;
  code: string;
  user_id: string | null;
  amount_vnd: number;
  status: string;
  ref_type: string;
  ref_id: string;
  provider_order_code: string | number | null;
};

function baseUrlOf(request: Request): string {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

/**
 * Post a confirmed online payment, whatever told us about it.
 *
 * Poll and webhook both land here so they cannot drift apart. Called inside a
 * transaction with the payment row already locked.
 */
async function settleOnline(
  sql: Sql,
  pay: PendingPayment,
  paid: { amountPaid: number; transactionId: string | null; providerStatus: string },
): Promise<{ posted: boolean; reason?: string }> {
  if (pay.status === "posted") return { posted: true };

  // Never trust an amount from outside. A confirmation for less than the price
  // is a partial payment, not a paid booking.
  if (paid.amountPaid < pay.amount_vnd) {
    return { posted: false, reason: `paid ${paid.amountPaid} of ${pay.amount_vnd}` };
  }

  await sql.query(
    `update payments
        set status = 'posted', capture_mode = 'auto', provider = 'payos',
            provider_txn_id = $2, provider_status = $3, paid_at = now()
      where id = $1`,
    [pay.id, paid.transactionId, paid.providerStatus],
  );

  if (pay.ref_type === "booking") {
    const booking = await one<Parameters<typeof settleHeldBooking>[1]>(
      sql,
      `select * from court_bookings where id = $1 for update`,
      [pay.ref_id],
    );
    if (!booking) throw err.notFound("That booking no longer exists.");
    const court = await one<{ court_code: string }>(
      sql,
      `select court_code from courts where id = $1`,
      [booking.court_id],
    );
    // Reuses the same settle path as cash at the desk — occupancy confirmed,
    // invoice issued, member notified — against the row that already exists.
    await settleHeldBooking(sql, booking, court!, {
      method: "gateway",
      payAmount: pay.amount_vnd,
      quotaHours: 0,
      buyerName: "",
      actorId: pay.user_id ?? "",
      existingPaymentId: pay.id,
    });
    return { posted: true };
  }

  if (pay.ref_type === "subscription") {
    const sub = await one<{ user_id: string; plan_id: string }>(
      sql,
      `select user_id, plan_id from subscriptions where id = $1`,
      [pay.ref_id],
    );
    if (!sub) throw err.notFound("That plan order no longer exists.");
    const plan = await one<{ name: string; duration_days: number; price_vnd: number }>(
      sql,
      `select name, duration_days, price_vnd from membership_plans where id = $1`,
      [sub.plan_id],
    );
    await sql.query(
      `update subscriptions
          set status = 'active',
              start_on = coalesce(start_on, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
              end_on = coalesce(start_on, (now() at time zone 'Asia/Ho_Chi_Minh')::date)
                       + ($2::int * interval '1 day')
        where id = $1`,
      [pay.ref_id, plan?.duration_days ?? 30],
    );
    const buyer = await one<{ full_name: string }>(sql, `select full_name from users where id = $1`, [
      sub.user_id,
    ]);
    const settings = await getSettings(sql);
    const invoiceId = await issueInvoice(sql, {
      paymentId: pay.id,
      buyerName: buyer?.full_name ?? "Khách hàng",
      amountVnd: pay.amount_vnd,
      vatRate: Number(settings.vat_rate ?? 0),
      description: plan ? `Gói hội viên — ${plan.name}` : "Gói hội viên",
      unit: "gói",
      settings,
    });
    await enqueueReceipt(sql, sub.user_id, {
      payment_id: pay.id,
      invoice_id: invoiceId,
      amount_vnd: pay.amount_vnd,
      method: "gateway",
    });
    return { posted: true };
  }

  throw err.validation(`Online payment does not cover ${pay.ref_type}.`);
}

/**
 * How far the order sequence has got, and the note that travels with it.
 *
 * Deliberately readable without signing in. It exposes no money, no member and
 * no key — only a counter and a reminder — and it needs to be readable by the
 * operator standing in front of a half-migrated database, which is exactly the
 * moment nobody can sign in.
 */
export async function onlineSequence(sql: Sql) {
  const row = await one<{
    provider: string;
    last_order_code: string | number;
    updated_at: string;
    note: string | null;
  }>(
    sql,
    `select provider, last_order_code, updated_at::text, note
       from provider_sequences where provider = 'payos'`,
  );
  return {
    status: 200,
    body: row
      ? {
          provider: row.provider,
          last_order_code: Number(row.last_order_code),
          updated_at: row.updated_at,
          note: row.note,
        }
      : { provider: "payos", last_order_code: null },
  };
}

/**
 * Raise a payment link for something already owed.
 *
 * A member may only do this for their own held court. Staff may do it for
 * anybody, which is the counter case: the customer is at the desk and will
 * scan the QR that appears on reception's screen.
 */
export async function onlineCreate(sql: Sql, request: Request, user: PublicUser) {
  if (!payosConfigured()) {
    throw err.br("C-08", "Online payment is not switched on for this centre.");
  }
  const b = await readJson(request);
  const refType = str(b.ref_type) ?? "booking";
  const refId = str(b.ref_id);
  if (!refId) throw err.validation("ref_id is required.");

  const staff = user.role === "receptionist" || user.role === "manager";
  let amount = 0;
  let payerId: string | null = null;
  let label = "";

  if (refType === "booking") {
    const booking = await one<{
      id: string;
      user_id: string;
      status: string;
      price_vnd: number;
      hold_until: string | null;
    }>(sql, `select id, user_id, status, price_vnd, hold_until from court_bookings where id = $1`, [refId]);
    if (!booking) throw err.notFound();
    if (!staff && booking.user_id !== user.id) throw err.forbidden();
    if (booking.status !== "hold") throw err.conflictState("That booking is not waiting for payment.");
    if (!booking.hold_until || new Date(booking.hold_until) < new Date()) throw err.holdExpired();
    amount = booking.price_vnd;
    payerId = booking.user_id;
    label = "court";
  } else if (refType === "subscription") {
    // Members order plans in the app but pay at the desk, so raising a link for
    // one is reception's job.
    if (!staff) throw err.forbidden("Ask the front desk to take payment for a plan.");
    const sub = await one<{ user_id: string; plan_id: string; status: string }>(
      sql,
      `select user_id, plan_id, status from subscriptions where id = $1`,
      [refId],
    );
    if (!sub) throw err.notFound();
    // A link settles by activating the order, so it only makes sense for one
    // still waiting for money (D-01).
    if (sub.status !== "pending") throw err.conflictState("That plan is not waiting for payment.");
    const plan = await one<{ price_vnd: number }>(
      sql,
      `select price_vnd from membership_plans where id = $1`,
      [sub.plan_id],
    );
    amount = plan?.price_vnd ?? 0;
    payerId = sub.user_id;
    label = "plan";
  } else {
    throw err.validation("Online payment covers courts and plans.");
  }

  if (amount <= 0) throw err.validation("There is nothing to pay.");

  // One live link per thing being paid for. Without this, pressing the button
  // twice leaves two pending rows and the second confirmation has no order to
  // attach to.
  const existing = await one<PendingPayment>(
    sql,
    `select id, code, user_id, amount_vnd, status::text as status, ref_type, ref_id, provider_order_code
       from payments
      where ref_type = $1 and ref_id = $2 and status::text = 'pending' and provider = 'payos'
      order by created_at desc limit 1`,
    [refType, refId],
  );
  if (existing?.provider_order_code) {
    const state = await readPaymentLink(Number(existing.provider_order_code));
    if (state.status === "PENDING") {
      return {
        status: 200,
        body: {
          payment_id: existing.id,
          order_code: Number(existing.provider_order_code),
          amount_vnd: existing.amount_vnd,
          reused: true,
        },
      };
    }
  }

  const settings = await getSettings(sql);
  const shiftId = staff
    ? (
        await one<{ id: string }>(
          sql,
          `select id from cashier_shifts where receptionist_id = $1 and closed_at is null`,
          [user.id],
        )
      )?.id ?? null
    : null;
  const base = baseUrlOf(request);

  /*
   * Allocate a code, ask payOS for a link, and move on if that code is taken.
   *
   * `nextOrderCode` comes from the clock and a recorded high-water mark, so a
   * collision should not happen at all. The retry is here for the one case it
   * cannot rule out: an order code spent at payOS by something other than this
   * database — an earlier install, a colleague's machine sharing the merchant
   * account, a test script.
   *
   * Each pass genuinely advances now. The previous version derived the code
   * from the document counter and, on giving up, threw — which rolled back the
   * whole transaction including every counter increment, so the next request
   * started from exactly the same number and failed in exactly the same way,
   * forever. Nothing in this loop depends on the counter any more.
   *
   * Two attempts, not five: payOS rate-limits at five calls a minute, and
   * burning that budget on retries is how one stuck payment becomes several.
   */
  let pay: { id: string } | null = null;
  let payCode = "";
  let orderCode = 0;
  let link = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2 && !link; attempt += 1) {
    const code = await nextCode(sql, "PAY");
    payCode = code;
    orderCode = await nextOrderCode(sql, "payos");

    // The row exists before the link does, so a confirmation always has
    // somewhere to land — and it is `pending`, which no report counts.
    pay = (await one<{ id: string }>(
      sql,
      `insert into payments
         (code, user_id, shift_id, method, amount_vnd, vat_rate, status, ref_type, ref_id,
          created_by, capture_mode, provider, provider_order_code, provider_status)
       values ($1,$2,$3,'gateway',$4,$5,'pending',$6,$7,$8,'auto','payos',$9,'PENDING')
       returning id`,
      [code, payerId, shiftId, amount, Number(settings.vat_rate ?? 0), refType, refId, user.id, orderCode],
    )) ?? null;

    try {
      link = await createPaymentLink({
        orderCode,
        amountVnd: amount,
        description: describeForGateway(code),
        // The payment's own id travels in the URL we control, so the return
        // page has something to ask about without looking one up by order code.
        returnUrl: `${base}/pay/return?pid=${pay!.id}`,
        cancelUrl: `${base}/pay/return?pid=${pay!.id}&cancelled=1`,
        // Outliving the court hold would let somebody pay for a slot that has
        // already been released to another member.
        expiresInSeconds: settings.transfer_hold_minutes * 60,
      });
    } catch (e) {
      lastError = e;
      // 231 — payOS already has an order with this code.
      const taken = (e as { code?: string })?.code === "231";
      // The row for a code payOS refused is not a payment of any kind.
      await sql.query(`update payments set status = 'failed', provider_status = $2 where id = $1`, [
        pay!.id,
        taken ? "ORDER_CODE_TAKEN" : "CREATE_FAILED",
      ]);
      pay = null;
      if (!taken) throw e;
      console.warn(`[payos] order code ${orderCode} already exists — taking the next one`);
    }
  }

  if (!link || !pay) {
    console.error("[payos] could not issue a payment link", lastError);
    throw err.br("C-09", "Could not start the online payment. Take it at the desk instead.");
  }

  await audit(sql, user.id, "online_link", "payment", pay!.id);
  return {
    status: 201,
    body: {
      payment_id: pay!.id,
      payment_code: payCode,
      order_code: orderCode,
      amount_vnd: amount,
      checkout_url: link.checkoutUrl,
      qr_code: link.qrCode,
      expires_at: link.expiredAt,
      for: label,
      /** Whoever raised it: the desk shows the QR, a member is redirected. */
      raised_by: staff ? "desk" : "member",
    },
  };
}

/**
 * Ask payOS whether a link has been paid, and post it if so.
 *
 * Safe to call repeatedly — from the return page, from reception's screen while
 * the customer scans, or from a job. Posting is guarded by the payment's own
 * status, so the second call through finds the work already done.
 */
export async function onlineVerify(sql: Sql, id: string, user: PublicUser) {
  const pay = await one<PendingPayment>(
    sql,
    `select id, code, user_id, amount_vnd, status::text as status, ref_type, ref_id, provider_order_code
       from payments where id = $1 for update`,
    [id],
  );
  if (!pay) throw err.notFound();
  const staff = user.role === "receptionist" || user.role === "manager";
  if (!staff && pay.user_id !== user.id) throw err.forbidden();
  if (!pay.provider_order_code) throw err.validation("That payment was not taken online.");
  if (pay.status === "posted") {
    return { status: 200, body: { status: "posted", payment_id: pay.id, amount_vnd: pay.amount_vnd } };
  }

  const state = await readPaymentLink(Number(pay.provider_order_code));
  if (state.status !== "PAID") {
    if (state.status === "CANCELLED" || state.status === "EXPIRED") {
      await sql.query(
        `update payments set status = $2::pay_status, provider_status = $3 where id = $1`,
        [pay.id, state.status === "EXPIRED" ? "expired" : "failed", state.status],
      );
    }
    return {
      status: 200,
      body: { status: state.status.toLowerCase(), payment_id: pay.id, amount_vnd: pay.amount_vnd },
    };
  }

  const settled = await settleOnline(sql, pay, {
    amountPaid: state.amountPaid,
    transactionId: state.transactionId,
    providerStatus: state.status,
  });
  if (!settled.posted) {
    return {
      status: 200,
      body: { status: "underpaid", detail: settled.reason, payment_id: pay.id, amount_vnd: pay.amount_vnd },
    };
  }
  await audit(sql, user.id, "online_paid", "payment", pay.id);
  return { status: 200, body: { status: "posted", payment_id: pay.id, amount_vnd: pay.amount_vnd } };
}

/**
 * payOS calling to say a link was paid.
 *
 * Public by necessity — payOS holds no session — so the signature is the only
 * thing standing between this endpoint and anybody on the internet posting
 * themselves a free court. An unverifiable body is discarded without reading
 * its contents.
 *
 * payOS retries, and sends a test call when the URL is registered, so this is
 * written to be safe to receive any number of times. It always answers 200:
 * a non-2xx makes payOS retry, and the one thing worse than missing a
 * confirmation is a retry storm over a payment already posted.
 */
export async function payosWebhook(sql: Sql, request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 200, body: { received: true, note: "unreadable body" } };
  }

  let verified;
  try {
    verified = await verifyWebhook(body);
  } catch {
    // Not from payOS, or tampered with. Say nothing useful back.
    return { status: 200, body: { received: true } };
  }

  const pay = await one<PendingPayment>(
    sql,
    `select id, code, user_id, amount_vnd, status::text as status, ref_type, ref_id, provider_order_code
       from payments where provider_order_code = $1 for update`,
    [verified.orderCode],
  );
  // payOS sends a probe with a dummy order code when the URL is registered.
  if (!pay) return { status: 200, body: { received: true } };

  const settled = await settleOnline(sql, pay, {
    amountPaid: verified.amount,
    transactionId: verified.reference,
    providerStatus: "PAID",
  });
  if (settled.posted) await audit(sql, null, "online_paid_webhook", "payment", pay.id);
  return { status: 200, body: { received: true } };
}

/**
 * Withdraw links for holds that have since lapsed.
 *
 * Run from the job loop. A link that outlives its court is a customer paying
 * for a slot somebody else now has; cancelling it at payOS is what stops the
 * money arriving in the first place, which is much easier than refunding it.
 */
export async function expireOnlineLinks(sql: Sql): Promise<number> {
  if (!payosConfigured()) return 0;
  const stale = await sql.query<{ id: string; provider_order_code: string }>(
    `select p.id, p.provider_order_code
       from payments p
       left join court_bookings b on p.ref_type = 'booking' and b.id = p.ref_id
      where p.status::text = 'pending'
        and p.provider = 'payos'
        and p.provider_order_code is not null
        and (b.id is null or b.status <> 'hold' or b.hold_until < now())`,
  );
  for (const row of stale) {
    try {
      await cancelPaymentLink(Number(row.provider_order_code), "Hold expired");
    } catch {
      // Already cancelled or already paid at payOS; the status update below
      // still has to happen either way.
    }
    await sql.query(`update payments set status = 'expired', provider_status = 'EXPIRED' where id = $1`, [
      row.id,
    ]);
  }
  return stale.length;
}
