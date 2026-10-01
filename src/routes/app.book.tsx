import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Landmark, Receipt as ReceiptIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MonthCalendar, useAvailability } from "@/components/availability-calendar";
import { CourtGrid, DateStrip, freeHours, type Court, type OccSlot } from "@/components/court-grid";
import { Cover, HoldProgress, HoldTimer, MediaCaption, media, sportPhoto } from "@/components/media";
import { PayOnlineButton } from "@/components/pay-online";
import { Shell, money, when } from "@/components/shell";
import { Badge, Button, Card, DateField, Seg, Skeleton, StatusBadge } from "@/components/ui";
import { GlareHover, StarBorder } from "@/components/fx";
import { apiGet, apiPost, openInvoice, ApiClientError } from "@/lib/arena3/client";
import { todayISO, sportLabel } from "@/lib/arena3/labels";

export const Route = createFileRoute("/app/book")({
  validateSearch: (s: Record<string, unknown>): { sport?: string } => ({
    sport: s.sport === "badminton" || s.sport === "basketball" || s.sport === "volleyball" ? s.sport : undefined,
  }),
  component: Page,
});

/** The closest still-free hours on the same sport, nearest to what they wanted. */
function nearestFree(
  data: { courts: Court[]; slots: OccSlot[] },
  wanted: Court,
  hour: number,
  date: string,
) {
  const sameSport = data.courts.filter((c) => c.sport === wanted.sport);
  return freeHours(sameSport, data.slots, date, Date.now())
    .sort(
      (a, b) =>
        Math.abs(a.hour - hour) - Math.abs(b.hour - hour) ||
        Number(b.court.court_code === wanted.court_code) -
          Number(a.court.court_code === wanted.court_code),
    )
    .slice(0, 3);
}

/** One of the member's own upcoming court bookings (M-04). */
type MyBooking = {
  id: string;
  code: string;
  status: string;
  start_at: string;
  end_at: string;
  court_id: string;
  court_code: string;
  sport: string;
  can_move: boolean;
};

type Hold = {
  booking: { id: string; code: string; hold_until?: string };
  price: number;
  hold_until: string;
  /** Which slot this is, carried from the tap so the card can name it. */
  court_code?: string;
  hour?: number;
};

/** A hold that was refused, and — when another hour would help — where to go instead. */
type Taken = {
  message: string;
  alts: { court: Court; hour: number }[];
  /** False when the refusal was about the member, not the slot. */
  canRetry: boolean;
};

