import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cover, MediaCaption, PhotoBanner, media, sportPhoto } from "@/components/media";
import { MyAttendance } from "@/components/my-attendance";
import { Shell } from "@/components/shell";
import { Badge, Button, Card, EmptyState, LoadError, Seg, ShowMore, Skeleton } from "@/components/ui";
import { Lift, Stagger, StaggerItem, motion } from "@/components/motion";
import { GlareHover, SpotlightCard } from "@/components/fx";
import { cn } from "@/lib/cn";
import { apiDelete, apiPost } from "@/lib/arena3/client";
import { levelLabel, rruleLabel, sportLabel } from "@/lib/arena3/labels";
import { locale, t } from "@/lib/i18n";
import { useRead } from "@/lib/use-read";

export const Route = createFileRoute("/app/classes")({
  validateSearch: (s: Record<string, unknown>): { sport?: string } => ({
    sport: s.sport === "badminton" || s.sport === "basketball" || s.sport === "volleyball" ? s.sport : undefined,
  }),
  component: Page,
});

type Cl = {
  id: string;
  sport: string;
  level: string;
  capacity: number;
  enrolled_count: number;
  court_code: string;
  coach_name: string;
  rrule: string;
  duration_min: number;
  status: string;
};

type Enr = { id: string; class_id: string; status: string; waitlist_pos: number | null };
type Offer = { id: string; class_id: string; expires_at: string; sport: string; level: string };

