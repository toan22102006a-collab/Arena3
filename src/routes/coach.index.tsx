import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarDays, ChevronRight, ClipboardCheck, MapPin, Users } from "lucide-react";
import { sessionDay } from "@/components/class-detail";
import { ArenaIcon, SportIcon } from "@/components/arena-icons";
import { PhotoBanner, media } from "@/components/media";
import { Shell, hhmm } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadError,
  Skeleton,
  StatusBadge,
} from "@/components/ui";
import { levelLabel, sportLabel } from "@/lib/arena3/labels";
import { t } from "@/lib/i18n";
import { useRead } from "@/lib/use-read";

export const Route = createFileRoute("/coach/")({
  component: Page,
});

export type CoachSession = {
  id: string;
  start_at: string;
  end_at: string;
  level: string;
  sport: string;
  court_code: string;
  enrolled_count: number;
  capacity: number;
  class_id: string;
  class_code: string;
  status: string;
};

/** The centre's calendar day of an instant, for grouping — "2026-10-21". */
function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

function dayName(iso: string) {
  const today = dayKey(new Date().toISOString());
  const tomorrow = dayKey(new Date(Date.now() + 864e5).toISOString());
  const k = dayKey(iso);
  if (k === today) return t("Today");
  if (k === tomorrow) return t("Tomorrow");
  return sessionDay(iso);
}

function Page() {
  const navigate = useNavigate();
  const read = useRead<{ items: CoachSession[] }>("/coach/schedule");
  // null = not answered yet (or failed); [] = the centre really has nothing for this coach.
  const items = read.data?.items ?? null;

  const take = (id: string) => void navigate({ to: "/coach/attendance", search: { session: id } });

  // The first session still to come is the one to act on; everything else is a short list under it.
  const next = items?.find(
    (s) => s.status === "scheduled" && new Date(s.end_at).getTime() > Date.now(),
  );
  const rest = (items ?? []).filter((s) => s.id !== next?.id);
  const days = new Map<string, CoachSession[]>();
  for (const s of rest) {
    const k = dayKey(s.start_at);
    days.set(k, [...(days.get(k) ?? []), s]);
  }

  return (
    <Shell
      role="coach"
      title={t("Schedule")}
      subtitle={t("Every session you teach, by day. Tap one to take its register.")}
    >
      {read.error ? (
        <LoadError
          message={read.error.message}
          onRetry={read.error.refused ? undefined : read.reload}
        />
      ) : !items ? (
        <div className="grid gap-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-32" />
        </div>
      ) : !items.length ? (
        <EmptyState
          title={t("No sessions coming up")}
          hint={t(
            "When the manager publishes a class with you as coach, its sessions appear here.",
          )}
        />
      ) : (
        <div className="mx-auto grid max-w-3xl gap-8">
          <PhotoBanner src={media.coachWhistle} focus="50% 22%" />
          {next ? (
            <section aria-label={t("Next session")}>
              <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-2">
                <ArenaIcon name="whistle" motion="wiggle" className="size-5" />
                {t("Next session")}
              </p>
              <Card className="grid gap-5 border border-accent/30 bg-accent/[0.04] p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <CalendarDays aria-hidden className="size-4" />
                  <span className="font-semibold text-fg">{dayName(next.start_at)}</span>
                  <span aria-hidden>·</span>
                  <span>{sessionDay(next.start_at)}</span>
                </div>
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                  <p className="figure text-4xl tabular-nums sm:text-5xl">
                    {hhmm(next.start_at)}
                    <span className="text-muted">–{hhmm(next.end_at)}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">
                      <SportIcon sport={next.sport} motion="bounce" className="mr-1 size-3.5" />
                      {sportLabel(next.sport)}
                    </Badge>
                    <Badge tone="muted">{levelLabel(next.level)}</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin aria-hidden className="size-4 text-muted" />
                    {t("Court {court}", { court: next.court_code })}
                  </span>
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <Users aria-hidden className="size-4 text-muted" />
                    {t("{enrolled}/{capacity} students", {
                      enrolled: next.enrolled_count,
                      capacity: next.capacity,
                    })}
                  </span>
                </div>
                <Button
                  size="lg"
                  className="w-full sm:w-auto sm:justify-self-start"
                  onClick={() => take(next.id)}
                >
                  <ClipboardCheck aria-hidden className="size-5" />
                  {t("Take register")}
                </Button>
              </Card>
            </section>
          ) : null}

          {rest.length ? (
            <section aria-label={t("Coming up")} className="grid gap-5">
              <p className="text-sm font-semibold text-muted">{t("Coming up")}</p>
              {[...days.entries()].map(([k, list]) => (
                <div key={k}>
                  <h2 className="mb-2 text-base font-semibold">{dayName(list[0]!.start_at)}</h2>
                  <Card className="overflow-hidden p-0">
                    <ul className="divide-y divide-line">
                      {list.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => take(s.id)}
                            className="flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-wood/60"
                          >
                            <span className="w-14 shrink-0 text-base sm:w-24 font-semibold tabular-nums">
                              {hhmm(s.start_at)}
                              <span className="block text-xs font-normal text-muted">
                                {hhmm(s.end_at)}
                              </span>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 font-medium">
                                  <SportIcon sport={s.sport} className="size-4 text-accent" />
                                  {sportLabel(s.sport)}
                                </span>
                                <Badge tone="muted">{levelLabel(s.level)}</Badge>
                                {s.status !== "scheduled" ? (
                                  <StatusBadge status={s.status} />
                                ) : null}
                              </span>
                              <span className="mt-0.5 block text-sm text-muted tabular-nums">
                                {t("Court {court} · {enrolled}/{capacity} students", {
                                  court: s.court_code,
                                  enrolled: s.enrolled_count,
                                  capacity: s.capacity,
                                })}
                              </span>
                            </span>
                            <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      )}
    </Shell>
  );
}
