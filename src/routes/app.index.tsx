import { createFileRoute, Link } from "@tanstack/react-router";
import { Map, Ticket, Wallet } from "lucide-react";
import { AssistantMark } from "@/components/mark";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PassCard } from "@/components/media";
import { PayOnlineButton } from "@/components/pay-online";
import { Shell, hhmm, money, when } from "@/components/shell";
import { Button, Card, Empty, Skeleton, StatusBadge } from "@/components/ui";
import { Lift, Reveal, Stagger, StaggerItem } from "@/components/motion";
import { GlareHover, ShinyText, SplitText, SpotlightCard } from "@/components/fx";
import { apiGet, apiPost, getStoredUser, openInvoice } from "@/lib/arena3/client";
import { formatDate, levelLabel, sportLabel, todayISO } from "@/lib/arena3/labels";

export const Route = createFileRoute("/app/")({
  component: Page,
});

type Me = {
  user: { full_name: string; member_code: string | null };
  subscriptions: Array<{
    id: string;
    status: string;
    end_on: string;
    plan_name: string;
    court_hours_left: string | number;
    sport_scope: string;
  }>;
  inbox: Array<{ id: string; template: string; payload: unknown; sent_at: string }>;
  offers?: Array<{ id: string; expires_at: string; sport: string; level: string }>;
  enrollments?: Array<{ id: string; status: string; waitlist_pos: number | null; sport: string; level: string }>;
  today: {
    bookings: Array<{
      id: string;
      code: string;
      start_at: string;
      end_at: string;
      status: string;
      court_code: string;
    }>;
    classes: Array<{
      id: string;
      start_at: string;
      end_at: string;
      level: string;
      sport: string;
      court_code: string;
      coach_name: string;
    }>;
  };
};

