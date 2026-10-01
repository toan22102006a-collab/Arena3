import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { money } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Select, Skeleton, Stat } from "@/components/ui";
import { apiGet, downloadReport } from "@/lib/arena3/client";
import { sportLabel } from "@/lib/arena3/labels";

type Kind = "revenue" | "capacity" | "members";

/** Excel and PDF of the report on screen, with the same filters it is showing. */
export function ExportButtons({
  kind,
  from,
  to,
  extra = {},
}: {
  kind: Kind;
  from: string;
  to: string;
  extra?: Record<string, string | null | undefined>;
}) {
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  async function go(format: "xlsx" | "pdf") {
    setBusy(format);
    try {
      const q = new URLSearchParams({ from, to, format });
      for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
      const name = await downloadReport(`/reports/${kind}/export?${q}`, `arena3-${kind}-${from}_${to}.${format}`);
      toast.success(`Saved ${name}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void go("xlsx")}>
        {busy === "xlsx" ? "Preparing…" : "Export Excel"}
      </Button>
      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void go("pdf")}>
        {busy === "pdf" ? "Preparing…" : "Export PDF"}
      </Button>
    </div>
  );
}

function useReport<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    apiGet<T>(path)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [path]);
  return { data, error };
}

const SPORTS = ["badminton", "basketball", "volleyball"];
const hours = (min: number) => Math.round((min / 60) * 10) / 10;
const pctText = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);

function SportSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="w-44">
      <Select aria-label="Sport" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All sports</option>
        {SPORTS.map((s) => (
          <option key={s} value={s}>
            {sportLabel(s)}
          </option>
        ))}
      </Select>
    </div>
  );
}

// ---- capacity -------------------------------------------------------------------

type Capacity = {
  open_hour: number;
  close_hour: number;
  totals: { sold_min: number; open_min: number; pct: number };
  by_sport: Array<{
    sport: string;
    sold_min: number;
    open_min: number;
    pct: number;
    peak_pct: number | null;
    offpeak_pct: number | null;
  }>;
  by_hour: Array<{ hour: number; pct: number }>;
  hours: number[];
  courts: Array<{ court_id: string; court_code: string; sport: string; pct: number; cells: number[] }>;
  revenue_by_source: { court_vnd: number; class_vnd: number };
};

function heat(pct: number): React.CSSProperties {
  return {
    background: `color-mix(in srgb, var(--color-accent) ${Math.round(Math.min(100, pct) * 0.9)}%, transparent)`,
    color: pct >= 55 ? "#fff" : undefined,
  };
}

export function CapacityPanel({ from, to }: { from: string; to: string }) {
  const [sport, setSport] = useState("");
  const q = new URLSearchParams({ from, to });
  if (sport) q.set("sport", sport);
  const { data, error } = useReport<Capacity>(`/reports/capacity?${q}`);

  return (
    <section className="mt-10" aria-labelledby="cap-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="cap-h" className="font-display text-2xl">
            Court capacity
          </h2>
          <p className="text-sm text-muted">
            Share of open hours that were sold, as bookings or class sessions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SportSelect value={sport} onChange={setSport} />
          <ExportButtons kind="capacity" from={from} to={to} extra={{ sport }} />
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : !data ? (
        <Skeleton className="mt-4 h-64" />
      ) : data.courts.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No courts to report on" hint="Courts that are ready for play show up here." />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Stat
              label="Hours sold"
              value={`${hours(data.totals.sold_min)} h`}
              hint={`of ${hours(data.totals.open_min)} h open`}
            />
            <Stat label="Used" value={`${data.totals.pct}%`} />
            <Stat
              label="Court rental vs classes"
              value={money(data.revenue_by_source.court_vnd)}
              hint={`Class fees ${money(data.revenue_by_source.class_vnd)}`}
            />
          </div>

          <Card className="mt-3 overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-2xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Sport</th>
                  <th className="px-3 py-2 text-right font-medium">Sold</th>
                  <th className="px-3 py-2 text-right font-medium">Used</th>
                  <th className="px-3 py-2 text-right font-medium">Peak</th>
                  <th className="px-4 py-2 text-right font-medium">Off-peak</th>
                </tr>
              </thead>
              <tbody>
                {data.by_sport.map((s) => (
                  <tr key={s.sport} className="border-t border-line/60">
                    <td className="px-4 py-2">{sportLabel(s.sport)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{hours(s.sold_min)} h</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.pct}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pctText(s.peak_pct)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{pctText(s.offpeak_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="mt-3 p-0">
            <p className="px-4 pt-4 text-2xs font-medium uppercase tracking-wider text-muted">
              Heatmap · used % by hour
            </p>
            <div className="overflow-x-auto px-2 pb-3 pt-2">
              <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-center text-xs">
                <thead className="text-2xs text-muted">
                  <tr>
                    <th className="sticky left-0 bg-surface px-2 py-1 text-left font-medium">Court</th>
                    {data.hours.map((h) => (
                      <th key={h} className="px-1 py-1 font-medium">
                        {String(h).padStart(2, "0")}h
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.courts.map((c) => (
                    <tr key={c.court_id}>
                      <th scope="row" className="sticky left-0 bg-surface px-2 py-1 text-left font-medium">
                        {c.court_code}
                      </th>
                      {c.cells.map((p, i) => (
                        <td
                          key={i}
                          className="rounded-[4px] px-1 py-1.5 tabular-nums"
                          style={heat(p)}
                          title={`${c.court_code} · ${String(data.hours[i]).padStart(2, "0")}:00 · ${p}%`}
                        >
                          {Math.round(p)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" className="sticky left-0 bg-surface px-2 py-1 text-left font-semibold">
                      All courts
                    </th>
                    {data.by_hour.map((h) => (
                      <td key={h.hour} className="px-1 py-1.5 font-semibold tabular-nums">
                        {Math.round(h.pct)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </section>
  );
}

// ---- members and class sign-ups -------------------------------------------------

type MembersReport = {
  members: {
    new: number;
    active: number;
    expiring: number;
    plans_ended: number;
    plans_renewed: number;
    renewal_rate: number | null;
  };
  trend: Array<{ month: string; new_members: number; plans_started: number }>;
  attendance_on: boolean;
  classes: Array<{
    id: string;
    code: string;
    sport: string;
    level: string;
    status: string;
    coach: string;
    capacity: number;
    enrolled: number;
    waitlisted: number;
    fill_pct: number;
    attendance_pct: number | null;
  }>;
};

export function MembersPanel({ from, to }: { from: string; to: string }) {
  const [sport, setSport] = useState("");
  const [chartReady, setChartReady] = useState(false);
  useEffect(() => setChartReady(true), []);
  const q = new URLSearchParams({ from, to });
  if (sport) q.set("sport", sport);
  const { data, error } = useReport<MembersReport>(`/reports/members?${q}`);
  const showAttendance = !!data?.attendance_on;

  return (
    <section className="mt-10" aria-labelledby="mem-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="mem-h" className="font-display text-2xl">
            Members and class sign-ups
          </h2>
          <p className="text-sm text-muted">New members, plan renewals and how full each class is.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SportSelect value={sport} onChange={setSport} />
          <ExportButtons kind="members" from={from} to={to} extra={{ sport }} />
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : !data ? (
        <Skeleton className="mt-4 h-64" />
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Stat label="New members" value={data.members.new} />
            <Stat label="Active plans" value={data.members.active} hint="members with a plan running" />
            <Stat label="Plans ending" value={data.members.expiring} hint="and not renewed yet" />
            <Stat
              label="Renewal rate"
              value={pctText(data.members.renewal_rate)}
              hint={`${data.members.plans_renewed} of ${data.members.plans_ended} ended plans`}
            />
          </div>

          <Card className="mt-3">
            <p className="text-2xs font-medium uppercase tracking-wider text-muted">Last 12 months</p>
            {chartReady ? (
              <div className="mt-3 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="2 4" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11 }}
                      stroke="var(--color-muted)"
                      tickLine={false}
                      tickFormatter={(m: string) => `${m.slice(5)}/${m.slice(2, 4)}`}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="var(--color-muted)"
                      tickLine={false}
                      axisLine={false}
                      width={32}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-line)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      cursor={{ fill: "var(--color-wood)", opacity: 0.5 }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="new_members" name="New members" fill="var(--color-accent)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                    <Bar dataKey="plans_started" name="Plans started" fill="var(--color-line-strong)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Skeleton className="mt-3 h-52" />
            )}
          </Card>

          <Card className="mt-3 overflow-x-auto p-0">
            <p className="px-4 pt-4 text-2xs font-medium uppercase tracking-wider text-muted">
              Classes running in this period
            </p>
            {data.classes.length === 0 ? (
              <p className="px-4 pb-4 pt-2 text-sm text-muted">No classes were running in this period.</p>
            ) : (
              <table className="mt-2 w-full min-w-[560px] text-sm">
                <thead className="text-left text-2xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Class</th>
                    <th className="px-3 py-2 font-medium">Coach</th>
                    <th className="px-3 py-2 text-right font-medium">Enrolled</th>
                    <th className="px-3 py-2 text-right font-medium">Waitlist</th>
                    <th className="px-3 py-2 text-right font-medium">Full</th>
                    {showAttendance ? <th className="px-4 py-2 text-right font-medium">Attendance</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.classes.map((c) => (
                    <tr key={c.id} className="border-t border-line/60">
                      <td className="px-4 py-2">
                        <span className="font-medium">{c.code}</span>
                        <span className="block text-xs text-muted">
                          {sportLabel(c.sport)} · {c.level}
                        </span>
                      </td>
                      <td className="px-3 py-2">{c.coach}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.enrolled}/{c.capacity}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.waitlisted}</td>
                      <td className="px-3 py-2 text-right">
                        <Badge tone={c.fill_pct >= 100 ? "accent" : c.fill_pct < 40 ? "hold" : "ink"}>
                          {c.fill_pct}%
                        </Badge>
                      </td>
                      {showAttendance ? (
                        <td className="px-4 py-2 text-right tabular-nums">{pctText(c.attendance_pct)}</td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </section>
  );
}
