import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { sessionDay } from "@/components/class-detail";
import { Shell, hhmm } from "@/components/shell";
import { Badge, Card, EmptyState, Select, Skeleton } from "@/components/ui";
import { Lift, Stagger, StaggerItem, motion } from "@/components/motion";
import { SpotlightCard, SplitText } from "@/components/fx";
import { apiGet, apiPut } from "@/lib/arena3/client";
import { formatDate, levelLabel, sportLabel } from "@/lib/arena3/labels";

export const Route = createFileRoute("/app/train")({ component: Page });

const GOALS: Record<string, string> = {
  weight: "Lose weight",
  technique: "Improve technique",
  compete: "Compete",
  fun: "Have fun",
};
const METRIC_LABEL: Record<string, string> = {
  smash_count: "Smashes",
  freethrow_pct: "Free throws",
  serve_pct: "Serves in",
};

type PlanBlock = { title: string; minutes: number; phase?: string };
type Plan = {
  id: string;
  title: string | null;
  payload: { goal?: string; blocks?: PlanBlock[]; note?: string };
};

type Progress = {
  goal: string | null;
  levels: Array<{ sport: string; level: string }>;
  next_sessions: Array<{
    id: string;
    start_at: string;
    sport: string;
    level: string;
    court_code: string;
    plans: Plan[];
  }>;
  results: Array<{
    session_id: string;
    plan_pct: number | null;
    metrics: Record<string, number> | null;
    note: string | null;
    start_at: string;
    sport: string;
  }>;
  reviews: Array<{
    id: string;
    sport: string;
    period_weeks: number;
    technique: number;
    fitness: number;
    attitude: number;
    comment: string | null;
    created_at: string;
    coach_name: string;
  }>;
  homework: Array<{
    id: string;
    title: string;
    body: string | null;
    checklist: string[];
    due_on: string | null;
    done_items: number[];
  }>;
};

const say = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

