import { createFileRoute, Link } from "@tanstack/react-router";
import { SectionTitle } from "@/components/section";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Banknote, Clock3, CreditCard, Landmark, Ticket, Undo2 } from "lucide-react";
import { HoldTimer } from "@/components/media";
import { PayOnlineButton } from "@/components/pay-online";
import { Shell, money, useSessionUser, when } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Input, Pagination, Seg, Select, Skeleton } from "@/components/ui";
import { Lift, Reveal, Stagger, StaggerItem, motion } from "@/components/motion";
import { GLBackground, SpotlightCard, StarBorder } from "@/components/fx";
import { PromoInput } from "@/components/promo-input";
import { api, apiGet, apiPost, openInvoice } from "@/lib/arena3/client";
import { sportLabel } from "@/lib/arena3/labels";
import { t, tk, tServer } from "@/lib/i18n";

export const Route = createFileRoute("/desk/payments")({
  component: Page,
});

type Order = {
  id: string;
  sport_scope: string;
  ordered_on: string;
  end_on: string;
  user_id: string;
  full_name: string;
  phone: string;
  member_code: string | null;
  plan_name: string;
  price_vnd: number;
  paid_vnd: number;
  plan_id: string;
  /** A code the member already put on the order in the app. */
  promo_code: string | null;
  promo_discount_vnd: number;
};

type Refund = {
  id: string;
  code: string;
  amount_vnd: number;
  created_at: string;
  ref_type: string;
  ref_id: string;
  member_name: string | null;
  member_code: string | null;
  raised_by: string | null;
};

/** A payment that has been posted — money the centre has actually taken. */
type Receipt = {
  id: string;
  code: string;
  method: string;
  amount_vnd: number;
  created_at: string;
  ref_type: string;
  member_name: string | null;
  member_code: string | null;
  buyer_phone: string | null;
  taken_by: string | null;
  invoice_id: string | null;
  /** 'manual' — a person asserted it. 'auto' — the gateway confirmed it. */
  capture_mode: "manual" | "auto" | null;
  provider: string | null;
};

/** A court held open against a promise to transfer, with nothing posted yet. */
type Awaiting = {
  id: string;
  code: string;
  price_vnd: number;
  start_at: string;
  end_at: string;
  transfer_requested_at: string;
  hold_until: string;
  court_code: string;
  sport: string;
  member_name: string | null;
  member_code: string | null;
  phone: string | null;
};

type Queue = {
  awaiting: Awaiting[];
  orders: Order[];
  refunds: Refund[];
  receipts: Receipt[];
  days: number;
  /** The receipt list hit its cap and there is more behind it. */
  capped: boolean;
};

// `gateway` is one of the five values `pay_method` allows, so a payment taken
// online was reachable only under "All" — and reconciliation is exactly the job
// where a method you cannot isolate is the one you need.
const METHODS = [
  { value: "all", label: tk("All") },
  { value: "cash", label: tk("Cash") },
  { value: "card", label: tk("Card") },
  { value: "transfer", label: tk("Transfer") },
  { value: "gateway", label: tk("Online") },
] as const;

function methodLabel(m: string) {
  const label = (
    {
      cash: tk("Cash"),
      card: tk("Card"),
      transfer: tk("Bank transfer"),
      gateway: tk("Online gateway"),
      quota: tk("Plan hours"),
    } as Record<string, string>
  )[m];
  return label ? t(label) : m;
}

/** What a payment or refund was raised against, in words the desk uses. */
function refTypeLabel(r: string) {
  const label = ({ subscription: tk("Plan"), booking: tk("Booking") } as Record<string, string>)[r];
  return label ? t(label) : r;
}

/* With one method in the list the icon was decoration; with four it is how you
   scan the column without reading every line. */
function MethodIcon({ method }: { method: string }) {
  const Icon =
    method === "cash" ? Banknote : method === "card" ? CreditCard : method === "quota" ? Ticket : Landmark;
  return <Icon className="size-4 shrink-0 text-muted" />;
}

