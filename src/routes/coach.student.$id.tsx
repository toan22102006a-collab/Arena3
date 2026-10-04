import { Link, createFileRoute } from "@tanstack/react-router";
import { SectionTitle } from "@/components/section";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Field, Select, Skeleton, Textarea } from "@/components/ui";
import { SplitText } from "@/components/fx";
import { apiGet, apiPost, apiPut } from "@/lib/arena3/client";
import { formatDate, levelLabel, sportLabel } from "@/lib/arena3/labels";
import { t, tServer, tk } from "@/lib/i18n";

export const Route = createFileRoute("/coach/student/$id")({ component: Page });

const GOALS: Record<string, string> = {
  weight: tk("Lose weight"),
  technique: tk("Improve technique"),
  compete: tk("Compete"),
  fun: tk("Have fun"),
};
const SPORTS = ["badminton", "basketball", "volleyball"];
const LEVELS = ["beginner", "intermediate", "advanced"];
const METRIC_LABEL: Record<string, string> = {
  smash_count: tk("Smashes"),
  freethrow_pct: tk("Free throws"),
  serve_pct: tk("Serves in"),
};

type Profile = {
  student: { id: string; full_name: string; member_code: string | null; date_of_birth: string | null; health_notes: string | null };
  goal: string | null;
  levels: Array<{ sport: string; level: string }>;
  notes: Array<{ id: string; body: string; created_at: string; coach_name: string }>;
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
  results: Array<{
    session_id: string;
    plan_pct: number | null;
    metrics: Record<string, number> | null;
    note: string | null;
    start_at: string;
    sport: string;
  }>;
  attendance: Record<string, number>;
  homework: Array<{ id: string; title: string; due_on: string | null; checklist: string[]; done_items: number[]; completed_at: string | null }>;
};

const say = (e: unknown) => (e instanceof Error ? tServer(e.message) : t("Something went wrong"));

