import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Menu,
  Phone,
  Quote,
  Sparkles,
  X,
} from "lucide-react";
import { ArenaMark } from "@/components/mark";
import { Cover, HeroVideo, MediaCaption, media, sportPhoto } from "@/components/media";
import { Button, Card, Modal, Seg, Skeleton } from "@/components/ui";
import {
  CourtGrid,
  DateStrip,
  freeHours,
  useNowMinute,
  type Court as GridCourt,
} from "@/components/court-grid";
import {
  CountUp,
  Lift,
  Parallax,
  Reveal,
  ScrollProgress,
  Stagger,
  StaggerItem,
  WordReveal,
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from "@/components/motion";
import {
  CardSwap,
  GLBackground,
  GlareHover,
  ScrollReveal,
  ScrollVelocity,
  ShinyText,
  SplitText,
  SpotlightCard,
  StarBorder,
} from "@/components/fx";
import { getStoredUser, getToken, homeFor } from "@/lib/arena3/client";
import {
  getPublicAvailability,
  getPublicCatalog,
  type CatalogPrice,
} from "@/lib/arena3/catalog";
import { COACHES, type CoachCard } from "@/lib/arena3/coaches";
import { addDaysISO, levelLabel, rruleLabel, sportLabel, weekdayShort } from "@/lib/arena3/labels";
import { money } from "@/components/shell";
import { LangSwitch } from "@/components/lang-switch";
import { t, tk } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  // Today's schedule loads with the page rather than behind a sign-in wall:
  // "is a court free tonight" is the question people arrive with, and making
  // them register to find out is the funnel running backwards.
  loader: async () => {
    const [catalog, availability] = await Promise.all([
      getPublicCatalog(),
      getPublicAvailability({ data: {} }),
    ]);
    return { ...catalog, availability };
  },
  component: Home,
});

/**
 * Rich sentences: translate the whole sentence with `{name}` placeholders set to `mark("name")`,
 * then `rich()` swaps each marker for a styled node, so word order stays the translator's call.
 */
const mark = (k: string) => `\u0001${k}\u0002`;
function rich(text: string, nodes: Record<string, ReactNode>): ReactNode {
  return text.split(/\u0001(\w+)\u0002/).map((part, i) =>
    i % 2 === 0 ? part : <span key={i}>{nodes[part]}</span>,
  );
}

/** Short weekday for display; `weekdayShort` keeps its English codes for the weekend check. */
const WD_SHORT: Record<string, string> = {
  Mon: tk("Mon"),
  Tue: tk("Tue"),
  Wed: tk("Wed"),
  Thu: tk("Thu"),
  Fri: tk("Fri"),
  Sat: tk("Sat"),
  Sun: tk("Sun"),
};
const wdLabel = (iso: string) => {
  const w = weekdayShort(iso);
  return t(WD_SHORT[w] ?? w);
};

function Home() {
  const token = getToken();
  const u = getStoredUser();
  if (token && u) return <Navigate to={homeFor(u.role)} />;
  return <Landing />;
}

const OPEN_HOUR = 6;
const CLOSE_HOUR = 22;

/** Current wall-clock hour at the centre (ICT), or null until the client mounts. */
function useVenueHour() {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    const read = () =>
      setHour(
        Number(
          new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Ho_Chi_Minh",
            hour: "2-digit",
            hour12: false,
          }).format(new Date()),
        ),
      );
    read();
    const id = setInterval(read, 60_000);
    return () => clearInterval(id);
  }, []);
  return hour;
}

/**
 * The public nav, in business order.
 *
 * Not everything on this page matters equally. Somebody arriving has one
 * question — when can I get on a court — so the schedule is first and the
 * things that only matter once they have played (coaches, plans) come after.
 * Facilities and "how it works" moved to the footer: they are reassurance, and
 * reassurance does not belong in front of the decision.
 */
const NAV: [string, string][] = [
  ["#schedule", tk("Today's schedule")],
  ["#courts", tk("Courts & pricing")],
  ["#classes", tk("Classes")],
  ["#coaches", tk("Coaches")],
  ["#plans", tk("Plans")],
];

/**
 * The landing header.
 *
 * It gets out of the way going down the page and comes back the instant you
 * scroll up, which is what people reach for when they want the nav again. The
 * hamburger below `md` opens the same five links as a sheet — the desktop nav
 * is hidden at that width and there was previously nothing in its place.
 */
function SiteHeader({ reduced }: { reduced: boolean }) {
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const { scrollY } = useScroll();
  const last = useRef(0);

  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = last.current;
    last.current = y;
    // Ignore the rubber-band overscroll at the very top, and anything small
    // enough to be a trackpad tremor rather than an intent to scroll.
    if (y < 96) {
      setHidden(false);
      return;
    }
    if (Math.abs(y - prev) < 6) return;
    setHidden(y > prev);
  });

  // A hidden header with an open sheet hanging off it would be a trap.
  useEffect(() => {
    if (open) setHidden(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <motion.header
      className="sticky top-0 z-30 border-b border-line/70 glass"
      animate={reduced ? undefined : { y: hidden ? "-100%" : "0%" }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="group flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <motion.span
            whileHover={reduced ? undefined : { rotate: -8, scale: 1.06 }}
            transition={{ type: "spring", stiffness: 380, damping: 18 }}
            className="inline-flex"
          >
            <ArenaMark className="size-8" />
          </motion.span>
          <span className="font-display text-xl font-normal italic">Arena3</span>
        </Link>
        {/* Same voice as the signed-in header: a row of quiet uppercase pills.
            The landing used a wide-tracked display face that read as decoration
            next to it, so the two halves of the same product looked like two
            different products. */}
        <nav className="hidden items-center gap-1 xl:flex">
          {NAV.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="flex h-9 items-center whitespace-nowrap rounded-[var(--radius-pill)] px-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted transition-colors duration-200 hover:bg-wood hover:text-fg"
            >
              {t(label)}
            </a>
          ))}
        </nav>
        {/* Two zones, not one row of five buttons: what the centre sells is on
            the left of the rule, what belongs to a person is on the right. */}
        <div className="hidden items-center gap-2 md:flex">
          <a href="#schedule">
            <Button>{t("Book a court")}</Button>
          </a>
          <span aria-hidden className="mx-1 h-6 w-px bg-line-strong/70" />
          <Link to="/login">
            <Button variant="ghost">{t("Sign in")}</Button>
          </Link>
          <Link to="/register">
            <Button variant="outline">{t("Join")}</Button>
          </Link>
          <LangSwitch />
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? t("Close menu") : t("Open menu")}
          className="grid size-10 place-items-center rounded-[var(--radius-md)] border border-line bg-surface/70 text-fg transition-colors duration-200 hover:border-accent hover:bg-wood xl:hidden"
        >
          {open ? <X className="size-5" strokeWidth={1.75} /> : <Menu className="size-5" strokeWidth={1.75} />}
        </button>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="sheet"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-line/70 bg-surface/95 backdrop-blur-sm xl:hidden"
          >
            <nav className="mx-auto grid max-w-6xl gap-1 px-4 py-3">
              {/* The first nav entry is the schedule, which is what this button
                  does — so the sheet shows the action and then the rest. */}
              <a href="#schedule" onClick={() => setOpen(false)} className="mb-1 block">
                <Button className="w-full">{t("Book a court")}</Button>
              </a>
              {NAV.slice(1).map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className="rounded-[var(--radius-md)] px-3 py-3 text-sm font-medium text-fg transition-colors duration-200 hover:bg-wood"
                >
                  {t(label)}
                </a>
              ))}
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line/70 pt-3">
                <Link to="/login" onClick={() => setOpen(false)}>
                  <Button variant="outline" className="w-full">
                    {t("Sign in")}
                  </Button>
                </Link>
                <Link to="/register" onClick={() => setOpen(false)}>
                  <Button className="w-full">{t("Join")}</Button>
                </Link>
              </div>
              <div className="flex justify-center pt-1 md:hidden">
                <LangSwitch />
              </div>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.header>
  );
}

