import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Shell, money } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Input, Skeleton } from "@/components/ui";
import { Stagger, StaggerItem } from "@/components/motion";
import { StarBorder } from "@/components/fx";
import { ApiClientError, apiGet, apiPut } from "@/lib/arena3/client";
import { DAY_KIND_LABEL, sportLabel } from "@/lib/arena3/labels";
import { t, tk, tServer } from "@/lib/i18n";
import { SectionTitle } from "@/components/section";
import { Banknote, ChevronDown, Percent, Ticket } from "lucide-react";

export const Route = createFileRoute("/manager/prices")({
  component: Page,
});

type Rule = {
  id: string;
  sport: string;
  day_kind: string;
  start_local: string;
  end_local: string;
  price_vnd: number;
  is_peak: boolean;
  court_id: string | null;
};

type Plan = {
  id: string;
  name: string;
  sport_scope: string;
  price_vnd: number;
  is_on_sale: boolean;
  duration_days: number | null;
  court_hours: number;
  court_discount_pct: number;
};

const SPORT_ORDER = ["badminton", "basketball", "volleyball"];

/**
 * Pricing, in the blocks a manager thinks in: what a court costs by sport and
 * hour, what a membership costs, and the VAT that sits on top. Plans and VAT
 * are read-only here — they have their own screens — so a price can only be
 * changed in one place.
 */