function Page() {
  const { id } = Route.useParams();
  const [p, setP] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [lvl, setLvl] = useState({ sport: "badminton", level: "beginner" });
  const [rev, setRev] = useState({ sport: "badminton", period_weeks: "4", technique: "3", fitness: "3", attitude: "3", comment: "" });

  const load = useCallback(async () => {
    try {
      setP(await apiGet<Profile>(`/students/${id}/profile`));
    } catch (e) {
      toast.error(say(e));
      setFailed(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (e) {
      toast.error(say(e));
    }
  }

  const att = p?.attendance ?? {};

  return (
    <Shell role="coach" title={p?.student.full_name ?? t("Student")} subtitle={p ? (p.student.member_code ?? "") : ""}>
      <Link to="/coach/attendance" className="text-sm text-muted underline-offset-4 hover:underline">
        {t("← Back to attendance")}
      </Link>
      {!p ? (
        failed ? (
          <EmptyState title={t("This student isn't available")} hint={t("You can see students in the classes you teach.")} />
        ) : (
          <Skeleton className="mt-4 h-40" />
        )
      ) : (
        <div className="mt-4 grid gap-8">
          <Card className="grid gap-3 md:grid-cols-3">
            <div>
              <p className="kicker text-2xs text-muted">{t("Goal")}</p>
              <p className="mt-1 text-lg">{p.goal && GOALS[p.goal] ? t(GOALS[p.goal]!) : t("Not set yet")}</p>
            </div>
            <div>
              <p className="kicker text-2xs text-muted">{t("Attendance")}</p>
              <p className="mt-1 text-sm">
                {t("{present} present · {late} late · {absent} absent · {excused} excused", {
                  present: att.present ?? 0,
                  late: att.late ?? 0,
                  absent: att.absent ?? 0,
                  excused: att.excused ?? 0,
                })}
              </p>
            </div>
            <div>
              <p className="kicker text-2xs text-muted">{t("Health notes")}</p>
              <p className={`mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere] ${p.student.health_notes ? "text-danger" : "text-muted"}`}>
                {p.student.health_notes || t("None on file")}
              </p>
            </div>
          </Card>

          <section>
            <SectionTitle text={t("Level")} className="font-display text-2xl" />
            <Card className="mt-3 grid gap-3">
              <div className="flex flex-wrap gap-2">
                {p.levels.length ? (
                  p.levels.map((l) => (
                    <Badge key={l.sport} tone="accent">
                      {sportLabel(l.sport)} · {levelLabel(l.level)}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted">{t("No level assessed yet.")}</span>
                )}
              </div>
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label={t("Sport")}>
                  <Select value={lvl.sport} onChange={(e) => setLvl({ ...lvl, sport: e.target.value })}>
                    {SPORTS.map((s) => (
                      <option key={s} value={s}>
                        {sportLabel(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("Level")}>
                  <Select value={lvl.level} onChange={(e) => setLvl({ ...lvl, level: e.target.value })}>
                    {LEVELS.map((s) => (
                      <option key={s} value={s}>
                        {levelLabel(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button variant="outline" onClick={() => run(() => apiPut(`/students/${id}/level`, lvl), t("Level updated"))}>
                  {t("Set level")}
                </Button>
              </div>
            </Card>
          </section>

          <section>
            <SectionTitle text={t("Progress review")} className="font-display text-2xl" />
            <p className="mt-1 text-sm text-muted">
              {t("A review stays on record and the student is told about it. It can't be edited afterwards.")}
            </p>
            <Card className="mt-3 grid gap-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Field label={t("Sport")}>
                  <Select value={rev.sport} onChange={(e) => setRev({ ...rev, sport: e.target.value })}>
                    {SPORTS.map((s) => (
                      <option key={s} value={s}>
                        {sportLabel(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("Period")}>
                  <Select value={rev.period_weeks} onChange={(e) => setRev({ ...rev, period_weeks: e.target.value })}>
                    <option value="2">{t("{n} weeks", { n: 2 })}</option>
                    <option value="4">{t("{n} weeks", { n: 4 })}</option>
                  </Select>
                </Field>
                {(["technique", "fitness", "attitude"] as const).map((k) => (
                  <Field
                    key={k}
                    label={k === "technique" ? t("Technique (1–5)") : k === "fitness" ? t("Fitness (1–5)") : t("Attitude (1–5)")}
                  >
                    <Select value={rev[k]} onChange={(e) => setRev({ ...rev, [k]: e.target.value })}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
              <Field label={t("Comment")}>
                <Textarea rows={3} maxLength={2000} value={rev.comment} onChange={(e) => setRev({ ...rev, comment: e.target.value })} />
              </Field>
              <div>
                <Button
                  onClick={() =>
                    run(async () => {
                      await apiPost(`/students/${id}/reviews`, rev);
                      setRev({ ...rev, comment: "" });
                    }, t("Review saved"))
                  }
                >
                  {t("Save review")}
                </Button>
              </div>
            </Card>
            <div className="mt-3 grid gap-2">
              {p.reviews.map((r) => (
                <Card key={r.id} className="p-4">
                  <p className="text-xs text-muted">
                    {formatDate(r.created_at)} · {sportLabel(r.sport)} · {t("{n} weeks", { n: r.period_weeks })} · {r.coach_name}
                  </p>
                  <p className="mt-1 text-sm">
                    {t("Technique {technique}/5 · Fitness {fitness}/5 · Attitude {attitude}/5", {
                      technique: r.technique,
                      fitness: r.fitness,
                      attitude: r.attitude,
                    })}
                  </p>
                  {r.comment ? <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{r.comment}</p> : null}
                </Card>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle text={t("Coach notes")} className="font-display text-2xl" />
            <p className="mt-1 text-sm text-muted">{t("Private to staff. The student never sees these.")}</p>
            <Card className="mt-3 grid gap-3">
              <Textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Observation, injury watch, what to work on…")} />
              <div>
                <Button
                  disabled={!note.trim()}
                  onClick={() =>
                    run(async () => {
                      await apiPost(`/students/${id}/notes`, { body: note });
                      setNote("");
                    }, t("Note added"))
                  }
                >
                  {t("Add note")}
                </Button>
              </div>
            </Card>
            <div className="mt-3 grid gap-2">
              {p.notes.map((n) => (
                <Card key={n.id} className="p-4">
                  <p className="text-xs text-muted">
                    {formatDate(n.created_at)} · {n.coach_name}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{n.body}</p>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle text={t("Recent sessions")} className="font-display text-2xl" />
            <div className="mt-3 grid gap-2">
              {p.results.length ? (
                p.results.map((r) => (
                  <Card key={r.session_id} className="p-4">
                    <p className="text-xs text-muted">
                      {formatDate(r.start_at)} · {sportLabel(r.sport)}
                    </p>
                    <p className="mt-1 text-sm">
                      {r.plan_pct == null ? t("No plan score") : t("{pct}% of the plan", { pct: r.plan_pct })}
                      {Object.entries(r.metrics ?? {}).map(([k, v]) => ` · ${METRIC_LABEL[k] ? t(METRIC_LABEL[k]) : k} ${v}`)}
                    </p>
                    {r.note ? <p className="mt-1 text-sm text-muted">{r.note}</p> : null}
                  </Card>
                ))
              ) : (
                <p className="text-sm text-muted">{t("No results recorded yet.")}</p>
              )}
            </div>
          </section>

          <section>
            <SectionTitle text={t("Homework")} className="font-display text-2xl" />
            <div className="mt-3 grid gap-2">
              {p.homework.length ? (
                p.homework.map((h) => (
                  <Card key={h.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <div>
                      <p className="font-medium">{h.title}</p>
                      <p className="text-xs text-muted">
                        {h.due_on ? t("Due {date}", { date: formatDate(h.due_on) }) : t("No due date")} ·{" "}
                        {t("{done}/{total} items", { done: h.done_items.length, total: h.checklist.length })}
                      </p>
                    </div>
                    <Badge tone={h.completed_at ? "accent" : "muted"}>{h.completed_at ? t("Done") : t("Open")}</Badge>
                  </Card>
                ))
              ) : (
                <p className="text-sm text-muted">{t("No homework assigned.")}</p>
              )}
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}
