import { createFileRoute } from "@tanstack/react-router";
import { SectionTitle } from "@/components/section";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Button, Card, Field, Input, Seg, Skeleton } from "@/components/ui";
import { Reveal, Stagger, StaggerItem, motion } from "@/components/motion";
import { SplitText } from "@/components/fx";
import { cn } from "@/lib/cn";
import { ApiClientError, apiGet, apiPatch } from "@/lib/arena3/client";
import { sportLabel } from "@/lib/arena3/labels";
import { t, tk, tServer } from "@/lib/i18n";

export const Route = createFileRoute("/manager/settings")({
  component: Page,
});

const FLAG_META: { key: string; label: string; hint: string }[] = [
  { key: "F4", label: tk("Register & session plans"), hint: tk("Coaches take attendance and hand out drills.") },
  { key: "F5", label: tk("Plan suggestions"), hint: tk("Drill templates per sport — a coach still has to approve.") },
  { key: "F6", label: tk("Member assistant"), hint: tk("Gemini Q&A, grounded in the timetable, plans and coaches.") },
];

const SETTINGS_FORM_KEYS = [
  "legal_name",
  "address",
  "tax_code",
  "open_time",
  "close_time",
  "hold_minutes",
  "book_ahead_days",
  "cancel_court_hours",
  "gate_dedup_minutes",
  "at_risk_idle_days",
  "self_checkin_enabled",
  "freeze_max_days_year",
  "waitlist_offer_hours",
];

function Page() {
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void apiGet<Record<string, unknown>>("/settings")
      .then(setS)
      .catch((e) => toast.error(tServer(e.message)));
    void apiGet<{ flags: Record<string, boolean> }>("/flags")
      .then((r) => setFlags(r.flags))
      .catch(() => undefined);
  }, []);
  if (!s) {
    return (
      <Shell role="manager" title={t("Centre settings")}>
        <Skeleton className="h-64" />
      </Shell>
    );
  }
  /** One input of the Centre details form; the server's message for it shows underneath. */
  function f(key: string, label: string, type: "text" | "number" | "time" = "text") {
    const raw = s![key];
    const value = type === "time" ? String(raw ?? "").slice(0, 5) : String(raw ?? "");
    return (
      <Field label={label} hint={fieldErrors[key]}>
        <Input
          type={type}
          inputMode={type === "number" ? "numeric" : undefined}
          value={value}
          aria-invalid={fieldErrors[key] ? true : undefined}
          onChange={(e) => {
            setS({ ...s!, [key]: e.target.value });
            if (fieldErrors[key]) setFieldErrors(({ [key]: _gone, ...rest }) => rest);
          }}
        />
      </Field>
    );
  }
  return (
    <Shell role="manager" title={t("Centre settings")} subtitle={t("New transactions pick these up within a minute.")}>
      <SectionTitle text={tk("Features")} className="mb-3 font-display text-2xl" />
      <Stagger className="mb-6 grid gap-2 md:grid-cols-2" gap={0.05}>
        {FLAG_META.map((fl) => (
          <StaggerItem key={fl.key}>
          <Card className="flex h-full items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">
                {fl.key} · {t(fl.label)}
              </p>
              <p className="text-xs text-muted">{t(fl.hint)}</p>
            </div>
            <button
              type="button"
              onClick={async () => {
                const next = !flags[fl.key];
                try {
                  const r = await apiPatch<{ flags: Record<string, boolean> }>("/flags", { [fl.key]: next });
                  setFlags(r.flags);
                  toast.success(next ? t("{key} switched on", { key: fl.key }) : t("{key} switched off", { key: fl.key }));
                } catch (e) {
                  toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
                }
              }}
              className={`h-8 w-14 rounded-full p-1 transition-colors ${flags[fl.key] ? "bg-accent" : "bg-wood"}`}
              aria-pressed={!!flags[fl.key]}
              aria-label={t(fl.label)}
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
      <SectionTitle text={tk("Courts")} className="mb-1 font-display text-2xl" />
      <p className="mb-3 text-sm text-muted">
        {t("Taking a court out of service stops new bookings on it. Anything already booked stays — the desk sorts those out.")}
      </p>
      <Courts />

      <SectionTitle text={tk("Centre details")} className="mb-3 mt-8 font-display text-2xl" />
      <Reveal>
      <Card className="grid gap-3 md:grid-cols-2">
        {f("legal_name", t("Legal name"))}
        {f("address", t("Address"))}
        {f("tax_code", t("Tax code"))}
        {f("open_time", t("Opens at"), "time")}
        {f("close_time", t("Closes at"), "time")}
        {f("hold_minutes", t("Hold length (minutes)"), "number")}
        {f("book_ahead_days", t("Book ahead (days)"), "number")}
        {f("cancel_court_hours", t("Court cancellation window (hours)"), "number")}
        {f("gate_dedup_minutes", t("Count a repeat gate scan once for (minutes)"), "number")}
        {f("at_risk_idle_days", t("At-risk after no visit for (days)"), "number")}
        {f("freeze_max_days_year", t("Freeze cap (days per year)"), "number")}
        {f("waitlist_offer_hours", t("Waitlist offer window (hours)"), "number")}
        <label className="flex items-start gap-3 text-sm md:col-span-2">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--color-accent)]"
            checked={s.self_checkin_enabled === true}
            onChange={(e) => setS({ ...s, self_checkin_enabled: e.target.checked })}
          />
          <span>
            {t("Let members check in themselves")}
            <span className="block text-xs text-muted">
              {t("Off by default. When on, the front desk shows a code that changes every 30 seconds and a member scans it from their own phone. Members without a plan or booking are still sent to the desk.")}
            </span>
          </span>
        </label>
        <p className="text-xs text-muted md:col-span-2">
          {t("Time zone ({tz}) and currency ({currency}) are fixed for this centre.", {
            tz: String(s.timezone ?? "—"),
            currency: String(s.currency ?? "—"),
          })}
        </p>
        <div className="md:col-span-2">
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setFieldErrors({});
              try {
                // Values go as typed: the server checks each one and names the
                // input that is wrong, so a blank never becomes a silent null.
                const body: Record<string, unknown> = {};
                for (const k of SETTINGS_FORM_KEYS) body[k] = s[k] ?? "";
                body.open_time = String(s.open_time ?? "").slice(0, 5);
                body.close_time = String(s.close_time ?? "").slice(0, 5);
                setS(await apiPatch("/settings", body));
                toast.success(t("Saved — new transactions use these now"));
              } catch (e) {
                if (e instanceof ApiClientError && e.body.field) {
                  setFieldErrors({ [e.body.field]: tServer(e.message) });
                  toast.error(tServer(e.message));
                } else {
                  toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
                }
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? t("Saving…") : t("Save")}
          </Button>
        </div>
      </Card>
      </Reveal>
    </Shell>
  );
}