function Page() {
  const [date, setDate] = useState(todayISO);
  const [sport, setSport] = useState(Route.useSearch().sport ?? "badminton");
  const [data, setData] = useState<{ courts: Court[]; slots: OccSlot[] } | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [overlap, setOverlap] = useState<{ court: Court; hour: number; message: string } | null>(null);
  // Week strip or whole month — both show how many slots each day has left.
  const [view, setView] = useState<"week" | "month">("week");
  const [refresh, setRefresh] = useState(0);
  const avail = useAvailability(sport, refresh);
  const [mine, setMine] = useState<MyBooking[] | null>(null);
  const [windowHours, setWindowHours] = useState(2);
  const [showAllMine, setShowAllMine] = useState(false);
  // The booking being moved: the grid's next tap lands on it instead of making a new hold.
  const [moving, setMoving] = useState<MyBooking | null>(null);
  const [moveError, setMoveError] = useState("");
  async function loadMine() {
    try {
      const r = await apiGet<{ items: MyBooking[]; window_hours: number }>("/me/bookings");
      setMine(r.items);
      setWindowHours(r.window_hours);
    } catch {
      setMine([]);
    }
  }
  const [taken, setTaken] = useState<Taken | null>(null);
  const [busy, setBusy] = useState(false);
  // Leave the online button out entirely when the centre has no payOS set up,
  // rather than offering one that errors.
  const [onlineOn, setOnlineOn] = useState(false);
  useEffect(() => {
    void apiGet<{ capabilities?: { online_payment?: boolean } }>("/flags")
      .then((r) => setOnlineOn(Boolean(r.capabilities?.online_payment)))
      .catch(() => setOnlineOn(false));
  }, []);
  // Sticks around after the toast has gone. A receipt people paid for should
  // not be something you have four seconds to notice.
  const [receipt, setReceipt] = useState<string | null>(null);
  // A transfer the member has promised but reception has not yet found.
  const [pending, setPending] = useState<{ amount: number; until: string } | null>(null);

  async function load(d = date) {
    const occ = await apiGet<{ courts: Court[]; slots: OccSlot[] }>(`/occupancy?date=${d}`);
    setData(occ);
    setRefresh((n) => n + 1);
    void loadMine();
  }

  async function moveTo(court: Court, hour: number, confirmOverlap = false) {
    if (!moving) return;
    const start = `${date}T${String(hour).padStart(2, "0")}:00:00+07:00`;
    setBusy(true);
    setMoveError("");
    try {
      await apiPost(
        `/bookings/${moving.id}/reschedule`,
        { start_at: start, court_id: court.id, ...(confirmOverlap ? { confirm_overlap: true } : {}) },
      );
      toast.success(`Moved ${moving.code} to ${court.court_code} · ${String(hour).padStart(2, "0")}:00`);
      setMoving(null);
      setOverlap(null);
      await load();
    } catch (e) {
      if (e instanceof ApiClientError && e.body.requires_confirm && !confirmOverlap) {
        setOverlap({ court, hour, message: e.body.message });
      } else {
        setMoveError(e instanceof Error ? e.message : "Could not move that booking");
        await load().catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }

  function startMove(b: MyBooking) {
    setMoving(b);
    setMoveError("");
    setHold(null);
    setTaken(null);
    setSport(b.sport);
    // Open the booking's own day: most changes are another hour the same day.
    setDate(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(b.start_at)),
    );
  }
  useEffect(() => {
    setData(null);
    void load().catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function holdSlot(court: Court, hour: number, confirmOverlap = false) {
    const start = `${date}T${String(hour).padStart(2, "0")}:00:00+07:00`;
    setBusy(true);
    try {
      const res = await apiPost<Hold>(
        "/bookings",
        { court_id: court.id, start_at: start, ...(confirmOverlap ? { confirm_overlap: true } : {}) },
        true,
      );
      setHold({ ...res, court_code: court.court_code, hour });
      setOverlap(null);
      setTaken(null);
      toast.success(`Holding ${court.court_code} · ${res.booking.code}`);
      await load();
    } catch (e) {
      if (e instanceof ApiClientError && e.body.requires_confirm && !confirmOverlap) {
        setOverlap({ court, hour, message: e.body.message });
      } else {
        // Two people reaching for the same 19:00 on a Saturday is the system
        // working, not breaking — but a red toast saying "slot unavailable"
        // leaves the member to start the search again from nothing. Offer the
        // nearest hours that are still open instead, closest first.
        const message = e instanceof Error ? e.message : "Could not hold that slot";
        // Only when another hour would actually help. A member who has used up
        // their two holds for the day, or whose balance is over the limit, is
        // not going to get anywhere by tapping a different court — offering
        // three of them would just be three more refusals.
        const aboutTheSlot =
          !(e instanceof ApiClientError) ||
          e.body.code === "CONFLICT_SLOT" ||
          e.body.br === "BR-35" ||
          e.body.br === "BR-66";
        // Re-read the day before suggesting anything: the grid on screen is
        // the one that just turned out to be wrong.
        const fresh = aboutTheSlot
          ? await apiGet<{ courts: Court[]; slots: OccSlot[] }>(`/occupancy?date=${date}`).catch(
              () => null,
            )
          : null;
        if (fresh) setData(fresh);
        setTaken({
          message,
          alts: fresh ? nearestFree(fresh, court, hour, date) : [],
          canRetry: aboutTheSlot,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmPay(method: "quota" | "transfer") {
    if (!hold) return;
    setBusy(true);
    try {
      // The endpoint issues an invoice and hands back its id. Dropping that on
      // the floor is why a member could pay and never see a receipt — nothing
      // in the UI ever mentioned one existed.
      const res = await apiPost<{
        invoice_id?: string;
        awaiting_transfer?: boolean;
        hold_until?: string;
      }>(`/bookings/${hold.booking.id}/confirm`, { method }, true);
      setHold(null);
      await load();
      // A transfer is not a booking yet. Saying "Booking confirmed" here would
      // be the app telling a member their court is theirs while reception has
      // not found a single dong of it in the bank.
      if (res.awaiting_transfer) {
        setPending({ amount: hold.price, until: res.hold_until ?? hold.hold_until });
        toast.success("Transfer noted", {
          description: "Your court is held while reception checks the bank.",
        });
        return;
      }
      if (res.invoice_id) {
        setReceipt(res.invoice_id);
        toast.success(method === "quota" ? "One plan hour deducted" : "Booking confirmed", {
          description: "Your receipt is ready.",
          action: {
            label: "Open receipt",
            onClick: () => void openInvoice(res.invoice_id!),
          },
        });
      } else {
        toast.success(method === "quota" ? "One plan hour deducted" : "Booking confirmed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not confirm the booking");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      role="member"
      title="Book a court"
      subtitle="Pick a date and sport, then tap a free slot — we hold it for five minutes."
    >
      <GlareHover className="mb-4 block rounded-[var(--radius-xl)]" duration={1.1}>
        <Cover
          src={sport ? sportPhoto(sport) : media.hallCourts}
          alt=""
          scrim="none"
          className="h-36 rounded-[var(--radius-xl)] md:h-44"
        >
          <MediaCaption>
            <p className="font-display text-2xl">
              {sport ? sportLabel(sport) : "All 3 sports"} · 60′ slots
            </p>
          </MediaCaption>
        </Cover>
      </GlareHover>
      <div className="mb-4 grid gap-3">
        {view === "week" ? (
          <DateStrip value={date} onChange={setDate} avail={avail} />
        ) : (
          <MonthCalendar value={date} onChange={setDate} avail={avail} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Seg
            value={view}
            onChange={(v) => setView(v === "month" ? "month" : "week")}
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
          <Seg
            value={sport}
            onChange={setSport}
            options={[
              { value: "", label: "All" },
              { value: "badminton", label: sportLabel("badminton") },
              { value: "basketball", label: sportLabel("basketball") },
              { value: "volleyball", label: sportLabel("volleyball") },
            ]}
          />
          <DateField value={date} onChange={setDate} aria-label="Pick another date" />
        </div>
      </div>
      {moving ? (
        <Card className="mb-4 border border-accent/30 bg-accent/5">
          <p className="text-sm font-medium">
            Moving {moving.code} — now {moving.court_code}, {when(moving.start_at)}
          </p>
          <p className="mt-1 text-xs text-muted">
            Tap a free slot below. You keep the same sport and price; the old hour is freed the moment the new one is
            yours.
          </p>
          {moveError ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {moveError}
            </p>
          ) : null}
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={() => (setMoving(null), setMoveError(""))}>
              Keep it where it is
            </Button>
          </div>
        </Card>
      ) : null}
      {mine?.length && !moving ? (
        <Card className="mb-4">
          <p className="mb-2 font-display text-lg">Your upcoming courts</p>
          <div className="grid gap-2">
            {(showAllMine ? mine : mine.slice(0, 3)).map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-wood/50 px-3 py-2"
              >
                <span className="text-sm">
                  <span className="font-medium">{b.court_code}</span> · {when(b.start_at)}{" "}
                  <span className="font-mono text-xs text-muted">{b.code}</span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={b.status} />
                  {b.can_move ? (
                    <Button size="sm" variant="outline" onClick={() => startMove(b)}>
                      Change time
                    </Button>
                  ) : b.status === "confirmed" ? (
                    <Badge tone="muted">Within {windowHours}h — can&apos;t move</Badge>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          {mine.length > 3 ? (
            <button
              type="button"
              onClick={() => setShowAllMine((v) => !v)}
              className="mt-2 text-sm text-accent-2 underline-offset-2 hover:underline"
            >
              {showAllMine ? "Show fewer" : `Show all ${mine.length}`}
            </button>
          ) : null}
        </Card>
      ) : null}
      <AnimatePresence>
        {pending ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Card className="mb-4 border border-hold/30 bg-hold/5">
              <div className="flex flex-wrap items-center gap-3">
                <Landmark className="size-5 shrink-0 text-hold" strokeWidth={1.75} />
                <div className="min-w-[12rem] flex-1">
                  <p className="text-sm font-medium">
                    Transfer {money(pending.amount)} — your court is held meanwhile.
                  </p>
                  <p className="text-xs text-muted">
                    Reception confirms it against the bank, usually the same day. We hold the slot
                    for another <HoldTimer until={pending.until} onExpire={() => setPending(null)} />
                    ; after that it goes back on the grid.
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)} aria-label="Dismiss">
                  Got it
                </Button>
              </div>
            </Card>
          </motion.div>
        ) : null}
        {receipt ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Card className="mb-4 flex flex-wrap items-center gap-3 border border-accent/30 bg-accent/5">
              <ReceiptIcon className="size-5 shrink-0 text-accent" strokeWidth={1.75} />
              <div className="min-w-[10rem] flex-1">
                <p className="text-sm font-medium">Booking confirmed — your receipt is ready.</p>
                <p className="text-xs text-muted">
                  It is also kept in <Link to="/account" className="text-accent-2 underline">Account settings → Receipts</Link>.
                </p>
              </div>
              <Button size="sm" onClick={() => void openInvoice(receipt)}>
                Open receipt
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReceipt(null)} aria-label="Dismiss">
                Dismiss
              </Button>
            </Card>
          </motion.div>
        ) : null}
        {taken ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Card className="mb-4 border border-hold/30 bg-hold/5">
              <p className="text-sm font-medium">{taken.message}</p>
              {!taken.canRetry ? (
                <>
                  <p className="mt-1 text-xs text-muted">
                    Another court will not get past this one — the desk can sort it out while you
                    are here.
                  </p>
                  <div className="mt-3">
                    <Button size="sm" variant="ghost" onClick={() => setTaken(null)}>
                      Dismiss
                    </Button>
                  </div>
                </>
              ) : taken.alts.length ? (
                <>
                  <p className="mt-1 text-xs text-muted">
                    Nearest hours still open on this sport — tap one to hold it.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {taken.alts.map((a) => (
                      <Button
                        key={`${a.court.id}-${a.hour}`}
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void holdSlot(a.court, a.hour)}
                      >
                        {a.court.court_code} · {String(a.hour).padStart(2, "0")}:00
                      </Button>
                    ))}
                    <Button size="sm" variant="ghost" onClick={() => setTaken(null)}>
                      Dismiss
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-1 text-xs text-muted">
                    Nothing else is free for this sport today. Try another date above, or another
                    sport.
                  </p>
                  <div className="mt-3">
                    <Button size="sm" variant="ghost" onClick={() => setTaken(null)}>
                      Dismiss
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </motion.div>
        ) : null}
        {overlap ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Card className="mb-4 border border-hold/30 bg-hold/5">
              <p className="text-sm">{overlap.message}</p>
              <p className="mt-1 text-xs text-muted">
                Your class enrolment stays put — this is only a clash warning.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void (moving
                      ? moveTo(overlap.court, overlap.hour, true)
                      : holdSlot(overlap.court, overlap.hour, true))
                  }
                >
                  {moving ? "Move it anyway" : "Hold it anyway"}
                </Button>
                <Button variant="outline" onClick={() => setOverlap(null)}>
                  Never mind
                </Button>
              </div>
            </Card>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {hold ? (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            className="overflow-hidden"
          >
            {/* Sticky: the countdown is the one thing on this page that stops
                being true while you look away from it, and scrolling the grid
                for another court used to push it off screen. */}
            <Card className="sticky top-2 z-20 mb-4 flex flex-wrap items-center justify-between gap-4 border border-accent/30 bg-surface">
              <div className="min-w-[13rem] flex-1">
                <HoldProgress until={hold.hold_until} onExpire={() => setHold(null)} />
                <p className="mt-2 text-sm text-muted">
                  {hold.court_code ? (
                    <span className="font-medium text-fg">
                      {hold.court_code}
                      {hold.hour != null ? ` · ${String(hold.hour).padStart(2, "0")}:00` : ""}
                    </span>
                  ) : (
                    <span className="font-medium text-fg">{hold.booking.code}</span>
                  )}{" "}
                  · <span className="font-display text-lg tabular-nums text-fg">{money(hold.price)}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StarBorder speed={4}>
                  <Button disabled={busy} onClick={() => void confirmPay("quota")}>
                    Use plan hours
                  </Button>
                </StarBorder>
                {/*
                  Paying online settles the slot immediately, because payOS
                  confirms the money before the booking is confirmed. Bank
                  transfer below only promises it: the court stays on hold and
                  reception has to find the money on a statement first.
                */}
                {onlineOn ? (
                  <PayOnlineButton
                    refType="booking"
                    refId={hold.booking.id}
                    label="Pay online"
                    size="md"
                    variant="outline"
                    onPaid={() => {
                      setHold(null);
                      void load();
                      toast.success("Paid — your court is confirmed and the receipt is in your account.");
                    }}
                  />
                ) : null}
                <Button variant="outline" disabled={busy} onClick={() => void confirmPay("transfer")}>
                  Bank transfer
                </Button>
              </div>
            </Card>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {data ? (
        <CourtGrid
          date={date}
          courts={data.courts}
          slots={data.slots}
          sport={sport || undefined}
          onPick={(c, h) => void (moving ? moveTo(c, h) : holdSlot(c, h))}
          // A sold-out sport should hand back the two controls at the top of
          // this page rather than make the member go and find them again.
          onPickSport={setSport}
          onPickDate={setDate}
        />
      ) : (
        <div className="grid gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-72" />
        </div>
      )}
    </Shell>
  );
}
