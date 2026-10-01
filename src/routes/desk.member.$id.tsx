import { createFileRoute } from "@tanstack/react-router";
import { PayOnlineButton } from "@/components/pay-online";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell, money, useSessionUser, when } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Modal, Skeleton, StatusBadge, Textarea } from "@/components/ui";
import { Lift, Reveal, Stagger, StaggerItem } from "@/components/motion";
import { SplitText, SpotlightCard } from "@/components/fx";
import { apiGet, apiPost, openInvoice } from "@/lib/arena3/client";
import { METHOD_LABEL, formatDate, sportLabel } from "@/lib/arena3/labels";

export const Route = createFileRoute("/desk/member/$id")({
  component: Page,
});

type Payment = {
  id: string;
  code: string;
  method: string;
  amount_vnd: number;
  status: string;
  created_at: string;
  ref_type: string;
  invoice_id: string | null;
  /** What is left of this payment after everything already sent back. */
  refundable_vnd: number;
};

/** Digits only, so a typed "1.500.000" or "1,500,000" still means 1500000. */
function parseVnd(raw: string) {
  const digits = raw.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function Page() {
  const { id } = Route.useParams();
  const me = useSessionUser();
  const [data, setData] = useState<{
    user: { full_name: string; phone: string; member_code: string | null };
    debt_vnd: number;
    subscriptions: Array<{
      id: string;
      status: string;
      plan_name: string;
      end_on: string;
      sport_scope: string;
      court_hours_left: number;
      frozen_days?: number;
    }>;
    payments: Payment[];
    today: {
      bookings: Array<{ id: string; code: string; start_at: string; status: string; court_code: string }>;
      classes: unknown[];
    };
  } | null>(null);
  // Leave the online button out when the centre has no payOS keys, rather
  // than offering reception a button that errors in front of a customer.
  const [onlineOn, setOnlineOn] = useState(false);
  useEffect(() => {
    void apiGet<{ capabilities?: { online_payment?: boolean } }>("/flags")
      .then((r) => setOnlineOn(Boolean(r.capabilities?.online_payment)))
      .catch(() => setOnlineOn(false));
  }, []);
  const [plans, setPlans] = useState<Array<{ id: string; name: string; price_vnd: number }>>([]);
  // The payment a refund is being raised against, plus what the desk typed.
  const [refunding, setRefunding] = useState<Payment | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);

  async function load() {
    setData(await apiGet(`/members/${id}`));
  }
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
    void apiGet<{ items: Array<{ id: string; name: string; price_vnd: number }> }>("/plans").then((r) =>
      setPlans(r.items),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function openRefund(p: Payment) {
    setRefunding(p);
    // Pre-filled with the whole refundable amount, because a full refund is
    // what nearly every one of these is; a part refund is a deliberate edit.
    setRefundAmount(String(p.refundable_vnd));
    setRefundReason("");
  }

  async function submitRefund() {
    if (!refunding) return;
    const amount = parseVnd(refundAmount);
    if (amount <= 0 || amount > refunding.refundable_vnd) return;
    setRefundBusy(true);
    try {
      const res = await apiPost<{ payment: { status: string } }>(
        `/payments/${refunding.id}/refund`,
        { amount_vnd: amount, reason: refundReason.trim() },
        true,
      );
      // Above a receptionist's limit the server parks it instead of paying it.
      // Saying "Refunded" either way would have the desk hand over cash for a
      // refund no manager has signed off yet.
      toast.success(
        res.payment?.status === "refund_pending"
          ? "Raised — a manager has to sign this off before the money moves"
          : `Refunded ${money(amount)}`,
      );
      setRefunding(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not raise that refund");
    } finally {
      setRefundBusy(false);
    }
  }

  if (!data) {
    return (
      <Shell role="receptionist" title="Member">
        <Skeleton className="h-40" />
      </Shell>
    );
  }

  const refundTyped = parseVnd(refundAmount);
  const refundInvalid = !refunding
    ? ""
    : refundTyped <= 0
      ? "Enter an amount."
      : refundTyped > refunding.refundable_vnd
        ? `Only ${money(refunding.refundable_vnd)} of this payment is still refundable.`
        : "";

  return (
    <Shell role="receptionist" title={data.user.full_name} subtitle={`${data.user.member_code} · ${data.user.phone}`}>
      <p className="mb-4 text-sm">
        Outstanding balance <span className="tabular-nums font-medium">{money(data.debt_vnd)}</span>
      </p>
      <Stagger className="grid gap-3 md:grid-cols-2" gap={0.07}>
        {data.subscriptions.map((s) => (
          <StaggerItem key={s.id} className="h-full">
          <Lift className="h-full">
          <SpotlightCard className="h-full rounded-[var(--radius-xl)]" size={320} strength={0.1}>
          <Card interactive className="relative z-[2] h-full">
            <StatusBadge status={s.status} />
            <h2 className="mt-2 font-display text-2xl">{s.plan_name}</h2>
            <p className="text-sm text-muted">
              {sportLabel(s.sport_scope)} · through {formatDate(s.end_on)} · {Number(s.court_hours_left)} court hours
            </p>
            {s.status === "pending" || s.status === "active" ? (
              <Button
                className="mt-3"
                onClick={async () => {
                  const plan = plans.find((p) => p.name === s.plan_name);
                  const amt = plan?.price_vnd ?? 0;
                  try {
                    const res = await apiPost<{ invoice: { id: string } }>(
                      "/payments",
                      { ref_type: "subscription", ref_id: s.id, method: "cash", amount_vnd: amt },
                      true,
                    );
                    toast.success("Payment recorded");
                    await load();
                    if (res.invoice?.id) await openInvoice(res.invoice.id);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Something went wrong");
                  }
                }}
              >
                Take payment
              </Button>
            ) : null}
            {/*
              The counter case for a plan: the customer is at the desk, this
              puts a QR on reception's screen and the payment posts when payOS
              confirms it. Sits beside "Take payment" — which is cash, and is
              reception's word — so the two are never confused.
            */}
            {onlineOn && (s.status === "pending" || s.status === "active") ? (
              <PayOnlineButton
                refType="subscription"
                refId={s.id}
                label="Pay online"
                size="md"
                variant="outline"
                onPaid={() => void load()}
              />
            ) : null}
            {s.status === "active" ? (
              <Button
                className="mt-2"
                variant="outline"
                onClick={async () => {
                  try {
                    await apiPost(`/subscriptions/${s.id}/freeze`, { days: 7 });
                    toast.success("Frozen for 7 days — the end date moves out to match");
                    await load();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not freeze the plan");
                  }
                }}
              >
                Freeze for 7 days
              </Button>
            ) : null}
            {s.status === "frozen" ? (
              <Button
                className="mt-3"
                onClick={async () => {
                  try {
                    await apiPost(`/subscriptions/${s.id}/unfreeze`);
                    toast.success("Plan resumed");
                    await load();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Something went wrong");
                  }
                }}
              >
                Resume plan
              </Button>
            ) : null}
          </Card>
          </SpotlightCard>
          </Lift>
          </StaggerItem>
        ))}
      </Stagger>

      <SplitText as="h2" text="Sell another plan" className="mt-8 font-display text-2xl" />
      <Reveal className="mt-3 flex flex-wrap gap-2">
        {plans.map((p) => (
          <Button
            key={p.id}
            variant="outline"
            onClick={async () => {
              try {
                await apiPost("/subscriptions", { plan_id: p.id, user_id: id });
                toast.success("Order created — take payment to activate");
                await load();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Something went wrong");
              }
            }}
          >
            {p.name} · {money(p.price_vnd)}
          </Button>
        ))}
      </Reveal>

      <SplitText as="h2" text="Payments" className="mt-8 font-display text-2xl" />
      <p className="mt-1 text-sm text-muted">
        The last twenty movements on this member&rsquo;s account. Refunds raised here go straight
        out if they are within your limit, and to a manager if they are not.
      </p>
      <Stagger className="mt-3 grid gap-2" gap={0.04}>
        {data.payments.map((p) => {
          const isRefund = p.amount_vnd < 0;
          return (
            <StaggerItem key={p.id}>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{money(Math.abs(p.amount_vnd))}</span>
                    {isRefund ? <Badge tone="danger">Refund</Badge> : null}
                    {p.status === "refund_pending" ? <Badge tone="hold">Awaiting a manager</Badge> : null}
                    {p.status === "refund_rejected" ? <Badge tone="muted">Rejected</Badge> : null}
                  </div>
                  <p className="mt-1 truncate text-xs tabular-nums text-subtle">
                    {p.code} · {(METHOD_LABEL[p.method] ?? p.method)} · {p.ref_type} · {when(p.created_at)}
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {p.invoice_id ? (
                    <Button size="sm" variant="ghost" onClick={() => void openInvoice(p.invoice_id!)}>
                      Receipt
                    </Button>
                  ) : null}
                  {!isRefund && p.status === "posted" && p.refundable_vnd > 0 ? (
                    <Button size="sm" variant="outline" onClick={() => openRefund(p)}>
                      Refund
                    </Button>
                  ) : null}
                </div>
              </Card>
            </StaggerItem>
          );
        })}
        {!data.payments.length ? (
          <p className="text-sm text-muted">Nothing has been taken from this member yet.</p>
        ) : null}
      </Stagger>

      <Modal
        open={!!refunding}
        onClose={() => setRefunding(null)}
        title="Raise a refund"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRefunding(null)}>
              Cancel
            </Button>
            <Button
              disabled={refundBusy || !!refundInvalid}
              onClick={() => void submitRefund()}
            >
              {refundBusy ? "Working…" : `Refund ${money(refundTyped)}`}
            </Button>
          </div>
        }
      >
        {refunding ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted">
              Against {refunding.code} · {money(Math.abs(refunding.amount_vnd))} taken by{" "}
              {METHOD_LABEL[refunding.method] ?? refunding.method} · {when(refunding.created_at)}.{" "}
              {money(refunding.refundable_vnd)} of it is still refundable.
            </p>
            <Field label="Amount to refund" hint={refundInvalid}>
              <Input
                inputMode="numeric"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                aria-label="Amount to refund in dong"
              />
            </Field>
            <Field label="Reason" tone="muted" hint="Kept on the audit trail for whoever signs it off.">
              <Textarea
                rows={3}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Court closed for maintenance, member cancelled in time, …"
              />
            </Field>
            {me?.role !== "manager" ? (
              <p className="text-xs text-muted">
                Above your limit this is parked for a manager instead of paid out — you will be told
                which happened.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <SplitText as="h2" text="Today" className="mt-8 font-display text-2xl" />
      <Stagger className="mt-3 grid gap-2" gap={0.05}>
        {data.today.bookings.map((b) => (
          <StaggerItem key={b.id}>
          <Card className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">
                {b.court_code} · {when(b.start_at)}
              </p>
              <p className="text-xs text-subtle">
                {b.code} · {b.status === "confirmed" ? "Confirmed" : b.status}
              </p>
            </div>
            {b.status === "confirmed" ? (
              <Button
                onClick={async () => {
                  try {
                    await apiPost(`/bookings/${b.id}/check-in`);
                    toast.success("Checked in — on court");
                    await load();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Something went wrong");
                  }
                }}
              >
                Check-in
              </Button>
            ) : (
              <StatusBadge status={b.status} />
            )}
          </Card>
          </StaggerItem>
        ))}
        {!data.today.bookings.length ? (
          <p className="text-sm text-muted">No bookings today.</p>
        ) : null}
      </Stagger>
    </Shell>
  );
}
