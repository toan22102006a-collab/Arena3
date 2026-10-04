import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Badge, Card, EmptyState, FilterChip, Input, Pagination, Select, Skeleton, StatusBadge } from "@/components/ui";
import { apiGet } from "@/lib/arena3/client";
import { formatDate, sportLabel } from "@/lib/arena3/labels";
import { locale, t, tk, tServer } from "@/lib/i18n";

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
  classes: number;
};

const PAGE = 25;

const PLAN_LABEL: Record<Row["plan_state"], string> = {
  active: tk("Plan active"),
  expiring: tk("Ends within a week"),
  expired: tk("Plan expired"),
  none: tk("No plan"),
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
    const timer = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(timer);
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
      .catch((e) => live && toast.error(e instanceof Error ? tServer(e.message) : t("Could not load members")));
    return () => {
      live = false;
    };
  }, [term, status, sport, plan, offset]);

  const total = data?.total ?? 0;

  const PLAN_CHIPS: Array<{ value: string; label: string }> = [
    { value: "", label: t("Everyone") },
    { value: "active", label: t("Plan active") },
    { value: "expiring", label: t("Ends this week") },
    { value: "expired", label: t("Expired") },
    { value: "none", label: t("No plan") },
  ];

  return (
    <Shell role="manager" title={t("Members")} subtitle={t("Everyone with an account. Open a member for their plan, classes, balance and attendance.")}>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label={t("Plan state")}>
        {PLAN_CHIPS.map((c) => (
          <FilterChip key={c.value || "all"} active={plan === c.value} onClick={() => setPlan(c.value)} label={c.label} />
        ))}
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_10rem_10rem]">
        <Input
          placeholder={t("Name, phone or member code")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("Search members")}
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("Account status")}>
          <option value="">{t("Any status")}</option>
          <option value="active">{t("Active")}</option>
          <option value="locked">{t("Locked")}</option>
          <option value="disabled">{t("Disabled")}</option>
        </Select>
        <Select value={sport} onChange={(e) => setSport(e.target.value)} aria-label={t("Sport")}>
          <option value="">{t("Any sport")}</option>
          {["badminton", "basketball", "volleyball"].map((s) => (
            <option key={s} value={s}>
              {sportLabel(s)}
            </option>
          ))}
        </Select>
      </div>

      {!data ? (
        <Skeleton className="h-48" />
      ) : !data.items.length ? (
        <EmptyState title={t("No members match")} hint={t("Loosen a filter or check the spelling.")} />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted tabular-nums">
            {total === 1 ? t("1 member") : t("{n} members", { n: total.toLocaleString(locale()) })}
          </p>
          <Card className="overflow-hidden p-0">
            <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_minmax(0,1.4fr)_5rem] gap-4 border-b border-line bg-wood/50 px-4 py-2 text-xs font-medium text-muted md:grid">
              <span>{t("Member")}</span>
              <span>{t("Phone")}</span>
              <span>{t("Plan")}</span>
              <span className="text-right">{t("Classes")}</span>
            </div>
            <ul className="divide-y divide-line/70">
              {data.items.map((m) => (
                <li key={m.id}>
                  <Link
                    to="/desk/member/$id"
                    params={{ id: m.id }}
                    className="grid gap-x-4 gap-y-0.5 px-4 py-2.5 transition-colors duration-150 hover:bg-wood/60 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_minmax(0,1.4fr)_5rem] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="truncate">{m.full_name}</span>
                        {m.status !== "active" ? <StatusBadge status={m.status} /> : null}
                      </p>
                      <p className="text-xs tabular-nums text-muted">{m.member_code ?? "—"}</p>
                    </div>
                    <p className="text-sm tabular-nums text-muted">{m.phone}</p>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={m.plan_state === "active" ? "accent" : m.plan_state === "expiring" ? "hold" : "muted"}>
                        {t(PLAN_LABEL[m.plan_state])}
                      </Badge>
                      {m.plan_name ? (
                        <span className="truncate text-xs text-muted">
                          {m.plan_name}
                          {m.end_on ? ` · ${t("until {date}", { date: formatDate(m.end_on) })}` : ""}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm tabular-nums text-muted md:text-right">
                      {m.classes === 1 ? t("1 class") : t("{n} classes", { n: m.classes })}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Pagination offset={offset} total={total} pageSize={PAGE} onChange={setOffset} />
        </>
      )}
    </Shell>
  );
}
