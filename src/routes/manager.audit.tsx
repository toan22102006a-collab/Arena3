import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Badge, Card, Empty, Input, Skeleton } from "@/components/ui";
import { Stagger, StaggerItem } from "@/components/motion";
import { SplitText } from "@/components/fx";
import { apiGet } from "@/lib/arena3/client";

export const Route = createFileRoute("/manager/audit")({
  component: Page,
});

type Entry = {
  id: number;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
};

/**
 * Turn `approve_refund` into `Approve refund`.
 *
 * The action names are written for the handlers that record them, and there is
 * no point maintaining a second hand-written map that drifts every time
 * somebody audits a new thing.
 */
function actionLabel(a: string): string {
  const words = a.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Which actions deserve to catch the eye.
 *
 * A log where everything is the same weight is a log nobody scans. Money
 * leaving the centre and changes to what it charges are the two things a
 * manager is reading this page to find.
 */
function toneFor(action: string): "danger" | "hold" | "muted" {
  if (/refund|delete|reject|decline|cancel/.test(action)) return "danger";
  if (/price|setting|flag|close_shift|freeze/.test(action)) return "hold";
  return "muted";
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

function Page() {
  const [items, setItems] = useState<Entry[] | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    void apiGet<{ items: Entry[]; actions: string[] }>(
      `/audit${action ? `?action=${encodeURIComponent(action)}` : ""}`,
    )
      .then((r) => {
        setItems(r.items);
        // Keep the full list once it is known: filtering to one action would
        // otherwise collapse the picker to that single option.
        if (!action) setActions(r.actions ?? []);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load the audit log"));
  }, [action]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items ?? [];
    return (items ?? []).filter((e) =>
      `${e.actor_name ?? ""} ${e.action} ${e.entity} ${e.entity_id ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [items, q]);

  return (
    <Shell
      role="manager"
      title="Audit"
      subtitle="Who changed what, newest first. The 200 most recent entries."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="grid gap-1.5">
          <span className="sr-only">Filter by action</span>
          <select
            value={action}
            onChange={(e) => {
              setItems(null);
              setAction(e.target.value);
            }}
            className="h-11 rounded-[var(--radius-sm)] border border-line bg-surface px-3 text-sm"
            aria-label="Filter by action"
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
        </label>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Person, entity or id"
          aria-label="Search the log"
          className="max-w-xs"
        />
        <span className="ml-auto text-2xs uppercase tracking-wider text-muted">
          {items ? `${shown.length} shown` : "Loading"}
        </span>
      </div>

      <SplitText as="h2" text="Activity" className="mb-3 font-display text-2xl" />

      {!items ? (
        <div className="grid gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : shown.length ? (
        <Stagger className="grid gap-2" gap={0.03}>
          {shown.map((e) => (
            <StaggerItem key={e.id}>
              <Card className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <Badge tone={toneFor(e.action)}>{actionLabel(e.action)}</Badge>
                <span className="text-sm font-medium">{e.actor_name ?? "System"}</span>
                {e.actor_role ? (
                  <span className="text-2xs uppercase tracking-wider text-muted">{e.actor_role}</span>
                ) : null}
                <span className="text-sm text-muted">
                  {e.entity}
                  {e.entity_id ? (
                    // Enough of the id to match against a booking or payment in
                    // another screen, without a full UUID eating the row.
                    <span className="tabular-nums"> · {e.entity_id.slice(0, 8)}</span>
                  ) : null}
                </span>
                <span className="ml-auto text-xs tabular-nums text-muted">{when(e.at)}</span>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      ) : (
        <Empty
          title={q || action ? "Nothing matches that" : "Nothing recorded yet"}
          hint={
            q || action
              ? "Clear the filter, or widen the search."
              : "Actions appear here as staff take payments, change prices and refund."
          }
        />
      )}
    </Shell>
  );
}
