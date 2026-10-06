import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SectionTitle } from "@/components/section";
import { Shell, money, when } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Field, Input, LoadError, Skeleton } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { ApiClientError, apiPost } from "@/lib/arena3/client";
import { t, tServer } from "@/lib/i18n";
import { useRead } from "@/lib/use-read";

export const Route = createFileRoute("/app/points")({ component: Page });

type Data = {
  points: number;
  earned: number;
  spend_vnd: number;
  tier: "bronze" | "silver" | "gold";
  next_tier: { key: string; need: number } | null;
  earn_vnd: number;
  redeem_vnd: number;
  min_redeem: number;
  history: { id: string; points: number; reason: string; note: string | null; created_at: string; promo_code: string | null }[];
};

const tierName = (k: string) => (k === "gold" ? t("Gold") : k === "silver" ? t("Silver") : t("Bronze"));

function Page() {
  const { data: d, error, reload } = useRead<Data>("/me/points");
  const [pts, setPts] = useState("");
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; value: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function redeem() {
    setFieldErr(null);
    setBusy(true);
    try {
      const r = await apiPost<{ code: string; value_vnd: number }>("/me/points/redeem", { points: Number(pts) }, true);
      setCode({ code: r.code, value: r.value_vnd });
      setPts("");
      reload();
    } catch (e) {
      setFieldErr(e instanceof ApiClientError ? e.message : e instanceof Error ? tServer(e.message) : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  const n = Number(pts);
  return (
    <Shell role="member" title={t("My points")} subtitle={t("Every booking and plan earns points. Swap them for a discount code.")}>
      {error ? (
        <LoadError message={error.message} onRetry={error.refused ? undefined : reload} />
      ) : !d ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <Reveal from="down">
            <Card className="mb-4 p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t("Balance")}</p>
                  <p className="font-display text-5xl tabular-nums">{d.points}</p>
                  <p className="text-xs text-muted">{t("worth {amount}", { amount: money(d.points * d.redeem_vnd) })}</p>
                </div>
                <div className="text-right">
                  <Badge tone="accent">{tierName(d.tier)}</Badge>
                  <p className="mt-1 text-xs text-muted">
                    {d.next_tier
                      ? t("{n} more points to {tier}", { n: d.next_tier.need, tier: tierName(d.next_tier.key) })
                      : t("Top tier — thank you for playing here.")}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted">
                {t("You earn 1 point for every {amount} you spend. 1 point is worth {value}.", { amount: money(d.earn_vnd), value: money(d.redeem_vnd) })}
              </p>
            </Card>
          </Reveal>

          <Card className="mb-6 p-5">
            <p className="mb-3 font-medium">{t("Swap points for a code")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("Points to swap (at least {n})", { n: d.min_redeem })} hint={fieldErr ?? undefined}>
                <Input inputMode="numeric" value={pts} onChange={(e) => setPts(e.target.value)} />
              </Field>
              <Button disabled={busy || !n || n < d.min_redeem || n > d.points} onClick={() => void redeem()}>
                {n > 0 ? t("Get a {amount} code", { amount: money(n * d.redeem_vnd) }) : t("Get a code")}
              </Button>
            </div>
            {code ? (
              <div className="mt-4 rounded-[var(--radius-md)] bg-accent/10 p-4">
                <p className="text-xs text-muted">{t("Your code — {amount} off one booking or plan, valid 60 days. Type it at checkout.", { amount: money(code.value) })}</p>
                <p className="mt-1 select-all font-mono text-2xl tracking-wider">{code.code}</p>
              </div>
            ) : null}
          </Card>

          <SectionTitle text={t("History")} className="mb-3 font-display text-2xl" />
          {d.history.length === 0 ? (
            <EmptyState title={t("Nothing swapped yet")} hint={t("Points you swap or are given show up here.")} />
          ) : (
            <div className="grid gap-2">
              {d.history.map((h) => (
                <Card key={h.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span>
                    {h.note ?? h.reason}
                    <span className="block text-xs text-muted">{when(h.created_at)}</span>
                  </span>
                  <span className={`tabular-nums ${h.points < 0 ? "text-danger" : "text-accent-2"}`}>{h.points > 0 ? `+${h.points}` : h.points}</span>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
