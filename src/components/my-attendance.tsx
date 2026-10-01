import { useEffect, useState } from "react";
import { when } from "@/components/shell";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui";
import { apiGet } from "@/lib/arena3/client";
import { levelLabel, sportLabel } from "@/lib/arena3/labels";

type Row = {
  session_id: string;
  start_at: string;
  sport: string;
  level: string;
  court_code: string;
  result: "present" | "late" | "absent" | "excused" | null;
};
type Attendance = { items: Row[]; counts: Record<"present" | "late" | "absent" | "excused", number> };

const RESULTS = [
  { key: "present", label: "Present", tone: "accent" },
  { key: "late", label: "Late", tone: "hold" },
  { key: "absent", label: "Absent", tone: "danger" },
  { key: "excused", label: "Excused", tone: "muted" },
] as const;

/**
 * The member's own record of finished class sessions (M-05): what the coach
 * marked each one — present, late, absent or excused — and nothing about anyone
 * else. A session the coach has not marked yet says so rather than guessing.
 */
export function MyAttendance() {
  const [data, setData] = useState<Attendance | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void apiGet<Attendance>("/me/attendance")
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  return (
    <section aria-labelledby="my-attendance" className="mt-10">
      <h2 id="my-attendance" className="mb-2 font-display text-2xl">
        My attendance
      </h2>
      {failed ? (
        <p className="text-sm text-muted">Your attendance could not be loaded just now.</p>
      ) : !data ? (
        <Skeleton className="h-24" />
      ) : !data.items.length ? (
        <EmptyState
          title="No finished sessions yet"
          hint="After each class your coach marks you present, late, absent or excused — the marks show up here."
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {RESULTS.map((r) => (
              <Badge key={r.key} tone={r.tone}>
                {r.label} · {data.counts[r.key] ?? 0}
              </Badge>
            ))}
          </div>
          <Card className="divide-y divide-line p-0">
            {data.items.map((row) => {
              const r = RESULTS.find((x) => x.key === row.result);
              return (
                <div key={row.session_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="text-sm">
                    <span className="font-medium">
                      {sportLabel(row.sport)} · {levelLabel(row.level)}
                    </span>
                    <span className="block text-xs text-muted">
                      {when(row.start_at)} · {row.court_code}
                    </span>
                  </span>
                  {r ? <Badge tone={r.tone}>{r.label}</Badge> : <Badge tone="muted">Not marked yet</Badge>}
                </div>
              );
            })}
          </Card>
        </>
      )}
    </section>
  );
}
