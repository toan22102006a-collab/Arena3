import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, DateField, Field, Input, Select, Skeleton, Textarea } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { SplitText } from "@/components/fx";
import { hhmm } from "@/components/shell";
import { sessionDay } from "@/components/class-detail";
import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/arena3/client";
import { addDaysISO, formatDate } from "@/lib/arena3/labels";

type Msg = (e: unknown) => string;
const say: Msg = (e) => (e instanceof Error ? e.message : "Something went wrong");

export type TrainingSession = {
  id: string;
  class_id: string;
  start_at: string;
  sport: string;
  level: string;
  status: string;
};

const METRICS = [
  { key: "smash_count", label: "Smashes", hint: "count" },
  { key: "freethrow_pct", label: "Free throws %", hint: "0–100" },
  { key: "serve_pct", label: "Serves in %", hint: "0–100" },
] as const;

const PHASES = ["warm-up", "technique", "fitness", "match", "cool-down"] as const;

/* ------------------------------------------------------------------ *
 * Results — plan completion and numbers per student (FR-TRN-05)        *
 * ------------------------------------------------------------------ */

type ResultRow = {
  user_id: string;
  full_name: string;
  member_code: string | null;
  attendance: string | null;
  plan_pct: number | null;
  metrics: Record<string, number> | null;
  note: string | null;
};

type Draft = { pct: string; note: string } & Record<string, string>;

function toDraft(r: ResultRow): Draft {
  const d: Draft = { pct: r.plan_pct == null ? "" : String(r.plan_pct), note: r.note ?? "" };
  for (const m of METRICS) d[m.key] = r.metrics?.[m.key] == null ? "" : String(r.metrics[m.key]);
  return d;
}