type Court = { id: string; court_code: string; sport: string; status: string };

const STATUSES = [
  { value: "ready", label: tk("Open"), tone: "accent" as const },
  { value: "maintenance", label: tk("Maintenance"), tone: "hold" as const },
  { value: "closed", label: tk("Closed"), tone: "danger" as const },
];

function Courts() {
  const [items, setItems] = useState<Court[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sport, setSport] = useState("");

  useEffect(() => {
    void apiGet<{ items: Court[] }>("/courts")
      .then((r) => setItems(r.items))
      .catch((e) => toast.error(e instanceof Error ? tServer(e.message) : t("Could not load the courts")));
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
      const found = STATUSES.find((s) => s.value === status)?.label;
      const label = found ? t(found) : status;
      const code = court.court_code;
      toast.success(
        status !== "ready" && res.upcoming > 0
          ? res.upcoming === 1
            ? t("{code} → {label}. 1 booking still stands — tell the desk.", { code, label })
            : t("{code} → {label}. {n} bookings still stand — tell the desk.", { code, label, n: res.upcoming })
          : t("{code} → {label}", { code, label }),
      );
    } catch (e) {
      setItems((list) => (list ?? []).map((c) => (c.id === court.id ? { ...c, status: court.status } : c)));
      toast.error(e instanceof Error ? tServer(e.message) : t("Could not change that court"));
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
            { value: "", label: t("All") },
            { value: "badminton", label: t("Badminton") },
            { value: "basketball", label: t("Basketball") },
            { value: "volleyball", label: t("Volleyball") },
          ]}
        />
        <p className="text-xs tabular-nums text-muted">
          {t("{n} of {total} open", { n: items.length - down, total: items.length })}
        </p>
      </div>
      <Stagger className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" gap={0.03}>
        {shown.map((c) => (
          <StaggerItem key={c.id}>
            <Card className="flex h-full flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">
                  {c.court_code}
                </p>
                <p className="text-xs text-muted">{sportLabel(c.sport)}</p>
              </div>
              <div
                role="radiogroup"
                aria-label={t("Status for {code}", { code: c.court_code })}
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
                      <span className="relative z-[1]">{t(st.label)}</span>
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
