import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell, money } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton } from "@/components/ui";
import { ApiClientError, apiGet, apiPatch, apiPost } from "@/lib/arena3/client";
import { formatDate, sportLabel } from "@/lib/arena3/labels";
import { t, tk, tServer } from "@/lib/i18n";

export const Route = createFileRoute("/manager/promos")({ component: Page });

type Promo = {
  id: string;
  code: string;
  name: string;
  kind: "percent" | "amount";
  value: number;
  max_discount_vnd: number | null;
  min_order_vnd: number;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  max_per_member: number;
  applies_to: string[];
  sport: string | null;
  plan_id: string | null;
  plan_name: string | null;
  stackable: boolean;
  status: "active" | "paused";
  state: "active" | "paused" | "expired" | "scheduled" | "exhausted";
  used: number;
  discount_given_vnd: number;
};

type Redemption = {
  id: string;
  status: "applied" | "restored";
  discount_vnd: number;
  created_at: string;
  restored_at: string | null;
  full_name: string;
  member_code: string | null;
};

type Plan = { id: string; name: string };

const STATE_TONE: Record<Promo["state"], "accent" | "hold" | "muted" | "danger"> = {
  active: "accent",
  scheduled: "hold",
  paused: "muted",
  expired: "muted",
  exhausted: "danger",
};

const STATE_LABEL: Record<Promo["state"], string> = {
  active: tk("active"),
  scheduled: tk("scheduled"),
  paused: tk("paused"),
  expired: tk("expired"),
  exhausted: tk("exhausted"),
};

const empty = {
  code: "",
  name: "",
  kind: "percent",
  value: "10",
  max_discount_vnd: "",
  min_order_vnd: "",
  starts_at: "",
  ends_at: "",
  max_uses: "",
  max_per_member: "1",
  plan: true,
  court: true,
  sport: "",
  plan_id: "",
};

function describe(p: Promo) {
  return p.kind === "percent" ? t("{n}% off", { n: p.value }) : t("{amount} off", { amount: money(p.value) });
}

/** An input type=date gives YYYY-MM-DD; the code runs to the end of that day, Vietnam time. */
function endOfDay(d: string) {
  return d ? `${d}T23:59:59+07:00` : "";
}
function startOfDay(d: string) {
  return d ? `${d}T00:00:00+07:00` : "";
}

