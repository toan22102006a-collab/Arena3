import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shell, money } from "@/components/shell";
import { Button, Card, Skeleton } from "@/components/ui";
import { apiPost } from "@/lib/arena3/client";

/**
 * Where payOS sends the customer back to.
 *
 * This page reports a result; it never decides one. Landing here is not
 * evidence of payment — the address is guessable, reachable out of order and
 * re-openable at will — so the first thing it does is ask the server, which
 * asks payOS. Until that answer comes back it says "checking", not "paid".
 *
 * The same page covers the cancel URL: payOS sends `cancel=true` and the wait
 * is pointless, but the server is still asked, because a customer can pay and
 * then press cancel on the way back.
 */

type Search = { pid?: string; cancelled?: string; status?: string };

export const Route = createFileRoute("/pay/return")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    pid: typeof s.pid === "string" ? s.pid : undefined,
    cancelled: typeof s.cancelled === "string" ? s.cancelled : undefined,
    status: typeof s.status === "string" ? s.status : undefined,
  }),
  component: Page,
});

type Outcome = "checking" | "posted" | "pending" | "cancelled" | "unknown";

/** How long to keep asking before telling the customer to check their account. */
const ATTEMPTS = 8;
const GAP_MS = 2500;

function Page() {
  const search = useSearch({ from: "/pay/return" });
  const paymentId = search.pid ?? null;
  const [outcome, setOutcome] = useState<Outcome>("checking");
  const [amount, setAmount] = useState<number | null>(null);

  useEffect(() => {
    if (!paymentId) {
      setOutcome("unknown");
      return;
    }
    let alive = true;
    let tries = 0;

    async function ask() {
      tries += 1;
      try {
        // The server asks payOS; the browser is told the answer. Ownership is
        // checked there — a member can only verify their own payment.
        const r = await apiPost<{ status: string; amount_vnd?: number }>(
          `/payments/online/${paymentId}/verify`,
        );
        if (!alive) return;
        if (typeof r.amount_vnd === "number") setAmount(r.amount_vnd);
        if (r.status === "posted") {
          setOutcome("posted");
        } else if (r.status === "failed" || r.status === "expired") {
          setOutcome("cancelled");
        } else if (tries < ATTEMPTS) {
          // A bank transfer can land a few seconds after the redirect.
          window.setTimeout(() => void ask(), GAP_MS);
        } else {
          setOutcome("pending");
        }
      } catch {
        if (alive) setOutcome("unknown");
      }
    }
    void ask();
    return () => {
      alive = false;
    };
  }, [paymentId]);

  return (
    <Shell role="member" title="Payment" subtitle="Back from the payment page.">
      <Card className="mx-auto max-w-md p-6 text-center">
        {outcome === "checking" ? (
          <div className="grid gap-3">
            <p className="font-display text-2xl">Checking with the bank…</p>
            <p className="text-sm text-muted">
              This takes a few seconds. Do not pay again — if the money has left your account it will
              land here.
            </p>
            <Skeleton className="mx-auto h-2 w-40" />
          </div>
        ) : null}

        {outcome === "posted" ? (
          <div className="grid gap-2">
            <p className="font-display text-3xl">Paid</p>
            {amount ? <p className="text-2xl tabular-nums">{money(amount)}</p> : null}
            <p className="text-sm text-muted">
              Your court is confirmed and the receipt is in your account.
            </p>
            <div className="mt-2 flex justify-center gap-2">
              <Link to="/account">
                <Button variant="outline">See the receipt</Button>
              </Link>
              <Link to="/app">
                <Button>My schedule</Button>
              </Link>
            </div>
          </div>
        ) : null}

        {outcome === "pending" ? (
          <div className="grid gap-2">
            <p className="font-display text-2xl">Not confirmed yet</p>
            <p className="text-sm text-muted">
              The bank has not told us about it. If the money has left your account it will post by
              itself — your receipt will appear in your account. Please do not pay twice.
            </p>
            <Link to="/account" className="mt-2">
              <Button variant="outline">Check my receipts</Button>
            </Link>
          </div>
        ) : null}

        {outcome === "cancelled" ? (
          <div className="grid gap-2">
            <p className="font-display text-2xl">Payment cancelled</p>
            <p className="text-sm text-muted">
              Nothing was taken. The court is released unless you booked it again.
            </p>
            <Link to="/app/book" className="mt-2">
              <Button>Book again</Button>
            </Link>
          </div>
        ) : null}

        {outcome === "unknown" ? (
          <div className="grid gap-2">
            <p className="font-display text-2xl">We could not find that payment</p>
            <p className="text-sm text-muted">
              If money left your account, the front desk can look it up by the time and amount.
            </p>
            <Link to="/account" className="mt-2">
              <Button variant="outline">My receipts</Button>
            </Link>
          </div>
        ) : null}
      </Card>
    </Shell>
  );
}
