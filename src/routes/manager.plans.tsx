import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cover, sportPhoto } from "@/components/media";
import { Shell, money } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton } from "@/components/ui";
import { Lift, Stagger, StaggerItem } from "@/components/motion";
import { GlareHover, SpotlightCard } from "@/components/fx";
import { ApiClientError, apiGet, apiPatch, apiPost } from "@/lib/arena3/client";
import { sportLabel } from "@/lib/arena3/labels";
import { t, tServer } from "@/lib/i18n";

export const Route = createFileRoute("/manager/plans")({
  component: Page,
});

type Plan = {
  id: string;
  name: string;
  sport_scope: string;
  price_vnd: number;
  is_on_sale: boolean;
  duration_days: number | null;
  session_quota: number | null;
  court_hours: number;
  court_discount_pct: number;
  carry_over_hours: boolean;
};

const emptyForm = {
  name: "",
  sport_scope: "badminton",
  price_vnd: "800000",
  duration_days: "30",
  session_quota: "",
  court_hours: "2",
  court_discount_pct: "10",
  is_on_sale: true,
  carry_over_hours: false,
};

type Detail = {
  plan: Plan;
  holders: { active: number; pending: number; frozen: number; ever: number };
};

function Page() {
  const [items, setItems] = useState<Plan[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [fe, setFe] = useState<{ field: string; message: string } | null>(null);
  const bad = (f: string) => (fe?.field === f ? fe.message : undefined);

  async function load() {
    setItems((await apiGet<{ items: Plan[] }>("/plans")).items);
  }
  useEffect(() => {
    void load().catch((e) => toast.error(tServer(e.message)));
  }, []);

  async function openDetail(id: string) {
    try {
      setDetail(await apiGet<Detail>(`/plans/${id}`));
    } catch (e) {
      toast.error(e instanceof Error ? tServer(e.message) : t("Could not open that plan"));
    }
  }

  async function setSale(p: Plan, on: boolean) {
    try {
      await apiPatch(`/plans/${p.id}`, { is_on_sale: on });
      toast.success(
        on
          ? t("{name} is on sale again", { name: p.name })
          : t("{name} is no longer sold. Members who hold it keep it.", { name: p.name }),
      );
      await load();
      setDetail((d) => (d && d.plan.id === p.id ? { ...d, plan: { ...d.plan, is_on_sale: on } } : d));
    } catch (e) {
      toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
    }
  }

  async function create() {
    setFe(null);
    setBusy(true);
    try {
      // Sent as typed: the server names the field that is wrong, so a typo
      // reaches the person who made it instead of quietly becoming a zero.
      await apiPost("/plans", {
        name: form.name.trim(),
        sport_scope: form.sport_scope,
        price_vnd: form.price_vnd,
        duration_days: form.duration_days,
        session_quota: form.session_quota,
        court_hours: form.court_hours,
        court_discount_pct: form.court_discount_pct,
        is_on_sale: form.is_on_sale,
        carry_over_hours: form.carry_over_hours,
      });
      toast.success(t("Plan created"));
      setOpen(false);
      setForm(emptyForm);
      await load();
    } catch (e) {
      if (e instanceof ApiClientError && e.body.field) setFe({ field: e.body.field, message: tServer(e.message) });
      else toast.error(e instanceof Error ? tServer(e.message) : t("Could not create the plan"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      role="manager"
      title={t("Membership plans")}
      subtitle={t("Plans are never deleted: one you stop selling leaves the app, and members who hold it keep it.")}
    >
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setOpen(true)}>{t("New plan")}</Button>
      </div>
      {!items ? (
        <Skeleton className="h-48" />
      ) : !items.length ? (
        <EmptyState title={t("No plans yet")} hint={t("Create the first plan so members can buy court hours and class sessions in the app.")}>
          <Button onClick={() => setOpen(true)}>{t("New plan")}</Button>
        </EmptyState>
      ) : null}
      <Stagger className="grid gap-3 md:grid-cols-3" gap={0.07}>
        {(items ?? []).map((p) => (
          <StaggerItem key={p.id} className="h-full">
          <Lift className="h-full">
          <SpotlightCard className="h-full rounded-[var(--radius-xl)]" size={320} strength={0.1}>
          <Card interactive className="relative z-[2] flex h-full flex-col overflow-hidden p-0">
            <GlareHover>
              <Cover src={sportPhoto(p.sport_scope)} alt="" className="h-28">
                <p className="absolute bottom-3 left-4 text-2xs uppercase tracking-wider text-on-media on-media">
                  {sportLabel(p.sport_scope)}
                </p>
              </Cover>
            </GlareHover>
            <div className="flex flex-1 flex-col p-5">
              <Badge tone={p.is_on_sale ? "accent" : "muted"}>{p.is_on_sale ? t("On sale") : t("Not for sale")}</Badge>
              <h2 className="mt-2 font-display text-2xl">{p.name}</h2>
              <p className="mt-2 font-display text-3xl tabular-nums">{money(p.price_vnd)}</p>
              <p className="mt-2 text-sm text-muted">
                {p.duration_days ? t("{n} days", { n: p.duration_days }) : t("Per session")}
                {p.session_quota ? ` · ${t("{n} class sessions", { n: p.session_quota })}` : ""}
                {` · ${t("{n} court hours", { n: p.court_hours })} · ${t("{pct}% off courts", { pct: p.court_discount_pct })}`}
              </p>
              <div className="mt-auto flex gap-2 pt-4">
                <Button variant="outline" onClick={() => void openDetail(p.id)}>
                  {t("Details")}
                </Button>
                <Button variant="ghost" onClick={() => void setSale(p, !p.is_on_sale)}>
                  {p.is_on_sale ? t("Stop selling") : t("Sell again")}
                </Button>
              </div>
            </div>
          </Card>
          </SpotlightCard>
          </Lift>
          </StaggerItem>
        ))}
      </Stagger>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("New membership plan")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button disabled={busy} onClick={() => void create()}>
              {busy ? t("Saving…") : t("Create plan")}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label={t("Plan name")} hint={bad("name")}>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t("Basketball 30 days")}
            />
          </Field>
          <Field label={t("Sport")} hint={bad("sport_scope")}>
            <Select
              value={form.sport_scope}
              onChange={(e) => setForm({ ...form, sport_scope: e.target.value })}
            >
              <option value="badminton">{t("Badminton")}</option>
              <option value="basketball">{t("Basketball")}</option>
              <option value="volleyball">{t("Volleyball")}</option>
              <option value="all">{t("All three sports")}</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Price (đ)")} hint={bad("price_vnd")}>
              <Input
                inputMode="numeric"
                value={form.price_vnd}
                onChange={(e) => setForm({ ...form, price_vnd: e.target.value })}
              />
            </Field>
            <Field label={t("Duration (days)")} hint={bad("duration_days")}>
              <Input
                inputMode="numeric"
                value={form.duration_days}
                onChange={(e) => setForm({ ...form, duration_days: e.target.value })}
                placeholder={t("Leave blank for per-session")}
              />
            </Field>
            <Field label={t("Class sessions")} hint={bad("session_quota")}>
              <Input
                inputMode="numeric"
                value={form.session_quota}
                onChange={(e) => setForm({ ...form, session_quota: e.target.value })}
              />
            </Field>
            <Field label={t("Court hours")} hint={bad("court_hours")}>
              <Input
                inputMode="numeric"
                value={form.court_hours}
                onChange={(e) => setForm({ ...form, court_hours: e.target.value })}
              />
            </Field>
            <Field label={t("Court discount %")} hint={bad("court_discount_pct")}>
              <Input
                inputMode="numeric"
                value={form.court_discount_pct}
                onChange={(e) => setForm({ ...form, court_discount_pct: e.target.value })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_on_sale}
              onChange={(e) => setForm({ ...form, is_on_sale: e.target.checked })}
            />
            {t("Put it on sale now (members see it in the app)")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.carry_over_hours}
              onChange={(e) => setForm({ ...form, carry_over_hours: e.target.checked })}
            />
            {t("Carry unused court hours over on renewal")}
          </label>
        </div>
      </Modal>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.plan.name ?? t("Plan")}
        footer={
          <>
            {detail ? (
              <Button variant="outline" onClick={() => void setSale(detail.plan, !detail.plan.is_on_sale)}>
                {detail.plan.is_on_sale ? t("Stop selling") : t("Sell again")}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setDetail(null)}>
              {t("Close")}
            </Button>
          </>
        }
      >
        {detail ? (
          <div className="grid gap-4 text-sm">
            <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted">{t("Status")}</dt>
              <dd>
                <Badge tone={detail.plan.is_on_sale ? "accent" : "muted"}>
                  {detail.plan.is_on_sale ? t("On sale") : t("Not for sale")}
                </Badge>
              </dd>
              <dt className="text-muted">{t("Price")}</dt>
              <dd className="tabular-nums">{money(detail.plan.price_vnd)}</dd>
              <dt className="text-muted">{t("Sport")}</dt>
              <dd>{sportLabel(detail.plan.sport_scope)}</dd>
              <dt className="text-muted">{t("Lasts")}</dt>
              <dd>{detail.plan.duration_days ? t("{n} days", { n: detail.plan.duration_days }) : t("Per session")}</dd>
              <dt className="text-muted">{t("Court hours")}</dt>
              <dd className="tabular-nums">{detail.plan.court_hours}</dd>
              <dt className="text-muted">{t("Class sessions")}</dt>
              <dd className="tabular-nums">{detail.plan.session_quota ?? t("Not included")}</dd>
              <dt className="text-muted">{t("Court discount")}</dt>
              <dd className="tabular-nums">{detail.plan.court_discount_pct}%</dd>
              <dt className="text-muted">{t("Unused hours")}</dt>
              <dd>{detail.plan.carry_over_hours ? t("Carried over on renewal") : t("Reset on renewal")}</dd>
            </dl>
            <p className="rounded-[var(--radius-md)] bg-wood px-3 py-2">
              <span className="font-medium tabular-nums">{detail.holders.active}</span> {t("active")} ·{" "}
              <span className="font-medium tabular-nums">{detail.holders.pending}</span> {t("waiting for payment")} ·{" "}
              <span className="font-medium tabular-nums">{detail.holders.frozen}</span> {t("frozen")} ·{" "}
              <span className="tabular-nums">{detail.holders.ever}</span> {t("sold in total")}
            </p>
            <p className="text-xs text-muted">
              {t("Stopping sales hides the plan from members and blocks new orders. People who already hold it keep it, and a plan is never deleted.")}
            </p>
          </div>
        ) : null}
      </Modal>
    </Shell>
  );
}
