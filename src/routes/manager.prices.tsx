import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Shell, money } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Input, Skeleton } from "@/components/ui";
import { Stagger, StaggerItem } from "@/components/motion";
import { StarBorder } from "@/components/fx";
import { ApiClientError, apiGet, apiPut } from "@/lib/arena3/client";
import { DAY_KIND_LABEL, sportLabel } from "@/lib/arena3/labels";

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
    void load().catch((e) => toast.error(e.message));
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
      toast.success("Pricing saved");
      await load();
    } catch (e) {
      if (e instanceof ApiClientError && typeof e.body.index === "number") setBad(e.body.index);
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const onSale = (plans ?? []).filter((p) => p.is_on_sale);

  return (
    <Shell
      role="manager"
      title="Pricing"
      subtitle="A new price only applies to new transactions — bookings and plans already sold keep theirs."
    >
      <section aria-labelledby="court-rates">
        <h2 id="court-rates" className="mb-2 font-display text-2xl">
          Court rates
        </h2>
        <p className="mb-3 text-sm text-muted">Price per hour, by sport, day and time of day. Peak hours are the busy evening slots.</p>
        {!items ? (
          <Skeleton className="h-40" />
        ) : !items.length ? (
          <EmptyState title="No court rates yet" hint="Without a rate a court cannot be quoted, so no booking can be made." />
        ) : (
          <div className="grid gap-5">
            {groups.map(([sport, rows]) => (
              <div key={sport}>
                <h3 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted">{sportLabel(sport)}</h3>
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
                            <span className="block text-xs text-muted">{courtCodes[r.court_id] ?? "One court"} only</span>
                          ) : null}
                        </span>
                        <span className="text-sm tabular-nums">
                          {r.start_local.slice(0, 5)}–{r.end_local.slice(0, 5)}
                        </span>
                        <span>
                          <Badge tone={r.is_peak ? "accent" : "muted"}>{r.is_peak ? "Peak" : "Off-peak"}</Badge>
                        </span>
                        <Input
                          type="number"
                          min={0}
                          aria-label={`${sportLabel(r.sport)} ${DAY_KIND_LABEL[r.day_kind] ?? r.day_kind} ${r.start_local.slice(0, 5)} price`}
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
              </div>
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
            {saving ? "Saving…" : "Save new prices"}
          </Button>
        </StarBorder>
      </section>

      <section aria-labelledby="plan-prices" className="mt-10">
        <div className="mb-2 flex items-end justify-between gap-3">
          <h2 id="plan-prices" className="font-display text-2xl">
            Membership plans
          </h2>
          <Link to="/manager/plans" className="text-sm underline">
            Edit plans
          </Link>
        </div>
        {!plans ? (
          <Skeleton className="h-24" />
        ) : !onSale.length ? (
          <EmptyState title="No plan is on sale" hint="Members cannot buy a plan until you put one on sale.">
            <Link to="/manager/plans" className="text-sm underline">
              Go to plans
            </Link>
          </EmptyState>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {onSale.map((p) => (
              <Card key={p.id} className="flex items-center justify-between gap-3 p-3">
                <span>
                  <span className="block text-sm font-medium">{p.name}</span>
                  <span className="block text-xs text-muted">
                    {sportLabel(p.sport_scope)} · {p.duration_days ? `${p.duration_days} days` : "per session"} ·{" "}
                    {p.court_hours} court hours · {p.court_discount_pct}% off courts
                  </span>
                </span>
                <span className="text-sm tabular-nums">{money(p.price_vnd)}</span>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="vat" className="mt-10">
        <h2 id="vat" className="mb-2 font-display text-2xl">
          VAT
        </h2>
        <Card className="flex items-center justify-between gap-3 p-4">
          <span className="text-sm">
            {vat == null ? (
              "VAT rate not available."
            ) : (
              <>
                VAT rate on receipts: <span className="font-medium tabular-nums">{vat}%</span>
              </>
            )}
          </span>
          <Link to="/manager/settings" className="text-sm underline">
            Change in Settings
          </Link>
        </Card>
      </section>
    </Shell>
  );
}