export function ResultsPanel({ sessionId, cancelled }: { sessionId: string; cancelled: boolean }) {
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ items: ResultRow[] }>(`/sessions/${sessionId}/results`);
      setRows(r.items);
      setDraft(Object.fromEntries(r.items.map((x) => [x.user_id, toDraft(x)])));
    } catch (e) {
      toast.error(say(e));
      setRows([]);
    }
  }, [sessionId]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const items = (rows ?? []).map((r) => {
        const d = draft[r.user_id]!;
        const metrics: Record<string, number> = {};
        for (const m of METRICS) if (d[m.key] !== "") metrics[m.key] = Number(d[m.key]);
        return {
          user_id: r.user_id,
          plan_pct: d.pct === "" ? null : Number(d.pct),
          metrics,
          note: d.note,
        };
      });
      const res = await apiPut<{ items: ResultRow[] }>(`/sessions/${sessionId}/results`, { items });
      setRows(res.items);
      setDraft(Object.fromEntries(res.items.map((x) => [x.user_id, toDraft(x)])));
      toast.success("Results saved");
    } catch (e) {
      toast.error(say(e));
    } finally {
      setSaving(false);
    }
  }

  const set = (id: string, k: string, v: string) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id]!, [k]: v } as Draft }));

  return (
    <div className="mt-10">
      <SplitText as="h2" text="Results" className="font-display text-2xl" />
      <p className="mt-1 text-sm text-muted">
        How much of the plan each student got through, and any numbers worth tracking. Leave a row blank to record nothing.
      </p>
      {!rows ? (
        <Skeleton className="mt-3 h-24" />
      ) : cancelled ? (
        <p className="mt-3 text-sm text-muted">This session was cancelled, so there is nothing to record.</p>
      ) : !rows.length ? (
        <p className="mt-3 text-sm text-muted">Nobody is enrolled in this class yet.</p>
      ) : (
        <>
          <div className="mt-3 grid gap-2">
            {rows.map((r) => {
              const d = draft[r.user_id];
              if (!d) return null;
              return (
                <Card key={r.user_id} className="grid gap-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {r.full_name} <span className="text-xs text-muted">{r.member_code}</span>
                    </p>
                    {r.attendance ? <Badge tone={r.attendance === "absent" ? "danger" : "muted"}>{r.attendance}</Badge> : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <Field label="Plan done %">
                      <Input
                        inputMode="numeric"
                        placeholder="0–100"
                        value={d.pct}
                        onChange={(e) => set(r.user_id, "pct", e.target.value)}
                      />
                    </Field>
                    {METRICS.map((m) => (
                      <Field key={m.key} label={m.label}>
                        <Input
                          inputMode="numeric"
                          placeholder={m.hint}
                          value={d[m.key]}
                          onChange={(e) => set(r.user_id, m.key, e.target.value)}
                        />
                      </Field>
                    ))}
                  </div>
                  <Field label="Note">
                    <Input
                      maxLength={1000}
                      placeholder="What stood out today"
                      value={d.note}
                      onChange={(e) => set(r.user_id, "note", e.target.value)}
                    />
                  </Field>
                </Card>
              );
            })}
          </div>
          <Button className="mt-4" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save results"}
          </Button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Plans — build, publish, copy last week (FR-TRN-04)                   *
 * ------------------------------------------------------------------ */

type Block = { title: string; minutes: string; phase: string };
type PlanRow = {
  id: string;
  title: string | null;
  published: boolean;
  source: string;
  session_id: string | null;
  session_start: string | null;
  payload: { blocks?: Array<{ title: string; minutes: number; phase?: string }>; note?: string };
};

const blank = (): Block => ({ title: "", minutes: "10", phase: "" });

/** Monday of the week before the one holding `iso` (the centre's calendar). */
function lastWeekMonday(iso: string) {
  const day = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return addDaysISO(day, -((dow + 6) % 7) - 7);
}

export function PlanPanel({ session, f5 }: { session: TrainingSession; f5: boolean }) {
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([blank()]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [focus, setFocus] = useState("core technique");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ items: PlanRow[] }>(`/training-plans?class_id=${session.class_id}`);
      setPlans(r.items);
    } catch (e) {
      toast.error(say(e));
      setPlans([]);
    }
  }, [session.class_id]);

  useEffect(() => {
    setPlans(null);
    void load();
  }, [load]);

  async function suggest() {
    try {
      const r = await apiPost<{ payload: { blocks?: Array<{ title: string; minutes: number }> } }>(
        "/training-plans/suggest",
        { sport: session.sport, level: session.level, goal: focus },
      );
      // The suggestion writes its length into the title ("Net shots 10′"); the minutes box already says it.
      const next = (r.payload.blocks ?? []).map((b) => ({
        title: b.title.replace(/\s*\d+\s*[′']$/, ""),
        minutes: String(b.minutes),
        phase: "",
      }));
      if (next.length) setBlocks(next);
      toast.success("Suggestion added. Edit anything before you publish.");
    } catch (e) {
      toast.error(say(e));
    }
  }

  async function submit(published: boolean) {
    setBusy(true);
    try {
      await apiPost("/training-plans", {
        class_id: session.class_id,
        session_id: session.id,
        title,
        published,
        source: "coach",
        payload: {
          goal: title || focus,
          note,
          blocks: blocks.map((b) => ({
            title: b.title,
            minutes: Number(b.minutes),
            ...(b.phase ? { phase: b.phase } : {}),
          })),
        },
      });
      toast.success(published ? "Plan published to the class" : "Draft saved");
      setBlocks([blank()]);
      setTitle("");
      setNote("");
      await load();
    } catch (e) {
      toast.error(say(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(p: PlanRow) {
    try {
      await apiPatch(`/training-plans/${p.id}`, { published: !p.published });
      setPlans((l) => l?.map((x) => (x.id === p.id ? { ...x, published: !p.published } : x)) ?? l);
    } catch (e) {
      toast.error(say(e));
    }
  }

  async function copyLastWeek() {
    try {
      const r = await apiPost<{ copied: number; skipped: unknown[] }>(
        `/classes/${session.class_id}/plans/duplicate-week`,
        { from: lastWeekMonday(session.start_at) },
      );
      toast.success(
        r.copied
          ? `Copied ${r.copied} plan${r.copied === 1 ? "" : "s"} as drafts${r.skipped.length ? `, skipped ${r.skipped.length}` : ""}.`
          : r.skipped.length
            ? `Nothing copied — ${r.skipped.length} session${r.skipped.length === 1 ? "" : "s"} already planned, past or missing.`
            : "Last week had no plans to copy.",
      );
      await load();
    } catch (e) {
      toast.error(say(e));
    }
  }

  const setBlock = (i: number, patch: Partial<Block>) =>
    setBlocks((l) => l.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <div className="mt-10">
      <SplitText as="h2" text="Session plan" className="font-display text-2xl" />
      <p className="mt-1 text-sm text-muted">
        Plan this session block by block. {f5 ? "The AI only suggests — you decide what students see. " : ""}
        Published plans appear under My progress for everyone in the class.
      </p>
      <Reveal>
        <Card className="mt-3 grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Title">
              <Input maxLength={120} placeholder="Footwork and net play" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            {f5 ? (
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <Field label="Focus">
                  <Select value={focus} onChange={(e) => setFocus(e.target.value)}>
                    <option value="core technique">Core technique</option>
                    <option value="conditioning">Conditioning</option>
                    <option value="match play">Match play</option>
                  </Select>
                </Field>
                <Button variant="outline" onClick={suggest}>
                  Suggest
                </Button>
              </div>
            ) : null}
          </div>

          <div className="grid gap-2">
            {blocks.map((b, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem] gap-2 md:grid-cols-[1fr_8rem_5rem_auto]">
                <Input
                  aria-label={`Block ${i + 1} title`}
                  maxLength={120}
                  placeholder={`Block ${i + 1}`}
                  value={b.title}
                  onChange={(e) => setBlock(i, { title: e.target.value })}
                />
                <Input
                  aria-label={`Block ${i + 1} minutes`}
                  inputMode="numeric"
                  className="md:order-3"
                  value={b.minutes}
                  onChange={(e) => setBlock(i, { minutes: e.target.value })}
                />
                <Select
                  aria-label={`Block ${i + 1} phase`}
                  className="md:order-2"
                  value={b.phase}
                  onChange={(e) => setBlock(i, { phase: e.target.value })}
                >
                  <option value="">Phase</option>
                  {PHASES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="md:order-4"
                  disabled={blocks.length === 1}
                  onClick={() => setBlocks((l) => l.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div>
              <Button variant="outline" size="sm" disabled={blocks.length >= 12} onClick={() => setBlocks((l) => [...l, blank()])}>
                Add block
              </Button>
            </div>
          </div>

          <Field label="Note for students">
            <Input maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || session.status === "cancelled"} onClick={() => submit(true)}>
              Publish to the class
            </Button>
            <Button variant="outline" disabled={busy || session.status === "cancelled"} onClick={() => submit(false)}>
              Save as draft
            </Button>
            <Button variant="ghost" onClick={copyLastWeek}>
              Copy plans from last week
            </Button>
          </div>
        </Card>
      </Reveal>

      <div className="mt-4 grid gap-2">
        {!plans ? (
          <Skeleton className="h-16" />
        ) : !plans.length ? (
          <EmptyState title="No plans for this class yet" hint="Build one above, or copy last week's." />
        ) : (
          plans.map((p) => (
            <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium">{p.title || (p.payload.blocks?.[0]?.title ?? "Plan")}</p>
                <p className="text-xs text-muted">
                  {p.session_start ? `${sessionDay(p.session_start)} · ${hhmm(p.session_start)}` : "Whole class"} ·{" "}
                  {(p.payload.blocks ?? []).length} blocks
                  {p.source === "ai" ? " · AI draft" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={p.published ? "accent" : "muted"}>{p.published ? "Published" : "Draft"}</Badge>
                <Button size="sm" variant="outline" onClick={() => toggle(p)}>
                  {p.published ? "Unpublish" : "Publish"}
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Homework (FR-TRN-07)                                                 *
 * ------------------------------------------------------------------ */

type HwRow = {
  id: string;
  title: string;
  due_on: string | null;
  checklist: string[];
  recipients: number;
  completed: number;
  student_name: string | null;
};

export function HomeworkPanel({ classId }: { classId: string }) {
  const [items, setItems] = useState<HwRow[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [lines, setLines] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ items: HwRow[] }>(`/homework?class_id=${classId}`);
      setItems(r.items);
    } catch (e) {
      toast.error(say(e));
      setItems([]);
    }
  }, [classId]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  async function assign() {
    setBusy(true);
    try {
      const r = await apiPost<{ recipients: number }>("/homework", {
        class_id: classId,
        title,
        body,
        due_on: due || null,
        checklist: lines
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      });
      toast.success(`Homework sent to ${r.recipients} student${r.recipients === 1 ? "" : "s"}`);
      setTitle("");
      setBody("");
      setLines("");
      setDue("");
      await load();
    } catch (e) {
      toast.error(say(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10">
      <SplitText as="h2" text="Homework" className="font-display text-2xl" />
      <p className="mt-1 text-sm text-muted">Something to practise before the next class. Students tick items off as they go.</p>
      <Card className="mt-3 grid gap-3">
        <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
          <Field label="Title">
            <Input maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Due">
            <DateField aria-label="Due date" value={due} onChange={setDue} />
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={2} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Field label="Checklist" hint="One item per line, up to 20." tone="muted">
          <Textarea rows={3} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={"50 wall shots\n10 minutes of footwork"} />
        </Field>
        <div>
          <Button onClick={assign} disabled={busy || !title.trim()}>
            Assign to the class
          </Button>
        </div>
      </Card>
      <div className="mt-3 grid gap-2">
        {!items ? (
          <Skeleton className="h-16" />
        ) : (
          items.map((h) => (
            <Card key={h.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{h.title}</p>
                <p className="text-xs text-muted">
                  {h.due_on ? `Due ${formatDate(h.due_on)}` : "No due date"} · {h.checklist.length} item
                  {h.checklist.length === 1 ? "" : "s"}
                </p>
              </div>
              <Badge tone={h.completed === h.recipients ? "accent" : "muted"}>
                {h.completed}/{h.recipients} done
              </Badge>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