function Page() {
  const [items, setItems] = useState<Promo[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [fe, setFe] = useState<{ field: string; message: string } | null>(null);
  const [history, setHistory] = useState<{ promo: Promo; rows: Redemption[] } | null>(null);
  const bad = (f: string) => (fe?.field === f ? fe.message : undefined);

  async function load() {
    setItems((await apiGet<{ items: Promo[] }>("/promotions")).items);
  }
  useEffect(() => {
    void load().catch((e) => toast.error(tServer(e.message)));
    void apiGet<{ items: Plan[] }>("/plans")
      .then((r) => setPlans(r.items))
      .catch(() => undefined);
  }, []);

  async function create() {
    setBusy(true);
    setFe(null);
    try {
      const applies = [form.plan ? "plan" : "", form.court ? "court" : ""].filter(Boolean);
      await apiPost("/promotions", {
        code: form.code,
        name: form.name,
        kind: form.kind,
        value: form.value,
        max_discount_vnd: form.kind === "percent" ? form.max_discount_vnd : "",
        min_order_vnd: form.min_order_vnd,
        starts_at: startOfDay(form.starts_at),
        ends_at: endOfDay(form.ends_at),
        max_uses: form.max_uses,
        max_per_member: form.max_per_member,
        applies_to: applies,
        sport: form.sport,
        plan_id: form.plan_id,
      });
      toast.success(t("Code {code} is live", { code: form.code.toUpperCase() }));
      setOpen(false);
      setForm(empty);
      await load();
    } catch (e) {
      if (e instanceof ApiClientError && e.body.field) setFe({ field: e.body.field, message: tServer(e.message) });
      toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(p: Promo) {
    try {
      await apiPatch(`/promotions/${p.id}`, { status: p.status === "active" ? "paused" : "active" });
      toast.success(p.status === "active" ? t("Paused — new orders can't use it") : t("Back on"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
    }
  }

  async function showHistory(p: Promo) {
    try {
      const r = await apiGet<{ items: Redemption[] }>(`/promotions/${p.id}/redemptions`);
      setHistory({ promo: p, rows: r.items });
    } catch (e) {
      toast.error(e instanceof Error ? tServer(e.message) : t("Could not load the history"));
    }
  }

  return (
    <Shell
      role="manager"
      title={t("Promo codes")}
      subtitle={t("A code is counted when the money posts, and handed back if the payment is fully refunded.")}
    >
      <div className="mb-4">
        <Button onClick={() => setOpen(true)}>{t("New code")}</Button>
      </div>

      {!items ? (
        <Skeleton className="h-40" />
      ) : !items.length ? (
        <EmptyState title={t("No promo codes yet")} hint={t("Create one and give it to members at the desk or in a campaign.")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((p) => (
            <Card key={p.id} className="grid gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-display text-2xl tracking-wide">{p.code}</p>
                  <p className="text-sm text-muted">{p.name}</p>
                </div>
                <Badge tone={STATE_TONE[p.state]}>{t(STATE_LABEL[p.state])}</Badge>
              </div>
              <p className="text-sm">
                <span className="font-medium">{describe(p)}</span>
                {p.kind === "percent" && p.max_discount_vnd ? (
                  <span className="text-muted"> · {t("up to {amount}", { amount: money(p.max_discount_vnd) })}</span>
                ) : null}
                {p.min_order_vnd > 0 ? <span className="text-muted"> · {t("from {amount}", { amount: money(p.min_order_vnd) })}</span> : null}
              </p>
              <p className="text-xs text-muted">
                {p.applies_to.map((a) => (a === "plan" ? t("plans") : t("courts"))).join(" + ")}
                {p.sport ? ` · ${sportLabel(p.sport)}` : ""}
                {p.plan_name ? ` · ${t("{name} only", { name: p.plan_name })}` : ""}
                {p.starts_at ? ` · ${t("from {date}", { date: formatDate(p.starts_at) })}` : ""}
                {p.ends_at ? ` · ${t("until {date}", { date: formatDate(p.ends_at) })}` : ""}
                {` · ${t("{n} per member", { n: p.max_per_member })}`}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="tabular-nums">
                  {p.max_uses ? t("Used {n} of {max}", { n: p.used, max: p.max_uses }) : t("Used {n}", { n: p.used })}
                  <span className="text-muted"> · {t("gave away {amount}", { amount: money(p.discount_given_vnd) })}</span>
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => void showHistory(p)}>
                    {t("Who used it")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void toggle(p)}>
                    {p.status === "active" ? t("Pause") : t("Resume")}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("New promo code")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button disabled={busy} onClick={() => void create()}>
              {busy ? t("Saving…") : t("Create code")}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Code")} hint={bad("code")}>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SUMMER10" />
          </Field>
          <Field label={t("Name")} hint={bad("name")}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("Summer opening")} />
          </Field>
          <Field label={t("Type")}>
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="percent">{t("Percent off")}</option>
              <option value="amount">{t("Fixed amount off")}</option>
            </Select>
          </Field>
          <Field label={form.kind === "percent" ? t("Percent (1–100)") : t("Amount (đ, multiple of 1,000)")} hint={bad("value")}>
            <Input inputMode="numeric" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          </Field>
          {form.kind === "percent" ? (
            <Field label={t("Cap (đ, optional)")} hint={bad("max_discount_vnd")}>
              <Input
                inputMode="numeric"
                value={form.max_discount_vnd}
                onChange={(e) => setForm({ ...form, max_discount_vnd: e.target.value })}
              />
            </Field>
          ) : null}
          <Field label={t("Minimum order (đ, optional)")} hint={bad("min_order_vnd")}>
            <Input
              inputMode="numeric"
              value={form.min_order_vnd}
              onChange={(e) => setForm({ ...form, min_order_vnd: e.target.value })}
            />
          </Field>
          <Field label={t("Starts (optional)")} hint={bad("starts_at")}>
            <Input type="date" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
          </Field>
          <Field label={t("Ends (optional)")} hint={bad("ends_at")}>
            <Input type="date" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
          </Field>
          <Field label={t("Total uses (blank = unlimited)")} hint={bad("max_uses")}>
            <Input inputMode="numeric" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} />
          </Field>
          <Field label={t("Uses per member")} hint={bad("max_per_member")}>
            <Input
              inputMode="numeric"
              value={form.max_per_member}
              onChange={(e) => setForm({ ...form, max_per_member: e.target.value })}
            />
          </Field>
          <Field label={t("Sport")}>
            <Select value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })}>
              <option value="">{t("Any sport")}</option>
              <option value="badminton">{t("Badminton")}</option>
              <option value="basketball">{t("Basketball")}</option>
              <option value="volleyball">{t("Volleyball")}</option>
            </Select>
          </Field>
          <Field label={t("Only this plan")}>
            <Select value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
              <option value="">{t("Any plan")}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="flex items-center gap-4 text-sm sm:col-span-2">
            <legend className="mb-1 text-xs text-muted">{t("Applies to")} {bad("applies_to") ? `— ${bad("applies_to")}` : ""}</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.checked })} />
              {t("Membership plans")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.court} onChange={(e) => setForm({ ...form, court: e.target.checked })} />
              {t("Court bookings")}
            </label>
          </fieldset>
        </div>
        <p className="mt-3 text-xs text-muted">
          {t("Class sign-ups carry no price here, so a code can't apply to them. One code per order. Percentages round to the nearest 1,000đ, and an order is never discounted below 1,000đ.")}
        </p>
      </Modal>

      <Modal
        open={history !== null}
        onClose={() => setHistory(null)}
        title={history ? t("{code} — who used it", { code: history.promo.code }) : ""}
      >
        {history && !history.rows.length ? <p className="text-sm text-muted">{t("Nobody yet.")}</p> : null}
        <ul className="grid gap-2">
          {history?.rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {r.full_name} <span className="text-xs text-muted">{r.member_code}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{money(r.discount_vnd)}</span>
                <Badge tone={r.status === "applied" ? "accent" : "muted"}>
                  {r.status === "applied" ? t("used") : t("given back")}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      </Modal>
    </Shell>
  );
}
