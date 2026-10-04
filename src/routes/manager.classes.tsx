import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Button, Card, DateField, EmptyState, Field, Input, Select, ShowMore, StatusBadge } from "@/components/ui";
import { Lift, Reveal, Stagger, StaggerItem, motion } from "@/components/motion";
import { SpotlightCard } from "@/components/fx";
import { ClassDetailModal } from "@/components/class-detail";
import { apiGet, apiPost } from "@/lib/arena3/client";
import { composeWeeklyRrule, levelLabel, rruleLabel, sportLabel, todayISO, addDaysISO } from "@/lib/arena3/labels";
import { t, tk, tServer } from "@/lib/i18n";

export const Route = createFileRoute("/manager/classes")({
  component: Page,
});

const DAYS = [
  { k: "MO", l: tk("Mon") },
  { k: "TU", l: tk("Tue") },
  { k: "WE", l: tk("Wed") },
  { k: "TH", l: tk("Thu") },
  { k: "FR", l: tk("Fri") },
  { k: "SA", l: tk("Sat") },
  { k: "SU", l: tk("Sun") },
];

function Page() {
  const [limit, setLimit] = useState(8);
  const [items, setItems] = useState<
    Array<{
      id: string;
      code: string;
      sport: string;
      level: string;
      status: string;
      court_code: string;
      coach_name: string;
      enrolled_count: number;
      capacity: number;
      rrule?: string;
    }>
  >([]);
  const [courts, setCourts] = useState<Array<{ id: string; court_code: string; sport: string }>>([]);
  const [coaches, setCoaches] = useState<Array<{ id: string; full_name: string; sports: string[] | null }>>([]);
  const [loaded, setLoaded] = useState(false);
  // The class whose sessions and roster are open (B-08).
  const [detail, setDetail] = useState<string | null>(null);
  const [days, setDays] = useState<string[]>(["TU", "TH"]);
  const [hour, setHour] = useState(19);
  const [form, setForm] = useState({
    sport: "badminton",
    level: "beginner",
    coach_id: "",
    court_id: "",
    capacity: 12,
    duration_min: 90,
    start_on: todayISO(),
    end_on: addDaysISO(todayISO(), 60),
  });

  const load = useCallback(async () => {
    setItems((await apiGet<{ items: typeof items }>("/classes")).items);
    setCourts((await apiGet<{ items: typeof courts }>("/courts")).items);
    setCoaches((await apiGet<{ items: typeof coaches }>("/staff?role=coach&status=active")).items);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load().catch((e) => toast.error(tServer(e.message)));
  }, [load]);

  // The people and courts a class of this sport can actually use. Nothing is
  // assumed about which accounts exist: a centre that issued its own coach
  // logins has none of the seed ids.
  const sportCourts = useMemo(() => courts.filter((c) => c.sport === form.sport), [courts, form.sport]);
  const sportCoaches = useMemo(
    () => coaches.filter((c) => (c.sports ?? []).some((s) => s === form.sport || s === "all")),
    [coaches, form.sport],
  );
  useEffect(() => {
    setForm((f) => {
      const court_id = sportCourts.some((c) => c.id === f.court_id) ? f.court_id : (sportCourts[0]?.id ?? "");
      const coach_id = sportCoaches.some((c) => c.id === f.coach_id) ? f.coach_id : (sportCoaches[0]?.id ?? "");
      return court_id === f.court_id && coach_id === f.coach_id ? f : { ...f, court_id, coach_id };
    });
  }, [sportCourts, sportCoaches]);
  const missing = !loaded
    ? null
    : !sportCoaches.length
      ? t("No active coach teaches this sport yet.")
      : !sportCourts.length
        ? t("There is no court for this sport.")
        : null;

  function toggleDay(k: string) {
    setDays((prev) => (prev.includes(k) ? prev.filter((d) => d !== k) : [...prev, k]));
  }

  return (
    <Shell role="manager" title={t("Classes")} subtitle={t("Pick the days and the hour — clashes on court or coach are blocked for you.")}>
      <Reveal from="down">
      <Card className="mb-6 grid gap-3 md:grid-cols-3">
        <Field label={t("Sport")}>
          <Select value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })}>
            <option value="badminton">{t("Badminton")}</option>
            <option value="basketball">{t("Basketball")}</option>
            <option value="volleyball">{t("Volleyball")}</option>
          </Select>
        </Field>
        <Field label={t("Level")}>
          <Select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
            <option value="beginner">{t("Beginner")}</option>
            <option value="intermediate">{t("Intermediate")}</option>
            <option value="advanced">{t("Advanced")}</option>
            <option value="team">{t("Squad")}</option>
          </Select>
        </Field>
        <Field label={t("Court")}>
          <Select value={form.court_id} onChange={(e) => setForm({ ...form, court_id: e.target.value })}>
            {sportCourts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.court_code} · {sportLabel(c.sport)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("Coach")}>
          <Select value={form.coach_id} onChange={(e) => setForm({ ...form, coach_id: e.target.value })}>
            {sportCoaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="md:col-span-2">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted">{t("Repeats weekly on")}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {DAYS.map((d) => (
              <button
                key={d.k}
                type="button"
                onClick={() => toggleDay(d.k)}
                className={`relative min-h-9 min-w-11 rounded-[var(--radius-sm)] px-2 text-sm font-medium transition-colors duration-200 active:scale-95 ${
                  days.includes(d.k) ? "text-bg" : "bg-wood text-muted hover:bg-wood/70"
                }`}
              >
                {days.includes(d.k) ? (
                  <motion.span
                    layoutId={`byday-${d.k}`}
                    className="absolute inset-0 rounded-[var(--radius-sm)] bg-fg"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                ) : null}
                <span className="relative">{t(d.l)}</span>
              </button>
            ))}
          </div>
        </div>
        <Field label={t("Start time")}>
          <Select value={String(hour)} onChange={(e) => setHour(Number(e.target.value))}>
            {Array.from({ length: 16 }, (_, i) => i + 6).map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("First day")}>
          <DateField value={form.start_on} onChange={(v) => setForm({ ...form, start_on: v })} aria-label={t("Start date")} />
        </Field>
        <Field label={t("Capacity")}>
          <Input
            type="number"
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
          />
        </Field>
        <div className="flex flex-col justify-end gap-1">
          {missing ? (
            <p className="text-xs text-danger">
              {missing}{" "}
              {!sportCoaches.length ? (
                <Link to="/manager/staff" className="underline">
                  {t("Add a coach")}
                </Link>
              ) : null}
            </p>
          ) : null}
          <Button
            className="w-full"
            disabled={!!missing || !form.coach_id || !form.court_id}
            onClick={async () => {
              try {
                const row = await apiPost<{ id: string }>("/classes", {
                  ...form,
                  rrule: composeWeeklyRrule(days, hour),
                });
                toast.success(t("Draft created"));
                const pub = await apiPost<{ sessions: unknown[]; skipped: unknown[] }>(`/classes/${row.id}/publish`);
                toast.success(t("Published {n} sessions", { n: pub.sessions.length }));
                await load();
              } catch (e) {
                toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
              }
            }}
          >
            {t("Create & publish")}
          </Button>
        </div>
      </Card>
      </Reveal>
      <Stagger className="grid gap-3 md:grid-cols-2" gap={0.06}>
        {items.slice(0, limit).map((c) => (
          <StaggerItem key={c.id} className="h-full">
          <Lift className="h-full">
          <SpotlightCard className="h-full rounded-[var(--radius-xl)]" size={320} strength={0.1}>
          <Card interactive className="relative z-[2] h-full">
            <div className="flex items-center justify-between gap-2">
              <StatusBadge status={c.status} />
              <span className="text-2xs tabular-nums text-muted">{c.code}</span>
            </div>
            <h2 className="mt-2 font-display text-2xl">
              {sportLabel(c.sport)} · {levelLabel(c.level)}
            </h2>
            <p className="text-sm text-muted">
              {c.coach_name} · {c.court_code} · {c.enrolled_count}/{c.capacity}
            </p>
            {c.rrule ? <p className="text-sm">{rruleLabel(c.rrule)}</p> : null}
            <Button className="mt-3" variant="outline" onClick={() => setDetail(c.id)}>
              {t("Sessions & students")}
            </Button>
            {c.status === "draft" ? (
              <Button
                className="mt-3 ml-2"
                onClick={async () => {
                  try {
                    await apiPost(`/classes/${c.id}/publish`);
                    toast.success(t("Published"));
                    await load();
                  } catch (e) {
                    toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
                  }
                }}
              >
                {t("Publish")}
              </Button>
            ) : null}
          </Card>
          </SpotlightCard>
          </Lift>
          </StaggerItem>
        ))}
      </Stagger>
      <ShowMore shown={Math.min(limit, items.length)} total={items.length} step={8} onMore={() => setLimit((n) => n + 8)} />
      {loaded && !items.length ? (
        <EmptyState
          title={t("No classes yet")}
          hint={t("Pick a sport, a coach and the days above, then press Create & publish. Members can book as soon as it is published.")}
        />
      ) : null}
      <ClassDetailModal classId={detail} onClose={() => setDetail(null)} manage onChanged={() => void load()} />
    </Shell>
  );
}
