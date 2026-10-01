import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell, hhmm, useSessionUser } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Field, Input } from "@/components/ui";
import { SplitText } from "@/components/fx";
import { apiGet, apiPost } from "@/lib/arena3/client";
import { sportLabel } from "@/lib/arena3/labels";

export const Route = createFileRoute("/desk/gate")({ component: Page });

type Result = {
  member: { id: string; full_name: string; member_code: string | null };
  checked_in_at: string;
  duplicate: boolean;
  plans: Array<{ id: string; name: string; end_on: string; session_left: number | null; status: string }>;
  warnings: Array<{ kind: string; message: string }>;
  today: {
    bookings: Array<{ id: string; code: string; start_at: string; court_code: string }>;
    sessions: Array<{ id: string; start_at: string; sport: string; court_code: string }>;
  };
};

type Entry = { id: string; at: string; user_id: string; full_name: string; member_code: string | null };

function Page() {
  const user = useSessionUser();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState<Entry[] | null>(null);

  const loadToday = useCallback(async () => {
    try {
      setToday((await apiGet<{ items: Entry[] }>("/desk/gate-checkins")).items);
    } catch {
      setToday([]);
    }
  }, []);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    try {
      // A phone number starts with a digit or +; a member code is letters first.
      const body = /^[+0-9][0-9 .-]{7,}$/.test(v) ? { phone: v.replace(/[ .-]/g, "") } : { code: v };
      setResult(await apiPost<Result>("/desk/gate-checkin", body));
      setQ("");
      await loadToday();
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Check-in failed");
      toast.error("That check-in didn't go through");
    } finally {
      setBusy(false);
      // A scanner types into whatever has focus, so hand focus back for the next member.
      setTimeout(() => document.getElementById("gate-q")?.focus(), 0);
    }
  }

  return (
    <Shell role={user?.role === "manager" ? "manager" : "receptionist"} title="Gate" subtitle="Scan a member code or type a phone number to let someone in.">
      <Card className="max-w-xl">
        <form onSubmit={submit} className="grid gap-3">
          <Field label="Member code or phone">
            <Input id="gate-q" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="A3-000123 or 0900 000 000" />
          </Field>
          <div>
            <Button type="submit" disabled={busy || !q.trim()}>
              {busy ? "Checking…" : "Check in"}
            </Button>
          </div>
        </form>
        <p className="mt-3 text-xs text-muted">
          This only records that they walked in. A class register is still the coach's call.
        </p>
      </Card>

      <div aria-live="polite">
        {error ? (
          <Card className="mt-4 max-w-xl border border-danger/30">
            <p className="text-sm text-danger">{error}</p>
          </Card>
        ) : null}
        {result ? (
          <Card className="mt-4 grid max-w-xl gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-display text-2xl">{result.member.full_name}</p>
                <p className="text-xs text-muted">{result.member.member_code}</p>
              </div>
              <Badge tone={result.duplicate ? "hold" : "accent"}>
                {result.duplicate ? `Already in at ${hhmm(result.checked_in_at)}` : `In at ${hhmm(result.checked_in_at)}`}
              </Badge>
            </div>
            {result.warnings.map((w) => (
              <p key={w.kind + w.message} className="rounded-[var(--radius-sm)] bg-hold/12 px-3 py-2 text-sm text-hold">
                {w.message}
              </p>
            ))}
            {result.plans.map((p) => (
              <p key={p.id} className="text-sm">
                {p.name}
                <span className="text-muted">
                  {" "}
                  · until {p.end_on}
                  {p.session_left != null ? ` · ${p.session_left} sessions left` : ""}
                </span>
              </p>
            ))}
            {result.today.sessions.length || result.today.bookings.length ? (
              <div className="text-sm">
                <p className="kicker text-2xs text-muted">Today</p>
                <ul className="mt-1 grid gap-1">
                  {result.today.sessions.map((s) => (
                    <li key={s.id}>
                      {hhmm(s.start_at)} · {sportLabel(s.sport)} class · {s.court_code}
                    </li>
                  ))}
                  {result.today.bookings.map((b) => (
                    <li key={b.id}>
                      {hhmm(b.start_at)} · court {b.court_code} <span className="text-muted">({b.code})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted">Nothing booked for today.</p>
            )}
          </Card>
        ) : null}
      </div>

      <div className="mt-10">
        <SplitText as="h2" text="Through the gate today" className="font-display text-2xl" />
        <div className="mt-3 grid gap-2">
          {!today ? null : !today.length ? (
            <EmptyState title="Nobody yet today" hint="Check-ins appear here as they happen." />
          ) : (
            today.map((t) => (
              <Card key={t.id} className="flex items-center justify-between p-4">
                <p className="font-medium">
                  {t.full_name} <span className="text-xs text-muted">{t.member_code}</span>
                </p>
                <span className="text-sm tabular-nums text-muted">{hhmm(t.at)}</span>
              </Card>
            ))
          )}
        </div>
      </div>
    </Shell>
  );
}
