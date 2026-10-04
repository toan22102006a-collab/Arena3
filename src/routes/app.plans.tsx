import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cover, MediaCaption, sportPhoto } from "@/components/media";
import { Shell, money } from "@/components/shell";
import { Button, Card, EmptyState, Input, Skeleton } from "@/components/ui";
import { Lift, Stagger, StaggerItem } from "@/components/motion";
import { GlareHover, SpotlightCard } from "@/components/fx";
import { apiGet, apiPost } from "@/lib/arena3/client";
import { sportLabel } from "@/lib/arena3/labels";
import { t } from "@/lib/i18n";

export const Route = createFileRoute("/app/plans")({
  component: Page,
});

type Plan = {
  id: string;
  name: string;
  sport_scope: string;
  duration_days: number | null;
  session_quota: number | null;
  court_hours: number;
  court_discount_pct: number;
  price_vnd: number;
};

function Page() {
  const [items, setItems] = useState<Plan[] | null>(null);
  // Which plan is mid-request. One at a time: the server refuses a second live
  // subscription on the same sport anyway, and letting two buttons spin at once
  // only makes it look as though both worked.
  const [busy, setBusy] = useState<string | null>(null);
  // Plans already ordered this visit. The desk has not taken the money yet, so
  // pressing the button again does nothing useful — say so instead of firing a
  // request the rate limiter will reject.
  const [ordered, setOrdered] = useState<Record<string, string>>({});
  const [promoCode, setPromoCode] = useState("");

  useEffect(() => {
    void apiGet<{ items: Plan[] }>("/plans")
      .then((r) => setItems(r.items))
      .catch((e) => toast.error(e.message));
  }, []);

  async function order(p: Plan) {
    if (busy) return;
    setBusy(p.id);
    try {
      const res = await apiPost<{
        preview_end: string;
        renewal?: boolean;
        amount_due_vnd: number;
        promo?: { code: string; discount_vnd: number } | null;
      }>("/subscriptions", {
        plan_id: p.id,
        ...(promoCode.trim() ? { promo_code: promoCode.trim() } : {}),
      });
      setOrdered((o) => ({ ...o, [p.id]: res.preview_end }));
      toast.success(
        res.renewal
          ? t("Renewed through {date} — pay at the desk", { date: res.preview_end })
          : t("Order placed, valid through {date} — pay at the desk", { date: res.preview_end }),
        {
          description: res.promo
            ? t("{code} takes {off} off — you pay {total}.", {
                code: res.promo.code,
                off: money(res.promo.discount_vnd),
                total: money(res.amount_due_vnd),
              })
            : t("You pay {total}.", { total: money(res.amount_due_vnd) }),
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Something went wrong"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell
      role="member"
      title={t("Membership plans")}
      subtitle={t("Order here, pay at the desk — you see the new end date before anything is charged.")}
    >
      {!items ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : (
        <>
        <div className="mb-4 flex max-w-sm items-center gap-2">
          <Input
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
            placeholder={t("Promo code (optional)")}
            aria-label={t("Promo code")}
            autoCapitalize="characters"
            maxLength={32}
          />
        </div>
        <Stagger className="grid gap-3 md:grid-cols-3" gap={0.08}>
          {items.map((p) => (
            <StaggerItem key={p.id} className="h-full">
            <Lift className="h-full">
            <SpotlightCard className="h-full rounded-[var(--radius-xl)]" size={340} strength={0.11}>
            <Card interactive className="relative z-[2] flex h-full flex-col overflow-hidden p-0">
              <GlareHover>
                <Cover src={sportPhoto(p.sport_scope)} alt="" scrim="none" className="h-36">
                  <MediaCaption>
                    <p className="text-2xs uppercase tracking-wider">{sportLabel(p.sport_scope)}</p>
                  </MediaCaption>
                </Cover>
              </GlareHover>
              <div className="flex flex-1 flex-col p-5">
                <h2 className="font-display text-2xl">{p.name}</h2>
                <p className="mt-3 font-display text-3xl tabular-nums">{money(p.price_vnd)}</p>
                <ul className="mt-4 grid gap-2 text-sm text-muted">
                  <li className="flex items-center gap-2">
                    <Check className="size-4 text-accent" strokeWidth={1.75} />
                    {p.duration_days ? t("{n} days", { n: p.duration_days }) : t("Per session")}
                  </li>
                  {p.session_quota ? (
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-accent" strokeWidth={1.75} />
                      {t("{n} class sessions", { n: p.session_quota })}
                    </li>
                  ) : null}
                  <li className="flex items-center gap-2">
                    <Check className="size-4 text-accent" strokeWidth={1.75} />
                    {t("{n} court hours", { n: p.court_hours })}
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 text-accent" strokeWidth={1.75} />
                    {t("{n}% off court rental", { n: p.court_discount_pct })}
                  </li>
                </ul>
                {/* Pinned to the bottom of the card: plans carry a different
                    number of benefit lines each, so laying the buttons out
                    under their own lists put them at three heights in a row. */}
                <div className="mt-auto pt-5">
                  <Button
                    className="w-full"
                    disabled={busy !== null || ordered[p.id] !== undefined}
                    onClick={() => void order(p)}
                  >
                    {busy === p.id
                      ? t("Placing order…")
                      : ordered[p.id]
                        ? t("Ordered — pay at the desk")
                        : t("Buy or renew")}
                  </Button>
                  {ordered[p.id] ? (
                    <p className="mt-2 text-center text-xs text-muted">{t("Valid through {date}", { date: ordered[p.id] })}</p>
                  ) : null}
                </div>
              </div>
            </Card>
            </SpotlightCard>
            </Lift>
            </StaggerItem>
          ))}
          {!items.length ? <EmptyState title={t("No plans on sale right now")} /> : null}
        </Stagger>
        </>
      )}
    </Shell>
  );
}