function Page() {
  const [d, setD] = useState<Progress | null>(null);

  async function load() {
    try {
      setD(await apiGet<Progress>("/me/training"));
    } catch (e) {
      toast.error(say(e));
      setD({ goal: null, levels: [], next_sessions: [], results: [], reviews: [], homework: [] });
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function setGoal(goal: string) {
    try {
      await apiPut("/me/training-goal", { goal: goal || null });
      setD((x) => (x ? { ...x, goal: goal || null } : x));
      toast.success("Goal saved");
    } catch (e) {
      toast.error(say(e));
    }
  }

  async function tick(hw: Progress["homework"][number], index: number) {
    const done = hw.done_items.includes(index)
      ? hw.done_items.filter((i) => i !== index)
      : [...hw.done_items, index].sort((a, b) => a - b);
    // Show the tick at once; the server's answer says whether it finished the homework.
    setD((x) => x && { ...x, homework: x.homework.map((h) => (h.id === hw.id ? { ...h, done_items: done } : h)) });
    try {
      const r = await apiPut<{ completed: boolean }>(`/me/homework/${hw.id}`, { done_items: done });
      if (r.completed) {
        toast.success("Homework done — nice work");
        setTimeout(() => setD((x) => x && { ...x, homework: x.homework.filter((h) => h.id !== hw.id) }), 700);
      }
    } catch (e) {
      toast.error(say(e));
      await load();
    }
  }

  return (
    <Shell role="member" title="My progress" subtitle="Your plans, homework and what your coach has noticed. AI only suggests — a coach approves what reaches you.">
      {!d ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-10">
          <Card className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="kicker text-2xs text-muted">Your goal</p>
              <Select className="mt-1.5" aria-label="Your goal" value={d.goal ?? ""} onChange={(e) => void setGoal(e.target.value)}>
                <option value="">Not set</option>
                {Object.entries(GOALS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <p className="kicker text-2xs text-muted">Your level</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {d.levels.length ? (
                  d.levels.map((l) => (
                    <Badge key={l.sport} tone="accent">
                      {sportLabel(l.sport)} · {levelLabel(l.level)}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted">Your coach sets this after a few sessions.</span>
                )}
              </div>
            </div>
          </Card>

          <section>
            <SplitText as="h2" text="Up next" className="font-display text-2xl" />
            {d.next_sessions.length ? (
              <Stagger className="mt-3 grid gap-3 md:grid-cols-2" gap={0.07}>
                {d.next_sessions.map((s) => (
                  <StaggerItem key={s.id} className="h-full">
                    <Lift className="h-full">
                      <SpotlightCard className="h-full rounded-[var(--radius-xl)]" size={320} strength={0.1}>
                        <Card interactive className="relative z-[2] h-full">
                          <p className="text-2xs uppercase tracking-wider text-muted">
                            {sessionDay(s.start_at)} · {hhmm(s.start_at)} · {sportLabel(s.sport)} · {s.court_code}
                          </p>
                          {s.plans.length ? (
                            s.plans.map((p) => (
                              <div key={p.id} className="mt-3">
                                <h3 className="font-display text-xl">{p.title || p.payload.goal || "Session plan"}</h3>
                                <ol className="mt-2 grid gap-1 text-sm">
                                  {(p.payload.blocks ?? []).map((b, i) => (
                                    <motion.li
                                      key={i}
                                      initial={{ opacity: 0, x: -8 }}
                                      whileInView={{ opacity: 1, x: 0 }}
                                      viewport={{ once: true }}
                                      transition={{ duration: 0.3, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                                    >
                                      {i + 1}. {b.title} <span className="tabular-nums text-muted">{b.minutes}′</span>
                                      {b.phase ? <span className="text-muted"> · {b.phase}</span> : null}
                                    </motion.li>
                                  ))}
                                </ol>
                                {p.payload.note ? <p className="mt-2 text-xs text-muted">{p.payload.note}</p> : null}
                              </div>
                            ))
                          ) : (
                            <p className="mt-3 text-sm text-muted">Your coach hasn't posted a plan for this one yet.</p>
                          )}
                        </Card>
                      </SpotlightCard>
                    </Lift>
                  </StaggerItem>
                ))}
              </Stagger>
            ) : (
              <div className="mt-3">
                <EmptyState title="No sessions coming up" hint="Join a class and its plans show up here." />
              </div>
            )}
          </section>

          <section>
            <SplitText as="h2" text="Homework" className="font-display text-2xl" />
            {d.homework.length ? (
              <div className="mt-3 grid gap-3">
                {d.homework.map((h) => (
                  <Card key={h.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-medium">{h.title}</h3>
                      <span className="text-xs text-muted">{h.due_on ? `Due ${formatDate(h.due_on)}` : "No due date"}</span>
                    </div>
                    {h.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted [overflow-wrap:anywhere]">{h.body}</p> : null}
                    <ul className="mt-3 grid gap-1">
                      {h.checklist.map((item, i) => (
                        <li key={i}>
                          <label className="flex min-h-9 cursor-pointer items-center gap-3 text-sm">
                            <input
                              type="checkbox"
                              className="size-4 accent-[var(--color-accent)]"
                              checked={h.done_items.includes(i)}
                              onChange={() => void tick(h, i)}
                            />
                            <span className={h.done_items.includes(i) ? "text-muted line-through" : ""}>{item}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">Nothing to do right now.</p>
            )}
          </section>

          <section>
            <SplitText as="h2" text="Coach reviews" className="font-display text-2xl" />
            <div className="mt-3 grid gap-2">
              {d.reviews.length ? (
                d.reviews.map((r) => (
                  <Card key={r.id} className="p-4">
                    <p className="text-xs text-muted">
                      {formatDate(r.created_at)} · {sportLabel(r.sport)} · last {r.period_weeks} weeks · {r.coach_name}
                    </p>
                    <p className="mt-1 text-sm">
                      Technique {r.technique}/5 · Fitness {r.fitness}/5 · Attitude {r.attitude}/5
                    </p>
                    {r.comment ? <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{r.comment}</p> : null}
                  </Card>
                ))
              ) : (
                <p className="text-sm text-muted">No reviews yet.</p>
              )}
            </div>
          </section>

          <section>
            <SplitText as="h2" text="Recent sessions" className="font-display text-2xl" />
            <div className="mt-3 grid gap-2">
              {d.results.length ? (
                d.results.map((r) => (
                  <Card key={r.session_id} className="p-4">
                    <p className="text-xs text-muted">
                      {formatDate(r.start_at)} · {sportLabel(r.sport)}
                    </p>
                    <p className="mt-1 text-sm">
                      {r.plan_pct == null ? "Session logged" : `${r.plan_pct}% of the plan`}
                      {Object.entries(r.metrics ?? {}).map(([k, v]) => ` · ${METRIC_LABEL[k] ?? k} ${v}`)}
                    </p>
                    {r.note ? <p className="mt-1 text-sm text-muted">{r.note}</p> : null}
                  </Card>
                ))
              ) : (
                <p className="text-sm text-muted">Your coach's notes from each session appear here.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}
