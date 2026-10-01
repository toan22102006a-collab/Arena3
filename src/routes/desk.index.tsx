import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell, money } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Modal, Select, StatusBadge } from "@/components/ui";
import { Reveal, Stagger, StaggerItem, motion } from "@/components/motion";
import { GLBackground, SplitText, SpotlightCard, StarBorder } from "@/components/fx";
import { apiGet, apiPost, openInvoice } from "@/lib/arena3/client";
import { sportLabel } from "@/lib/arena3/labels";

export const Route = createFileRoute("/desk/")({
  component: Page,
});

type Hit = {
  id: string;
  full_name: string;
  phone: string;
  member_code: string | null;
  status: string;
};

type Plan = {
  id: string;
  name: string;
  sport_scope: string;
  price_vnd: number;
  duration_days: number | null;
  court_hours: number;
};

function Page() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Hit[]>([]);
  const [shift, setShift] = useState<{ shift: { id: string; opened_at: string }; totals?: { cash: number } } | null>(
    null,
  );
  const [form, setForm] = useState({ full_name: "", phone: "" });
  const [closeOpen, setCloseOpen] = useState(false);
  const [cash, setCash] = useState("");
  const [tickets, setTickets] = useState<
    Array<{ id: string; body: string; full_name: string | null; phone: string | null; created_at: string }>
  >([]);
  // Which request the desk is writing an answer to, and the answer so far. One
  // at a time: the box opens on the row being answered rather than sitting
  // under all of them, so it is obvious whose complaint is being replied to.
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  // Just the count — the queue itself lives one screen over, but a receptionist
  // has to be able to see from here that somebody is owed attention.
  const [waiting, setWaiting] = useState(0);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [newUser, setNewUser] = useState<{
    id: string;
    full_name: string;
    member_code?: string | null;
    temp_password?: string;
  } | null>(null);
  const [picked, setPicked] = useState<Plan | null>(null);
  const [subId, setSubId] = useState<string | null>(null);
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);

  async function loadShift() {
    try {
      setShift(await apiGet("/shifts/current"));
    } catch {
      setShift(null);
    }
  }
  useEffect(() => {
    void loadShift();
    void apiGet<{ items: typeof tickets }>("/tickets")
      .then((r) => setTickets(r.items))
      .catch(() => undefined);
    void apiGet<{ items: Plan[] }>("/plans")
      .then((r) => setPlans(r.items))
      .catch(() => undefined);
    void apiGet<{ waiting: number }>("/payments/pending?brief=1")
      .then((r) => setWaiting(r.waiting))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (q.trim().length < 3) {
      setItems([]);
      return;
    }
    const t = setTimeout(() => {
      void apiGet<{ items: Hit[] }>(`/members?q=${encodeURIComponent(q)}`)
        .then((r) => setItems(r.items))
        .catch((e) => toast.error(e.message));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  function resetWizard() {
    setStep(1);
    setNewUser(null);
    setPicked(null);
    setForm({ full_name: "", phone: "" });
    setMethod("cash");
    setSubId(null);
  }

  return (
    <Shell role="receptionist" title="Front desk" subtitle="Find a member, sell a plan, take payment — three moves.">
      {/* Kept well under the text: this console is stared at all shift, so the
          field is a texture, not a feature. */}
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
      <Reveal className="mb-5 flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] bg-surface p-3 shadow-[var(--shadow-border)]" from="down">
        {shift ? (
          <Badge tone="accent">Shift open · cash {money(shift.totals?.cash ?? 0)}</Badge>
        ) : (
          <Button
            onClick={async () => {
              try {
                await apiPost("/shifts/open");
                await loadShift();
                toast.success("Shift opened");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Something went wrong");
              }
            }}
          >
            {/*
              An imperative, because this is the thing to press. Labelled
              "Shift open" it read as a status line, so reception saw the
              words "shift open" on screen, believed one was, and then met
              "Open a shift first" on the payment button with no idea where
              to go.
            */}
            Open shift
          </Button>
        )}
        {shift ? (
          <Button
            variant="outline"
            onClick={() => {
              setCash(String(shift.totals?.cash ?? 0));
              setCloseOpen(true);
            }}
          >
            Close shift
          </Button>
        ) : null}
        <Link to="/desk/payments" className="ml-auto">
          <Button variant="outline">
            Payments
            {waiting ? (
              <span className="rounded-full bg-hold px-2 py-0.5 text-2xs font-semibold tabular-nums text-bg">
                {waiting}
              </span>
            ) : null}
          </Button>
        </Link>
        <Link to="/desk/courts">
          <Button variant="ink">Court map</Button>
        </Link>
      </Reveal>

      <Field label="Find a member">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, phone or member code"
          autoFocus
        />
      </Field>
      <div className="mt-3 grid gap-2">
        {q.trim().length > 0 && q.trim().length < 3 ? (
          <p className="text-sm text-muted">Type at least 3 characters.</p>
        ) : null}
        {items.map((m, i) => (
          <motion.button
            key={m.id}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(i, 6) * 0.03, ease: [0.16, 1, 0.3, 1] }}
            onClick={() => navigate({ to: "/desk/member/$id", params: { id: m.id } })}
            className="flex min-h-14 items-center justify-between rounded-[var(--radius-lg)] bg-surface px-4 py-3 text-left shadow-[var(--shadow-border)] transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-wood"
          >
            <div>
              <div className="font-medium">{m.full_name}</div>
              <div className="text-xs tabular-nums text-muted">
                {m.member_code} · {m.phone}
              </div>
            </div>
            <StatusBadge status={m.status} />
          </motion.button>
        ))}
      </div>

      <SplitText as="h2" text="New member" className="mt-8 font-display text-2xl" />
      <p className="mt-1 text-sm text-muted">Three steps: profile → plan → payment.</p>
      <ol className="mt-3 flex gap-2 text-2xs font-medium uppercase tracking-wider">
        {[
          [1, "Profile"],
          [2, "Plan"],
          [3, "Payment"],
        ].map(([n, l]) => (
          <li key={n} className="relative rounded-full px-3 py-1">
            {step === n ? (
              <motion.span
                layoutId="desk-wizard-step"
                className="absolute inset-0 rounded-full bg-accent"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            ) : (
              <span className="absolute inset-0 rounded-full bg-wood" />
            )}
            <span className={`relative ${step === n ? "text-accent-fg" : "text-muted"}`}>
              {n}. {l}
            </span>
          </li>
        ))}
      </ol>
      <SpotlightCard className="mt-3 rounded-[var(--radius-xl)]" size={420} strength={0.09}>
      <Card className="relative z-[2]">
        {step === 1 ? (
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Full name">
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Alex Nguyen"
              />
            </Field>
            <Field label="Phone number">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="0901 234 567"
                inputMode="tel"
              />
            </Field>
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={busy || !form.full_name.trim() || !form.phone.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await apiPost<{
                      user: { id: string; full_name: string; member_code?: string | null };
                      existing?: boolean;
                      temp_password?: string;
                    }>("/members", { ...form, pii_consent: true });
                    setNewUser({ ...res.user, temp_password: res.temp_password });
                    setStep(2);
                    toast.success(
                      res.existing
                        ? "This person already has a profile — pick a plan or stop here"
                        : `Created ${res.user.member_code ?? "the profile"}. Temporary password: ${res.temp_password}`,
                    );
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not create the account");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Create profile
              </Button>
            </div>
          </div>
        ) : null}
        {step === 2 && newUser ? (
          <div>
            <p className="mb-3 text-sm">
              {newUser.full_name}
              {newUser.member_code ? ` · ${newUser.member_code}` : ""}
            </p>
            {newUser.temp_password ? (
              <Card className="mb-4 border border-hold/30 bg-hold/5 p-4">
                <p className="text-2xs uppercase tracking-wider text-muted">Temporary password — hand this to the member so they can sign in</p>
                <p className="mt-1 font-mono text-lg font-semibold tracking-wide">{newUser.temp_password}</p>
                <p className="mt-1 text-xs text-muted">They change it after the first sign-in.</p>
              </Card>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPicked(p)}
                  className={`rounded-[var(--radius-lg)] border px-4 py-3 text-left transition-[background-color,border-color,transform] duration-200 active:scale-[0.98] ${
                    picked?.id === p.id ? "border-accent bg-accent/10" : "border-line hover:bg-wood"
                  }`}
                >
                  <p className="text-2xs uppercase tracking-wider text-muted">{sportLabel(p.sport_scope)}</p>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm tabular-nums text-muted">
                    {money(p.price_vnd)}
                    {p.duration_days ? ` · ${p.duration_days} days` : ""} · {p.court_hours} court hours
                  </p>
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                disabled={!picked || busy}
                onClick={async () => {
                  if (!picked || !newUser) return;
                  setBusy(true);
                  try {
                    const res = await apiPost<{ subscription: { id: string } }>("/subscriptions", {
                      plan_id: picked.id,
                      user_id: newUser.id,
                    });
                    setSubId(res.subscription.id);
                    setStep(3);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not start the plan");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Next: take payment
              </Button>
            </div>
          </div>
        ) : null}
        {step === 3 && newUser && picked ? (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-3 text-sm">
              {newUser.full_name} · {picked.name} · {money(picked.price_vnd)}
            </div>
            <Field label="Payment method">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="transfer">Bank transfer</option>
                <option value="card">Card</option>
              </Select>
            </Field>
            <div className="flex items-end gap-2 md:col-span-2">
              <StarBorder speed={4}>
              <Button
                disabled={busy || !shift}
                onClick={async () => {
                  if (!subId) return;
                  setBusy(true);
                  try {
                    const res = await apiPost<{ invoice: { id: string } }>(
                      "/payments",
                      {
                        ref_type: "subscription",
                        ref_id: subId,
                        method,
                        amount_vnd: picked.price_vnd,
                      },
                      true,
                    );
                    toast.success("Paid — receipt opened");
                    // Clear the wizard before printing. The payment is already
                    // posted; if the receipt fails to open, leaving step 3 on
                    // screen would offer to take the same money again.
                    const uid = newUser.id;
                    resetWizard();
                    navigate({ to: "/desk/member/$id", params: { id: uid } });
                    if (res.invoice?.id) {
                      try {
                        await openInvoice(res.invoice.id);
                      } catch {
                        toast.warning("Paid — but the receipt did not open. Reprint it from the profile.");
                      }
                    }
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Payment did not go through");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {shift ? "Take payment & print" : "Open a shift first"}
              </Button>
              </StarBorder>
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
      </SpotlightCard>

      <Modal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Close shift"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloseOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!shift) return;
                try {
                  await apiPost(`/shifts/${shift.shift.id}/close`, { cash_declared_vnd: Number(cash) });
                  toast.success("Shift closed");
                  setCloseOpen(false);
                  await loadShift();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Something went wrong");
                }
              }}
            >
              Reconcile & close
            </Button>
          </>
        }
      >
        <Field label="Cash counted (VND)">
          <Input inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} />
        </Field>
        <p className="mt-2 text-sm text-muted">Expected from the books: {money(shift?.totals?.cash ?? 0)}</p>
      </Modal>

      {tickets.length ? (
        <div className="mt-8">
          <SplitText as="h2" text="Requests from the app" className="font-display text-2xl" />
          <Stagger className="mt-3 grid gap-2" gap={0.05}>
            {tickets.map((t) => (
              <StaggerItem key={t.id}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* A member's own words, so they may contain a long run
                        with nothing to wrap on — without this it pushes the
                        Reply and Close buttons off the side of the card. */}
                    <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm">{t.body}</p>
                    <p className="mt-1 text-xs text-muted">
                      {t.full_name} · {t.phone}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setReplyTo(replyTo === t.id ? null : t.id);
                        setReply("");
                      }}
                    >
                      {replyTo === t.id ? "Cancel" : "Reply"}
                    </Button>
                    {/* Closing without answering is still allowed — a duplicate,
                        or something dealt with at the counter in person — but it
                        is no longer the only thing the desk can do. */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await apiPost(`/tickets/${t.id}/close`);
                          setTickets((list) => list.filter((x) => x.id !== t.id));
                          toast.success("Request closed");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Something went wrong");
                        }
                      }}
                    >
                      Close
                    </Button>
                  </div>
                </div>
                {replyTo === t.id ? (
                  <form
                    className="mt-3 flex flex-wrap gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (reply.trim().length < 2 || replying) return;
                      setReplying(true);
                      try {
                        await apiPost(`/tickets/${t.id}/reply`, { reply: reply.trim() });
                        setTickets((list) => list.filter((x) => x.id !== t.id));
                        setReplyTo(null);
                        setReply("");
                        toast.success("Replied — the member has been notified");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Something went wrong");
                      } finally {
                        setReplying(false);
                      }
                    }}
                  >
                    <Input
                      className="min-w-0 flex-1"
                      autoFocus
                      maxLength={2000}
                      placeholder="What should we tell them?"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                    />
                    <Button type="submit" disabled={replying || reply.trim().length < 2}>
                      Send
                    </Button>
                  </form>
                ) : null}
              </Card>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      ) : null}
    </Shell>
  );
}
