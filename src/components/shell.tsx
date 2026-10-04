import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  DoorOpen,
  Dumbbell,
  Ellipsis,
  LayoutGrid,
  LogOut,
  Map,
  QrCode,
  ScrollText,
  Settings,
  Tag,
  Ticket,
  UserCog,
  UserMinus,
  Users,
  Wallet,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ArenaMark, AssistantMark } from "./mark";
import { AnimatePresence, PageIn, motion } from "./motion";
import { GradualBlur } from "./fx";
import { Spot, spotForPath } from "./illustrations";
import { cn } from "@/lib/cn";
import {
  apiGet,
  apiPost,
  clearSession,
  getStoredUser,
  getToken,
  homeFor,
  type SessionUser,
} from "@/lib/arena3/client";
import { roleLabel } from "@/lib/arena3/labels";
import { locale, t, tk } from "@/lib/i18n";
import { LangSwitch } from "./lang-switch";

export function useSessionUser(): SessionUser | null {
  const [u, setU] = useState<SessionUser | null>(null);
  useEffect(() => {
    setU(getStoredUser());
  }, []);
  return u;
}

/**
 * `more` tucks a tab into the "More" menu on a laptop and `dock: false` keeps it out of the
 * phone's bottom bar (it goes in the "More" sheet instead). Eleven tabs in one row ran off the
 * edge of the screen, and seven on a phone were too small to read or hit.
 */
type NavItem = { to: string; label: string; icon: typeof Map; more?: boolean; dock?: boolean };

const NAV: Record<string, NavItem[]> = {
  member: [
    { to: "/app", label: tk("Schedule"), icon: CalendarDays },
    { to: "/app/book", label: tk("Book"), icon: Map },
    { to: "/app/classes", label: tk("Classes"), icon: Ticket },
    { to: "/app/train", label: tk("Progress"), icon: Activity },
    { to: "/app/plans", label: tk("Plans"), icon: Wallet },
    { to: "/app/pass", label: tk("Pass"), icon: QrCode },
  ],
  receptionist: [
    { to: "/desk", label: tk("Desk"), icon: Users },
    { to: "/desk/gate", label: tk("Gate"), icon: DoorOpen },
    { to: "/desk/courts", label: tk("Courts"), icon: Map, dock: false },
    { to: "/desk/classes", label: tk("Classes"), icon: Ticket, dock: false },
    { to: "/desk/payments", label: tk("Payments"), icon: Wallet },
    { to: "/desk/at-risk", label: tk("At risk"), icon: UserMinus },
    // `/desk/gear` is a complete equipment-hire screen that nothing linked to,
    // so reception could only reach it by typing the URL.
    { to: "/desk/gear", label: tk("Gear"), icon: Dumbbell, dock: false },
  ],
  // The coach had one tab, which `showNav` hides, so the screen had no menu at
  // all (B-10). Schedule, register and profile are three different jobs.
  coach: [
    { to: "/coach", label: tk("Schedule"), icon: CalendarDays },
    { to: "/coach/attendance", label: tk("Attendance"), icon: ClipboardList },
    { to: "/account", label: tk("Profile"), icon: UserCog },
  ],
  manager: [
    { to: "/manager", label: tk("Reports"), icon: LayoutGrid },
    { to: "/manager/classes", label: tk("Classes"), icon: Ticket, dock: false },
    { to: "/manager/members", label: tk("Members"), icon: Users },
    { to: "/manager/plans", label: tk("Plans"), icon: Wallet, more: true, dock: false },
    { to: "/manager/promos", label: tk("Promos"), icon: Tag, more: true, dock: false },
    { to: "/manager/attendance", label: tk("Attendance"), icon: ClipboardList },
    // Refund sign-off lives on the payments screen, which has always taken a
    // manager — nothing in this menu pointed at it (B-02).
    { to: "/desk/payments", label: tk("Payments"), icon: Wallet },
    { to: "/manager/staff", label: tk("Staff"), icon: UserCog, dock: false },
    { to: "/manager/prices", label: tk("Pricing"), icon: Settings, more: true, dock: false },
    { to: "/manager/audit", label: tk("Audit"), icon: ScrollText, more: true, dock: false },
    { to: "/manager/settings", label: tk("Settings"), icon: Settings, more: true, dock: false },
  ],
};

function navActive(pathname: string, to: string, items: { to: string }[]) {
  const list = Array.isArray(items) ? items : [];
  // A student's profile is reached from the register, so that is the tab it belongs to.
  if (pathname.startsWith("/coach/student/")) pathname = "/coach/attendance";
  // These have their own header buttons, not tabs; "/app" must not claim them as Schedule.
  if (/^\/(app\/(assistant|notifications)|alerts)(\/|$)/.test(pathname)) return false;
  const matches = list.filter((it) => pathname === it.to || pathname.startsWith(`${it.to}/`));
  const best = [...matches].sort((a, b) => b.to.length - a.to.length)[0];
  return best?.to === to;
}

