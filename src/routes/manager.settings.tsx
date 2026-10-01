import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Button, Card, Field, Input, Seg, Skeleton } from "@/components/ui";
import { Reveal, Stagger, StaggerItem, motion } from "@/components/motion";
import { SplitText } from "@/components/fx";
import { cn } from "@/lib/cn";
import { apiGet, apiPatch } from "@/lib/arena3/client";
import { sportLabel } from "@/lib/arena3/labels";

export const Route = createFileRoute("/manager/settings")({
  component: Page,
});

const FLAG_META: { key: string; label: string; hint: string }[] = [
  { key: "F4", label: "Register & session plans", hint: "Coaches take attendance and hand out drills." },
  { key: "F5", label: "Plan suggestions", hint: "Drill templates per sport — a coach still has to approve." },
  { key: "F6", label: "Member assistant", hint: "Gemini Q&A, grounded in the timetable, plans and coaches." },
];

function Page() {
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  useEffect(() => {
    void apiGet<Record<string, unknown>>("/settings")
      .then(setS)
      .catch((e) => toast.error(e.message));
    void apiGet<{ flags: Record<string, boolean> }>("/flags")
      .then((r) => setFlags(r.flags))
      .catch(() => undefined);
  }, []);
  if (!s) {
    return (
      <Shell role="manager" title="Centre settings">
        <Skeleton className="h-64" />
      </Shell>
    );
  }
  function f(key: string, label: string) {
    return (
      <Field label={label}>
        <Input value={String(s![key] ?? "")} onChange={(e) => setS({ ...s!, [key]: e.target.value })} />
      </Field>
    );
  }
  return (
    <Shell role="manager" title="Centre settings" subtitle="New transactions pick these up within a minute.">
      <SplitText as="h2" text="Features" className="mb-3 font-display text-2xl" />
      <Stagger className="mb-6 grid gap-2 md:grid-cols-2" gap={0.05}>
        {FLAG_META.map((fl) => (
          <StaggerItem key={fl.key}>
          <Card className="flex h-full items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">
                {fl.key} · {fl.label}
              </p>
              <p className="text-xs text-muted">{fl.hint}</p>
            </div>
            <button
              type="button"
              onClick={async () => {
                const next = !flags[fl.key];
                try {
                  const r = await apiPatch<{ flags: Record<string, boolean> }>("/flags", { [fl.key]: next });
                  setFlags(r.flags);
                  toast.success(next ? `${fl.key} switched on` : `${fl.key} switched off`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Something went wrong");
                }
              }}
              className={`h-8 w-14 rounded-full p-1 transition-colors ${flags[fl.key] ? "bg-accent" : "bg-wood"}`}
              aria-pressed={!!flags[fl.key]}
              aria-label={fl.label}
            >
              <motion.span
                layout
                className="block size-6 rounded-full bg-surface shadow"
                style={{ marginLeft: flags[fl.key] ? "1.5rem" : 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 34 }}
              />
            </button>
          </Card>
          </StaggerItem>
        ))}
      </Stagger>
      <SplitText as="h2" text="Courts" className="mb-1 font-display text-2xl" />
      <p className="mb-3 text-sm text-muted">
        Taking a court out of service stops new bookings on it. Anything already booked stays — the desk sorts those out.
      </p>
      <Courts />

      <SplitText as="h2" text="Centre details" className="mb-3 mt-8 font-display text-2xl" />
      <Reveal>
      <Card className="grid gap-3 md:grid-cols-2">
        {f("legal_name", "Legal name")}
        {f("address", "Address")}
        {f("tax_code", "Tax code")}
        {f("hold_minutes", "Hold length (minutes)")}
        {f("book_ahead_days", "Book ahead (days)")}
        {f("cancel_court_hours", "Court cancellation window (hours)")}
        {f("debt_limit_vnd", "Debt ceiling (đ)")}
        {f("freeze_max_days_year", "Freeze cap (days per year)")}
        {f("waitlist_offer_hours", "Waitlist offer window (hours)")}
        <div className="md:col-span-2">
          <Button
            onClick={async () => {
              try {
                const body = {
                  legal_name: s.legal_name,
                  address: s.address,
                  tax_code: s.tax_code,
                  hold_minutes: Number(s.hold_minutes),
                  book_ahead_days: Number(s.book_ahead_days),
                  cancel_court_hours: Number(s.cancel_court_hours),
                  debt_limit_vnd: Number(s.debt_limit_vnd),
                  freeze_max_days_year: Number(s.freeze_max_days_year),
                  waitlist_offer_hours: Number(s.waitlist_offer_hours),
                };
                setS(await apiPatch("/settings", body));
                toast.success("Saved — new transactions use these now");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Something went wrong");
              }
            }}
          >
            Save
          </Button>
        </div>
      </Card>
      </Reveal>
    </Shell>
  );
}

type Court = { id: string; court_code: string; sport: string; status: string; convertible?: boolean };

const STATUSES = [
  { value: "ready", label: "Open", tone: "accent" as const },
  { value: "maintenance", label: "Maintenance", tone: "hold" as const },
  { value: "closed", label: "Closed", tone: "danger" as const },
];

function Courts() {
  const [items, setItems] = useState<Court[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sport, setSport] = useState("");

  useEffect(() => {
    void apiGet<{ items: Court[] }>("/courts")
      .then((r) => setItems(r.items))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load the courts"));
  }, []);

  async function set(court: Court, status: string) {
    if (court.status === status || busy) return;
    setBusy(court.id);
    // Optimistic: the pill is the only feedback, and waiting ~300ms for the
    // round trip before it moves makes the control feel unresponsive. Rolled
    // back below if the server disagrees.
    setItems((list) => (list ?? []).map((c) => (c.id === court.id ? { ...c, status } : c)));
    try {
      const res = await apiPatch<{ court: Court; upcoming: number }>(`/courts/${court.id}`, { status });
      setItems((list) => (list ?? []).map((c) => (c.id === court.id ? res.court : c)));
      const label = STATUSES.find((s) => s.value === status)?.label ?? status;
      toast.success(
        status !== "ready" && res.upcoming > 0
          ? `${court.court_code} → ${label}. ${res.upcoming} booking${res.upcoming === 1 ? "" : "s"} still stand — tell the desk.`
          : `${court.court_code} → ${label}`,
      );
    } catch (e) {
      setItems((list) => (list ?? []).map((c) => (c.id === court.id ? { ...c, status: court.status } : c)));
      toast.error(e instanceof Error ? e.message : "Could not change that court");
    } finally {
      setBusy(null);
    }
  }

  if (!items) return <Skeleton className="h-40" />;

  const shown = sport ? items.filter((c) => c.sport === sport) : items;
  const down = items.filter((c) => c.status !== "ready").length;

  return (
    <div className="mb-2 grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Seg
          value={sport}
          onChange={setSport}
          options={[
            { value: "", label: "All" },
            { value: "badminton", label: "Badminton" },
            { value: "basketball", label: "Basketball" },
            { value: "volleyball", label: "Volleyball" },
          ]}
        />
        <p className="text-xs tabular-nums text-muted">
          {items.length - down} of {items.length} open
        </p>
      </div>
      <Stagger className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" gap={0.03}>
        {shown.map((c) => (
          <StaggerItem key={c.id}>
            <Card className="flex h-full flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">
                  {c.court_code}
                  {c.convertible ? <span className="ml-1 text-subtle">↔</span> : null}
                </p>
                <p className="text-xs text-muted">{sportLabel(c.sport)}</p>
              </div>
              <div
                role="radiogroup"
                aria-label={`Status for ${c.court_code}`}
                className="inline-flex rounded-[var(--radius-pill)] bg-wood p-1"
              >
                {STATUSES.map((st) => {
                  const on = c.status === st.value;
                  return (
                    <button
                      key={st.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={busy === c.id}
                      onClick={() => void set(c, st.value)}
                      className={cn(
                        "relative min-h-8 rounded-[var(--radius-pill)] px-3 text-2xs font-semibold uppercase tracking-wider transition-colors duration-200 disabled:opacity-60",
                        on ? "text-bg" : "text-muted hover:text-fg",
                      )}
                    >
                      {on ? (
                        <motion.span
                          layoutId={`court-status-${c.id}`}
                          className={cn(
                            "absolute inset-0 rounded-[var(--radius-pill)]",
                            st.tone === "accent" ? "bg-accent" : st.tone === "hold" ? "bg-hold" : "bg-danger",
                          )}
                          transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        />
                      ) : null}
                      <span className="relative z-[1]">{st.label}</span>
                    </button>
                  );
                })}
              </div>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
