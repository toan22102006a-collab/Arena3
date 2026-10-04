import { useEffect, useState } from "react";
import { availLabel, type AvailMap } from "@/components/availability-calendar";
import { cn } from "@/lib/cn";
import { locale, t } from "@/lib/i18n";
import {
  addDaysISO,
  kindLabel,
  slotStateLabel,
  sportLabel,
  todayISO,
  weekdayShort,
} from "@/lib/arena3/labels";

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString(locale(), {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type Court = {
  id: string;
  court_code: string;
  sport: string;
  status: string;
};
export type OccSlot = {
  court_id: string;
  start: string;
  end: string;
  kind: string;
  /**
   * The booking or enrolment this hour belongs to.
   *
   * Optional because the public schedule is served without it: whose booking
   * an hour is has nothing to do with whether it is free, and the landing page
   * has no business knowing.
   */
  ref?: string;
};

export const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

export { sportLabel };

/**
 * What an hour on a court is actually doing.
 *
 * The grid used to paint two things — taken or not — which is enough to sell a
 * slot and not enough to run a centre. A hold that expires in four minutes, a
 * court somebody is playing on right now, and a court with a broken light are
 * three different problems for reception and three different answers for a
 * member asking "can I have it?". They are separate states here so every
 * surface that draws a court says the same six words.
 */
export type SlotState =
  | "free"
  | "hold"
  | "booked"
  | "in_use"
  | "class"
  | "maintenance"
  | "closed"
  | "past";

/**
 * How each state is painted. The legend is built from this, so they cannot drift.
 *
 * On the desktop grid a cell is nine pixels tall with no room for a word, so
 * colour is the whole message and two states that merely differ in opacity are
 * the same state. Hence one family per idea: beige for free, green for sold,
 * black for a class, amber and dashed for the temporary one, hatching for
 * anything the building has taken off the market.
 */
const STATE_CLASS: Record<SlotState, string> = {
  free: "bg-wood/70 text-muted",
  // Dashed, because a hold is the one state that undoes itself.
  hold: "stripes border-2 border-dashed border-hold bg-hold/40 text-hold",
  // Mid green, solid: clearly sold, and unmistakably not the amber of a hold.
  booked: "bg-accent/80 text-accent-fg",
  // The darkest green: the only state where someone is on the court as you read this.
  in_use: "bg-accent-2 text-accent-fg ring-2 ring-accent-2/40",
  class: "bg-fg text-bg",
  maintenance: "stripes bg-wood text-muted",
  closed: "stripes bg-line-strong/45 text-subtle",
  past: "bg-wood/30 text-subtle/80 line-through decoration-subtle/40",
};

/**
 * An occupied hour whose owner the desk can look up (B-07). Court-level
 * closures have no occupancy behind them, so there is nothing to open.
 */
function canInspect(occ: OccSlot | undefined): occ is OccSlot & { ref: string } {
  return (
    !!occ?.ref && (occ.kind === "booking" || occ.kind === "hold" || occ.kind === "session" || occ.kind === "maintenance")
  );
}

/** Which states a member can act on. Everything else is information only. */
function isBookable(s: SlotState) {
  return s === "free";
}

function occAt(slots: OccSlot[], courtId: string, date: string, hour: number): OccSlot | undefined {
  const start = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+07:00`).getTime();
  const end = start + 60 * 60 * 1000;
  return slots.find((s) => {
    if (s.court_id !== courtId) return false;
    const a = new Date(s.start).getTime();
    const b = new Date(s.end).getTime();
    return a < end && b > start;
  });
}

function hourStart(date: string, hour: number) {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+07:00`).getTime();
}

/**
 * Has this hour already finished?
 *
 * The slot is written in ICT, so the string carries `+07:00` and comparing the
 * parsed instant against `Date.now()` is correct whatever timezone the browser
 * is in. An hour counts as past only once it has fully elapsed — the 14:00 slot
 * is still live at 14:30, and the desk can still sell the tail of it as a
 * walk-in.
 */
function isPast(date: string, hour: number, now: number) {
  return hourStart(date, hour) + 3_600_000 <= now;
}

/** Is this the hour the clock is in right now? */
function isNow(date: string, hour: number, now: number) {
  if (!now) return false;
  const start = hourStart(date, hour);
  return now >= start && now < start + 3_600_000;
}

export function slotState(
  court: Court,
  occ: OccSlot | undefined,
  date: string,
  hour: number,
  now: number,
): SlotState {
  if (isPast(date, hour, now)) return "past";
  // A court out of service is out of service for the whole day, whatever the
  // occupancy table says — the row for a booking taken before it broke is
  // history reception has to ring about, not an hour anyone can buy.
  if (court.status === "closed") return "closed";
  if (court.status === "maintenance") return "maintenance";
  if (!occ) return "free";
  if (occ.kind === "hold") return "hold";
  if (occ.kind === "maintenance") return "maintenance";
  if (occ.kind === "session") return "class";
  return isNow(date, hour, now) ? "in_use" : "booked";
}

/** Every hour still sellable on these courts, earliest first. */
export function freeHours(
  courts: Court[],
  slots: OccSlot[],
  date: string,
  now: number,
): { court: Court; hour: number }[] {
  const out: { court: Court; hour: number }[] = [];
  for (const h of HOURS) {
    for (const c of courts) {
      if (slotState(c, occAt(slots, c.id, date, h), date, h, now) === "free") {
        out.push({ court: c, hour: h });
      }
    }
  }
  return out;
}

/**
 * A clock that ticks once a minute.
 *
 * The grid greys out hours as they elapse, so it has to re-render on its own —
 * leaving a tab open through 18:00 should not leave a sellable-looking 17:00
 * on screen. Starting at `0` and filling in from an effect keeps the server
 * render and the first client render identical, which is what hydration needs;
 * `0` simply means "nothing is past yet" for the one frame before the effect
 * runs.
 */
export function useNowMinute() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function DateStrip({
  value,
  onChange,
  days = 7,
  avail,
}: {
  value: string;
  onChange: (v: string) => void;
  days?: number;
  /** Free-slot counts per day; a day with none left says so before it is opened. */
  avail?: AvailMap | null;
}) {
  const today = todayISO();
  const items = Array.from({ length: days }, (_, i) => {
    const iso = addDaysISO(today, i);
    return { iso, wd: weekdayShort(iso), day: Number(iso.slice(8, 10)), isToday: iso === today };
  });
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {items.map((it) => {
        const on = value === it.iso;
        return (
          <button
            key={it.iso}
            type="button"
            onClick={() => onChange(it.iso)}
            className={cn(
              "flex min-h-16 min-w-[4.25rem] shrink-0 flex-col items-center justify-center rounded-[var(--radius-lg)] px-3 transition-[background-color,color,transform,box-shadow] duration-200 active:scale-95",
              on
                ? "bg-accent text-accent-fg shadow-[0_8px_20px_-12px_rgba(31,92,67,0.9)]"
                : "bg-surface text-fg shadow-[var(--shadow-border)] hover:-translate-y-0.5 hover:bg-wood",
            )}
          >
            <span className="text-2xs font-medium uppercase tracking-wide opacity-70">
              {it.isToday ? t("Today") : it.wd}
            </span>
            <span className="font-display text-xl tabular-nums leading-none">{it.day}</span>
            {avail ? <span className="mt-0.5 text-2xs leading-none opacity-80">{availLabel(avail[it.iso])}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The key to the grid.
 *
 * `compact` drops the two states a member never has to reason about — a closed
 * court is the centre's business, not theirs — so the public
 * schedule reads in one line instead of two.
 */
export function CourtLegend({ compact = false }: { compact?: boolean }) {
  const order: SlotState[] = compact
    ? ["free", "hold", "booked", "in_use", "class", "past"]
    : ["free", "hold", "booked", "in_use", "class", "maintenance", "closed", "past"];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
      {order.map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-[2px]", STATE_CLASS[s])} />
          {slotStateLabel(s)}
        </li>
      ))}
    </ul>
  );
}

/**
 * What to do when the answer is "nothing".
 *
 * A fully-booked Saturday evening is the normal state of a busy centre, not an
 * error, and "no free slots" on its own leaves the member to work out their own
 * next move — which is usually to close the tab. So the grid answers the
 * question it just refused: the same sport tomorrow, or another sport in this
 * hall today, with the counts that make the choice for them.
 */
function NoFreeSlots({
  date,
  sport,
  dayOver,
  alternatives,
  onPickSport,
  onPickDate,
}: {
  date: string;
  sport?: string;
  /** Every hour has already elapsed — the day is finished, not sold out. */
  dayOver: boolean;
  alternatives: { sport: string; count: number }[];
  onPickSport?: (sport: string) => void;
  onPickDate?: (date: string) => void;
}) {
  const tomorrow = addDaysISO(date, 1);
  const sportName = sport ? sportLabel(sport).toLowerCase() : "";
  const offers = (onPickDate ? 1 : 0) + (onPickSport ? alternatives.length : 0);
  return (
    <div className="rounded-[var(--radius-xl)] border border-hold/30 bg-hold/5 p-4">
      <p className="text-sm font-medium">
        {dayOver
          ? sport
            ? t("Play has finished for the day on {sport}.", { sport: sportName })
            : t("Play has finished for the day on every court.")
          : sport
            ? t("Every {sport} hour left is taken.", { sport: sportName })
            : t("Every court hour left is taken.")}
      </p>
      <p className="mt-1 text-sm text-muted">
        {dayOver
          ? `${t("The hall opens again at 06:00.")}${offers ? ` ${t("Pick the next day below.")}` : ""}`
          : `${t("Nothing has gone wrong — this is a full day.")}${offers ? ` ${t("Here is what is still open.")}` : ""}`}
      </p>
      {offers ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {onPickDate ? (
            <button
              type="button"
              onClick={() => onPickDate(tomorrow)}
              className="min-h-9 rounded-[var(--radius-pill)] border border-line bg-surface px-4 text-xs font-medium shadow-[var(--shadow-border)] transition-colors duration-150 hover:bg-wood"
            >
              {t("Try {day} {n}", { day: weekdayShort(tomorrow), n: Number(tomorrow.slice(8, 10)) })}
            </button>
          ) : null}
          {onPickSport
            ? alternatives.map((a) => (
                <button
                  key={a.sport}
                  type="button"
                  onClick={() => onPickSport(a.sport)}
                  className="min-h-9 rounded-[var(--radius-pill)] border border-line bg-surface px-4 text-xs font-medium shadow-[var(--shadow-border)] transition-colors duration-150 hover:bg-wood"
                >
                  {t("{sport} · {n} free", { sport: sportLabel(a.sport), n: a.count })}
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

export function CourtGrid({
  date,
  courts,
  slots,
  sport,
  onPick,
  onInspect,
  onPickSport,
  onPickDate,
  legendCompact = false,
  selected,
}: {
  date: string;
  courts: Court[];
  slots: OccSlot[];
  sport?: string;
  onPick?: (court: Court, hour: number) => void;
  /** Staff only: tapping a taken hour opens whose it is. */
  onInspect?: (court: Court, hour: number, occ: OccSlot & { ref: string }) => void;
  /** Offered when this sport is sold out and another one is not. */
  onPickSport?: (sport: string) => void;
  /** Offered when the whole day is sold out. */
  onPickDate?: (date: string) => void;
  legendCompact?: boolean;
  /** The hour the caller is currently asking about, marked on the grid. */
  selected?: { courtId: string; hour: number } | null;
}) {
  const now = useNowMinute();
  const list = sport ? courts.filter((c) => c.sport === sport) : courts;
  const free = freeHours(list, slots, date, now).length;
  const hasClass = slots.some((s) => s.kind === "session" && list.some((c) => c.id === s.court_id));

  // Only worth computing when the answer above was zero.
  const alternatives =
    free === 0
      ? [...new Set(courts.map((c) => c.sport))]
          .filter((s) => s !== sport)
          .map((s) => ({
            sport: s,
            count: freeHours(courts.filter((c) => c.sport === s), slots, date, now).length,
          }))
          .filter((a) => a.count > 0)
          .sort((a, b) => b.count - a.count)
      : [];

  if (list.length === 0) {
    return (
      <div className="grid place-items-center gap-1 rounded-[var(--radius-xl)] bg-surface px-6 py-14 text-center shadow-[var(--shadow-border)]">
        <p className="font-medium">
          {sport ? t("No {sport} courts", { sport: sportLabel(sport).toLowerCase() }) : t("No courts")}
        </p>
        <p className="text-sm text-muted">{t("Nothing is set up for this sport yet. Try another filter.")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CourtLegend compact={legendCompact} />
        <p className="text-xs tabular-nums text-muted">{t("{n} free slots left", { n: free })}</p>
      </div>
      {free === 0 ? (
        <NoFreeSlots
          date={date}
          sport={sport}
          dayOver={HOURS.every((h) => isPast(date, h, now))}
          alternatives={alternatives}
          onPickSport={onPickSport}
          onPickDate={onPickDate}
        />
      ) : null}
      {!hasClass ? (
        <p className="text-sm text-muted">{t("No classes scheduled on court today — you are seeing member bookings only.")}</p>
      ) : null}

      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:hidden" role="region" aria-label={t("Courts, scrolls sideways")} tabIndex={0}>
        {list.map((c) => (
          <div
            key={c.id}
            className="w-[min(20rem,85vw)] shrink-0 snap-center rounded-[var(--radius-lg)] bg-surface p-3 shadow-[var(--shadow-border)]"
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="font-medium">{c.court_code}</p>
              <p className="text-2xs text-muted">
                {c.status === "ready" ? sportLabel(c.sport) : slotStateLabel(c.status === "closed" ? "closed" : "maintenance")}
              </p>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {HOURS.map((h) => {
                const occ = occAt(slots, c.id, date, h);
                const state = slotState(c, occ, date, h, now);
                const label = String(h).padStart(2, "0");
                const title = cellTitle(state, occ);
                // Past hours are shown, never offered — seeing the whole day is
                // the point of the grid, but nothing can be sold backwards.
                const clickable = onPick && (isBookable(state));
                const inspect = !clickable && onInspect && canInspect(occ) ? occ : null;
                const cls = cn(
                  "grid min-h-11 place-items-center rounded-[var(--radius-xs)] text-2xs font-medium tabular-nums",
                  STATE_CLASS[state],
                  isNow(date, h, now) && state !== "past" && "ring-1 ring-accent/60",
                  selected?.courtId === c.id &&
                    selected.hour === h &&
                    "ring-2 ring-accent ring-offset-1 ring-offset-surface",
                );
                if (inspect) {
                  return (
                    <button
                      key={h}
                      type="button"
                      title={title}
                      aria-label={t("{state} · {court} at {time} — show details", { state: slotStateLabel(state), court: c.court_code, time: `${label}:00` })}
                      onClick={() => onInspect!(c, h, inspect)}
                      className={cn(cls, "transition-transform duration-150 active:scale-95")}
                    >
                      {label}
                    </button>
                  );
                }
                if (!clickable) {
                  return (
                    <div key={h} title={title} className={cls}>
                      {label}
                    </div>
                  );
                }
                return (
                  <button
                    key={h}
                    type="button"
                    title={title}
                    aria-label={t("{state} · {court} at {time}", { state: slotStateLabel(state), court: c.court_code, time: `${label}:00` })}
                    onClick={() => onPick(c, h)}
                    className={cn(
                      cls,
                      isBookable(state) &&
                        "transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-accent-fg active:scale-95",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-border)] md:block" role="region" aria-label={t("Court timetable, scrolls sideways")} tabIndex={0}>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `3.25rem repeat(${list.length}, minmax(0, 1fr))`,
            // Sized to the courts actually on screen rather than a flat 640px.
            // Filtering to the two basketball courts used to leave the table
            // wider than its container, so a two-column grid scrolled sideways
            // for no reason. `max(100%, …)` fills the container when the courts
            // fit and only overflows — and only then shows a scrollbar — once
            // there are genuinely too many to lay out. 4.5rem is the narrowest
            // a "BC1 / Basketball" heading stays readable at.
            minWidth: `max(100%, ${3.25 + list.length * 4.5}rem)`,
          }}
        >
          <div className="sticky left-0 z-10 bg-surface px-2 py-2 text-2xs font-medium uppercase tracking-wider text-muted">
            {t("Hour")}
          </div>
          {list.map((c) => (
            <div key={c.id} className="border-l border-line/80 px-1 py-2 text-center">
              <div className="text-xs font-medium">
                {c.court_code}
              </div>
              {/* A court out of service says so in its own heading — otherwise
                  the only clue is a column of stripes with nothing naming it. */}
              <div className={cn("text-2xs", c.status === "ready" ? "text-subtle" : "text-hold")}>
                {c.status === "ready"
                  ? sportLabel(c.sport)
                  : slotStateLabel(c.status === "closed" ? "closed" : "maintenance")}
              </div>
            </div>
          ))}
          {HOURS.map((h) => (
            <HourRow
              key={h}
              hour={h}
              list={list}
              slots={slots}
              date={date}
              onPick={onPick}
              onInspect={onInspect}
              selected={selected}
              now={now}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Hover text: the state, plus what is on the court and until when. */
function cellTitle(state: SlotState, occ: OccSlot | undefined) {
  if (state === "past") return occ ? t("{kind} · finished", { kind: kindLabel(occ.kind) }) : t("This hour has passed");
  if (!occ) return slotStateLabel(state);
  return `${slotStateLabel(state)} · ${kindLabel(occ.kind)} ${hhmm(occ.start)}–${hhmm(occ.end)}`;
}

function HourRow({
  hour,
  list,
  slots,
  date,
  onPick,
  onInspect,
  selected,
  now,
}: {
  hour: number;
  list: Court[];
  slots: OccSlot[];
  date: string;
  onPick?: (court: Court, hour: number) => void;
  onInspect?: (court: Court, hour: number, occ: OccSlot & { ref: string }) => void;
  selected?: { courtId: string; hour: number } | null;
  now: number;
}) {
  const past = isPast(date, hour, now);
  const live = isNow(date, hour, now);
  return (
    <>
      <div
        className={cn(
          "sticky left-0 z-10 flex items-center gap-1 border-t border-line/70 bg-surface px-2 py-1 text-xs tabular-nums",
          past ? "text-subtle/80 line-through" : live ? "font-medium text-accent-2" : "text-muted",
        )}
      >
        {live ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
        {String(hour).padStart(2, "0")}
      </div>
      {list.map((c) => {
        const occ = occAt(slots, c.id, date, hour);
        const state = slotState(c, occ, date, hour, now);
        const title = cellTitle(state, occ);
        const clickable = onPick && (isBookable(state));
        const cls = cn(
          "h-9 w-full overflow-hidden rounded-[var(--radius-xs)]",
          STATE_CLASS[state],
          live && state !== "past" && "ring-1 ring-accent/60",
          selected?.courtId === c.id &&
            selected.hour === hour &&
            "ring-2 ring-accent ring-offset-1 ring-offset-surface",
        );
        const inspect = !clickable && onInspect && canInspect(occ) ? occ : null;
        if (inspect) {
          return (
            <div key={c.id} className="border-l border-t border-line/70 p-1">
              <button
                type="button"
                title={title}
                aria-label={t("{state} · {court} at {time} — show details", {
                  state: slotStateLabel(state),
                  court: c.court_code,
                  time: `${String(hour).padStart(2, "0")}:00`,
                })}
                onClick={() => onInspect!(c, hour, inspect)}
                className={cn(cls, "block transition-transform duration-150 active:scale-95")}
              />
            </div>
          );
        }
        if (!clickable) {
          return (
            <div key={c.id} className="border-l border-t border-line/70 p-1">
              <div title={title} className={cls} />
            </div>
          );
        }
        return (
          <div key={c.id} className="border-l border-t border-line/70 p-1">
            <button
              type="button"
              title={title}
              aria-label={
                isBookable(state)
                  ? t("Book {court} at {time}", { court: c.court_code, time: `${String(hour).padStart(2, "0")}:00` })
                  : t("Release the court paired with {court} at {time}", {
                      court: c.court_code,
                      time: `${String(hour).padStart(2, "0")}:00`,
                    })
              }
              onClick={() => onPick(c, hour)}
              className={cn(
                cls,
                isBookable(state) &&
                  "block transition-[background-color,transform] duration-150 hover:bg-accent active:scale-95",
              )}
            />
          </div>
        );
      })}
    </>
  );
}
