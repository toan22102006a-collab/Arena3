import { createFileRoute } from "@tanstack/react-router";
import { SectionTitle } from "@/components/section";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Shell, hhmm, useSessionUser } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Field, Input, Select, Seg } from "@/components/ui";
import { SplitText } from "@/components/fx";
import { ApiClientError, apiGet, apiPost } from "@/lib/arena3/client";
import { sportLabel } from "@/lib/arena3/labels";
import { t, tk, tServer } from "@/lib/i18n";

export const Route = createFileRoute("/desk/gate")({ component: Page });

type Result = {
  member: { id: string; full_name: string; member_code: string | null };
  allowed: boolean;
  needs_override: boolean;
  flagged?: boolean;
  checked_in_at: string | null;
  duplicate: boolean;
  plans: Array<{ id: string; name: string; end_on: string; session_left: number | null; status: string }>;
  warnings: Array<{ kind: string; message: string }>;
  today: {
    bookings: Array<{ id: string; code: string; start_at: string; court_code: string }>;
    sessions: Array<{ id: string; start_at: string; sport: string; court_code: string }>;
  };
};

type Entry = {
  id: string;
  at: string;
  user_id: string;
  full_name: string;
  member_code: string | null;
  method: string | null;
  flagged: boolean;
  reason: string | null;
};

/** What reception picks from when the code could not be used (BR-72). */
const MANUAL_REASONS = [
  { value: "no_phone", label: tk("Member has no phone with them") },
  { value: "dead_battery", label: tk("Phone battery is dead") },
  { value: "qr_failed", label: tk("Code would not scan") },
  { value: "forgot", label: tk("Forgot to open the app") },
  { value: "other", label: tk("Other") },
];

/** Why someone with no plan or booking may still come in. */
const OVERRIDE_REASONS = [
  { value: "renewing", label: tk("Renewing right now") },
  { value: "guest_pass", label: tk("Guest pass") },
  { value: "manager_ok", label: tk("Manager approved") },
  { value: "expired_ok", label: tk("Just expired — grace") },
  { value: "other", label: tk("Other") },
];

const METHOD_LABEL: Record<string, string> = { qr: tk("QR"), manual: tk("Manual"), self: tk("Self") };

/** The wording for a stored reason code, in the current language. */
function reasonLabel(code: string) {
  const hit = [...MANUAL_REASONS, ...OVERRIDE_REASONS].find((r) => r.value === code);
  return hit ? t(hit.label) : code.replace(/_/g, " ");
}

type Pending = { kind: "qr"; token: string } | { kind: "manual"; body: Record<string, unknown> };

