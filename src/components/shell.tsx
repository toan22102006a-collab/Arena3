import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  DoorOpen,
  Dumbbell,
  LayoutGrid,
  LogOut,
  Map,
  ScrollText,
  Settings,
  Ticket,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ArenaMark, AssistantMark } from "./mark";
import { AnimatePresence, PageIn, motion } from "./motion";
import { GradualBlur, SplitText } from "./fx";
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

export function useSessionUser(): SessionUser | null {
  const [u, setU] = useState<SessionUser | null>(null);
  useEffect(() => {
    setU(getStoredUser());
  }, []);
  return u;
}

const NAV: Record<string, { to: string; label: string; icon: typeof Map }[]> = {
  member: [
    { to: "/app", label: "Schedule", icon: CalendarDays },
    { to: "/app/book", label: "Book", icon: Map },
    { to: "/app/classes", label: "Classes", icon: Ticket },
    { to: "/app/train", label: "Progress", icon: Activity },
    { to: "/app/plans", label: "Plans", icon: Wallet },
  ],
  receptionist: [
    { to: "/desk", label: "Desk", icon: Users },
    { to: "/desk/gate", label: "Gate", icon: DoorOpen },
    { to: "/desk/courts", label: "Courts", icon: Map },
    { to: "/desk/classes", label: "Classes", icon: Ticket },
    { to: "/desk/payments", label: "Payments", icon: Wallet },
    // `/desk/gear` is a complete equipment-hire screen that nothing linked to,
    // so reception could only reach it by typing the URL.
    { to: "/desk/gear", label: "Gear", icon: Dumbbell },
  ],
  // The coach had one tab, which `showNav` hides, so the screen had no menu at
  // all (B-10). Schedule, register and profile are three different jobs.
  coach: [
    { to: "/coach", label: "Schedule", icon: CalendarDays },
    { to: "/coach/attendance", label: "Attendance", icon: ClipboardList },
    { to: "/account", label: "Profile", icon: UserCog },
  ],
  manager: [
    { to: "/manager", label: "Reports", icon: LayoutGrid },
    { to: "/manager/classes", label: "Classes", icon: Ticket },
    { to: "/manager/members", label: "Members", icon: Users },
    { to: "/manager/plans", label: "Plans", icon: Wallet },
    // Refund sign-off lives on the payments screen, which has always taken a
    // manager — nothing in this menu pointed at it (B-02).
    { to: "/desk/payments", label: "Payments", icon: Wallet },
    { to: "/manager/staff", label: "Staff", icon: UserCog },
    { to: "/manager/prices", label: "Pricing", icon: Settings },
    { to: "/manager/audit", label: "Audit", icon: ScrollText },
    { to: "/manager/settings", label: "Settings", icon: Settings },
  ],
};

function navActive(pathname: string, to: string, items: { to: string }[]) {
  const list = Array.isArray(items) ? items : [];
  // A student's profile is reached from the register, so that is the tab it belongs to.
  if (pathname.startsWith("/coach/student/")) pathname = "/coach/attendance";
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
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
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
function AccountMenu({ user, role, onLogout }: { user: SessionUser | null; role: SessionUser["role"]; onLogout: () => void }) {
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
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold tracking-wide text-accent-fg">
          {initials(user?.full_name)}
        </span>
        <span className="hidden text-left sm:block">
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
            <div className="border-b border-line/70 px-3 pb-2.5 pt-2 sm:hidden">
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
              Account settings
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
              Sign out
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
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
          <Link to={home} className="flex items-center gap-2">
            <ArenaMark className="size-8" />
            <span className="hidden font-display text-2xl font-normal italic tracking-tight sm:inline">Arena3</span>
          </Link>
          <nav className={cn("ml-3 items-center gap-1", showNav ? "hidden md:flex" : "hidden")}>
            {items.map((it) => {
              const active = navActive(pathname, it.to, items);
              const Icon = it.icon;
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  activeOptions={{ exact: true }}
                  className={cn(
                    "relative flex h-9 items-center gap-2 rounded-[var(--radius-pill)] px-3.5 text-xs font-semibold uppercase tracking-[0.1em] transition-colors duration-200",
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
                  <span className="relative z-[1]">{it.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell
              to={role === "member" ? "/app/notifications" : "/alerts"}
              active={pathname.startsWith("/app/notifications") || pathname.startsWith("/alerts")}
            />
            {role === "member" ? (
              <Link
                to="/app/assistant"
                aria-label="Assistant"
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
            <AccountMenu user={user} role={role} onLogout={() => void logout()} />
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
            <header className="mb-5">
              <SplitText
                as="h1"
                text={title}
                splitBy="chars"
                stagger={0.016}
                duration={0.6}
                className="font-display text-3xl font-semibold sm:text-4xl"
              />
              {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
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
          {items.map((it) => {
            const active = navActive(pathname, it.to, items);
            const Icon = it.icon;
            return (
              <Link
                key={it.to}
                to={it.to}
                activeOptions={{ exact: true }}
                className={cn(
                  "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-pill)] text-[10px] uppercase tracking-wider transition-colors duration-200",
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
                <span className="relative z-[1]">{it.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
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
    const t = getToken();
    if (!t || !u) {
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

/** Prices stay in dong; grouping follows the English UI (140,000đ). */
export function money(n: number) {
  return new Intl.NumberFormat("en-US").format(n) + "đ";
}

export function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
    hour12: false,
  });
}

export function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
