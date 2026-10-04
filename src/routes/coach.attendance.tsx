import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Clock, FileCheck2, X } from "lucide-react";
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
import { t, tServer, tk } from "@/lib/i18n";
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

// Colour and icon say the answer before the word does: green tick, amber clock, red cross, grey note.
const RESULTS = [
  { v: "present", l: tk("Present"), Icon: Check, on: "bg-accent" },
  { v: "late", l: tk("Late"), Icon: Clock, on: "bg-hold" },
  { v: "absent", l: tk("Absent"), Icon: X, on: "bg-danger" },
  { v: "excused", l: tk("Excused"), Icon: FileCheck2, on: "bg-fg" },
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
      .catch((e) => toast.error(tServer(e.message)));
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
      toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
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
      toast.success(locked ? t("Register corrected") : t("Register saved"));
      setReason("");
      await openSession(open);
    } catch (e) {
      toast.error(e instanceof Error ? tServer(e.message) : t("Attendance is switched off (flag F4)"));
    }
  }

  return (
    <Shell role="coach" title={t("Attendance")} subtitle={t("Pick a session, mark who came, then plan the next one.")}>
      {!items ? (
        <Skeleton className="h-24" />
      ) : !items.length ? (
        <EmptyState
          title={t("No sessions to take a register for")}
          hint={t("Sessions appear here once a class you teach is published.")}
        />
      ) : (
        <Card className="grid gap-3 md:grid-cols-2">
          <Field label={t("Session")}>
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
              {t("{level} · {enrolled}/{capacity} students", {
                level: levelLabel(open.level),
                enrolled: open.enrolled_count,
                capacity: open.capacity,
              })}
            </p>
          ) : null}
        </Card>
      )}
      {open && att.length ? (
        <div className="mt-8">
          <div className="flex flex-wrap items-center gap-3">
            <SplitText as="h2" text={t("Register · {level}", { level: levelLabel(open.level) })} className="font-display text-2xl" />
            {locked ? <Badge tone="hold">{t("Locked")}</Badge> : null}
          </div>
          {locked ? (
            <p className="mt-1 text-sm text-muted">
              {meta?.lock_at
                ? t("This register closed {day} at {time}.", { day: sessionDay(meta.lock_at), time: hhmm(meta.lock_at) })
                : t("This register closed after the session.")}{" "}
              {isManager ? t("You can still correct it — say why below.") : t("Ask a manager to correct it.")}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="tabular-nums text-muted" aria-live="polite">
              {RESULTS.map((r) => `${t(r.l)} ${att.filter((u) => marks[u.id] === r.v).length}`).join(" · ")} · {t("of {n}", { n: att.length })}
            </p>
            {!blocked ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMarks(Object.fromEntries(att.map((u) => [u.id, "present"])))}
              >
                {t("Mark everyone present")}
              </Button>
            ) : null}
          </div>
          <Card className="mt-2 overflow-hidden p-0">
            <ul className="divide-y divide-line/70">
            {att.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5">
                <div className="min-w-0">
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
                    <p className="mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-danger">{u.health_notes}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {RESULTS.map((r) => (
                    <button
                      key={r.v}
                      type="button"
                      disabled={blocked}
                      aria-pressed={marks[u.id] === r.v}
                      onClick={() => setMarks((m) => ({ ...m, [u.id]: r.v }))}
                      className={`relative min-h-11 rounded-[var(--radius-sm)] px-3 text-xs font-medium transition-colors duration-200 active:scale-95 disabled:opacity-60 ${
                        marks[u.id] === r.v ? "text-bg" : "bg-wood text-muted hover:bg-wood/70"
                      }`}
                    >
                      {marks[u.id] === r.v ? (
                        <motion.span
                          layoutId={`att-${u.id}`}
                          className={`absolute inset-0 rounded-[var(--radius-sm)] ${r.on}`}
                          transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        />
                      ) : null}
                      <span className="relative inline-flex items-center gap-1">
                        <r.Icon aria-hidden className="size-3.5" />
                        {t(r.l)}
                      </span>
                    </button>
                  ))}
                </div>
              </li>
            ))}
            </ul>
          </Card>
          {locked && isManager ? (
            <div className="mt-3 max-w-md">
              <Field label={t("Reason for the correction")}>
                <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
          ) : null}
          <Button
            className="mt-4"
            disabled={blocked || (locked && reason.trim().length < 3) || meta?.status === "cancelled"}
            onClick={saveRegister}
          >
            {locked ? t("Save correction") : t("Save register")}
          </Button>
        </div>
      ) : null}

      {open && !att.length ? (
        <p className="mt-6 text-sm text-muted">
          {t("Nobody is enrolled in this session yet, so there is no register to take.")}
        </p>
      ) : null}

      {open && f4 ? <ResultsPanel sessionId={open.id} cancelled={open.status === "cancelled"} /> : null}
      {open && f4 ? <PlanPanel session={open} f5={flags.F5 !== false} /> : null}
      {open && f4 ? <HomeworkPanel classId={open.class_id} /> : null}
    </Shell>
  );
}
