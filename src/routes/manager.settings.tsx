import { createFileRoute } from "@tanstack/react-router";
import { SectionTitle } from "@/components/section";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Button, Card, Check, Field, Input, LoadError, MoneyInput, Seg, Skeleton } from "@/components/ui";
import { Reveal, Stagger, StaggerItem, motion } from "@/components/motion";
import { SplitText } from "@/components/fx";
import { cn } from "@/lib/cn";
import { ApiClientError, apiPatch } from "@/lib/arena3/client";
import { sportLabel } from "@/lib/arena3/labels";
import { t, tk, tServer } from "@/lib/i18n";
import { useRead } from "@/lib/use-read";

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
  "deposit_pct",
  "deposit_peak_only",
  "series_min_weeks",
  "series_max_weeks",
  "series_discount_pct",
  "loyalty_earn_vnd",
  "loyalty_redeem_vnd",
  "day_pass_vnd",
];

type Tier = { hours: number | string; refund_pct: number | string };

function Page() {
  const read = useRead<Record<string, unknown>>("/settings");
  const flagsRead = useRead<{ flags: Record<string, boolean> }>("/flags");
  // What the manager has typed or switched replaces what the server sent, from the first change on.
  const [typed, setS] = useState<Record<string, unknown> | null>(null);
  const [switched, setFlags] = useState<Record<string, boolean> | null>(null);
  const s = typed ?? read.data;
  const flags = switched ?? flagsRead.data?.flags ?? {};
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // A form that cannot be filled from the server is not shown at all: a blank one would look like
  // the centre has no details, and saving it would send those blanks back.
  if (read.error) {
    return (
      <Shell role="manager" title={t("Centre settings")}>
        <LoadError message={read.error.message} onRetry={read.error.refused ? undefined : read.reload} />
      </Shell>
    );
  }
  if (!s) {
    return (
      <Shell role="manager" title={t("Centre settings")}>
        <Skeleton className="h-64" />
      </Shell>
    );
  }
  const tiers = (Array.isArray(s.cancel_tiers) ? s.cancel_tiers : []) as Tier[];
  /** One input of the Centre details form; the server's message for it shows underneath. */
  function f(key: string, label: string, type: "text" | "number" | "time" | "money" = "text") {
    const raw = s![key];
    const value = type === "time" ? String(raw ?? "").slice(0, 5) : String(raw ?? "");
    const change = (next: string) => {
      setS({ ...s!, [key]: next });
      if (fieldErrors[key]) setFieldErrors(({ [key]: _gone, ...rest }) => rest);
    };
    return (
      <Field label={label} hint={fieldErrors[key]}>
        {type === "money" ? (
          <MoneyInput value={value} aria-invalid={fieldErrors[key] ? true : undefined} onChange={change} />
        ) : (
          <Input
            type={type}
            inputMode={type === "number" ? "numeric" : undefined}
            value={value}
            aria-invalid={fieldErrors[key] ? true : undefined}
            onChange={(e) => change(e.target.value)}
          />
        )}
      </Field>
    );
  }
  return (
    <Shell role="manager" title={t("Centre settings")} subtitle={t("New transactions pick these up within a minute.")}>
      <SectionTitle text={tk("Features")} className="mb-3 font-display text-2xl" />
      {flagsRead.error ? (
        // Switches that cannot be read must not show "off": that would be a guess presented as the state.
        <div className="mb-6">
          <LoadError message={flagsRead.error.message} onRetry={flagsRead.error.refused ? undefined : flagsRead.reload} />
        </div>
      ) : !flagsRead.data && !switched ? (
        <Skeleton className="mb-6 h-24" />
      ) : (
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
              className="grid h-11 w-14 shrink-0 place-items-center rounded-full sm:h-8"
              role="switch"
              aria-checked={!!flags[fl.key]}
              aria-label={t(fl.label)}
            >
              {/* The button is the 44px target; the track inside is what you see. */}
              <span className={`block h-8 w-14 rounded-full p-1 transition-colors ${flags[fl.key] ? "bg-accent" : "bg-subtle"}`}>
                <motion.span
                  layout
                  className="block size-6 rounded-full bg-surface shadow"
                  style={{ marginLeft: flags[fl.key] ? "1.5rem" : 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 34 }}
                />
              </span>
            </button>
          </Card>
          </StaggerItem>
        ))}
      </Stagger>
      )}
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
        <p className="mt-2 font-medium md:col-span-2">{t("Deposit and late-cancel fee")}</p>
        {f("deposit_pct", t("Deposit when booking online (%)"), "number")}
        <Check
          checked={s.deposit_peak_only === true}
          onChange={(e) => setS({ ...s, deposit_peak_only: e.target.checked })}
          label={t("Ask for a deposit on peak hours only")}
        />
        <div className="md:col-span-2">
          <p className="mb-1 text-sm">{t("Refund by how early they cancel")}</p>
          {fieldErrors.cancel_tiers ? <p role="alert" className="mb-1 text-xs text-danger">{fieldErrors.cancel_tiers}</p> : null}
          <div className="grid gap-2">
            {tiers.map((tier, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span>{t("Cancelled at least")}</span>
                <Input
                  className="w-20"
                  inputMode="numeric"
                  aria-label={t("Hours before start")}
                  value={String(tier.hours)}
                  onChange={(e) => setS({ ...s, cancel_tiers: tiers.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)) })}
                />
                <span>{t("hours before start → refund")}</span>
                <Input
                  className="w-20"
                  inputMode="numeric"
                  aria-label={t("Refund percent")}
                  value={String(tier.refund_pct)}
                  onChange={(e) => setS({ ...s, cancel_tiers: tiers.map((x, j) => (j === i ? { ...x, refund_pct: e.target.value } : x)) })}
                />
                <span>%</span>
                {tiers.length > 1 ? (
                  <Button size="sm" variant="outline" onClick={() => setS({ ...s, cancel_tiers: tiers.filter((_, j) => j !== i) })}>
                    {t("Remove")}
                  </Button>
                ) : null}
              </div>
            ))}
            {tiers.length < 6 ? (
              <div>
                <Button size="sm" variant="outline" onClick={() => setS({ ...s, cancel_tiers: [...tiers, { hours: 0, refund_pct: 0 }] })}>
                  {t("Add a step")}
                </Button>
              </div>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted">{t("The last step must be 0 hours: that is the refund for cancelling at the last minute.")}</p>
        </div>
        <p className="mt-2 font-medium md:col-span-2">{t("Fixed weekly bookings, points and day pass")}</p>
        {f("series_min_weeks", t("Fixed booking: fewest weeks"), "number")}
        {f("series_max_weeks", t("Fixed booking: most weeks"), "number")}
        {f("series_discount_pct", t("Fixed booking discount (%)"), "number")}
        {f("day_pass_vnd", t("Day pass price (đ)"), "money")}
        {f("loyalty_earn_vnd", t("Spend for 1 point (đ)"), "money")}
        {f("loyalty_redeem_vnd", t("Value of 1 point (đ)"), "money")}
        <Check
          className="md:col-span-2"
          checked={s.self_checkin_enabled === true}
          onChange={(e) => setS({ ...s, self_checkin_enabled: e.target.checked })}
          label={t("Let members check in themselves")}
          hint={t("Off by default. When on, the front desk shows a code that changes every 30 seconds and a member scans it from their own phone. Members without a plan or booking are still sent to the desk.")}
        />
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
                body.cancel_tiers = tiers.map((x) => ({ hours: Number(x.hours), refund_pct: Number(x.refund_pct) }));
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
  const read = useRead<{ items: Court[] }>("/courts");
  const [items, setItems] = useState<Court[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sport, setSport] = useState("");

  // The list starts from the server's answer; a status change moves its pill at once and the server confirms.
  useEffect(() => {
    if (read.data) setItems(read.data.items);
  }, [read.data]);

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

  if (read.error) return <LoadError message={read.error.message} onRetry={read.error.refused ? undefined : read.reload} />;
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
                role="group"
                aria-label={t("Status for {code}", { code: c.court_code })}
                className="inline-flex rounded-[var(--radius-md)] bg-wood p-1"
              >
                {STATUSES.map((st) => {
                  const on = c.status === st.value;
                  return (
                    <button
                      key={st.value}
                      type="button"
                      aria-pressed={on}
                      disabled={busy === c.id}
                      onClick={() => void set(c, st.value)}
                      className={cn(
                        "relative min-h-11 rounded-[var(--radius-sm)] px-3 text-2xs font-semibold transition-colors duration-200 disabled:opacity-60 sm:min-h-8",
                        on ? "text-bg" : "text-muted hover:text-fg",
                      )}
                    >
                      {on ? (
                        <motion.span
                          layoutId={`court-status-${c.id}`}
                          className={cn(
                            "absolute inset-0 rounded-[var(--radius-sm)]",
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
