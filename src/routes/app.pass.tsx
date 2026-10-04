import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Skeleton } from "@/components/ui";
import { apiGet, apiPost } from "@/lib/arena3/client";
import { t } from "@/lib/i18n";

export const Route = createFileRoute("/app/pass")({ component: Page });

type Token = { token: string; expires_at: string; ttl_seconds: number };

/** Redraw a little early so a code is never shown in its last seconds (UI-22). */
const REFRESH_MARGIN_MS = 5000;

function Page() {
  const [tok, setTok] = useState<Token | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selfCode, setSelfCode] = useState("");
  const [selfBusy, setSelfBusy] = useState(false);
  const [inside, setInside] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await apiGet<Token>("/me/checkin-token");
      setError(null);
      setTok(next);
      setImg(await QRCode.toDataURL(next.token, { margin: 1, width: 320, errorCorrectionLevel: "M" }));
      if (timer.current) clearTimeout(timer.current);
      const wait = Math.max(5000, new Date(next.expires_at).getTime() - Date.now() - REFRESH_MARGIN_MS);
      timer.current = setTimeout(() => void refresh(), wait);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not make a code"));
      timer.current = setTimeout(() => void refresh(), 15000);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // A phone that was asleep when the code ran out wakes up to a dead code.
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!tok) return;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(tok.expires_at).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [tok]);

  const sendSelf = useCallback(async (code: string) => {
    setSelfBusy(true);
    try {
      const res = await apiPost<{ allowed: boolean; duplicate?: boolean; message?: string }>("/me/self-checkin", {
        token: code,
      });
      if (res.allowed) {
        setInside(res.duplicate ? t("You are already checked in today.") : t("You are checked in. Enjoy your session."));
        setSelfCode("");
      } else {
        toast.error(res.message ?? t("Please see the front desk."));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("That code did not work"));
    } finally {
      setSelfBusy(false);
    }
  }, []);

  // The desk screen shows a QR that opens this page with the code attached, so
  // a member only needs their phone camera (SRS FR-TRN-02).
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("d");
    if (!d) return;
    window.history.replaceState(null, "", window.location.pathname);
    void sendSelf(d);
  }, [sendSelf]);

  function selfCheckin(e: React.FormEvent) {
    e.preventDefault();
    if (selfCode.trim()) void sendSelf(selfCode.trim());
  }

  return (
    <Shell
      role="member"
      title={t("Gate pass")}
      subtitle={t("Show this code to the front desk. It changes every minute, so a photo of it is no use to anyone.")}
    >
      <div className="grid max-w-md gap-4">
        <Card className="grid place-items-center gap-3 p-6">
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : img ? (
            // The code must stay readable in sunlight: white tile, no theming.
            <img src={img} alt={t("Your check-in code")} className="size-64 rounded-[var(--radius-md)] bg-white p-2" />
          ) : (
            <Skeleton className="size-64" />
          )}
          <div className="flex items-center gap-2">
            <Badge tone={left > 10 ? "accent" : "hold"}>{tok ? t("Valid for {n}s", { n: left }) : t("Making a code…")}</Badge>
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>
              {t("New code")}
            </Button>
          </div>
          <p className="text-center text-xs text-muted">
            {t("This only lets the desk see who you are. It does not use up a session or change your plan.")}
          </p>
        </Card>

        <Card>
          <form onSubmit={selfCheckin} className="grid gap-3">
            <Field tone="muted"
              label={t("Check yourself in")}
              hint={t("Only when the centre has turned this on. Scan the code on the front-desk screen with your phone camera — or paste what it reads.")}
            >
              <Input value={selfCode} onChange={(e) => setSelfCode(e.target.value)} placeholder={t("Code from the desk screen")} />
            </Field>
            <div>
              <Button type="submit" variant="outline" disabled={selfBusy || !selfCode.trim()}>
                {selfBusy ? t("Checking…") : t("Check in")}
              </Button>
            </div>
            {inside ? <p className="text-sm text-accent">{inside}</p> : null}
          </form>
        </Card>
      </div>
    </Shell>
  );
}