function Page() {
  const user = useSessionUser();
  const [mode, setMode] = useState("qr");
  const [scan, setScan] = useState("");
  const [q, setQ] = useState("");
  const [reason, setReason] = useState("no_phone");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [overrideReason, setOverrideReason] = useState("renewing");
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

  const refocus = (id: string) => setTimeout(() => document.getElementById(id)?.focus(), 0);

  async function send(p: Pending, override?: string) {
    setBusy(true);
    setError(null);
    try {
      const extra = override ? { override: true, override_reason: override } : {};
      const res =
        p.kind === "qr"
          ? await apiPost<Result>("/desk/scan", { token: p.token, ...extra })
          : await apiPost<Result>("/desk/gate-checkin", { ...p.body, ...extra });
      setResult(res);
      if (res.needs_override) {
        setPending(p);
      } else {
        setPending(null);
        setScan("");
        setQ("");
        await loadToday();
      }
    } catch (err) {
      setResult(null);
      setPending(null);
      setError(err instanceof Error ? tServer(err.message) : t("Check-in failed"));
      toast.error(t("That check-in didn't go through"));
      if (err instanceof ApiClientError && err.body.field === "reason") setMode("manual");
    } finally {
      setBusy(false);
      refocus(p.kind === "qr" ? "gate-scan" : "gate-q");
    }
  }

  function submitScan(e: React.FormEvent) {
    e.preventDefault();
    const v = scan.trim();
    if (v) void send({ kind: "qr", token: v });
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    // A phone number starts with a digit or +; a member code is letters first.
    const who = /^[+0-9][0-9 .-]{7,}$/.test(v) ? { phone: v.replace(/[ .-]/g, "") } : { code: v };
    void send({ kind: "manual", body: { ...who, reason } });
  }

  return (
    <Shell
      role={user?.role === "manager" ? "manager" : "receptionist"}
      title={t("Gate")}
      subtitle={t("Scan a member's code to let them in. Type a phone number only when the code can't be used.")}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <Card className="grid gap-3">
            <Seg
              value={mode}
              onChange={setMode}
              options={[
                { value: "qr", label: t("Scan code") },
                { value: "manual", label: t("Without a code") },
              ]}
            />
            {mode === "qr" ? (
              <form onSubmit={submitScan} className="grid gap-3">
                <CameraScanner onCode={(c) => void send({ kind: "qr", token: c })} />
                <Field tone="muted" label={t("Scanner input")} hint={t("A handheld scanner types here. Focus stays on this box.")}>
                  <Input
                    id="gate-scan"
                    autoFocus
                    value={scan}
                    onChange={(e) => setScan(e.target.value)}
                    placeholder={t("Point the scanner at the member's phone")}
                    autoComplete="off"
                  />
                </Field>
                <div>
                  <Button type="submit" disabled={busy || !scan.trim()}>
                    {busy ? t("Checking…") : t("Check in")}
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitManual} className="grid gap-3">
                <Field label={t("Member code or phone")}>
                  <Input
                    id="gate-q"
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t("A3-000123 or 0900 000 000")}
                  />
                </Field>
                <Field tone="muted" label={t("Why not the code?")} hint={t("Recorded with the visit so a manager can review it.")}>
                  <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                    {MANUAL_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {t(r.label)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div>
                  <Button type="submit" disabled={busy || !q.trim()}>
                    {busy ? t("Checking…") : t("Check in")}
                  </Button>
                </div>
              </form>
            )}
            <p className="text-xs text-muted">
              {t("This only records that they walked in. It never uses up a session or changes a plan.")}
            </p>
          </Card>

          <SelfCheckinCode />
        </div>

        <div aria-live="polite" className="grid content-start gap-4">
          {error ? (
            <Card className="border border-danger/30">
              <p className="text-sm text-danger">{error}</p>
            </Card>
          ) : null}
          {result ? (
            <Card className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-display text-2xl">{result.member.full_name}</p>
                  <p className="text-xs text-muted">{result.member.member_code}</p>
                </div>
                {result.needs_override ? (
                  <Badge tone="danger">{t("Nothing to enter on")}</Badge>
                ) : (
                  <Badge tone={result.duplicate ? "hold" : "accent"}>
                    {result.duplicate
                      ? t("Already in at {time}", { time: hhmm(result.checked_in_at!) })
                      : t("In at {time}", { time: hhmm(result.checked_in_at!) })}
                  </Badge>
                )}
              </div>
              {result.flagged ? <Badge tone="hold">{t("Flagged for the manager")}</Badge> : null}
              {result.warnings.map((w) => (
                <p key={w.kind + w.message} className="rounded-[var(--radius-sm)] bg-hold/12 px-3 py-2 text-sm text-hold">
                  {tServer(w.message)}
                </p>
              ))}
              {result.plans.map((p) => (
                <p key={p.id} className="text-sm">
                  {p.name}
                  <span className="text-muted">
                    {" "}
                    · {t("until {date}", { date: p.end_on })}
                    {p.session_left != null ? ` · ${t("{n} sessions left", { n: p.session_left })}` : ""}
                  </span>
                </p>
              ))}
              {result.today.sessions.length || result.today.bookings.length ? (
                <div className="text-sm">
                  <p className="kicker text-2xs text-muted">{t("Today")}</p>
                  <ul className="mt-1 grid gap-1">
                    {result.today.sessions.map((s) => (
                      <li key={s.id}>
                        {hhmm(s.start_at)} · {t("{sport} class", { sport: sportLabel(s.sport) })} · {s.court_code}
                      </li>
                    ))}
                    {result.today.bookings.map((b) => (
                      <li key={b.id}>
                        {hhmm(b.start_at)} · {t("court {code}", { code: b.court_code })} <span className="text-muted">({b.code})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted">{t("Nothing booked for today.")}</p>
              )}
              {result.needs_override && pending ? (
                <div className="grid gap-3 rounded-[var(--radius-md)] border border-line p-3">
                  <p className="text-sm">
                    {t("There is no live plan, booking or class for them today. Let them in anyway only with a reason — it is recorded and the manager sees it.")}
                  </p>
                  <Field label={t("Reason")}>
                    <Select value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}>
                      {OVERRIDE_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {t(r.label)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="flex gap-2">
                    <Button disabled={busy} onClick={() => void send(pending, overrideReason)}>
                      {t("Let them in")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setPending(null);
                        setResult(null);
                      }}
                    >
                      {t("Send to the desk")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>

      <div className="mt-10">
        <SectionTitle text={t("Through the gate today")} className="font-display text-2xl" />
        <div className="mt-3 grid gap-2">
          {!today ? null : !today.length ? (
            <EmptyState title={t("Nobody yet today")} hint={t("Check-ins appear here as they happen.")} />
          ) : (
            today.map((row) => (
              <Card key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <p className="font-medium">
                  {row.full_name} <span className="text-xs text-muted">{row.member_code}</span>
                </p>
                <div className="flex items-center gap-2">
                  {row.flagged ? <Badge tone="hold">{t("Flagged")}</Badge> : null}
                  {row.method ? <Badge tone="muted">{METHOD_LABEL[row.method] ? t(METHOD_LABEL[row.method]) : row.method}</Badge> : null}
                  <span className="text-sm tabular-nums text-muted">{hhmm(row.at)}</span>
                </div>
                {row.reason ? (
                  <p className="w-full text-xs text-muted">
                    {t("Reason: {reason}", { reason: reasonLabel(row.reason) })}
                  </p>
                ) : null}
              </Card>
            ))
          )}
        </div>
      </div>
    </Shell>
  );
}

/**
 * Reads the member's phone with the device camera where the browser can
 * (BarcodeDetector); everywhere else the scanner-input box above is the way in.
 */
function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const [on, setOn] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => {
    if (!on) return;
    let stop = false;
    let stream: MediaStream | null = null;
    let last = "";
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
        const loop = async () => {
          if (stop || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            const raw: string | undefined = found[0]?.rawValue;
            if (raw && raw !== last) {
              last = raw;
              onCode(raw);
              setTimeout(() => (last = ""), 4000);
            }
          } catch {
            /* a frame that cannot be read is skipped */
          }
          setTimeout(() => void loop(), 250);
        };
        void loop();
      } catch {
        toast.error(t("The camera is not available — use the scanner box instead."));
        setOn(false);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [on, onCode]);

  if (!supported) return null;
  return (
    <div className="grid gap-2">
      {on ? <video ref={video} muted playsInline className="aspect-video w-full rounded-[var(--radius-md)] bg-black object-cover" /> : null}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOn((v) => !v)}>
          {on ? t("Turn camera off") : t("Use the camera")}
        </Button>
      </div>
    </div>
  );
}

/** The 30-second code members scan to check themselves in, when the centre allows it. */
function SelfCheckinCode() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [img, setImg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const draw = async () => {
      try {
        const res = await apiGet<{ enabled: boolean; token: string; expires_at: string }>("/desk/checkin-qr");
        if (stop) return;
        setEnabled(res.enabled);
        if (res.enabled) {
          const url = `${window.location.origin}/app/pass?d=${encodeURIComponent(res.token)}`;
          setImg(await QRCode.toDataURL(url, { margin: 1, width: 280, errorCorrectionLevel: "M" }));
        }
        const wait = Math.max(5000, new Date(res.expires_at).getTime() - Date.now() - 4000);
        timer = setTimeout(() => void draw(), wait);
      } catch {
        timer = setTimeout(() => void draw(), 10000);
      }
    };
    void draw();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [open]);

  return (
    <Card className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">{t("Self check-in code")}</p>
          <p className="text-xs text-muted">{t("Members scan this screen with their own phone. Changes every 30 seconds.")}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? t("Hide") : t("Show")}
        </Button>
      </div>
      {open && enabled === false ? (
        <p className="text-sm text-muted">{t("Self check-in is switched off. A manager can turn it on in Settings.")}</p>
      ) : null}
      {open && enabled && img ? (
        <img src={img} alt={t("Self check-in code")} className="mx-auto size-56 rounded-[var(--radius-md)] bg-white p-2" />
      ) : null}
    </Card>
  );
}