function Page() {
  const [items, setItems] = useState<Rule[] | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [vat, setVat] = useState<number | null>(null);
  const [courtCodes, setCourtCodes] = useState<Record<string, string>>({});
  const [bad, setBad] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setItems((await apiGet<{ items: Rule[] }>("/price-rules")).items);
  }
  useEffect(() => {
    void load().catch((e) => toast.error(tServer(e.message)));
    void apiGet<{ items: Plan[] }>("/plans")
      .then((r) => setPlans(r.items))
      .catch(() => setPlans([]));
    void apiGet<{ items: { id: string; court_code: string }[] }>("/courts")
      .then((r) => setCourtCodes(Object.fromEntries(r.items.map((c) => [c.id, c.court_code]))))
      .catch(() => {});
    void apiGet<{ vat_rate?: string | number }>("/settings")
      .then((s) => setVat(s.vat_rate == null ? null : Number(s.vat_rate)))
      .catch(() => setVat(null));
  }, []);

  // Rows keep their index in the flat list: the save sends that list as-is.
  const groups = useMemo(() => {
    const out = new Map<string, { rule: Rule; index: number }[]>();
    (items ?? []).forEach((rule, index) => {
      const g = out.get(rule.sport) ?? [];
      g.push({ rule, index });
      out.set(rule.sport, g);
    });
    const rank = (sport: string) => {
      const i = SPORT_ORDER.indexOf(sport);
      return i < 0 ? SPORT_ORDER.length : i;
    };
    return [...out.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [items]);

  function edit(index: number, value: string) {
    if (!items) return;
    const next = [...items];
    next[index] = { ...next[index], price_vnd: value === "" ? Number.NaN : Number(value) };
    setItems(next);
    setBad(null);
    setMessage("");
  }

  async function save() {
    if (!items) return;
    setSaving(true);
    setBad(null);
    setMessage("");
    try {
      await apiPut("/price-rules", { items });
      toast.success(t("Pricing saved"));
      await load();
    } catch (e) {
      if (e instanceof ApiClientError && typeof e.body.index === "number") setBad(e.body.index);
      setMessage(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
    } finally {
      setSaving(false);
    }
  }

  const onSale = (plans ?? []).filter((p) => p.is_on_sale);

  return (
    <Shell
      role="manager"
      title={t("Pricing")}
      subtitle={t("A new price only applies to new transactions — bookings and plans already sold keep theirs.")}
    >
      <section aria-labelledby="court-rates">
        <SectionTitle
          id="court-rates"
          icon={Banknote}
          text={tk("Court rates")}
          hint={t("Price per hour, by sport, day and time of day. Peak hours are the busy evening slots.")}
          className="mb-3"
        />
        {!items ? (
          <Skeleton className="h-40" />
        ) : !items.length ? (
          <EmptyState title={t("No court rates yet")} hint={t("Without a rate a court cannot be quoted, so no booking can be made.")} />
        ) : (
          <div className="grid gap-5">
            {groups.map(([sport, rows], gi) => (
              <details key={sport} open={gi === 0 || rows.some((x) => x.index === bad)} className="group">
                <summary className="mb-2 flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-md)] bg-surface px-3 text-sm font-medium uppercase tracking-wider text-muted [&::-webkit-details-marker]:hidden">
                  <span>
                    {sportLabel(sport)} <span className="normal-case tracking-normal">· {t("{n} rates", { n: rows.length })}</span>
                  </span>
                  <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
                </summary>
                <Stagger className="grid gap-2" gap={0.03}>
                  {rows.map(({ rule: r, index }) => (
                    <StaggerItem key={r.id}>
                      <Card
                        className={`grid grid-cols-2 items-center gap-2 p-3 md:grid-cols-5 ${
                          bad === index ? "border-danger" : ""
                        }`}
                      >
                        <span className="text-sm">
                          {DAY_KIND_LABEL[r.day_kind] ?? r.day_kind}
                          {r.court_id ? (
                            <span className="block text-xs text-muted">{t("{court} only", { court: courtCodes[r.court_id] ?? t("One court") })}</span>
                          ) : null}
                        </span>
                        <span className="text-sm tabular-nums">
                          {r.start_local.slice(0, 5)}–{r.end_local.slice(0, 5)}
                        </span>
                        <span>
                          <Badge tone={r.is_peak ? "accent" : "muted"}>{r.is_peak ? t("Peak") : t("Off-peak")}</Badge>
                        </span>
                        <Input
                          type="number"
                          min={0}
                          aria-label={t("{sport} {day} {time} price", {
                            sport: sportLabel(r.sport),
                            day: DAY_KIND_LABEL[r.day_kind] ?? r.day_kind,
                            time: r.start_local.slice(0, 5),
                          })}
                          value={Number.isNaN(r.price_vnd) ? "" : r.price_vnd}
                          onChange={(e) => edit(index, e.target.value)}
                        />
                        <span className="text-right text-sm tabular-nums">
                          {Number.isNaN(r.price_vnd) ? "—" : money(r.price_vnd)}
                        </span>
                      </Card>
                    </StaggerItem>
                  ))}
                </Stagger>
              </details>
            ))}
          </div>
        )}
        {message ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {message}
          </p>
        ) : null}
        <StarBorder className="mt-4" speed={4}>
          <Button disabled={saving || !items?.length} onClick={() => void save()}>
            {saving ? t("Saving…") : t("Save new prices")}
          </Button>
        </StarBorder>
      </section>

      <section aria-labelledby="plan-prices" className="mt-10">
        <div className="mb-2 flex items-end justify-between gap-3">
          <SectionTitle
            id="plan-prices"
            icon={Ticket}
            text={tk("Membership plans")}
            hint={t("What each plan on sale costs and what it includes.")}
          />
          <Link to="/manager/plans" className="text-sm underline">
            {t("Edit plans")}
          </Link>
        </div>
        {!plans ? (
          <Skeleton className="h-24" />
        ) : !onSale.length ? (
          <EmptyState title={t("No plan is on sale")} hint={t("Members cannot buy a plan until you put one on sale.")}>
            <Link to="/manager/plans" className="text-sm underline">
              {t("Go to plans")}
            </Link>
          </EmptyState>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {onSale.map((p) => (
              <Card key={p.id} className="flex items-center justify-between gap-3 p-3">
                <span>
                  <span className="block text-sm font-medium">{p.name}</span>
                  <span className="block text-xs text-muted">
                    {sportLabel(p.sport_scope)} · {p.duration_days ? t("{n} days", { n: p.duration_days }) : t("per session")} ·{" "}
                    {t("{n} court hours", { n: p.court_hours })} · {t("{pct}% off courts", { pct: p.court_discount_pct })}
                  </span>
                </span>
                <span className="text-sm tabular-nums">{money(p.price_vnd)}</span>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="vat" className="mt-10">
        <SectionTitle
          id="vat"
          icon={Percent}
          text={tk("VAT")}
          hint={t("The tax rate printed on every receipt.")}
          className="mb-3"
        />
        <Card className="flex items-center justify-between gap-3 p-4">
          <span className="text-sm">
            {vat == null ? (
              t("VAT rate not available.")
            ) : (
              <>
                {t("VAT rate on receipts:")} <span className="font-medium tabular-nums">{vat}%</span>
              </>
            )}
          </span>
          <Link to="/manager/settings" className="text-sm underline">
            {t("Change in Settings")}
          </Link>
        </Card>
      </section>
    </Shell>
  );
}