/** Weekend pricing runs on Saturday and Sunday; everything else is a weekday. */
function dayKindOf(iso: string) {
  const wd = weekdayShort(iso);
  return wd === "Sat" || wd === "Sun" ? "weekend" : "weekday";
}

/** What one hour on one sport costs on a given day, from the centre's own sheet. */
function priceFor(prices: CatalogPrice[], sport: string, date: string, hour: number) {
  const kind = dayKindOf(date);
  const rule = prices.find(
    (p) =>
      p.sport === sport &&
      p.day_kind === kind &&
      !p.court_id &&
      Number(p.start_local.slice(0, 2)) <= hour &&
      hour < Number(p.end_local.slice(0, 2)),
  );
  return rule?.price_vnd ?? null;
}

function Landing() {
  const { plans, classes, prices, availability } = Route.useLoaderData();
  const [coachSport, setCoachSport] = useState("");
  const [openCoach, setOpenCoach] = useState<CoachCard | null>(null);
  const reduced = useReducedMotion();
  const hour = useVenueHour();
  const isOpen = hour == null ? null : hour >= OPEN_HOUR && hour < CLOSE_HOUR;

  // ── Today's schedule, live on the page ──────────────────────────────
  const [schedSport, setSchedSport] = useState("badminton");
  const [schedDate, setSchedDate] = useState(availability.date);
  const [sched, setSched] = useState(availability);
  const [schedBusy, setSchedBusy] = useState(false);
  const [picked, setPicked] = useState<{ court: GridCourt; hour: number } | null>(null);
  const now = useNowMinute();

  useEffect(() => {
    if (schedDate === sched.date) return;
    let alive = true;
    setSchedBusy(true);
    setPicked(null);
    getPublicAvailability({ data: { date: schedDate } })
      .then((r) => {
        if (alive) setSched(r);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setSchedBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [schedDate, sched.date]);

  const freeBySport = (s: string) =>
    freeHours(sched.courts.filter((c) => c.sport === s), sched.slots, sched.date, now).length;
  const schedFree = freeHours(sched.courts, sched.slots, sched.date, now).length;
  const schedDay =
    sched.date === availability.date
      ? t("today")
      : t("on {day}", { day: `${wdLabel(sched.date)} ${Number(sched.date.slice(8, 10))}` });
  const cheapestHour = Math.min(...prices.filter((p) => !p.court_id).map((p) => p.price_vnd));

  /*
   * After close, show tomorrow.
   *
   * Open the site at half past ten at night and every hour on today's grid has
   * already been played; a page whose headline offer is "0 free hours" and
   * whose grid is a wall of strikethrough is telling the truth in the least
   * useful way there is. The first day with hours left is the one worth
   * showing. Deferred to an effect rather than decided during render because
   * the clock is not available until the client has mounted — reading it
   * earlier would make the server and browser render different pages.
   */
  useEffect(() => {
    if (!now) return;
    if (schedDate !== availability.date) return;
    if (freeHours(availability.courts, availability.slots, availability.date, now).length > 0) return;
    setSchedDate(addDaysISO(availability.date, 1));
  }, [now, schedDate, availability]);

  /** Jump to the schedule already filtered to the sport they tapped. */
  const showTimes = (s: string) => {
    setSchedSport(s);
    setPicked(null);
    document.getElementById("schedule")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  };

  const sports = [
    {
      id: "badminton",
      photo: media.badminton,
      count: 12,
      codes: "CL-01…12",
      note: t("Feather-grade shuttles, 9m ceiling, wood sprung floor."),
    },
    {
      id: "basketball",
      photo: media.basketball,
      count: 2,
      codes: "BR-01, BR-02",
      note: t("Full-size hardwood with breakaway rims."),
    },
    {
      id: "volleyball",
      photo: media.volleyball,
      count: 2,
      codes: "BC-01, BC-02",
      note: t("Competition net height, referee stand, ten-second reset between sets."),
    },
  ];

  const weekday = prices.filter((p) => p.day_kind === "weekday" && !p.court_id);
  const coaches = COACHES.filter((c) => !coachSport || c.sport === coachSport);

  // Named against the court codes and gear SKUs the schedule actually uses, so
  // the marketing page and the booking grid describe the same building.
  const facilities = [
    {
      code: "CL-01…12",
      name: t("Badminton courts"),
      photo: media.badmintonCourt,
      note: t("Twelve bays on sprung wood. Feather-grade shuttles are issued at the counter, not sold from a machine."),
    },
    {
      code: "BR-01, BR-02",
      name: t("Basketball courts"),
      photo: media.basketballCourt,
      note: t("Full-size hardwood with breakaway rims."),
    },
    {
      code: "BC-01, BC-02",
      name: t("Volleyball courts"),
      photo: media.volleyballCourt,
      note: t("Competition net height with a referee stand on the side and a ten-second reset between sets."),
    },
    {
      code: t("Reception"),
      name: t("Front desk"),
      photo: media.reception,
      note: t("Staffed the whole time we are open. Rackets, shuttle tubes and match balls go out on your tab and settle with the court."),
    },
  ];

  const steps = [
    {
      n: "01",
      title: t("Pick your slot"),
      body: t("Live court map, hour by hour. What you see is what is actually free — holds expire in front of you."),
    },
    {
      n: "02",
      title: t("Hold it for five minutes"),
      body: t("The slot is yours while you decide. No card up front, no phone call."),
    },
    {
      n: "03",
      title: t("Pay at the desk"),
      body: t("Cash, transfer or straight off your plan's hour balance. Three taps at reception and you are on court."),
    },
  ];

  return (
    <main id="main-content" tabIndex={-1} className="min-h-dvh overflow-x-clip text-fg">
      <ScrollProgress />

      <SiteHeader reduced={!!reduced} />

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="grain relative min-h-[88dvh] overflow-hidden">
        <motion.div
          className="absolute inset-0"
          initial={reduced ? false : { scale: 1.12 }}
          animate={{ scale: 1 }}
          transition={{ duration: 2.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <HeroVideo src={media.hallVideo} poster={media.hallCourts} />
        </motion.div>
        <div className="hero-scrim pointer-events-none absolute inset-0" />
        {/* Filaments drift across the top of the footage — enough movement to
            keep the frame alive while the video loops. */}
        <GLBackground
          variant="threads"
          className="opacity-60 mix-blend-screen"
          color="#eadfcb"
          amplitude={1.2}
          speed={0.55}
          opacity={0.32}
        />

        <div className="relative mx-auto flex min-h-[88dvh] max-w-6xl flex-col justify-end px-4 pb-16 pt-24">
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
            // No panel: the headline sits straight on the footage, with the
            // hero scrim and `.on-media` text shadow doing the legibility work.
            className="max-w-2xl text-on-media on-media"
          >
            <div className="flex items-center gap-2.5">
              <span className="relative inline-flex size-2 text-on-media">
                {isOpen ? <span className="ping-ring" /> : null}
                <span
                  className={`relative inline-flex size-2 rounded-full ${
                    isOpen === false ? "bg-on-media-muted/55" : "bg-on-media"
                  }`}
                />
              </span>
              <p className="kicker text-2xs text-on-media-muted">
                <ShinyText className="shiny-on-media" speed={6}>
                  {isOpen == null
                    ? t("Indoor sports centre")
                    : isOpen
                      ? t("Open now · until {time}", { time: `${CLOSE_HOUR}:00` })
                      : t("Closed · opens {time}", { time: `${String(OPEN_HOUR).padStart(2, "0")}:00` })}
                </ShinyText>
              </p>
            </div>

            {/* Two voices, one headline: the narrative line stays in the serif
                italic, then the payoff drops into block caps underneath and
                tucks up under it. Lifted from unseen.co's title treatment, but
                built out of the two faces Arena3 already uses. */}
            <h1 className="mt-4">
              <span className="block font-display text-4xl font-medium italic leading-[0.96] sm:text-6xl">
                <WordReveal text={t("Courts, classes, plans —")} delay={0.35} />
              </span>
              <span className="athletic media-glow -mt-1 block text-[3.25rem] leading-[0.86] sm:-mt-2 sm:text-[5.5rem]">
                <WordReveal text={t("one calendar.")} delay={0.75} className="text-gradient-media py-[0.3em] -my-[0.3em]" />
              </span>
            </h1>

            <motion.p
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2, duration: 0.7 }}
              className="mt-5 max-w-lg text-on-media-muted"
            >
              {t("Badminton, basketball, volleyball. Open 06:00–22:00, every day. Book a court in five minutes; the desk closes you out in three taps.")}
            </motion.p>

            <motion.div
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.35, duration: 0.6 }}
              className="mt-8 flex flex-wrap gap-3"
            >
              {/* Reversed out: a dark-green pill would disappear into the
                  footage, so the CTAs invert to cream and glass here. The
                  magnet is on the primary only — two competing magnets make a
                  button row feel like it is sliding around.

                  The primary used to be "Become a member", which asks a
                  stranger to buy a subscription before they have seen the
                  place. The order is the funnel: see a free hour, take it,
                  come back — membership is what you buy on the third visit. */}
                              <a href="#schedule">
                  <Button
                    size="lg"
                    className="group bg-on-media text-fg shadow-[var(--shadow-soft)] hover:bg-surface hover:shadow-[var(--shadow-soft)]"
                  >
                    {t("Book a court")}
                    <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </Button>
                </a>
                            <a href="#courts">
                <Button
                  variant="outline"
                  size="lg"
                  className="group border-on-media/40 bg-on-media/10 text-on-media shadow-none backdrop-blur-sm hover:border-on-media/70 hover:bg-on-media/20"
                >
                  {t("See courts & pricing")}
                  {/* Diagonal arrow, unseen.co's tell for a "go and look" link. */}
                  <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Button>
              </a>
            </motion.div>

            {/* The live number is the argument for tapping the button above —
                and the one thing a photograph of a sports hall cannot say. */}
            <motion.p
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5, duration: 0.6 }}
              className="mt-4 text-sm text-on-media-muted"
            >
              {rich(
                t("{n} court hours still free {day} · from {price}/hr · held five minutes while you decide.", {
                  n: mark("n"),
                  day: schedDay,
                  price: mark("price"),
                }),
                {
                  n: <span className="tabular-nums text-on-media">{schedFree}</span>,
                  price: <span className="tabular-nums text-on-media">{money(cheapestHour)}</span>,
                },
              )}
              <span className="mt-1 block">
                {/* Membership is the third-visit decision, so it stays a link
                    under the fold of the offer rather than a third button. */}
                <a href="#plans" className="link-underline text-on-media">
                  {t("Or see membership plans")}
                </a>
              </span>
            </motion.p>
          </motion.div>
        </div>

        {/* Scroll cue.
            It used to be a lone outlined capsule floating beside the CTAs,
            which everybody read as a third button nobody had labelled. A cue
            has to say what it is: the word carries it, the rule underneath
            does the pointing, and it sits in the corner where no real control
            lives. */}
        {reduced ? null : (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute bottom-7 right-6 hidden flex-col items-center gap-2 lg:flex"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.8 }}
          >
            <span className="kicker text-2xs text-on-media-muted">{t("Scroll")}</span>
            <span className="relative block h-12 w-px overflow-hidden bg-on-media/25">
              <motion.span
                className="absolute inset-x-0 top-0 block h-5 bg-on-media/80"
                animate={{ y: [-20, 48] }}
                transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
              />
            </span>
          </motion.div>
        )}
      </section>

      {/* ── Counters ─────────────────────────────────────────────── */}
      <section className="grain relative overflow-hidden bg-fg text-on-media">
        {/* The one place on the page dark enough for a real shader to pay off.
            The blurred wash stays as the fallback for reduced motion and for
            the moment before the chunk lands. */}
        <GLBackground
          variant="aurora"
          colors={["#1f5c43", "#4e9e75", "#c9a227"]}
          amplitude={1.15}
          speed={0.85}
          opacity={0.6}
          fallback={<div className="wash wash-accent -left-24 -top-32 size-80 opacity-70" />}
        />
        {/*
          The band that has to earn the centre's credibility in three seconds.

          Four bare numerals did the opposite: "16 · 3 · 4 · 16H" is a quiz. A
          figure only builds trust when the reader can check it against
          something, so each one now carries the line that makes it concrete —
          and the first is not a boast at all but today's live count, which is
          the number that decides whether they scroll on or leave.

          Full-bleed rather than centred in a 6xl box: the cells used to stop
          short of the edges with the aurora running past them, so the band read
          as a floating card with two empty margins.
        */}
        <div className="relative z-[1] grid grid-cols-2 gap-px bg-on-media/12 lg:grid-cols-4">
          {[
            {
              to: schedFree,
              suffix: "",
              label: t("Court hours free"),
              note: t("Live from the booking grid · {day}", { day: schedDay }),
              href: "#schedule",
            },
            {
              to: 16,
              suffix: "",
              label: t("Courts & bays"),
              note: t("12 badminton · 2 basketball · 2 volleyball"),
              href: "#courts",
            },
            {
              to: 16,
              suffix: "h",
              label: t("Open every day"),
              note: t("06:00–22:00, no closing day"),
              href: "#schedule",
            },
            {
              to: 4,
              suffix: "",
              label: t("Head coaches"),
              note: t("One per sport, classes on the same calendar"),
              href: "#coaches",
            },
          ].map((s) => (
            <a
              key={s.label}
              href={s.href}
              className="group bg-fg/72 px-5 py-8 text-center backdrop-blur-[2px] transition-colors duration-200 hover:bg-fg/60 sm:py-11"
            >
              <p className="figure text-5xl tabular-nums sm:text-6xl">
                <CountUp to={s.to} suffix={s.suffix} />
              </p>
              <p className="kicker mt-3 text-2xs text-on-media">{s.label}</p>
              <p className="mx-auto mt-1.5 max-w-[16rem] text-xs leading-relaxed text-on-media-muted">
                {s.note}
              </p>
            </a>
          ))}
        </div>
      </section>

      {/* ── Courts & pricing ─────────────────────────────────────── */}
      {/*
        This used to be one section doing two jobs badly. A member looking at a
        sports centre asks four questions — what is there, what is free, when,
        and how much — and a photograph with a price tucked under it answered
        one and a half. So it is two sections now: what the hall contains, with
        every number in the open instead of on hover, and then the live grid
        below that answers "when".
      */}
      <section id="courts" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
        <Reveal>
          <p className="kicker text-2xs text-muted">{t("Three sports")}</p>
          <h2 className="mt-2 font-display text-4xl sm:text-5xl">
            <SplitText text={t("Courts & pricing")} />
          </h2>
          <p className="mt-3 max-w-md text-muted">
            {t("One hall, sixteen playing surfaces — badminton, basketball and volleyball under one roof.")}
          </p>
        </Reveal>

        <Stagger className="mt-8 grid gap-4 md:grid-cols-3" gap={0.1}>
          {sports.map((s) => {
            const off = weekday.find((p) => p.sport === s.id && !p.is_peak);
            const peak = weekday.find((p) => p.sport === s.id && p.is_peak);
            const openNow = freeBySport(s.id);
            return (
              <StaggerItem key={s.id} className="h-full">
                <Lift className="h-full">
                  <Card className="flex h-full flex-col overflow-hidden p-0">
                    <GlareHover>
                      <Cover
                        src={s.photo}
                        alt={sportLabel(s.id)}
                        scrim="none"
                        className="group aspect-[4/3]"
                        imgClassName="transition-transform duration-[900ms] ease-[var(--ease-smooth)] group-hover:scale-[1.07]"
                      >
                        <MediaCaption>
                          <p className="athletic text-3xl sm:text-4xl">{sportLabel(s.id)}</p>
                          <p className="mt-1 text-sm text-on-media-muted">
                            {s.count === 1
                              ? t("1 court · {codes}", { codes: s.codes })
                              : t("{n} courts · {codes}", { n: s.count, codes: s.codes })}
                          </p>
                        </MediaCaption>
                      </Cover>
                    </GlareHover>
                    <div className="flex flex-1 flex-col p-5">
                      <dl className="grid grid-cols-2 gap-3 border-b border-line pb-4">
                        <div>
                          <dt className="kicker text-2xs text-muted">{t("Off-peak")}</dt>
                          <dd className="font-display text-2xl tabular-nums">
                            {off ? money(off.price_vnd) : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="kicker text-2xs text-muted">{t("Peak")}</dt>
                          <dd className="font-display text-2xl tabular-nums text-accent-2">
                            {peak ? money(peak.price_vnd) : "—"}
                          </dd>
                        </div>
                      </dl>
                      <p className="mt-4 flex-1 text-sm text-muted">{s.note}</p>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <p className="text-xs tabular-nums text-muted">
                          {openNow ? t("{n} hours free", { n: openNow }) : t("Fully booked")}
                          <span className="text-subtle"> · {schedDay}</span>
                        </p>
                        <Button size="sm" onClick={() => showTimes(s.id)}>
                          {t("See free times")}
                        </Button>
                      </div>
                    </div>
                  </Card>
                </Lift>
              </StaggerItem>
            );
          })}
        </Stagger>
      </section>

      {/* ── Today's schedule ─────────────────────────────────────── */}
      <section id="schedule" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-20">
        <Reveal>
          <p className="kicker text-2xs text-muted">{t("Live availability")}</p>
          <h2 className="mt-2 font-display text-4xl sm:text-5xl">
            <SplitText text={t("When is a court free?")} splitBy="words" stagger={0.06} />
          </h2>
          <p className="mt-3 max-w-lg text-muted">
            {t("Every hour in the hall, exactly as it stands. Tap a free one and it is yours for five minutes while you sign in — no card up front, no phone call.")}
          </p>
        </Reveal>

        <div className="mt-7 grid gap-3">
          <DateStrip value={schedDate} onChange={setSchedDate} />
          <Seg
            value={schedSport}
            onChange={(v) => {
              setSchedSport(v);
              setPicked(null);
            }}
            options={[
              { value: "", label: t("All") },
              { value: "badminton", label: sportLabel("badminton") },
              { value: "basketball", label: sportLabel("basketball") },
              { value: "volleyball", label: sportLabel("volleyball") },
            ]}
          />
        </div>

        {/* What a tap on a free hour gets you, before you are asked for
            anything. The slot is named, priced and dated here so signing in is
            a step towards something specific rather than a toll gate. */}
        <AnimatePresence>
          {picked ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <Card className="mt-4 flex flex-wrap items-center gap-4 border border-accent/30">
                <div className="min-w-[13rem] flex-1">
                  <p className="kicker text-2xs text-muted">
                    {sportLabel(picked.court.sport)} · {picked.court.court_code}
                  </p>
                  <p className="mt-1 font-display text-2xl tabular-nums">
                    {String(picked.hour).padStart(2, "0")}:00–
                    {String(picked.hour + 1).padStart(2, "0")}:00
                    <span className="ml-2 text-muted">
                      {wdLabel(schedDate)} {Number(schedDate.slice(8, 10))}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {(() => {
                      const p = priceFor(prices, picked.court.sport, schedDate, picked.hour);
                      return p ? t("{price} for the hour", { price: money(p) }) : t("Priced at the desk");
                    })()}{" "}
                    · {t("held five minutes once you sign in")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to="/login">
                    <Button>{t("Sign in & hold it")}</Button>
                  </Link>
                  <Link to="/register">
                    <Button variant="outline">{t("Create an account")}</Button>
                  </Link>
                  <Button variant="ghost" onClick={() => setPicked(null)}>
                    {t("Pick another")}
                  </Button>
                </div>
              </Card>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="mt-4">
          {schedBusy ? (
            <div className="grid gap-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-72" />
            </div>
          ) : (
            <CourtGrid
              date={sched.date}
              courts={sched.courts}
              slots={sched.slots}
              sport={schedSport || undefined}
              onPick={(court, hour) => setPicked({ court, hour })}
              onPickSport={(s) => {
                setSchedSport(s);
                setPicked(null);
              }}
              onPickDate={setSchedDate}
              legendCompact
              selected={picked ? { courtId: picked.court.id, hour: picked.hour } : null}
            />
          )}
        </div>
      </section>

      {/* ── Class marquee ────────────────────────────────────────── */}
      {classes.length ? (
        <section
          aria-label={t("Classes running this week")}
          className="relative z-0 overflow-hidden border-y border-line bg-surface/80 py-5"
        >
          {/* Speed and direction track the scroll wheel: flicking down drives
              the strip, scrolling back up reverses it. */}
          <ScrollVelocity baseVelocity={1.8}>
            {classes.map((c) => (
              <span
                key={c.id}
                className="mr-10 inline-flex items-center gap-3 whitespace-nowrap text-sm"
              >
                <span className="athletic text-xl sm:text-2xl">{sportLabel(c.sport)}</span>
                <span className="kicker text-2xs text-muted">{levelLabel(c.level)}</span>
                <span className="tabular-nums text-accent-2">{rruleLabel(c.rrule)}</span>
                <span className="text-subtle">{c.court_code}</span>
                <span aria-hidden className="size-1.5 rounded-full bg-accent/45" />
              </span>
            ))}
          </ScrollVelocity>
        </section>
      ) : null}

      {/* ── Manifesto ────────────────────────────────────────────── */}
      <section aria-label={t("What Arena3 is for")} className="mx-auto max-w-4xl px-4 py-24">
        {/* Scrubbed rather than triggered: the words resolve out of a blur at
            whatever pace the reader scrolls, which is the one place on the page
            worth slowing someone down. */}
        <ScrollReveal className="font-display text-3xl leading-snug sm:text-[2.6rem] sm:leading-[1.25]">
          {t("A court should not need a phone call. Pick the hour you want, hold it while you think, and settle the whole thing — court, class, racket — on one tab at the desk.")}
        </ScrollReveal>
      </section>

      {/* ── How it works ─────────────────────────────────────────── */}
      <section id="how" className="relative mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
        {/* Pointer-reactive dot field. Costs nothing when the cursor is still —
            the canvas loop parks itself once the ripple settles. */}
        <GLBackground variant="dotgrid" className="-z-[1]" color="#1f5c43" gap={30} opacity={0.22} />
        <Reveal>
          <p className="kicker text-2xs text-muted">{t("Booking")}</p>
          <h2 className="mt-2 max-w-xl font-display text-4xl sm:text-5xl">
            <SplitText text={t("Three steps, no phone call.")} />
          </h2>
        </Reveal>

        <div className="relative mt-10">
          {/* Connector line draws itself across the three steps. */}
          <motion.div
            aria-hidden
            className="absolute left-0 right-0 top-6 hidden h-px origin-left bg-line-strong/60 md:block"
            initial={reduced ? false : { scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          />
          <Stagger className="grid gap-8 md:grid-cols-3" gap={0.14}>
            {steps.map((s) => (
              <StaggerItem key={s.n}>
                <div className="relative">
                  <span className="athletic relative z-[1] grid size-12 place-items-center rounded-full bg-accent pt-0.5 text-lg tabular-nums text-accent-fg shadow-[var(--shadow-accent)]">
                    {s.n}
                  </span>
                  <h3 className="mt-5 font-display text-2xl">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ── Coaches ──────────────────────────────────────────────── */}
      <section id="coaches" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
        <Reveal>
          <p className="kicker text-2xs text-muted">{t("The team")}</p>
          <h2 className="mt-2 max-w-2xl font-display text-4xl sm:text-5xl">
            <SplitText text={t("Coaches who actually take the session — not poster faces.")} splitBy="words" stagger={0.05} />
          </h2>
          <p className="mt-3 max-w-lg text-muted">
            {t("One head coach per sport. Classes never sit on court time you already bought. Sessions show up in the app the moment you join.")}
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mt-6">
          <Seg
            value={coachSport}
            onChange={setCoachSport}
            options={[
              { value: "", label: t("All") },
              { value: "badminton", label: t("Badminton") },
              { value: "basketball", label: t("Basketball") },
              { value: "volleyball", label: t("Volleyball") },
            ]}
          />
        </Reveal>

        {/* layout animation reflows the grid smoothly as the filter changes.

            A card that carries the photo, the title, three lines of prose and
            a fixture list is a page, not a card: four of them side by side and
            nothing stands out, least of all the coach. Face, sport, role — the
            three things that decide whether you want to read more — and the
            rest is one click away. */}
        <motion.div layout className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {coaches.map((c) => (
            <motion.div
              key={c.name}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <SpotlightCard className="h-full rounded-[var(--radius-xl)]">
                <Card interactive className="group flex h-full flex-col overflow-hidden p-0">
                  <GlareHover>
                    <Cover
                      src={c.photo}
                      alt={c.name}
                      scrim="none"
                      className="aspect-[3/4]"
                      imgClassName="transition-transform duration-[900ms] ease-[var(--ease-smooth)] group-hover:scale-105"
                    >
                      <MediaCaption>
                        <p className="kicker text-2xs text-on-media-muted">
                          {sportLabel(c.sport)}
                        </p>
                        <p className="athletic mt-1 text-2xl">{c.name}</p>
                      </MediaCaption>
                    </Cover>
                  </GlareHover>
                  <div className="flex flex-1 flex-col p-4">
                    <p className="flex-1 text-sm font-medium">{t(c.title)}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full"
                      onClick={() => setOpenCoach(c)}
                    >
                      {t("View details")}
                    </Button>
                  </div>
                </Card>
              </SpotlightCard>
            </motion.div>
          ))}
        </motion.div>

        <Modal
          open={!!openCoach}
          onClose={() => setOpenCoach(null)}
          title={openCoach?.name ?? ""}
          footer={
            <>
              <a href="#classes" onClick={() => setOpenCoach(null)}>
                <Button>{t("See open classes")}</Button>
              </a>
              <Button variant="ghost" onClick={() => setOpenCoach(null)}>
                {t("Close")}
              </Button>
            </>
          }
        >
          {openCoach ? (
            <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
              <Cover
                src={openCoach.photo}
                alt={openCoach.name}
                scrim="none"
                className="aspect-[3/4] rounded-[var(--radius-lg)]"
              />
              <div>
                <p className="kicker text-2xs text-muted">{sportLabel(openCoach.sport)}</p>
                <p className="mt-1 text-sm font-medium">{t(openCoach.title)}</p>
                <p className="mt-3 text-sm text-muted">{t(openCoach.blurb)}</p>
                <ul className="mt-4 grid gap-1.5 text-sm text-muted">
                  {openCoach.creds.map((x) => (
                    <li key={x} className="flex gap-2">
                      <span className="text-accent">·</span>
                      {t(x)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </Modal>
      </section>

      {/* ── Facilities ───────────────────────────────────────────── */}
      <section id="facilities" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-20">
        <Reveal>
          <p className="kicker text-2xs text-muted">{t("The building")}</p>
          <h2 className="mt-2 max-w-xl font-display text-4xl sm:text-5xl">
            {t("One roof, sixteen surfaces, one desk.")}
          </h2>
          <p className="mt-3 max-w-lg text-muted">
            {t("Everything the schedule can sell you sits in the same hall — so a court, a class and a racket all close out on one tab at reception.")}
          </p>
        </Reveal>

        <Reveal delay={0.08} className="mt-8">
          <Lift>
            <GlareHover className="rounded-[var(--radius-xl)]" duration={1.1}>
              <Cover
                src={media.hallCourts}
                alt={t("The main hall at Arena3")}
                className="group aspect-[16/9] rounded-[var(--radius-xl)] shadow-[var(--shadow-border)] sm:aspect-[16/7]"
                imgClassName="transition-transform duration-[1100ms] ease-[var(--ease-smooth)] group-hover:scale-[1.04]"
              >
                <MediaCaption>
                  <p className="kicker text-2xs text-on-media-muted">{t("Main hall")}</p>
                  <p className="athletic mt-1.5 text-4xl sm:text-5xl">{t("Sixteen playing surfaces")}</p>
                  <p className="mt-2 max-w-md text-sm text-on-media-muted">
                    {t("A nine-metre ceiling, sprung wood underfoot and lighting rated for evening play right through to close.")}
                  </p>
                </MediaCaption>
              </Cover>
            </GlareHover>
          </Lift>
        </Reveal>

        <Stagger className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" gap={0.09}>
          {facilities.map((f) => (
            <StaggerItem key={f.name}>
              <Lift className="h-full">
                <Cover
                  src={f.photo}
                  alt={f.name}
                  scrim="media"
                  className="group aspect-[4/5] rounded-[var(--radius-xl)] shadow-[var(--shadow-border)]"
                  imgClassName="transition-transform duration-[900ms] ease-[var(--ease-smooth)] group-hover:scale-[1.07]"
                >
                  <MediaCaption>
                    <p className="kicker text-2xs text-on-media-muted">{f.code}</p>
                    <p className="athletic mt-1.5 text-2xl">{f.name}</p>
                    <p className="mt-0 max-h-0 overflow-hidden text-sm text-on-media-muted opacity-0 transition-all duration-500 ease-[var(--ease-smooth)] group-hover:mt-2 group-hover:max-h-32 group-hover:opacity-100">
                      {f.note}
                    </p>
                  </MediaCaption>
                </Cover>
              </Lift>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="grid gap-8 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <Reveal from="left">
              <p className="kicker text-2xs text-muted">{t("Court rental")}</p>
              <h2 className="mt-2 font-display text-4xl">{t("Peak / off-peak")}</h2>
              <p className="mt-3 text-muted">
                {t("Mon–Fri is off-peak until 17:00. Weekends run on the weekend sheet. Members either draw down plan hours or take the percentage off.")}
              </p>
            </Reveal>

            <Reveal from="left" delay={0.12}>
              <SpotlightCard
                className="mt-6 overflow-hidden rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-border)]"
                strength={0.1}
                size={380}
              >
                <table className="relative z-[2] w-full text-sm">
                  <thead className="kicker text-left text-2xs text-muted">
                    <tr className="border-b border-line">
                      <th className="px-4 py-3 font-medium">{t("Sport")}</th>
                      <th className="px-4 py-3 font-medium">{t("Off-peak")}</th>
                      <th className="px-4 py-3 font-medium">{t("Peak")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["badminton", "basketball", "volleyball"].map((sport) => {
                      const off = weekday.find((p) => p.sport === sport && !p.is_peak);
                      const peak = weekday.find((p) => p.sport === sport && p.is_peak);
                      return (
                        <tr
                          key={sport}
                          className="border-b border-line transition-colors duration-200 last:border-0 hover:bg-wood/60"
                        >
                          <td className="px-4 py-3.5 font-medium">{sportLabel(sport)}</td>
                          <td className="px-4 py-3.5 tabular-nums">
                            {off ? money(off.price_vnd) : "—"}
                          </td>
                          <td className="px-4 py-3.5 font-medium tabular-nums text-accent-2">
                            {peak ? money(peak.price_vnd) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </SpotlightCard>
            </Reveal>
          </div>

          <Reveal from="right" delay={0.1}>
            <Cover
              src={media.courtDetail}
              alt=""
              className="min-h-64 rounded-[var(--radius-xl)] md:min-h-full"
            >
              {/* Half-way down the page — it must not compete with the hero
                  for bandwidth during the first load. */}
              <HeroVideo src={media.smash} poster={media.courtDetail} />
            </Cover>
          </Reveal>
        </div>
      </section>

      {/* ── Plans ────────────────────────────────────────────────── */}
      <section id="plans" className="relative mx-auto max-w-6xl scroll-mt-20 overflow-hidden px-4 pb-20">
        {/* Folded-cloth sheen at very low opacity — just enough texture that the
            plan cards do not float on flat cream. */}
        <GLBackground
          variant="silk"
          className="-z-[1] opacity-70"
          color="#1f5c43"
          speed={0.5}
          scale={1.7}
          opacity={0.13}
        />
        <Reveal>
          <p className="kicker text-2xs text-muted">{t("Memberships")}</p>
          <h2 className="mt-2 font-display text-4xl sm:text-5xl">
            <SplitText text={t("Buy in the app, settle at the desk")} splitBy="words" stagger={0.06} />
          </h2>
        </Reveal>

        <Stagger className="mt-8 grid gap-4 md:grid-cols-3" gap={0.1}>
          {plans.map((p, i) => {
            const featured = i === 1;
            const card = (
              <Lift className="h-full">
                <SpotlightCard className="h-full rounded-[var(--radius-xl)]">
                  <Card interactive className="group flex h-full flex-col overflow-hidden p-0">
                    <GlareHover>
                      <Cover
                        src={sportPhoto(p.sport_scope)}
                        alt=""
                        scrim="none"
                        className="h-36"
                        imgClassName="transition-transform duration-[900ms] ease-[var(--ease-smooth)] group-hover:scale-110"
                      >
                        <MediaCaption>
                          <p className="kicker text-2xs">
                            {sportLabel(p.sport_scope)}
                          </p>
                        </MediaCaption>
                      </Cover>
                    </GlareHover>
                    <div className="relative z-[2] flex flex-1 flex-col p-5">
                      {featured ? (
                        <span className="mb-2 inline-flex w-fit items-center gap-1 rounded-full bg-accent/12 px-2.5 py-1 text-2xs font-medium uppercase tracking-wider text-accent-2">
                          <Sparkles className="size-3" /> {t("Most picked")}
                        </span>
                      ) : null}
                      <h3 className="font-display text-2xl">{p.name}</h3>
                      <p className="mt-3 font-display text-3xl tabular-nums">{money(p.price_vnd)}</p>
                      <p className="mt-2 flex-1 text-sm text-muted">
                        {p.duration_days
                          ? t("{n} days", { n: p.duration_days })
                          : t("Per session")}{" "}
                        · {t("{n} court hours", { n: p.court_hours })} ·{" "}
                        {t("{n}% off", { n: p.court_discount_pct })}
                      </p>
                      <Link to="/register" className="mt-5 block">
                        {/* Only the recommended plan gets the travelling border —
                            on all three it would stop meaning anything. */}
                        {featured ? (
                          <StarBorder className="w-full" innerClassName="bg-surface">
                            <Button className="w-full">{t("Join to buy")}</Button>
                          </StarBorder>
                        ) : (
                          <Button className="w-full">{t("Join to buy")}</Button>
                        )}
                      </Link>
                    </div>
                  </Card>
                </SpotlightCard>
              </Lift>
            );
            return (
              <StaggerItem key={p.id} className="h-full">
                {card}
              </StaggerItem>
            );
          })}
        </Stagger>
      </section>

      {/* ── Open classes ─────────────────────────────────────────── */}
      {/*
        Enrolling was a guess: the cards said what was running and left the
        reader to hunt for the way in — clicking the card, then the sport, then
        finding the class again inside the app. The button belongs where the
        decision is made, next to the seat count that makes it.
      */}
      <section id="classes" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-20">
        <Reveal>
          <p className="kicker text-2xs text-muted">{t("Open classes")}</p>
          <h2 className="mt-2 font-display text-4xl">{t("Enrol while seats last")}</h2>
          <p className="mt-3 max-w-lg text-muted">
            {t("Coached ladders run on the same calendar as the courts, so a class never sits on an hour you have already bought. Seats are first come.")}
          </p>
        </Reveal>

        <Stagger className="mt-8 grid gap-4 md:grid-cols-2" gap={0.08}>
          {classes.slice(0, 4).map((c) => {
            const pct = c.capacity ? Math.min(100, (c.enrolled_count / c.capacity) * 100) : 0;
            const nearlyFull = pct >= 80;
            const full = c.enrolled_count >= c.capacity;
            const left = Math.max(0, c.capacity - c.enrolled_count);
            return (
              <StaggerItem key={c.id} className="h-full">
                <Card interactive className="flex h-full gap-4 p-3">
                  <Cover
                    src={sportPhoto(c.sport)}
                    alt=""
                    className="h-28 w-28 shrink-0 rounded-[var(--radius-lg)]"
                  />
                  <div className="flex min-w-0 flex-1 flex-col py-1">
                    <p className="kicker text-2xs text-muted">
                      {sportLabel(c.sport)}
                    </p>
                    <p className="font-display text-xl">{levelLabel(c.level)}</p>
                    <p className="truncate text-sm text-muted">
                      {c.coach_name} · {c.court_code} · {c.duration_min}′
                    </p>
                    <p className="text-sm">{rruleLabel(c.rrule)}</p>
                    {/* Seat meter fills as it scrolls in. */}
                    <div className="mt-2.5 flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-wood">
                        <motion.span
                          className={`block h-full rounded-full ${nearlyFull ? "bg-hold" : "bg-accent"}`}
                          initial={reduced ? false : { width: 0 }}
                          whileInView={{ width: `${pct}%` }}
                          viewport={{ once: true, amount: 0.6 }}
                          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                          style={reduced ? { width: `${pct}%` } : undefined}
                        />
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-subtle">
                        {c.enrolled_count}/{c.capacity}
                      </span>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                      <span className={`text-xs ${nearlyFull ? "text-hold" : "text-muted"}`}>
                        {full
                          ? t("Full — waitlist open")
                          : left === 1
                            ? t("1 seat left")
                            : t("{n} seats left", { n: left })}
                      </span>
                      <Link to="/register">
                        <Button size="sm" variant={full ? "outline" : "primary"}>
                          {full ? t("Join the waitlist") : t("Enrol")}
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              </StaggerItem>
            );
          })}
          {!classes.length ? (
            <p className="text-sm text-muted">{t("No classes published yet.")}</p>
          ) : null}
        </Stagger>
      </section>

      <Testimonials />

      {/* ── Closing CTA ──────────────────────────────────────────── */}
      <section className="relative mx-4 mb-16 overflow-hidden rounded-[var(--radius-xl)] md:mx-auto md:max-w-6xl">
        <Parallax speed={0.09} className="overflow-hidden rounded-[var(--radius-xl)]">
          <Cover
            src={media.exterior}
            alt={t("The Arena3 frontage at dusk")}
            className="min-h-[26rem]"
            scrim="hero"
          >
            <div className="relative flex min-h-[26rem] flex-col justify-end p-6 sm:p-12">
              <Reveal>
                <p className="athletic max-w-md text-5xl text-on-media on-media sm:text-6xl">
                  {t("06:00–22:00 · seven days")}
                </p>
                <p className="mt-3 max-w-sm text-on-media-muted on-media">
                  {t("Reception is staffed the whole time we are open. Walk-ins never need an account.")}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                                      <Link to="/register">
                      <Button size="lg" className="group bg-on-media text-fg hover:bg-surface">
                        {t("Create an account")}
                        <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </Button>
                    </Link>
                                    <Link to="/login">
                    <Button
                      size="lg"
                      variant="outline"
                      className="border-on-media/40 bg-transparent text-on-media hover:bg-on-media/10"
                    >
                      {t("Sign in")}
                    </Button>
                  </Link>
                </div>
              </Reveal>
            </div>
          </Cover>
        </Parallax>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="border-t border-line bg-surface/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <ArenaMark className="size-8" />
              <span className="font-display text-xl italic">Arena3</span>
            </div>
            <p className="mt-4 max-w-xs text-sm text-muted">
              {t("An indoor sports centre that runs courts, classes and memberships off a single calendar.")}
            </p>
          </div>

          <div>
            <p className="kicker text-2xs text-muted">{t("Visit")}</p>
            <ul className="mt-4 grid gap-3 text-sm">
              <li className="flex gap-2.5 text-muted">
                <Clock className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} />
                {t("06:00–22:00, seven days")}
              </li>
              <li className="flex gap-2.5 text-muted">
                <MapPin className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} />
                {t("Ho Chi Minh City")}
              </li>
              <li className="flex gap-2.5 text-muted">
                <Phone className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} />
                {t("Front desk, during opening hours")}
              </li>
            </ul>
          </div>

          <div>
            <p className="kicker text-2xs text-muted">{t("Explore")}</p>
            <ul className="mt-4 grid gap-2.5 text-sm">
              {[
                ["#schedule", t("Today's schedule")],
                ["#courts", t("Courts & pricing")],
                ["#classes", t("Open classes")],
                ["#how", t("How booking works")],
                ["#facilities", t("Facilities")],
                ["#coaches", t("Coaches")],
                ["#plans", t("Membership plans")],
              ].map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="link-underline text-muted hover:text-fg">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 kicker text-2xs text-subtle">
            <span>© {new Date().getFullYear()} Arena3</span>
            <span>{t("Badminton · Basketball · Volleyball")}</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

/** Demo member quotes, keyed to the seeded member profiles. */
const TESTIMONIALS = [
  {
    quote: tk(
      "I book between meetings and the court is simply there when I arrive. The five-minute hold is the reason I stopped ringing ahead.",
    ),
    name: "Nguyễn Văn Nam",
    meta: tk("Badminton · A3-2026-0001"),
  },
  {
    quote: tk(
      "The beginner ladder moved me onto a real training plan without it ever feeling like a test — and my knee has been fine since the coach reworked my footwork.",
    ),
    name: "Trần Mỹ Linh",
    meta: tk("Badminton · A3-2026-0002"),
  },
  {
    quote: tk(
      "Plan hours come straight off at the desk. No cash, no working out what counts as peak, no arguing about the price on a Saturday morning.",
    ),
    name: "Phạm Hoàng Long",
    meta: tk("Badminton · A3-2026-0003"),
  },
];

/**
 * Quote deck. The cards sit in a physical stack; the reader moves them.
 *
 * It used to advance on a timer, which meant a quote could slide away
 * mid-sentence. Nothing here is time-sensitive, so the deck now waits: the
 * arrows and dots underneath are the only things that turn it. The cards
 * behind the front one are `aria-hidden` and mouse-only, so those controls
 * are also what keyboard and screen-reader users drive.
 */
function Testimonials() {
  const [i, setI] = useState(0);
  const n = TESTIMONIALS.length;
  const step = (d: number) => setI((prev) => (prev + d + n) % n);

  return (
    <section aria-label={t("What members say")} className="mx-auto max-w-6xl px-4 pb-24">
      <Reveal>
        <p className="kicker text-2xs text-muted">{t("Members")}</p>
        <h2 className="mt-2 font-display text-4xl sm:text-5xl">
          <SplitText text={t("What the regulars say")} splitBy="words" stagger={0.06} />
        </h2>
      </Reveal>

      <Reveal delay={0.08} className="mt-10">
        {/* Right/top padding leaves room for the offset cards behind, so the
            stack never clips against the section edge. */}
        <div className="pr-14 pt-8">
          <CardSwap
            index={i}
            onIndexChange={setI}
            interval={0}
            offset={24}
            className="h-[23rem] sm:h-[19rem]"
            items={TESTIMONIALS.map((q) => ({
              key: q.name,
              node: (
                <Card className="relative flex h-full flex-col overflow-hidden p-0">
                  <div className="wash wash-accent -right-24 -top-28 size-72 opacity-40" />
                  <blockquote className="relative flex h-full flex-col p-6 sm:p-10">
                    <Quote className="size-8 shrink-0 text-accent/45" strokeWidth={1.5} />
                    <p className="mt-5 max-w-3xl flex-1 font-display text-xl leading-snug sm:text-3xl">
                      “{t(q.quote)}”
                    </p>
                    <footer className="mt-5 shrink-0">
                      <p className="athletic text-lg">{q.name}</p>
                      <p className="kicker mt-1.5 text-2xs text-muted">{t(q.meta)}</p>
                    </footer>
                  </blockquote>
                </Card>
              ),
            }))}
          />
        </div>
      </Reveal>

      <div className="mt-7 flex items-center gap-4">
        <div className="flex gap-2">
          <button
            type="button"
            aria-label={t("Previous quote")}
            onClick={() => step(-1)}
            className="grid size-10 place-items-center rounded-full border border-line bg-surface text-fg transition-[background-color,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-accent hover:bg-wood active:scale-95"
          >
            <ChevronLeft className="size-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label={t("Next quote")}
            onClick={() => step(1)}
            className="grid size-10 place-items-center rounded-full border border-line bg-surface text-fg transition-[background-color,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-accent hover:bg-wood active:scale-95"
          >
            <ChevronRight className="size-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex gap-2">
          {TESTIMONIALS.map((x, k) => (
            <button
              key={x.name}
              type="button"
              aria-label={t("Show quote {k} of {n}", { k: k + 1, n })}
              aria-current={k === i}
              onClick={() => setI(k)}
              className="group grid h-6 place-items-center px-1"
            >
              <span
                className={`block h-1.5 rounded-full transition-all duration-300 ${
                  k === i ? "w-9 bg-accent" : "w-3.5 bg-line-strong group-hover:bg-muted"
                }`}
              />
            </button>
          ))}
        </div>
        <span className="ml-auto kicker text-2xs tabular-nums text-muted">
          {i + 1} / {n}
        </span>
      </div>
    </section>
  );
}
