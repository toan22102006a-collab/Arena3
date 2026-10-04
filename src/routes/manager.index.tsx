import { createFileRoute } from "@tanstack/react-router";
import { Banknote, Clock, Hourglass, Layers, PiggyBank, TrendingUp, Undo2, Wallet } from "lucide-react";
import { CardTitle } from "@/components/section";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { CourtGrid, type Court, type OccSlot } from "@/components/court-grid";
import { Cover, MediaCaption, media } from "@/components/media";
import { Shell, money, when } from "@/components/shell";
import { CapacityPanel, ExportButtons, MembersPanel } from "@/components/report-panels";
import { Button, Card, DateField, Select, Seg, Skeleton, Stat, type Trend } from "@/components/ui";
import { CountUp, Reveal, Stagger, StaggerItem, motion } from "@/components/motion";
import { GLBackground, GlareHover, SplitText, SpotlightCard } from "@/components/fx";
import { apiGet } from "@/lib/arena3/client";
import { t, tServer } from "@/lib/i18n";
import { addDaysISO, formatDate, methodLabel, sourceLabel, todayISO } from "@/lib/arena3/labels";

export const Route = createFileRoute("/manager/")({
  component: Page,
});

type Rev = {
  from: string;
  to: string;
  totals: { revenue_vnd: number; gross_vnd?: number; refund_vnd: number; quota_hours: number };
  by_source: Record<string, number>;
  refunds_by_source?: Record<string, number>;
  by_shift?: Array<{
    shift_id: string | null;
    cashier: string | null;
    opened_at: string | null;
    closed_at: string | null;
    takings_vnd: number;
    refunds_vnd: number;
    count: number;
  }>;
  by_method: Record<string, number>;
  /** One row per ICT day in the window, including days with no takings. */
  by_day?: Array<{ day: string; revenue_vnd: number }>;
  /** The window just before this one, same length and same method filter. */
  prev?: Pick<Rev, "from" | "to" | "totals" | "by_source">;
};

type Occ = { date: string; items: Array<{ court_code: string; minutes: number; pct: number }> };

