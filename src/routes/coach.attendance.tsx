import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { sessionDay } from "@/components/class-detail";
import { HomeworkPanel, PlanPanel, ResultsPanel } from "@/components/coach-training";
import { Shell, hhmm, useSessionUser } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Field, Input, Select, Skeleton } from "@/components/ui";
import { Stagger, StaggerItem, motion } from "@/components/motion";
import { SplitText } from "@/components/fx";
import { apiGet, apiPost } from "@/lib/arena3/client";
import { levelLabel } from "@/lib/arena3/labels";
import type { CoachSession } from "./coach.index";

export const Route = createFileRoute("/coach/attendance")({
  validateSearch: (search: Record<string, unknown>): { session?: string } => ({
    session: typeof search.session === "string" ? search.session : undefined,
  }),
  component: Page,
});

type SessionRow = CoachSession;

type AttRow = {
  id: string;
  full_name: string;
  member_code: string | null;
  health_notes: string | null;
  result: string | null;
};

type AttMeta = { locked: boolean; lock_at: string | null; status: string };

const RESULTS = [
  { v: "present", l: "Present" },
  { v: "late", l: "Late" },
  { v: "absent", l: "Absent" },
  { v: "excused", l: "Excused" },
];

function Page() {
  const { session: sessionParam } = Route.useSearch();
  const navigate = useNavigate();
  const user = useSessionUser();
  const [items, setItems] = useState<SessionRow[] | null>(null);
  const [att, setAtt] = useState<AttRow[]>([]);
  const [meta, setMeta] = useState<AttMeta | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState<SessionRow | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [flagsReady, setFlagsReady] = useState(false);

  useEffect(() => {
    void apiGet<{ items: SessionRow[] }>("/coach/schedule")
      .then((r) => setItems(r.items))
      .catch((e) => toast.error(e.message));
    void apiGet<{ flags: Record<string, boolean> }>("/flags")
      .then((r) => setFlags(r.flags))
      .catch(() => undefined)
      .finally(() => setFlagsReady(true));
  }, []);

  // The session in the address bar (from a schedule card) is the one whose
  // register is on screen; with none chosen, the next one to come.
  useEffect(() => {
    if (!items?.length || !flagsReady) return;
    const next =
      items.find((s) => s.id === sessionParam) ?? items.find((s) => s.status === "scheduled") ?? items[0]!;
    if (next.id !== open?.id) void openSession(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sessionParam, flagsReady]);

  async function openSession(s: SessionRow) {
    setOpen(s);
    setReason("");
    setMeta(null);
    try {
      if (flags.F4 !== false) {
        const r = await apiGet<{ items: AttRow[]; session: AttMeta }>(`/sessions/${s.id}/attendance`);
        setAtt(r.items);
        setMeta(r.session);
        setMarks(Object.fromEntries(r.items.map((u) => [u.id, u.result ?? "present"])));
      } else {
        const r = await apiGet<{ items: AttRow[] }>(`/classes/${s.class_id}/roster`);
        setAtt(r.items);
        setMarks({});
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  const f4 = flags.F4 !== false;
  const isManager = user?.role === "manager";
  // After the lock only a manager may correct a register, and must say why (BR-53).
  const locked = !!meta?.locked;
  const blocked = locked && !isManager;

  async function saveRegister() {
    if (!open) return;
    try {
      await apiPost(`/sessions/${open.id}/attendance`, {
        items: Object.entries(marks).map(([user_id, result]) => ({ user_id, result })),
        ...(locked ? { reason } : {}),
      });
      toast.success(locked ? "Register corrected" : "Register saved");
      setReason("");
      await openSession(open);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Attendance is switched off (flag F4)");
    }
  }

  return (
    <Shell role="coach" title="Attendance" subtitle="Pick a session, mark who came, then plan the next one.">
      {!items ? (
        <Skeleton className="h-24" />
      ) : !items.length ? (
        <EmptyState title="No sessions to take a register for" hint="Sessions appear here once a class you teach is published." />
      ) : (
        <Card className="grid gap-3 md:grid-cols-2">
          <Field label="Session">
            <Select
              value={open?.id ?? ""}
              onChange={(e) => void navigate({ to: "/coach/attendance", search: { session: e.target.value } })}
            >
              {items.map((s) => (
                <option key={s.id} value={s.id}>
                  {sessionDay(s.start_at)} · {hhmm(s.start_at)} · {s.class_code} · {s.court_code}
                </option>
              ))}
            </Select>
          </Field>
          {open ? (
            <p className="self-end text-sm text-muted">
              {levelLabel(open.level)} · {open.enrolled_count}/{open.capacity} students
            </p>
          ) : null}
        </Card>
      )}
      {open && att.length ? (
        <div className="mt-8">
          <div className="flex flex-wrap items-center gap-3">
            <SplitText as="h2" text={`Register · ${levelLabel(open.level)}`} className="font-display text-2xl" />
            {locked ? <Badge tone="hold">Locked</Badge> : null}
          </div>
          {locked ? (
            <p className="mt-1 text-sm text-muted">
              This register closed {meta?.lock_at ? `${sessionDay(meta.lock_at)} at ${hhmm(meta.lock_at)}` : "after the session"}.{" "}
              {isManager ? "You can still correct it — say why below." : "Ask a manager to correct it."}
            </p>
          ) : null}
          <Stagger className="mt-3 grid gap-2" gap={0.04}>
            {att.map((u) => (
              <StaggerItem key={u.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">
                    {f4 ? (
                      <Link
                        to="/coach/student/$id"
                        params={{ id: u.id }}
                        className="underline-offset-4 hover:underline"
                      >
                        {u.full_name}
                      </Link>
                    ) : (
                      u.full_name
                    )}
                  </p>
                  <p className="text-xs text-muted">{u.member_code}</p>
                  {u.health_notes ? (
                    <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-danger">{u.health_notes}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {RESULTS.map((r) => (
                    <button
                      key={r.v}
                      type="button"
                      disabled={blocked}
                      onClick={() => setMarks((m) => ({ ...m, [u.id]: r.v }))}
                      className={`relative min-h-9 rounded-[var(--radius-sm)] px-2 text-xs font-medium transition-colors duration-200 active:scale-95 disabled:opacity-60 ${
                        marks[u.id] === r.v ? "text-bg" : "bg-wood text-muted hover:bg-wood/70"
                      }`}
                    >
                      {marks[u.id] === r.v ? (
                        <motion.span
                          layoutId={`att-${u.id}`}
                          className="absolute inset-0 rounded-[var(--radius-sm)] bg-fg"
                          transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        />
                      ) : null}
                      <span className="relative">{r.l}</span>
                    </button>
                  ))}
                </div>
              </Card>
              </StaggerItem>
            ))}
          </Stagger>
          {locked && isManager ? (
            <div className="mt-3 max-w-md">
              <Field label="Reason for the correction">
                <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
          ) : null}
          <Button
            className="mt-4"
            disabled={blocked || (locked && reason.trim().length < 3) || meta?.status === "cancelled"}
            onClick={saveRegister}
          >
            {locked ? "Save correction" : "Save register"}
          </Button>
        </div>
      ) : null}

      {open && !att.length ? (
        <p className="mt-6 text-sm text-muted">Nobody is enrolled in this session yet, so there is no register to take.</p>
      ) : null}

      {open && f4 ? <ResultsPanel sessionId={open.id} cancelled={open.status === "cancelled"} /> : null}
      {open && f4 ? <PlanPanel session={open} f5={flags.F5 !== false} /> : null}
      {open && f4 ? <HomeworkPanel classId={open.class_id} /> : null}
    </Shell>
  );
}