/** Whole days between an ICT date string and today, floored at zero. */
function daysWaiting(dateOnly: string) {
  const then = new Date(`${dateOnly}T00:00:00+07:00`).getTime();
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function Page() {
  const me = useSessionUser();
  const isManager = me?.role === "manager";
  const [data, setData] = useState<Queue | null>(null);
  const [days, setDays] = useState("7");
  const [payMethod, setPayMethod] = useState("all");
  const [receiptQuery, setReceiptQuery] = useState("");
  const [receiptOffset, setReceiptOffset] = useState(0);
  // Whether this centre has payOS set up at all. Read once: the button must be
  // absent rather than present-and-broken when it has not been configured.
  const [onlineOn, setOnlineOn] = useState(false);
  useEffect(() => {
    void apiGet<{ capabilities?: { online_payment?: boolean } }>("/flags")
      .then((r) => setOnlineOn(Boolean(r.capabilities?.online_payment)))
      .catch(() => setOnlineOn(false));
  }, []);
  const [shift, setShift] = useState<{ shift: { id: string } } | null>(null);
  // Method and busy flag are per-order: the desk works one member at a time,
  // but a slow network should never grey out the whole queue.
  const [method, setMethod] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [promo, setPromo] = useState<Record<string, { code: string; discount_vnd: number } | null>>({});

  // `api` rather than `apiGet`: the de-duplicator hands back an identical GET
  // that is already in flight, and every refresh here runs straight after a
  // mutation. Two rows actioned in quick succession would otherwise let the
  // second one adopt the first one's older answer and redraw a row that has
  // just been paid for.
  const load = useCallback(async () => {
    setData(await api<Queue>(`/payments/pending?days=${days}`));
  }, [days]);

  useEffect(() => {
    void load().catch((e) => toast.error(e instanceof Error ? tServer(e.message) : t("Could not load the queue")));
  }, [load]);

  useEffect(() => {
    void apiGet<{ shift: { id: string } }>("/shifts/current")
      .then(setShift)
      .catch(() => setShift(null));
  }, []);

  const awaiting = data?.awaiting ?? [];
  const orders = data?.orders ?? [];
  const refunds = data?.refunds ?? [];
  // Filtered here rather than at the server: the cap is applied before the
  // filter either way, and narrowing a list already on screen should not cost a
  // round trip while somebody is reading down a statement.
  const needle = receiptQuery.trim().toLowerCase();
  const receipts = (data?.receipts ?? []).filter(
    (r) =>
      (payMethod === "all" || r.method === payMethod) &&
      (!needle ||
        [r.member_name, r.member_code, r.buyer_phone, r.code].some((v) => v?.toLowerCase().includes(needle))),
  );
  // Fifteen receipts a page: the statement used to be one unbroken column, hundreds of rows tall.
  const RECEIPT_PAGE = 15;
  useEffect(() => setReceiptOffset(0), [payMethod, days, receiptQuery]);
  const receiptPage = receipts.slice(receiptOffset, receiptOffset + RECEIPT_PAGE);
  // Per-row flooring, not a floor on the total: one over-paid order must not
  // quietly cancel out what another member still owes.
  const owed = orders.reduce((sum, o) => sum + Math.max(0, o.price_vnd - o.paid_vnd), 0);

  // A receptionist without an open till cannot post anything; saying so once at
  // the top beats a row of buttons that each fail the same way when pressed.
  const canTake = isManager || !!shift;

  /**
   * Refresh after a mutation that has already succeeded.
   *
   * Never rethrows. Once the server has taken the money, a failed refresh is a
   * stale screen, not a failed payment — letting it reach the caller's `catch`
   * would put "Payment did not go through" on top of a payment that went
   * through perfectly, which is the one lie this screen must not tell.
   */
  async function refresh() {
    try {
      await load();
    } catch {
      toast.warning(t("Done — but the queue could not be refreshed. Reload to see where it stands."));
    }
  }

  // What the desk is charging for an order: list price, less any code the member
  // already applied, less one the desk typed in. Partial payments are not taken (BR-12).
  const dueOf = useCallback(
    (o: Order) => o.price_vnd - (promo[o.id]?.discount_vnd ?? o.promo_discount_vnd),
    [promo],
  );

  async function takePayment(o: Order) {
    const due = dueOf(o);
    setBusy(o.id);
    try {
      const res = await apiPost<{ invoice: { id: string } }>(
        "/payments",
        {
          ref_type: "subscription",
          ref_id: o.id,
          method: method[o.id] ?? "cash",
          amount_vnd: due,
          ...(promo[o.id]?.code ? { promo_code: promo[o.id]!.code } : {}),
        },
        true,
      );
      toast.success(t("Paid — {name} is on {plan}", { name: o.full_name, plan: o.plan_name }));
      // The money is taken the moment that POST returns, so the queue is
      // refreshed before anything else is attempted. Printing is the step most
      // likely to fail — a blocked popup is enough — and a failed print must
      // not leave a paid row sitting here inviting somebody to charge it twice.
      await refresh();
      if (res.invoice?.id) {
        try {
          await openInvoice(res.invoice.id);
        } catch {
          toast.warning(t("Paid — but the receipt did not open. Reprint it from the member's profile."));
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? tServer(e.message) : t("Payment did not go through"));
    } finally {
      setBusy(null);
    }
  }

  async function decline(o: Order) {
    setBusy(o.id);
    try {
      await apiPost(`/subscriptions/${o.id}/decline`);
      toast.success(t("Order cleared from the queue"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? tServer(e.message) : t("Could not clear that order"));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Reconcile one awaited transfer.
   *
   * Confirming posts the money and prints the receipt; rejecting hands the
   * court straight back to whoever wants it next. Both are staff judgements
   * made against the bank statement, which is why neither is a member action.
   */
  async function settleTransfer(a: Awaiting, received: boolean) {
    setBusy(a.id);
    try {
      const res = await apiPost<{ invoice_id?: string }>(
        `/bookings/${a.id}/${received ? "transfer-confirm" : "transfer-reject"}`,
      );
      toast.success(
        received ? t("Confirmed — {court} is booked", { court: a.court_code }) : t("Slot released back to the grid"),
      );
      await refresh();
      if (received && res.invoice_id) {
        try {
          await openInvoice(res.invoice_id);
        } catch {
          toast.warning(t("Confirmed — but the receipt did not open. Reprint it from the profile."));
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? tServer(e.message) : t("Could not settle that transfer"));
    } finally {
      setBusy(null);
    }
  }

  async function settleRefund(r: Refund, approve: boolean) {
    setBusy(r.id);
    try {
      await apiPost(`/payments/${r.id}/${approve ? "approve-refund" : "reject-refund"}`);
      toast.success(approve ? t("Refund approved") : t("Refund rejected"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
    } finally {
      setBusy(null);
    }
  }

  // Managers reach this screen for the refund sign-offs; handing them the desk
  // nav afterwards would strand them a click away from their own reports.
  return (
    <Shell
      role={isManager ? "manager" : "receptionist"}
      title={t("Payments")}
      subtitle={t("Plans ordered in the app and waiting to be paid for, refunds waiting on a manager, and every receipt the centre has issued.")}
    >
      <GLBackground
        variant="dotgrid"
        position="fixed"
        className="-z-[1]"
        color="#1f5c43"
        gap={32}
        dot={1.5}
        radius={130}
        opacity={0.12}
      />

      <Reveal
        className="mb-6 flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] bg-surface p-3 shadow-[var(--shadow-border)]"
        from="down"
      >
        <Badge tone={orders.length ? "accent" : "muted"}>
          {t("{n} waiting · {amount} owed", { n: orders.length, amount: money(owed) })}
        </Badge>
        {awaiting.length ? (
          <Badge tone="hold">{t("{n} transfers to check", { n: awaiting.length })}</Badge>
        ) : null}
        {refunds.length ? <Badge tone="danger">{t("{n} refunds to sign off", { n: refunds.length })}</Badge> : null}
        {/*
          Point at the button rather than describing where it lives. The hint
          used to say "open a shift at the desk" and then leave the reader to
          find it.
        */}
        {!canTake ? (
          <Link to="/desk">
            <Badge tone="hold">{t("No shift open — open one to take payment")}</Badge>
          </Link>
        ) : null}
        {/* A manager came here from the manager menu, so "back" is their own
            home — `/desk` is the receptionist's counter, with a till they do not run. */}
        <Link to={isManager ? "/manager" : "/desk"} className="ml-auto">
          <Button variant="ink">{isManager ? t("Back to reports") : t("Back to the desk")}</Button>
        </Link>
      </Reveal>

      {awaiting.length ? (
        <div className="mb-10">
          <SectionTitle text={t("Transfers to check")} className="font-display text-2xl" />
          <p className="mt-1 text-sm text-muted">
            {t("A member said they would transfer and the court is being held open for them. Find the money on the statement before you confirm — nothing has been posted yet.")}
          </p>
          <Stagger className="mt-3 grid gap-3" gap={0.05}>
            {awaiting.map((a) => (
              <StaggerItem key={a.id}>
                <Lift>
                  <SpotlightCard className="rounded-[var(--radius-xl)]" size={420} strength={0.1}>
                    <Card className="relative z-[2] border border-hold/30 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Clock3 className="size-4 text-hold" />
                            <h3 className="font-display text-xl">{a.member_name ?? t("Walk-in")}</h3>
                            <Badge tone="hold">
                              <HoldTimer until={a.hold_until} onExpire={() => void refresh()} /> {t("left")}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs tabular-nums text-muted">
                            {a.member_code ?? t("No code yet")}
                            {a.phone ? ` · ${a.phone}` : ""} · {t("asked {time}", { time: when(a.transfer_requested_at) })}
                          </p>
                          <p className="mt-2 text-sm">
                            {a.code} · {a.court_code} · {sportLabel(a.sport)} ·{" "}
                            {when(a.start_at)}
                          </p>
                        </div>
                        <p className="font-display text-2xl tabular-nums">{money(a.price_vnd)}</p>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <StarBorder speed={4}>
                          <Button disabled={busy === a.id} onClick={() => void settleTransfer(a, true)}>
                            {t("Money received — confirm")}
                          </Button>
                        </StarBorder>
                        <Button
                          variant="outline"
                          disabled={busy === a.id}
                          onClick={() => void settleTransfer(a, false)}
                        >
                          {t("Not found — release")}
                        </Button>
                      </div>
                    </Card>
                  </SpotlightCard>
                </Lift>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      ) : null}

      <SectionTitle text={t("Waiting for payment")} className="font-display text-2xl" />
      <p className="mt-1 text-sm text-muted">
        {t("A member picked a plan in the app and still owes for it. Taking payment here activates the plan and prints the receipt.")}
      </p>
      {!data ? (
        <div className="mt-3 grid gap-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : orders.length ? (
        <Stagger className="mt-3 grid gap-3" gap={0.06}>
          {orders.map((o) => {
            // Floored at zero. An order can only reach this state through a
            // part payment plus a price change, or a refund posted back against
            // it — rare, but a negative balance would render "Take -200,000đ"
            // and then ask the server to take a negative payment.
            const due = Math.max(0, dueOf(o) - o.paid_vnd);
            const settled = due === 0;
            const waited = daysWaiting(o.ordered_on);
            return (
              <StaggerItem key={o.id}>
                <Lift>
                  <SpotlightCard className="rounded-[var(--radius-xl)]" size={420} strength={0.1}>
                    <Card className="relative z-[2] p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-display text-xl">{o.full_name}</h3>
                            <Badge tone="accent">{sportLabel(o.sport_scope)}</Badge>
                            {waited >= 3 ? (
                              <Badge tone="hold">{t("Waiting {n} days", { n: waited })}</Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs tabular-nums text-muted">
                            {o.member_code ?? t("No code yet")} · {o.phone}
                          </p>
                          <p className="mt-2 text-sm">
                            {o.plan_name} · {t("runs to {date}", { date: o.end_on })}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-display text-2xl tabular-nums">{money(due)}</p>
                          {o.paid_vnd > 0 ? (
                            <p className="text-xs tabular-nums text-muted">
                              {t("{paid} of {total} already taken", { paid: money(o.paid_vnd), total: money(o.price_vnd) })}
                            </p>
                          ) : (
                            <p className="text-xs text-muted">{t("Ordered {date}", { date: o.ordered_on })}</p>
                          )}
                        </div>
                      </div>

                      {o.promo_code ? (
                        <p className="mt-2 text-xs text-accent">
                          {t("{code} already applied: −{amount}", { code: o.promo_code, amount: money(o.promo_discount_vnd) })}
                        </p>
                      ) : o.paid_vnd === 0 ? (
                        <div className="mt-3 max-w-xs">
                          <PromoInput
                            scope="plan"
                            compact
                            target={{ plan_id: o.plan_id, user_id: o.user_id }}
                            onChange={(q) =>
                              setPromo((m) => ({ ...m, [o.id]: q ? { code: q.code, discount_vnd: q.discount_vnd } : null }))
                            }
                          />
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Select
                          className="w-auto"
                          value={method[o.id] ?? "cash"}
                          onChange={(e) => setMethod((m) => ({ ...m, [o.id]: e.target.value }))}
                          aria-label={t("Payment method for {name}", { name: o.full_name })}
                        >
                          <option value="cash">{t("Cash")}</option>
                          <option value="transfer">{t("Bank transfer")}</option>
                          <option value="card">{t("Card")}</option>
                        </Select>
                        <StarBorder speed={4}>
                          <Button
                            disabled={busy === o.id || !canTake || settled}
                            onClick={() => void takePayment(o)}
                          >
                            {settled
                              ? t("Paid in full — ask a manager")
                              : canTake
                                ? t("Take {amount} & print", { amount: money(due) })
                                : t("Open a shift first")}
                          </Button>
                        </StarBorder>
                        {/*
                          The counter case. The customer is standing here; this
                          puts a QR on reception's screen for them to scan, and
                          the payment posts when payOS confirms it — reception
                          never asserts that the money arrived.
                        */}
                        {onlineOn && !settled && due > 0 ? (
                          <PayOnlineButton
                            refType="subscription"
                            refId={o.id}
                            label={t("Online {amount}", { amount: money(due) })}
                            onPaid={() => void load()}
                          />
                        ) : null}
                        <Link to="/desk/member/$id" params={{ id: o.user_id }}>
                          <Button variant="outline">
                            {t("Profile")} <ArrowUpRight className="ml-1 size-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          className="ml-auto"
                          disabled={busy === o.id || o.paid_vnd > 0}
                          onClick={() => void decline(o)}
                        >
                          {t("Clear")}
                        </Button>
                      </div>
                    </Card>
                  </SpotlightCard>
                </Lift>
              </StaggerItem>
            );
          })}
        </Stagger>
      ) : (
        <div className="mt-3">
          <EmptyState title={t("Nothing owed")} hint={t("Every plan ordered in the app has been paid for.")} />
        </div>
      )}

      {refunds.length ? (
        <div className="mt-10">
          <SectionTitle text={t("Refunds waiting for a manager")} className="font-display text-2xl" />
          <p className="mt-1 text-sm text-muted">
            {t("Raised at the desk above the receptionist limit.")} {isManager ? t("Sign them off here.") : t("A manager has to sign these off.")}
          </p>
          <Stagger className="mt-3 grid gap-3" gap={0.05}>
            {refunds.map((r) => (
              <StaggerItem key={r.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <Undo2 className="size-4 text-muted" />
                      <span className="font-medium">{r.member_name ?? t("Walk-in")}</span>
                      <Badge tone="danger">{money(Math.abs(r.amount_vnd))}</Badge>
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-muted">
                      {r.code} · {refTypeLabel(r.ref_type)} · {t("raised by {name}", { name: r.raised_by ?? "—" })} · {when(r.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={!isManager || busy === r.id}
                      onClick={() => void settleRefund(r, false)}
                    >
                      {t("Reject")}
                    </Button>
                    <Button disabled={!isManager || busy === r.id} onClick={() => void settleRefund(r, true)}>
                      {t("Approve")}
                    </Button>
                  </div>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      ) : null}

      <div className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle text={t("Receipts")} className="font-display text-2xl" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="kicker text-2xs text-muted">{t("Paid by")}</span>
            <Seg value={payMethod} onChange={setPayMethod} options={METHODS.map((m) => ({ value: m.value, label: t(m.label) }))} />
            <span className="kicker ml-1 text-2xs text-muted">{t("Last")}</span>
            <Seg
              value={days}
              onChange={setDays}
              options={[
                { value: "7", label: t("7 days") },
                { value: "14", label: t("14 days") },
                { value: "30", label: t("30 days") },
              ]}
            />
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">
          {t("Every payment the centre has taken, however it was paid — cash at the counter, a card, a transfer off the statement, or a court settled in the app. Each one has its receipt here.")}
        </p>
        <Input
          className="mt-3 sm:max-w-sm"
          placeholder={t("Search name, phone or receipt no.")}
          value={receiptQuery}
          onChange={(e) => setReceiptQuery(e.target.value)}
          aria-label={t("Search receipts")}
        />
        {!data ? (
          <Skeleton className="mt-3 h-24" />
        ) : receipts.length ? (
          <Stagger key={receiptOffset} className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2" gap={0.04}>
            {receiptPage.map((rc) => (
              <StaggerItem key={rc.id}>
                <motion.div
                  className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] bg-surface px-4 py-3 shadow-[var(--shadow-border)]"
                  whileHover={{ x: 2 }}
                  transition={{ type: "spring", stiffness: 320, damping: 26 }}
                >
                  <MethodIcon method={rc.method} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{rc.member_name ?? t("Walk-in")}</p>
                    <p className="truncate text-xs tabular-nums text-muted">
                      {rc.code} · {methodLabel(rc.method)} · {refTypeLabel(rc.ref_type)} · {when(rc.created_at)}
                      {rc.buyer_phone && !rc.member_code ? ` · ${rc.buyer_phone}` : ""}
                      {rc.taken_by ? ` · ${rc.taken_by}` : ""}
                    </p>
                  </div>
                  {/*
                    Who says this money arrived. "Manual" is a member of staff's
                    word — cash counted, a card slip, a statement read by eye.
                    "Auto" was confirmed by the payment provider's own API with
                    nobody asserting anything. A till that cannot tell the two
                    apart cannot be reconciled honestly, so the distinction is
                    on the row rather than buried in the record.
                  */}
                  <Badge tone={rc.capture_mode === "auto" ? "accent" : "muted"}>
                    {rc.capture_mode === "auto" ? t("Auto") : t("Manual")}
                  </Badge>
                  <span className="ml-auto font-medium tabular-nums">{money(rc.amount_vnd)}</span>
                  {rc.invoice_id ? (
                    <Button size="sm" variant="ghost" onClick={() => void openInvoice(rc.invoice_id!)}>
                      {t("Receipt")}
                    </Button>
                  ) : null}
                </motion.div>
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <div className="mt-3">
            <EmptyState
              title={payMethod === "all" ? t("Nothing taken in this window") : t("No {method} in this window", { method: methodLabel(payMethod).toLowerCase() })}
              hint={t("Widen the range, or try another method.")}
            />
          </div>
        )}
        <Pagination offset={receiptOffset} total={receipts.length} pageSize={RECEIPT_PAGE} onChange={setReceiptOffset} />
        {data?.capped ? (
          <p className="mt-3 text-xs text-muted">
            {t("Showing the {n} most recent — there are older receipts in this window that this list does not reach. Pull the full period from Reports to reconcile it.", { n: data.receipts.length })}
          </p>
        ) : null}
      </div>
    </Shell>
  );
}