function monthStart(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

/**
 * This period against the one before it.
 *
 * `upIsGood` is asked for rather than assumed. These three tiles sit in a row
 * and two of them mean opposite things: revenue rising is the centre having a
 * good week, refunds rising is the centre having a bad one. A single colour
 * rule keyed on the sign would paint a week of refunds green.
 */
function delta(cur: number, prev: number, upIsGood: boolean): Trend {
  if (prev === 0 && cur === 0) return { pct: 0, label: t("Same as the previous period"), good: null };
  if (prev === 0) return { pct: null, label: t("New this period"), good: upIsGood };
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
  const sign = pct > 0 ? "+" : "";
  return {
    pct,
    label: t("{pct}% vs the previous period", { pct: `${sign}${pct}` }),
    good: pct === 0 ? null : pct > 0 === upIsGood,
  };
}

/**
 * Axis ticks in the shortest form that is still unambiguous.
 *
 * Full VND on an axis is six to nine digits per tick, which crowds them into
 * each other; the tooltip carries the exact figure.
 */
function compactVnd(v: number): string {
  if (!v) return "0";
  if (Math.abs(v) >= 1_000_000) return `${Math.round(v / 100_000) / 10}tr`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
}

/** One tooltip skin for every chart on the page, in the app's own surface. */
const TOOLTIP = {
  formatter: (v: unknown) => money(Number(v ?? 0)),
  contentStyle: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-line)",
    borderRadius: 12,
    fontSize: 12,
  },
  labelStyle: { color: "var(--color-muted)", fontSize: 11 },
} as const;

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const body = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Page() {
  const today = todayISO();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [period, setPeriod] = useState("today");
  const [rev, setRev] = useState<Rev | null>(null);
  const [prev, setPrev] = useState<Pick<Rev, "from" | "to" | "totals" | "by_source"> | null>(null);
  const [method, setMethod] = useState("");
  const [occ, setOcc] = useState<Occ | null>(null);
  const [map, setMap] = useState<{ courts: Court[]; slots: OccSlot[] } | null>(null);
  const [chartReady, setChartReady] = useState(false);
  useEffect(() => setChartReady(true), []);

  function applyPeriod(p: string) {
    setPeriod(p);
    if (p === "today") {
      setFrom(today);
      setTo(today);
    } else if (p === "week") {
      setFrom(addDaysISO(today, -6));
      setTo(today);
    } else if (p === "month") {
      setFrom(monthStart(today));
      setTo(today);
    }
  }

  async function load() {
    const methodQ = method ? `&method=${method}` : "";
    // The server returns the previous window of the same length alongside, with
    // the same method filter, so the comparison is always like for like.
    const [r, o, m] = await Promise.all([
      apiGet<Rev>(`/reports/revenue?from=${from}&to=${to}${methodQ}`),
      apiGet<Occ>(`/reports/occupancy?date=${to}`),
      apiGet<{ courts: Court[]; slots: OccSlot[] }>(`/occupancy?date=${to}`),
    ]);
    setRev(r);
    setPrev(r.prev ?? null);
    setOcc(o);
    setMap(m);
  }
  useEffect(() => {
    void load().catch((e) => toast.error(tServer(e.message)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, method]);

  const chartData = Object.entries(rev?.by_method ?? {}).map(([k, v]) => ({
    name: methodLabel(k),
    vnd: v,
  }));
  // Biggest first: a magnitude comparison is read down the list, and leaving it
  // in map order makes the reader do the sorting themselves.
  const sourceData = Object.entries(rev?.by_source ?? {})
    .map(([k, v]) => ({ name: sourceLabel(k), vnd: v }))
    .sort((a, b) => b.vnd - a.vnd);
  const trendData = (rev?.by_day ?? []).map((d) => ({
    day: d.day.slice(8) + "/" + d.day.slice(5, 7),
    vnd: d.revenue_vnd,
  }));
  // One day is a point, not a trend — the tiles above already say that number.
  const showTrend = trendData.length > 1;

  return (
    <Shell
      role="manager"
      title={t("Reports")}
      subtitle={t("Revenue = payments taken − refunds. Court usage for {date}.", { date: formatDate(to) })}
    >
      <GLBackground
        variant="dotgrid"
        position="fixed"
        className="-z-[1]"
        color="#1f5c43"
        gap={32}
        dot={1.5}
        radius={130}
        opacity={0.12}
      />
      <GlareHover className="mb-5 hidden rounded-[var(--radius-xl)] sm:block" duration={1.1}>
        <Cover src={media.hallCourts} alt="" scrim="none" className="h-32 rounded-[var(--radius-xl)]">
          <MediaCaption>
            <p className="font-display text-2xl">{t("Close the books for this period")}</p>
          </MediaCaption>
        </Cover>
      </GlareHover>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Seg
          value={period}
          onChange={applyPeriod}
          options={[
            { value: "today", label: t("Today") },
            { value: "week", label: t("7 days") },
            { value: "month", label: t("This month") },
            { value: "custom", label: t("Custom") },
          ]}
        />
      {period === "custom" ? (
        <>
        <span className="text-2xs uppercase tracking-wider text-muted">{t("From")}</span>
        <DateField
          value={from}
          onChange={(v) => {
            setPeriod("custom");
            setFrom(v);
          }}
          aria-label={t("From date")}
        />
        <span className="text-2xs uppercase tracking-wider text-muted">{t("To")}</span>
        <DateField
          value={to}
          onChange={(v) => {
            setPeriod("custom");
            setTo(v);
          }}
          aria-label={t("To date")}
        />
        </>
      ) : null}
        <div className="w-40">
          <Select aria-label={t("Payment method")} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">{t("All methods")}</option>
            {["cash", "transfer", "card", "gateway", "quota"].map((m) => (
              <option key={m} value={m}>
                {methodLabel(m)}
              </option>
            ))}
          </Select>
        </div>
        <ExportButtons kind="revenue" from={from} to={to} extra={{ method }} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!rev || !occ) return;
            downloadCsv(`arena3-report-${from}_${to}.csv`, [
              [t("From"), formatDate(from), t("To"), formatDate(to)],
              [
                t("Revenue"),
                rev.totals.revenue_vnd,
                t("Refunds"),
                rev.totals.refund_vnd ?? 0,
                t("Plan hours used"),
                rev.totals.quota_hours,
              ],
              [],
              [t("Method"), t("Amount")],
              ...Object.entries(rev.by_method).map(([k, v]) => [methodLabel(k), v]),
              [],
              [t("Source"), t("Amount")],
              ...Object.entries(rev.by_source).map(([k, v]) => [sourceLabel(k), v]),
              [],
              [t("Court"), t("Minutes"), "%"],
              ...(occ.items ?? []).map((c) => [c.court_code, c.minutes, c.pct]),
            ]);
          }}
        >
          {t("Export CSV")}
        </Button>
      </div>
      {!rev ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : (
        <Stagger className="grid gap-3 md:grid-cols-3" gap={0.08}>
          <StaggerItem>
          <Stat
            label={t("Revenue")}
            icon={Banknote}
            note={t("Payments taken, minus refunds")}
            value={money(rev.totals.revenue_vnd)}
            trend={prev ? delta(rev.totals.revenue_vnd, prev.totals.revenue_vnd, true) : undefined}
          />
          </StaggerItem>
          <StaggerItem>
          <Stat
            label={t("Refunds")}
            icon={Undo2}
            note={t("Money handed back to members")}
            value={money(rev.totals.refund_vnd ?? 0)}
            trend={prev ? delta(rev.totals.refund_vnd ?? 0, prev.totals.refund_vnd ?? 0, false) : undefined}
          />
          </StaggerItem>
          <StaggerItem>
          <Stat
            label={t("Plan hours used")}
            icon={Hourglass}
            note={t("Court hours members drew from their plans")}
            value={rev.totals.quota_hours}
            trend={prev ? delta(rev.totals.quota_hours, prev.totals.quota_hours, true) : undefined}
          />
          </StaggerItem>
        </Stagger>
      )}

      {showTrend ? (
        <Reveal className="mt-6">
          <SpotlightCard className="rounded-[var(--radius-xl)]" size={520} strength={0.09}>
            <Card className="relative z-[2]">
<CardTitle icon={TrendingUp} title={t("Revenue per day")} hint={t("Each point is one day's takings, after refunds.")} />
              {chartReady ? (
                <div className="mt-3 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="2 4" />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 11 }}
                        stroke="var(--color-muted)"
                        tickLine={false}
                        minTickGap={16}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        stroke="var(--color-muted)"
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        tickFormatter={compactVnd}
                      />
                      <Tooltip {...TOOLTIP} labelFormatter={(l) => t("Day {d}", { d: String(l) })} />
                      <Area
                        type="monotone"
                        dataKey="vnd"
                        name={t("Revenue")}
                        stroke="var(--color-accent)"
                        strokeWidth={2}
                        fill="url(#revFill)"
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Skeleton className="mt-3 h-56" />
              )}
            </Card>
          </SpotlightCard>
        </Reveal>
      ) : null}

      <Reveal className="mt-6 grid gap-3 md:grid-cols-2">
        <SpotlightCard className="rounded-[var(--radius-xl)]" size={380} strength={0.09}>
        <Card className="relative z-[2] h-full">
          <CardTitle icon={Wallet} title={t("By payment method")} hint={t("How members paid: cash, transfer, card or online.")} />
          {chartReady && chartData.length ? (
            <div className="mt-3 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="2 4" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--color-muted)" tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted)"
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={compactVnd}
                  />
                  <Tooltip {...TOOLTIP} cursor={{ fill: "var(--color-wood)", opacity: 0.5 }} />
                  <Bar dataKey="vnd" name={t("Revenue")} fill="var(--color-accent)" radius={[4, 4, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">{t("Nothing recorded yet.")}</p>
          )}
        </Card>
        </SpotlightCard>
        <SpotlightCard className="rounded-[var(--radius-xl)]" size={380} strength={0.09}>
        <Card className="relative z-[2] h-full">
          <CardTitle icon={Layers} title={t("By source")} hint={t("What the money was for: court rental or plans.")} />
          {chartReady && sourceData.length ? (
            <div className="mt-3 h-52">
              <ResponsiveContainer width="100%" height="100%">
                {/* Horizontal: the category names are words, and sideways
                    labels are the commonest reason a bar chart goes unread. */}
                <BarChart
                  layout="vertical"
                  data={sourceData}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid horizontal={false} stroke="var(--color-line)" strokeDasharray="2 4" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted)"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={compactVnd}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted)"
                    tickLine={false}
                    axisLine={false}
                    width={92}
                  />
                  <Tooltip {...TOOLTIP} cursor={{ fill: "var(--color-wood)", opacity: 0.5 }} />
                  <Bar dataKey="vnd" name={t("Revenue")} fill="var(--color-accent)" radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">{t("Nothing recorded yet.")}</p>
          )}
        </Card>
        </SpotlightCard>
      </Reveal>

      {rev ? (
        <Reveal className="mt-6 grid gap-3 md:grid-cols-2">
          <Card>
            <CardTitle icon={PiggyBank} title={t("Where the money came from")} hint={t("The same revenue split by what was sold, with refunds shown.")} />
            {Object.keys(rev.by_source).length || Object.keys(rev.refunds_by_source ?? {}).length ? (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-2xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="pb-1 font-medium">{t("Source")}</th>
                    <th className="pb-1 text-right font-medium">{t("Taken")}</th>
                    <th className="pb-1 text-right font-medium">{t("Refunded")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...new Set([...Object.keys(rev.by_source), ...Object.keys(rev.refunds_by_source ?? {})])].map((k) => (
                    <tr key={k} className="border-t border-line/60">
                      <td className="py-1.5">{sourceLabel(k)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(rev.by_source[k] ?? 0)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(rev.refunds_by_source?.[k] ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-3 text-sm text-muted">
                {t("Nothing taken in this period yet. Takings appear here once reception records a payment.")}
              </p>
            )}
            <p className="mt-3 text-xs text-muted">
              {t("Class places come out of a plan and gear hire is not charged as a payment, so neither has a line of its own.")}
            </p>
          </Card>
          <Card>
            <CardTitle icon={Clock} title={t("By cashier shift")} hint={t("Takings for each shift a cashier opened at the desk.")} />
            {rev.by_shift?.length ? (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-2xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="pb-1 font-medium">{t("Shift")}</th>
                    <th className="pb-1 text-right font-medium">{t("Taken")}</th>
                    <th className="pb-1 text-right font-medium">{t("Refunded")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rev.by_shift.map((s) => (
                    <tr key={s.shift_id ?? "none"} className="border-t border-line/60">
                      <td className="py-1.5">
                        {s.shift_id ? (
                          <>
                            <span className="font-medium">{s.cashier ?? t("Reception")}</span>
                            <span className="block text-xs text-muted">
                              {s.opened_at ? when(s.opened_at) : ""}
                              {s.closed_at ? ` – ${when(s.closed_at)}` : ` – ${t("still open")}`}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted">{t("Not taken at the desk (online)")}</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{money(s.takings_vnd)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(s.refunds_vnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-3 text-sm text-muted">{t("No payments in this period, so there are no shifts to show.")}</p>
            )}
          </Card>
        </Reveal>
      ) : null}

      <CapacityPanel from={from} to={to} />
      <MembersPanel from={from} to={to} />

      <SplitText
        as="h2"
        text={t("Court usage · {date}", { date: formatDate(to) })}
        className="mt-8 font-display text-2xl"
      />
      <Stagger className="mt-3 grid gap-2 md:grid-cols-2" gap={0.05}>
        {(occ?.items ?? []).map((c) => (
          <StaggerItem key={c.court_code}>
          <Card className="p-4">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{c.court_code}</span>
              <span className="tabular-nums">
                <CountUp to={c.pct} duration={0.9} suffix="%" />
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-wood">
              <motion.div
                className="h-full bg-accent"
                initial={{ width: 0 }}
                whileInView={{ width: `${Math.min(100, c.pct)}%` }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </Card>
          </StaggerItem>
        ))}
      </Stagger>
      {map ? (
        <div className="mt-4">
          <CourtGrid date={to} courts={map.courts} slots={map.slots} />
        </div>
      ) : (
        <Skeleton className="mt-4 h-64" />
      )}
    </Shell>
  );
}