function Page() {
  const [me, setMe] = useState<Me | null>(null);
  // Whether the centre takes payment online at all.
  const [onlineOn, setOnlineOn] = useState(false);
  useEffect(() => {
    void apiGet<{ capabilities?: { online_payment?: boolean } }>("/flags")
      .then((r) => setOnlineOn(Boolean(r.capabilities?.online_payment)))
      .catch(() => setOnlineOn(false));
  }, []);
  useEffect(() => {
    void apiGet<Me>("/me")
      .then(setMe)
      .catch((e) => toast.error(e.message));
  }, []);
  const u = getStoredUser();
  const live = me?.subscriptions.filter((s) => s.status === "active") ?? [];
  const frozen = me?.subscriptions.filter((s) => s.status === "frozen") ?? [];
  const first = live[0];
  const greet = u?.full_name.split(" ").slice(-1)[0] ?? "";
  const expiring = live.filter((s) => {
    const d = daysUntil(s.end_on);
    return Number.isFinite(d) && d >= 0 && d <= 7;
  });

  const events = [
    ...(me?.today.classes ?? []).map((c) => ({
      id: `c-${c.id}`,
      start: c.start_at,
      kind: "Class" as const,
      title: `${sportLabel(c.sport)} · ${c.court_code}`,
      meta: c.coach_name,
      bookingId: null as string | null,
      status: "confirmed",
    })),
    ...(me?.today.bookings ?? []).map((b) => ({
      id: `b-${b.id}`,
      start: b.start_at,
      kind: "Court" as const,
      title: b.court_code,
      meta: b.code,
      bookingId: b.id,
      status: b.status,
    })),
  ].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <Shell role="member">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <ShinyText
            className="shiny-muted mb-1 block text-[11px] font-semibold uppercase tracking-widest"
            speed={6}
          >
            Member
          </ShinyText>
          <SplitText
            as="h1"
            text={`Welcome back, ${greet}`}
            stagger={0.02}
            duration={0.6}
            className="font-display text-3xl font-medium tracking-tight sm:text-4xl"
          />
        </div>
        {u?.member_code ? (
          <span className="rounded-[var(--radius-sm)] border border-line bg-surface px-2.5 py-1 font-mono text-xs font-semibold text-muted">
            {u.member_code}
          </span>
        ) : null}
      </div>

      {(me?.offers ?? []).length ? (
        <Card className="mb-4 border border-hold/30 bg-hold/5">
          <p className="text-sm font-medium">A waitlist seat opened up</p>
          {(me?.offers ?? []).map((o) => (
            <div key={o.id} className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {sportLabel(o.sport)} · {levelLabel(o.level)}
              </p>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await apiPost(`/waitlist/${o.id}/accept`);
                    toast.success("Seat claimed");
                    setMe(await apiGet("/me"));
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Offer expired");
                  }
                }}
              >
                Claim seat
              </Button>
            </div>
          ))}
        </Card>
      ) : null}

      {frozen.length ? (
        <Card className="mb-4">
          <p className="text-sm font-medium">Frozen plans</p>
          <p className="mt-1 text-sm text-muted">
            {frozen.map((s) => `${s.plan_name} · new end date ${formatDate(s.end_on)}`).join(" · ")} — ask
            the desk to unfreeze.
          </p>
        </Card>
      ) : null}

      {expiring.length ? (
        <Card className="mb-4 border border-hold/30 bg-hold/5">
          <p className="text-sm font-medium text-fg">Plans expiring soon</p>
          <p className="mt-1 text-sm text-muted">
            {expiring
              .map((s) => `${s.plan_name} — ${daysUntil(s.end_on)} days left (until ${formatDate(s.end_on)})`)
              .join(" · ")}{" "}
            — renew to keep your class seats.
          </p>
          <Link to="/app/plans" className="mt-3 inline-block">
            <Button size="sm">Renew</Button>
          </Link>
        </Card>
      ) : null}

      {!me ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Reveal className="order-1">
            {first ? (
              <GlareHover className="rounded-[var(--radius-xl)]" duration={1.1}>
                <PassCard
                  plan={first.plan_name}
                  sport={sportLabel(first.sport_scope)}
                  endOn={formatDate(first.end_on)}
                  hours={Number(first.court_hours_left)}
                  code={u?.member_code}
                />
              </GlareHover>
            ) : (
              <Empty title="No active plan" hint="Buy a plan to enrol in classes and book courts.">
                <Link to="/app/plans">
                  <Button>Browse plans</Button>
                </Link>
              </Empty>
            )}
          </Reveal>

          <div className="order-2 md:order-3 md:col-span-2">
            <SplitText as="h2" text="Quick actions" className="font-display text-lg tracking-tight" />
            <Stagger className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" gap={0.06}>
              {(
                [
                  { to: "/app/book" as const, label: "Book a court", Icon: Map },
                  { to: "/app/classes" as const, label: "Classes", Icon: Ticket },
                  { to: "/app/plans" as const, label: "Plans", Icon: Wallet },
                  { to: "/app/assistant" as const, label: "Ask AI", Icon: AssistantMark },
                ] as const
              ).map((a) => (
                <StaggerItem key={a.to}>
                  <Lift>
                    <SpotlightCard className="h-full rounded-[var(--radius-md)]" size={200} strength={0.12}>
                      <Link
                        to={a.to}
                        className="group relative z-[2] flex h-full flex-col items-center justify-center rounded-[var(--radius-md)] border border-line bg-surface/85 px-2 py-4 text-center transition-colors duration-200 hover:border-accent/40"
                      >
                        <span className="mb-2.5 grid size-12 place-items-center rounded-[var(--radius-sm)] bg-wood text-accent transition-colors duration-200 group-hover:bg-accent group-hover:text-accent-fg">
                          <a.Icon className="size-6" strokeWidth={1.75} />
                        </span>
                        <span className="text-xs font-semibold tracking-tight text-fg">{a.label}</span>
                      </Link>
                    </SpotlightCard>
                  </Lift>
                </StaggerItem>
              ))}
            </Stagger>
          </div>

          <Reveal className="order-3 md:order-2" delay={0.08}>
            <SpotlightCard className="h-full rounded-[var(--radius-xl)]" size={340} strength={0.1}>
            <Card className="relative z-[2] h-full">
              <div className="mb-3 flex items-baseline justify-between">
                <p className="font-display text-xl">Today</p>
                <span className="text-xs text-muted">
                  {events.length} {events.length === 1 ? "session" : "sessions"} booked
                </span>
              </div>
              {events.length ? (
                <Stagger className="grid gap-3" gap={0.06}>
                  {events.map((ev) => (
                    <StaggerItem key={ev.id}>
                      <div className="rounded-[var(--radius-md)] bg-wood/50 px-4 py-3 transition-colors duration-200 hover:bg-wood">
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded-full bg-accent px-2.5 py-0.5 text-2xs font-semibold text-accent-fg">
                            {ev.kind}
                          </span>
                          <StatusBadge status={ev.status} />
                        </div>
                        <p className="mt-2 font-display text-xl tracking-tight">
                          {hhmm(ev.start)} · {ev.title}
                        </p>
                        {/* The action shares the reference line rather than
                            claiming a row of its own. A court booking and a
                            class sitting next to each other used to differ by
                            a whole button in height purely because one of them
                            can be cancelled. */}
                        <div className="mt-1 flex min-h-8 items-center justify-between gap-2">
                          <p className="font-mono text-xs text-muted">{ev.meta}</p>
                          {/*
                            A held court can be paid for from here, not only
                            from the screen it was booked on. The booking page
                            keeps the hold in component state, so refreshing or
                            walking away left the member with a court they
                            could see, could cancel, and had no way to pay for
                            — it simply sat blocking the slot until it expired.
                          */}
                          {onlineOn && ev.bookingId && ev.status === "hold" ? (
                            <PayOnlineButton
                              refType="booking"
                              refId={ev.bookingId}
                              label="Pay online"
                              onPaid={async () => setMe(await apiGet("/me"))}
                            />
                          ) : null}
                          {ev.bookingId && (ev.status === "hold" || ev.status === "confirmed") ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                try {
                                  await apiPost(`/bookings/${ev.bookingId}/cancel`);
                                  toast.success("Booking cancelled");
                                  setMe(await apiGet("/me"));
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Something went wrong");
                                }
                              }}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </StaggerItem>
                  ))}
                </Stagger>
              ) : (
                <div className="mt-2">
                  <p className="text-sm text-muted">Nothing on the calendar.</p>
                  <div className="mt-3 flex gap-2">
                    <Link to="/app/book">
                      <Button size="sm">Book a court</Button>
                    </Link>
                    <Link to="/app/classes">
                      <Button size="sm" variant="outline">
                        Join a class
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </Card>
            </SpotlightCard>
          </Reveal>
        </div>
      )}

      {live.length > 1 ? (
        <Stagger className="mt-4 grid gap-3 md:grid-cols-3" gap={0.07}>
          {live.slice(1).map((s) => (
            <StaggerItem key={s.id}>
              <Card interactive className="h-full">
                <p className="text-2xs uppercase tracking-wider text-muted">
                  {sportLabel(s.sport_scope)}
                </p>
                <p className="mt-1 font-medium text-fg">{s.plan_name}</p>
                <p className="text-sm text-muted">
                  Until {formatDate(s.end_on)} · {Number(s.court_hours_left)} court hours
                </p>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      ) : null}

      <SplitText as="h2" text="Notifications" className="mt-8 font-display text-2xl" />
      <Stagger className="mt-3 grid gap-2" gap={0.05}>
        {(me?.inbox ?? []).slice(0, 8).map((n) => {
          const receipt = n.template === "payment_receipt" ? asReceipt(n.payload) : null;
          const body = (
            <Card className="p-4 text-left transition-colors duration-200 hover:bg-wood/40">
              <p className="text-sm font-medium text-fg">
                {receipt ? `Receipt · ${money(receipt.amount_vnd)}` : inboxLabel(n.template)}
              </p>
              <p className="text-xs text-muted">
                {when(n.sent_at)}
                {receipt ? ` · ${methodLabel(receipt.method)} · tap to open` : ""}
              </p>
            </Card>
          );
          return (
            <StaggerItem key={n.id}>
              {/* The receipt is the only notification with somewhere to go, so it
                  is the only one that becomes a button. Making every row look
                  tappable would promise eight links and deliver one. */}
              {receipt ? (
                <button
                  type="button"
                  className="block w-full"
                  onClick={async () => {
                    try {
                      await openInvoice(receipt.invoice_id);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "The receipt would not open");
                    }
                  }}
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </StaggerItem>
          );
        })}
        {me && !me.inbox.length ? <p className="text-sm text-muted">Nothing here yet.</p> : null}
      </Stagger>
    </Shell>
  );
}

function daysUntil(iso: string) {
  const a = Date.parse(`${todayISO()}T00:00:00+07:00`);
  const b = Date.parse(`${iso.slice(0, 10)}T00:00:00+07:00`);
  return Math.round((b - a) / 86400000);
}

/**
 * A receipt notification, or null if it is one of the older ones.
 *
 * Rows written before receipts carried their invoice hold only `{payment_id}`,
 * and they stay in the inbox forever. Reading them back as a plain notification
 * is the right outcome: the alternative is a tappable row that opens nothing.
 */
function asReceipt(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { invoice_id?: unknown; amount_vnd?: unknown; method?: unknown };
  if (typeof p.invoice_id !== "string" || typeof p.amount_vnd !== "number") return null;
  return {
    invoice_id: p.invoice_id,
    amount_vnd: p.amount_vnd,
    method: typeof p.method === "string" ? p.method : "",
  };
}

function methodLabel(m: string) {
  return (
    { cash: "Cash", card: "Card", transfer: "Bank transfer", quota: "Plan hours" } as Record<string, string>
  )[m] ?? "Paid";
}

function inboxLabel(t: string) {
  return (
    {
      booking_confirmed: "Booking confirmed",
      booking_cancelled: "Booking cancelled",
      transfer_requested: "Transfer noted — reception will confirm it",
      transfer_rejected: "We could not find your transfer",
      hold_expiring: "Your hold is about to expire",
      class_changed: "Class schedule changed",
      sub_expiring: "Plan expiring soon",
      waitlist_offer: "A class seat opened — claim it in the app",
      payment_receipt: "Payment receipt",
      ticket_replied: "Reception replied — read it under Account › Support",
    } as Record<string, string>
  )[t] ?? t;
}