function Page() {
  const classesRead = useRead<{ items: Cl[] }>("/classes");
  const meRead = useRead<{ enrollments?: Enr[]; offers?: Offer[] }>("/me");
  // The list is only shown once the member's own enrolments are known too: without them every class would read "Enrol".
  const items = classesRead.data && meRead.data ? classesRead.data.items : null;
  const mine = meRead.data?.enrollments ?? [];
  const offers = meRead.data?.offers ?? [];
  const failure = classesRead.error ?? meRead.error;
  const [sport, setSport] = useState(Route.useSearch().sport ?? "");
  const load = () => {
    classesRead.reload();
    meRead.reload();
  };

  const [limit, setLimit] = useState(6);
  const matching = (items ?? []).filter((c) => !sport || c.sport === sport);
  const shown = matching.slice(0, limit);
  useEffect(() => setLimit(6), [sport]);
  const byClass = Object.fromEntries(mine.map((e) => [e.class_id, e]));

  return (
    <Shell
      role="member"
      title={t("Classes")}
      subtitle={t("Enrol by sport. When a class is full you join a first-come waitlist.")}
    >
      <PhotoBanner src={media.classGroup} focus="50% 40%" className="mb-4" />
      {offers.length ? (
        <Card className="mb-4 border border-hold/30 bg-hold/5">
          <p className="text-sm font-medium">{t("A waitlist seat opened up")}</p>
          {offers.map((o) => (
            <div key={o.id} className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {t("{sport} · {level} — claim before {time}", {
                  sport: sportLabel(o.sport),
                  level: levelLabel(o.level),
                  time: new Date(o.expires_at).toLocaleTimeString(locale(), {
                    timeZone: "Asia/Ho_Chi_Minh",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  }),
                })}
              </p>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await apiPost(`/waitlist/${o.id}/accept`);
                    toast.success(t("Seat claimed"));
                    load();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : t("This offer has expired"));
                  }
                }}
              >
                {t("Claim seat")}
              </Button>
            </div>
          ))}
        </Card>
      ) : null}
      <div className="mb-4">
        <Seg
          value={sport}
          onChange={setSport}
          options={[
            { value: "", label: t("All") },
            { value: "badminton", label: sportLabel("badminton") },
            { value: "basketball", label: sportLabel("basketball") },
            { value: "volleyball", label: sportLabel("volleyball") },
          ]}
        />
      </div>
      {failure ? (
        <LoadError message={failure.message} onRetry={failure.refused ? undefined : load} />
      ) : !items ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <Stagger className="grid gap-3 md:grid-cols-2" gap={0.07}>
          {shown.map((c) => {
            const full = c.enrolled_count >= c.capacity;
            const pct = Math.min(100, Math.round((c.enrolled_count / Math.max(1, c.capacity)) * 100));
            const enr = byClass[c.id];
            return (
              <StaggerItem key={c.id} className="h-full">
              <Lift className="h-full">
              <SpotlightCard className="h-full rounded-[var(--radius-xl)]" size={340} strength={0.11}>
              <Card interactive className="relative z-[2] flex h-full flex-col overflow-hidden p-0">
                <GlareHover>
                  <Cover src={sportPhoto(c.sport)} alt="" scrim="none" className="h-24 sm:h-28">
                    <MediaCaption className="flex items-end justify-between">
                      <Badge tone="accent" className="bg-surface text-fg">
                        {sportLabel(c.sport)}
                      </Badge>
                      <p className="tabular-nums text-sm">{c.enrolled_count}/{c.capacity}</p>
                    </MediaCaption>
                  </Cover>
                </GlareHover>
                <div className="flex flex-1 flex-col p-5">
                  <h2 className="font-display text-2xl">{levelLabel(c.level)}</h2>
                  <p className="mt-1 text-sm text-muted">
                    {c.coach_name} · {c.court_code}
                  </p>
                  <p className="text-sm">{rruleLabel(c.rrule, c.duration_min)}</p>
                  {/* The bar on its own is a ratio nobody converts in their
                      head. What decides whether you enrol now or later is the
                      number of seats, so the bar gets a caption. */}
                  <div className="mt-4 flex items-baseline justify-between gap-2 text-2xs">
                    <span className="text-muted">{full ? t("Full") : t("{n} seats left", { n: c.capacity - c.enrolled_count })}</span>
                    <span className="tabular-nums text-subtle">{pct}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-wood">
                    <motion.div
                      className={cn("h-full rounded-full", full ? "bg-hold" : "bg-accent")}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                  {/* `mt-auto` pins the action to the bottom of the card. The
                      cards in a row stretch to the tallest one, and without it
                      each button sat directly under its own text — so a row of
                      four classes showed four buttons at four heights. */}
                  <div className="mt-auto pt-5">
                  {enr?.status === "confirmed" ? (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await apiDelete(`/enrollments/${enr.id}`);
                          toast.success(t("Enrolment cancelled"));
                          load();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : t("Could not cancel"));
                        }
                      }}
                    >
                      {t("Leave this class")}
                    </Button>
                  ) : enr?.status === "waitlisted" ? (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await apiDelete(`/enrollments/${enr.id}`);
                          toast.success(t("Left the waitlist"));
                          load();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : t("Something went wrong"));
                        }
                      }}
                    >
                      {t("Waitlisted #{pos} · Leave", { pos: enr.waitlist_pos ?? "—" })}
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      variant={full ? "outline" : "primary"}
                      onClick={async () => {
                        try {
                          const r = await apiPost<{ waitlisted?: boolean }>(`/classes/${c.id}/enroll`, {});
                          toast.success(r.waitlisted ? t("Added to the waitlist") : t("You are enrolled"));
                          load();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : t("Could not enrol"));
                        }
                      }}
                    >
                      {full ? t("Join the waitlist") : t("Enrol")}
                    </Button>
                  )}
                  </div>
                </div>
              </Card>
              </SpotlightCard>
              </Lift>
              </StaggerItem>
            );
          })}
          {!shown.length ? (
            <EmptyState title={t("No open classes")} hint={t("The manager publishes the weekly timetable.")} />
          ) : null}
        </Stagger>
      )}
      {items ? <ShowMore shown={shown.length} total={matching.length} step={6} onMore={() => setLimit((n) => n + 6)} /> : null}
      <MyAttendance />
    </Shell>
  );
}
