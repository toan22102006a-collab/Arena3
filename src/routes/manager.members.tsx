import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell, money } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Input, Select, Skeleton, StatusBadge } from "@/components/ui";
import { apiGet } from "@/lib/arena3/client";
import { formatDate, sportLabel } from "@/lib/arena3/labels";

export const Route = createFileRoute("/manager/members")({
  component: Page,
});

type Row = {
  id: string;
  member_code: string | null;
  full_name: string;
  phone: string;
  status: string;
  plan_name: string | null;
  sport_scope: string | null;
  end_on: string | null;
  plan_state: "active" | "expiring" | "expired" | "none";
  debt_vnd: number;
  classes: number;
};

const PAGE = 25;

const PLAN_LABEL: Record<Row["plan_state"], string> = {
  active: "Plan active",
  expiring: "Ends within a week",
  expired: "Plan expired",
  none: "No plan",
};

/** FR-MEM-04: every member, filtered by who they are and where their plan stands. */
function Page() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sport, setSport] = useState("");
  const [plan, setPlan] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: Row[]; total: number } | null>(null);

  // Typing waits a beat so one search is one request, and any filter change goes back to page one.
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setOffset(0), [term, status, sport, plan]);

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (term) params.set("q", term);
    if (status) params.set("status", status);
    if (sport) params.set("sport", sport);
    if (plan) params.set("plan", plan);
    apiGet<{ items: Row[]; total: number }>(`/directory/members?${params}`)
      .then((r) => live && setData(r))
      .catch((e) => live && toast.error(e instanceof Error ? e.message : "Could not load members"));
    return () => {
      live = false;
    };
  }, [term, status, sport, plan, offset]);

  const total = data?.total ?? 0;
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + PAGE, total);

  return (
    <Shell role="manager" title="Members" subtitle="Everyone with an account. Open a member for their plan, classes, balance and attendance.">
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          placeholder="Name, phone or member code"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search members"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Account status">
          <option value="">Any account status</option>
          <option value="active">Active</option>
          <option value="locked">Locked</option>
          <option value="disabled">Disabled</option>
        </Select>
        <Select value={sport} onChange={(e) => setSport(e.target.value)} aria-label="Sport">
          <option value="">Any sport</option>
          {["badminton", "basketball", "volleyball"].map((s) => (
            <option key={s} value={s}>
              {sportLabel(s)}
            </option>
          ))}
        </Select>
        <Select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan state">
          <option value="">Any plan state</option>
          <option value="active">Plan active</option>
          <option value="expiring">Ends within a week</option>
          <option value="expired">Plan expired</option>
          <option value="none">No plan</option>
        </Select>
      </div>

      {!data ? (
        <Skeleton className="h-48" />
      ) : !data.items.length ? (
        <EmptyState title="No members match" hint="Loosen a filter or check the spelling." />
      ) : (
        <>
          <div className="grid gap-2">
            {data.items.map((m) => (
              <Card key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/desk/member/$id" params={{ id: m.id }} className="font-medium hover:underline">
                      {m.full_name}
                    </Link>
                    {m.status !== "active" ? <StatusBadge status={m.status} /> : null}
                  </div>
                  <p className="text-sm tabular-nums text-muted">
                    {m.member_code ?? "—"} · {m.phone}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={m.plan_state === "active" ? "accent" : m.plan_state === "expiring" ? "hold" : "muted"}>
                    {PLAN_LABEL[m.plan_state]}
                  </Badge>
                  {m.plan_name ? (
                    <span className="text-muted">
                      {m.plan_name}
                      {m.end_on ? ` · until ${formatDate(m.end_on)}` : ""}
                    </span>
                  ) : null}
                  <span className="text-muted">
                    {m.classes} class{m.classes === 1 ? "" : "es"}
                  </span>
                  {m.debt_vnd > 0 ? <Badge tone="danger">Owes {money(m.debt_vnd)}</Badge> : null}
                </div>
              </Card>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span className="tabular-nums">
              {from}–{to} of {total}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={to >= total} onClick={() => setOffset(offset + PAGE)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
