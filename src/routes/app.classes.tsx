import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cover, MediaCaption, sportPhoto } from "@/components/media";
import { MyAttendance } from "@/components/my-attendance";
import { Shell } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Seg, Skeleton } from "@/components/ui";
import { Lift, Stagger, StaggerItem, motion } from "@/components/motion";
import { GlareHover, SpotlightCard } from "@/components/fx";
import { cn } from "@/lib/cn";
import { apiDelete, apiGet, apiPost } from "@/lib/arena3/client";
import { levelLabel, rruleLabel, sportLabel } from "@/lib/arena3/labels";

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
  const [items, setItems] = useState<Cl[] | null>(null);
  const [mine, setMine] = useState<Enr[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [sport, setSport] = useState(Route.useSearch().sport ?? "");
  async function load() {
    const [cls, me] = await Promise.all([
      apiGet<{ items: Cl[] }>("/classes"),
      apiGet<{ enrollments: Enr[]; offers: Offer[] }>("/me"),
    ]);
    setItems(cls.items);
    setMine(me.enrollments ?? []);
    setOffers(me.offers ?? []);
  }
  useEffect(() => {
    void load().catch((e) => toast.error(e.message));
  }, []);

  const shown = (items ?? []).filter((c) => !sport || c.sport === sport);
  const byClass = Object.fromEntries(mine.map((e) => [e.class_id, e]));

  return (
    <Shell role="member" title="Classes" subtitle="Enrol by sport. When a class is full you join a first-come waitlist.">
      {offers.length ? (
        <Card className="mb-4 border border-hold/30 bg-hold/5">
          <p className="text-sm font-medium">A waitlist seat opened up</p>
          {offers.map((o) => (
            <div key={o.id} className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {sportLabel(o.sport)} · {levelLabel(o.level)} — claim before{" "}
                {new Date(o.expires_at).toLocaleTimeString("en-GB", {
                  timeZone: "Asia/Ho_Chi_Minh",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </p>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await apiPost(`/waitlist/${o.id}/accept`);
                    toast.success("Seat claimed");
                    await load();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "This offer has expired");
                  }
                }}
              >
                Claim seat
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
            { value: "", label: "All" },
            { value: "badminton", label: "Badminton" },
            { value: "basketball", label: "Basketball" },
            { value: "volleyball", label: "Volleyball" },
          ]}
        />
      </div>
      {!items ? (
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
                  <Cover src={sportPhoto(c.sport)} alt="" scrim="none" className="h-36">
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
                    {c.coach_name} · {c.court_code} · {c.duration_min}′
                  </p>
                  <p className="text-sm">{rruleLabel(c.rrule)}</p>
                  {/* The bar on its own is a ratio nobody converts in their
                      head. What decides whether you enrol now or later is the
                      number of seats, so the bar gets a caption. */}
                  <div className="mt-4 flex items-baseline justify-between gap-2 text-2xs uppercase tracking-wider">
                    <span className="text-muted">{full ? "Full" : `${c.capacity - c.enrolled_count} seats left`}</span>
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
                          toast.success("Enrolment cancelled");
                          await load();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Could not cancel");
                        }
                      }}
                    >
                      Leave this class
                    </Button>
                  ) : enr?.status === "waitlisted" ? (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await apiDelete(`/enrollments/${enr.id}`);
                          toast.success("Left the waitlist");
                          await load();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Something went wrong");
                        }
                      }}
                    >
                      Waitlisted #{enr.waitlist_pos ?? "—"} · Leave
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      variant={full ? "outline" : "primary"}
                      onClick={async () => {
                        try {
                          const r = await apiPost<{ waitlisted?: boolean }>(`/classes/${c.id}/enroll`, {});
                          toast.success(r.waitlisted ? "Added to the waitlist" : "You are enrolled");
                          await load();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Could not enrol");
                        }
                      }}
                    >
                      {full ? "Join the waitlist" : "Enrol"}
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
            <EmptyState title="No open classes" hint="The manager publishes the weekly timetable." />
          ) : null}
        </Stagger>
      )}
      <MyAttendance />
    </Shell>
  );
}