function initials(name: string | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A3";
  // Vietnamese names put the given name last, and that is the one people answer
  // to — so take the first and last word rather than the first two.
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * The member's notifications, on their own button beside the account menu
 * (G-08): what is new is not an account setting, and an unread count on the
 * avatar menu is somewhere nobody looks. The count is re-read on every page
 * change, which is cheap and keeps it honest after a notification is opened.
 */
function NotificationBell({ active, to }: { active: boolean; to: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let live = true;
    void apiGet<{ unread: number }>("/me/notifications")
      .then((r) => live && setUnread(r.unread))
      .catch(() => {
        // The bell is a convenience; a failed count must not break the header.
      });
    return () => {
      live = false;
    };
  }, [pathname]);
  return (
    <Link
      to={to}
      aria-label={unread ? t("Notifications, {n} unread", { n: unread }) : t("Notifications")}
      className={cn(
        "relative grid size-11 place-items-center rounded-[var(--radius-pill)] transition-colors duration-150",
        active ? "bg-accent text-accent-fg shadow-[var(--shadow-accent)]" : "text-fg hover:bg-wood",
      )}
    >
      <Bell className="size-4" strokeWidth={1.9} />
      {unread ? (
        <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[0.625rem] font-bold leading-4 text-white tabular-nums">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}

/** Avatar button that opens the account menu. */
/** `compact` drops the name beside the avatar (it is still the first line of the menu) for roles whose tab row is long. */
function AccountMenu({
  user,
  role,
  onLogout,
  compact = false,
}: {
  user: SessionUser | null;
  role: SessionUser["role"];
  onLogout: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Any click outside, or Escape, closes it — the two things every menu on the
  // web does, and the two things people try first.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-[var(--radius-pill)] py-1 pl-1 pr-1 transition-colors duration-150 hover:bg-wood sm:pr-3"
        aria-label={t("Account menu — {name}", { name: user?.full_name ?? "" })}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold tracking-wide text-accent-fg">
          {initials(user?.full_name)}
        </span>
        <span className={cn("hidden text-left", compact ? "" : "sm:block")}>
          <span className="block max-w-[10rem] truncate text-sm font-medium leading-tight">{user?.full_name ?? "—"}</span>
          <span className="kicker text-2xs text-muted">{roleLabel(role)}</span>
        </span>
        <ChevronDown className={cn("hidden size-4 text-muted transition-transform duration-200 sm:block", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-56 origin-top-right overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface p-1.5 shadow-[0_24px_50px_-28px_rgba(20,28,18,0.8)]"
          >
            <div className={cn("border-b border-line/70 px-3 pb-2.5 pt-2", compact ? "" : "sm:hidden")}>
              <p className="truncate text-sm font-medium">{user?.full_name ?? "—"}</p>
              <p className="kicker text-2xs text-muted">{roleLabel(role)}</p>
            </div>
            <Link
              to="/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-sm transition-colors duration-150 hover:bg-wood"
            >
              <UserCog className="size-4 text-muted" strokeWidth={1.75} />
              {t("Account settings")}
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-left text-sm text-danger transition-colors duration-150 hover:bg-danger/10"
            >
              <LogOut className="size-4" strokeWidth={1.75} />
              {t("Sign out")}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Desktop: the tabs that did not fit in the row live under one "More" button. */
function MoreMenu({ items, pathname, all }: { items: NavItem[]; pathname: string; all: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  // The button lights up when the page you are on is one of the hidden tabs.
  const inside = items.some((it) => navActive(pathname, it.to, all));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex h-9 items-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] px-3.5 text-xs font-semibold uppercase tracking-[0.1em] transition-colors duration-200",
          inside ? "bg-accent text-accent-fg shadow-[var(--shadow-accent)]" : "text-muted hover:bg-wood hover:text-fg",
        )}
      >
        <Ellipsis className="size-4" strokeWidth={1.75} />
        {t("More")}
        <ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open ? (
        <div role="menu" className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-52 rounded-[var(--radius-lg)] border border-line bg-surface p-1.5 shadow-[0_24px_50px_-28px_rgba(20,28,18,0.8)]">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <Link
                key={it.to}
                to={it.to}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-sm transition-colors duration-150 hover:bg-wood",
                  navActive(pathname, it.to, all) && "bg-wood font-semibold",
                )}
              >
                <Icon className="size-4 text-muted" strokeWidth={1.75} />
                {t(it.label)}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Phone: a slide-up sheet with the tabs that do not fit in the bottom bar. */
function MoreSheet({
  items,
  pathname,
  all,
  open,
  onClose,
}: {
  items: NavItem[];
  pathname: string;
  all: NavItem[];
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t("More pages")}>
      <button type="button" aria-label={t("Close")} className="absolute inset-0 bg-fg/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 rounded-t-[var(--radius-xl)] bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-soft)]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong/60" />
        <div className="grid grid-cols-3 gap-2">
          {items.map((it) => {
            const Icon = it.icon;
            const active = navActive(pathname, it.to, all);
            return (
              <Link
                key={it.to}
                to={it.to}
                onClick={onClose}
                className={cn(
                  "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-[var(--radius-lg)] text-xs font-medium transition-colors duration-150",
                  active ? "bg-accent text-accent-fg" : "bg-wood text-fg",
                )}
              >
                <Icon className="size-5" strokeWidth={1.75} />
                {t(it.label)}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { roleLabel };

export function Shell({
  children,
  title,
  subtitle,
  role,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  role: SessionUser["role"];
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const user = useSessionUser();
  const items = NAV[role] ?? [];
  const home = homeFor(role);
  // A single tab is not a choice — it just repeats the page heading back at
  // you, which is why the coach screen read "Teaching / Teaching". Roles with
  // one destination get a plain wordmark and no nav at all.
  const showNav = items.length > 1;
  // Roles with a long tab row (and Vietnamese labels run longer) drop the wordmark text and tighten the tabs.
  const dense = role === "manager" || role === "receptionist";
  const rowItems = items.filter((it) => !it.more);
  const moreItems = items.filter((it) => it.more);
  const dockItems = items.filter((it) => it.dock !== false);
  const sheetItems = items.filter((it) => it.dock === false);
  const [sheet, setSheet] = useState(false);
  // Moving to another page closes the sheet.
  useEffect(() => setSheet(false), [pathname]);

  async function logout() {
    // Drop the local session immediately, before awaiting the server call.
    // `api()` reads the token synchronously, so the logout request still carries
    // it — but any fetch a page fires while that request is in flight would
    // otherwise go out with a token the server has already deleted and pop an
    // alarming "That session is not valid." toast on a *successful* sign-out.
    const done = apiPost("/auth/logout").catch(() => undefined);
    clearSession();
    navigate({ to: "/" });
    await done;
  }

  return (
    <div className="min-h-dvh text-fg">
      <header className="sticky top-0 z-20 border-b border-line/80 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to={home} aria-label={t("Arena3 home")} className="flex items-center gap-2">
            <ArenaMark className="size-8" />
            <span className={cn("hidden font-display text-2xl font-normal italic tracking-tight", dense ? "2xl:inline" : "sm:inline")}>Arena3</span>
          </Link>
          <nav className={cn("ml-3 items-center gap-1", showNav ? "hidden md:flex" : "hidden")}>
            {rowItems.map((it) => {
              const active = navActive(pathname, it.to, items);
              const Icon = it.icon;
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  activeOptions={{ exact: true }}
                  className={cn(
                    dense ? "px-2.5" : "px-3.5",
                    "relative flex h-9 items-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] text-xs font-semibold uppercase tracking-[0.1em] transition-colors duration-200",
                    active ? "text-accent-fg" : "text-muted hover:bg-wood hover:text-fg",
                  )}
                >
                  {/* Highlight slides between tabs rather than cutting. */}
                  {active ? (
                    <motion.span
                      layoutId="shell-nav-active"
                      className="absolute inset-0 rounded-[var(--radius-pill)] bg-accent shadow-[var(--shadow-accent)]"
                      transition={{ type: "spring", stiffness: 400, damping: 34 }}
                    />
                  ) : null}
                  <Icon className="relative z-[1] size-4" strokeWidth={1.75} />
                  <span className="relative z-[1]">{t(it.label)}</span>
                </Link>
              );
            })}
            {moreItems.length ? <MoreMenu items={moreItems} pathname={pathname} all={items} /> : null}
          </nav>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <LangSwitch />
            <NotificationBell
              to={role === "member" ? "/app/notifications" : "/alerts"}
              active={pathname.startsWith("/app/notifications") || pathname.startsWith("/alerts")}
            />
            {role === "member" ? (
              <Link
                to="/app/assistant"
                aria-label={t("Assistant")}
                className={cn(
                  "grid size-11 place-items-center rounded-[var(--radius-pill)] transition-colors duration-150",
                  pathname.startsWith("/app/assistant")
                    ? "bg-accent text-accent-fg shadow-[var(--shadow-accent)]"
                    : "text-fg hover:bg-wood",
                )}
              >
                <AssistantMark className="size-4" strokeWidth={1.9} />
              </Link>
            ) : null}
            <AccountMenu user={user} role={role} onLogout={() => void logout()} compact={dense} />
          </div>
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          "mx-auto max-w-6xl px-4 py-6 md:pb-10",
          // Only reserve room for the dock when there is a dock.
          showNav ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))]" : "pb-10",
        )}
      >
        <PageIn key={pathname}>
          {title ? (
            <header className="mb-6 flex items-center justify-between gap-4 rounded-[var(--radius-xl)] bg-surface/70 px-5 py-4 shadow-[var(--shadow-border)] sm:px-6">
              <div className="min-w-0">
                <h1 className="font-display text-3xl font-semibold text-balance sm:text-4xl">{title}</h1>
                {subtitle ? <p className="mt-1.5 max-w-2xl text-[0.95rem] leading-snug text-muted">{subtitle}</p> : null}
              </div>
              <Spot name={spotForPath(pathname)} className="hidden sm:block sm:h-24 sm:w-[7.5rem]" />
            </header>
          ) : null}
          {children}
        </PageIn>
      </main>
      {showNav ? (
        <>
      {/* The page fades out under the floating bar instead of being cut by it. */}
      <GradualBlur side="bottom" position="fixed" height="5.5rem" strength={1.6} className="z-[19] md:hidden" />
      {/* A dock rather than a bar: it floats clear of the page, but every item is
          still a real <Link>, so prefetch, long-press and "open in new tab" work
          the way a tab bar should on a touch device. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 px-3 pb-[calc(0.65rem+env(safe-area-inset-bottom))] md:hidden">
        <div className="glass mx-auto grid max-w-md auto-cols-fr grid-flow-col rounded-[var(--radius-pill)] p-1.5 shadow-[0_18px_40px_-24px_rgba(20,28,18,0.75)]">
          {dockItems.map((it) => {
            const active = navActive(pathname, it.to, items);
            const Icon = it.icon;
            return (
              <Link
                key={it.to}
                to={it.to}
                activeOptions={{ exact: true }}
                className={cn(
                  "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-pill)] text-[11px] tracking-wide transition-colors duration-200",
                  active ? "font-semibold text-accent-fg" : "font-medium text-muted",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="shell-dock-active"
                    className="absolute inset-0 rounded-[var(--radius-pill)] bg-accent shadow-[var(--shadow-accent)]"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                ) : null}
                <motion.span
                  className="relative z-[1]"
                  animate={{ y: active ? -1 : 0, scale: active ? 1.08 : 1 }}
                  transition={{ type: "spring", stiffness: 420, damping: 26 }}
                >
                  <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
                </motion.span>
                <span className="relative z-[1] whitespace-nowrap">{t(it.label)}</span>
              </Link>
            );
          })}
          {sheetItems.length ? (
            <button
              type="button"
              onClick={() => setSheet(true)}
              aria-haspopup="dialog"
              className={cn(
                "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-pill)] text-[11px] tracking-wide",
                sheetItems.some((it) => navActive(pathname, it.to, items))
                  ? "bg-accent font-semibold text-accent-fg"
                  : "font-medium text-muted",
              )}
            >
              <Ellipsis className="size-5" strokeWidth={1.75} />
              {t("More")}
            </button>
          ) : null}
        </div>
      </nav>
      <MoreSheet items={sheetItems} pathname={pathname} all={items} open={sheet} onClose={() => setSheet(false)} />
        </>
      ) : null}
    </div>
  );
}

export function Guard({
  roles,
  children,
}: {
  roles: SessionUser["role"][];
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);

  // Callers pass `roles` as an inline array literal, so its identity changes on
  // every render. Depend on the contents instead — otherwise this effect re-runs
  // forever (each run stores a freshly parsed user object, forcing a re-render)
  // and fires a /me request per cycle.
  const roleKey = roles.join(",");

  useEffect(() => {
    const allowed = roleKey.split(",") as SessionUser["role"][];
    const u = getStoredUser();
    const tok = getToken();
    if (!tok || !u) {
      navigate({ to: "/login" });
      return;
    }
    if (!allowed.includes(u.role)) {
      navigate({ to: homeFor(u.role) });
      return;
    }
    setUser(u);
    setReady(true);
    void apiGet("/me").catch(() => {
      clearSession();
      navigate({ to: "/login" });
    });
  }, [navigate, roleKey]);

  if (!ready || !user) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg text-muted">
        <motion.div
          className="flex flex-col items-center gap-3"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <motion.span
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <ArenaMark />
          </motion.span>
          <p className="font-display text-lg">Arena3</p>
        </motion.div>
      </div>
    );
  }
  return <>{children}</>;
}

/** Prices stay in dong; grouping follows the UI language (140,000đ / 140.000đ). */
export function money(n: number) {
  return new Intl.NumberFormat(locale()).format(n) + "đ";
}

export function when(iso: string) {
  return new Date(iso).toLocaleString(locale(), {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
    hour12: false,
  });
}

export function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString(locale(), {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
