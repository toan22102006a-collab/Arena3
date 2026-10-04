import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cover, sportPhoto } from "@/components/media";
import { sessionDay } from "@/components/class-detail";
import { Shell, hhmm } from "@/components/shell";
import { Badge, Card, EmptyState, Skeleton, StatusBadge } from "@/components/ui";
import { Lift, Stagger, StaggerItem } from "@/components/motion";
import { GlareHover, SpotlightCard } from "@/components/fx";
import { apiGet } from "@/lib/arena3/client";
import { levelLabel, sportLabel } from "@/lib/arena3/labels";
import { t, tServer } from "@/lib/i18n";

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

function Page() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CoachSession[] | null>(null);

  useEffect(() => {
    void apiGet<{ items: CoachSession[] }>("/coach/schedule")
      .then((r) => setItems(r.items))
      .catch((e) => toast.error(tServer(e.message)));
  }, []);

  // One heading per teaching day, so every card sits under the date it happens on.
  const days = new Map<string, CoachSession[]>();
  for (const s of items ?? []) {
    const k = dayKey(s.start_at);
    days.set(k, [...(days.get(k) ?? []), s]);
  }

  return (
    <Shell role="coach" title={t("Schedule")} subtitle={t("Every session you teach, by day. Tap one to take its register.")}>
      {!items ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : !items.length ? (
        <EmptyState
          title={t("No sessions coming up")}
          hint={t("When the manager publishes a class with you as coach, its sessions appear here.")}
        />
      ) : (
        [...days.entries()].map(([k, list]) => (
          <section key={k} className="mb-8">
            <h2 className="font-display text-xl">{sessionDay(list[0]!.start_at)}</h2>
            <Stagger className="mt-3 grid gap-3 md:grid-cols-2" gap={0.07}>
              {list.map((s) => (
                <StaggerItem key={s.id}>
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => void navigate({ to: "/coach/attendance", search: { session: s.id } })}
                  >
                    <Lift>
                      <SpotlightCard className="rounded-[var(--radius-xl)]" size={320} strength={0.11}>
                        <Card interactive className="relative z-[2] overflow-hidden p-0">
                          <GlareHover>
                            <Cover src={sportPhoto(s.sport)} alt="" className="h-24">
                              <div className="absolute bottom-3 left-4 flex items-center gap-2">
                                <Badge tone="accent" className="bg-surface text-fg">
                                  {sportLabel(s.sport)}
                                </Badge>
                                <Badge tone="muted" className="bg-surface/90 tabular-nums">
                                  {s.class_code}
                                </Badge>
                              </div>
                            </Cover>
                          </GlareHover>
                          <div className="p-5">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="font-display text-2xl">{levelLabel(s.level)}</h3>
                              {s.status !== "scheduled" ? <StatusBadge status={s.status} /> : null}
                            </div>
                            <p className="tabular-nums text-sm">
                              {sessionDay(s.start_at)} · {hhmm(s.start_at)}–{hhmm(s.end_at)}
                            </p>
                            <p className="text-sm text-muted tabular-nums">
                              {t("Court {court} · {enrolled}/{capacity} students", {
                                court: s.court_code,
                                enrolled: s.enrolled_count,
                                capacity: s.capacity,
                              })}
                            </p>
                          </div>
                        </Card>
                      </SpotlightCard>
                    </Lift>
                  </button>
                </StaggerItem>
              ))}
            </Stagger>
          </section>
        ))
      )}
    </Shell>
  );
}
