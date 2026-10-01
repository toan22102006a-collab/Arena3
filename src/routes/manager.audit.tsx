import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Input, Skeleton } from "@/components/ui";
import { Stagger, StaggerItem } from "@/components/motion";
import { SplitText } from "@/components/fx";
import { ApiClientError, apiGet } from "@/lib/arena3/client";

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
  before?: unknown;
  after?: unknown;
};

type Actor = { id: string; full_name: string; role: string };
type AuditPage = { items: Entry[]; more: boolean; actions: string[]; entities: string[]; actors: Actor[] };

const PAGE_SIZE = 50;
const HIDDEN_KEY = "arena3.audit.hidden";
const selectCls = "h-10 rounded-[var(--radius-sm)] border border-line bg-surface px-3 text-sm";

function readHidden(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function detail(v: unknown): string | null {
  if (v == null) return null;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return null;
  }
}

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
  if (/refund|delete|reject|decline|cancel|lock|revoke/.test(action)) return "danger";
  if (/price|setting|flag|close_shift|freeze|plan|password|role|staff/.test(action)) return "hold";
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
  const [data, setData] = useState<AuditPage | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [hidden, setHidden] = useState<number[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The pickers keep the full set once known, so filtering to one value does
  // not collapse its own menu down to that value.
  const [choices, setChoices] = useState<{ actions: string[]; entities: string[]; actors: Actor[] }>({
    actions: [],
    entities: [],
    actors: [],
  });

  useEffect(() => setHidden(readHidden()), []);

  useEffect(() => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (action) qs.set("action", action);
    if (actor) qs.set("actor", actor);
    if (entity) qs.set("entity", entity);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    setError(null);
    void apiGet<AuditPage>(`/audit?${qs}`)
      .then((r) => {
        // A bigserial can arrive as a string; the hidden list compares numbers.
        setData({ ...r, items: r.items.map((e) => ({ ...e, id: Number(e.id) })) });
        if (!action && !actor && !entity) {
          setChoices({ actions: r.actions ?? [], entities: r.entities ?? [], actors: r.actors ?? [] });
        }
      })
      .catch((e) => {
        setData({ items: [], more: false, actions: [], entities: [], actors: [] });
        if (e instanceof ApiClientError && e.body.field) setError(e.message);
        else toast.error(e instanceof Error ? e.message : "Could not load the audit log");
      });
  }, [action, actor, entity, from, to, limit]);

  function pick(set: (v: string) => void) {
    return (v: string) => {
      setData(null);
      setLimit(PAGE_SIZE);
      setOpen(null);
      set(v);
    };
  }

  // Hiding only tucks a row out of this screen. The log is append-only and
  // nothing here removes an entry from it.
  function hide(id: number) {
    const next = [...new Set([...hidden, id])];
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    } catch {
      // Hidden for this visit is still fine when storage is unavailable.
    }
  }
  function restoreAll() {
    setHidden([]);
    setShowHidden(false);
    try {
      localStorage.removeItem(HIDDEN_KEY);
    } catch {
      // Nothing to clean up.
    }
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.items ?? []).filter((e) => {
      if (!showHidden && hidden.includes(e.id)) return false;
      if (!needle) return true;
      return `${e.actor_name ?? ""} ${e.action} ${e.entity} ${e.entity_id ?? ""}`.toLowerCase().includes(needle);
    });
  }, [data, q, hidden, showHidden]);

  const hiddenHere = (data?.items ?? []).filter((e) => hidden.includes(e.id)).length;
  const filtered = !!(q || action || actor || entity || from || to);

  return (
    <Shell
      role="manager"
      title="Audit"
      subtitle="Who changed what, newest first. Hiding an entry only tidies this screen; the log itself is never edited."
    >
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <select
          value={action}
          onChange={(e) => pick(setAction)(e.target.value)}
          className={selectCls}
          aria-label="Filter by action"
        >
          <option value="">All actions</option>
          {choices.actions.map((a) => (
            <option key={a} value={a}>
              {actionLabel(a)}
            </option>
          ))}
        </select>
        <select
          value={actor}
          onChange={(e) => pick(setActor)(e.target.value)}
          className={selectCls}
          aria-label="Filter by person"
        >
          <option value="">Anyone</option>
          {choices.actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name} · {a.role}
            </option>
          ))}
        </select>
        <select
          value={entity}
          onChange={(e) => pick(setEntity)(e.target.value)}
          className={selectCls}
          aria-label="Filter by what was changed"
        >
          <option value="">Anything</option>
          {choices.entities.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <label className="grid gap-0.5 text-2xs uppercase tracking-wider text-muted">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => pick(setFrom)(e.target.value)}
            className={selectCls}
          />
        </label>
        <label className="grid gap-0.5 text-2xs uppercase tracking-wider text-muted">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => pick(setTo)(e.target.value)}
            className={selectCls}
          />
        </label>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search this list"
          aria-label="Search the log"
          className="max-w-[12rem]"
        />
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setData(null);
              setLimit(PAGE_SIZE);
              setAction("");
              setActor("");
              setEntity("");
              setFrom("");
              setTo("");
              setQ("");
            }}
          >
            Clear filters
          </Button>
        ) : null}
        <span className="ml-auto text-2xs uppercase tracking-wider text-muted">
          {data ? `${rows.length} shown` : "Loading"}
        </span>
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {hiddenHere ? (
        <p className="mb-3 text-xs text-muted">
          {hiddenHere} hidden on this screen.{" "}
          <button type="button" className="underline" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? "Hide them again" : "Show them"}
          </button>
          {" · "}
          <button type="button" className="underline" onClick={restoreAll}>
            Restore all
          </button>
        </p>
      ) : null}

      <SplitText as="h2" text="Activity" className="mb-3 font-display text-2xl" />

      {!data ? (
        <div className="grid gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : rows.length ? (
        <Stagger className="grid gap-1.5" gap={0.02}>
          {rows.map((e) => {
            const isOpen = open === e.id;
            const before = isOpen ? detail(e.before) : null;
            const after = isOpen ? detail(e.after) : null;
            return (
              <StaggerItem key={e.id}>
                <Card className={`p-0 ${hidden.includes(e.id) ? "opacity-60" : ""}`}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : e.id)}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left"
                  >
                    <Badge tone={toneFor(e.action)}>{actionLabel(e.action)}</Badge>
                    <span className="text-sm font-medium">{e.actor_name ?? "System"}</span>
                    {e.actor_role ? (
                      <span className="text-2xs uppercase tracking-wider text-muted">{e.actor_role}</span>
                    ) : null}
                    <span className="text-sm text-muted">
                      {e.entity}
                      {e.entity_id ? <span className="tabular-nums"> · {e.entity_id.slice(0, 8)}</span> : null}
                    </span>
                    <span className="ml-auto text-xs tabular-nums text-muted">{when(e.at)}</span>
                  </button>
                  {isOpen ? (
                    <div className="grid gap-2 border-t border-line px-3 py-2 text-xs">
                      {before || after ? (
                        <div className="grid gap-2 md:grid-cols-2">
                          {before ? (
                            <div>
                              <p className="mb-1 uppercase tracking-wider text-muted">Before</p>
                              <pre className="max-h-48 overflow-auto rounded-[var(--radius-sm)] bg-wood p-2">{before}</pre>
                            </div>
                          ) : null}
                          {after ? (
                            <div>
                              <p className="mb-1 uppercase tracking-wider text-muted">After</p>
                              <pre className="max-h-48 overflow-auto rounded-[var(--radius-sm)] bg-wood p-2">{after}</pre>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-muted">No before/after was recorded for this entry.</p>
                      )}
                      {!hidden.includes(e.id) ? (
                        <div>
                          <Button size="sm" variant="ghost" onClick={() => hide(e.id)}>
                            Hide from this screen
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      ) : (
        <EmptyState
          title={filtered ? "Nothing matches that" : "Nothing recorded yet"}
          hint={
            filtered
              ? "Clear the filters, or widen the dates."
              : "Entries appear here as staff take payments, change prices and refund."
          }
        />
      )}
      {data?.more ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={() => setLimit((n) => Math.min(n + PAGE_SIZE, 200))}
            disabled={limit >= 200}
          >
            {limit >= 200 ? "Narrow the filters to see older entries" : "Show more"}
          </Button>
        </div>
      ) : null}
    </Shell>
  );
}
