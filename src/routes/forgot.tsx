import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Field, Input } from "@/components/ui";
import { AnimatePresence, motion } from "@/components/motion";
import { apiPost } from "@/lib/arena3/client";
import { cn } from "@/lib/cn";

/**
 * Recover an account with a code sent to the email on file.
 *
 * The server side of this existed and had nothing in front of it: a member who
 * forgot their password had no route back in except asking the front desk to
 * do it for them, which is both a support burden and a worse answer than a
 * code only they can read.
 *
 * Two deliberate choices about what this screen does NOT reveal:
 *
 *  - It never says whether a phone number has an account. The wording after
 *    step one is the same either way, because "no account with that number"
 *    turns this page into a way of finding out who is a member here.
 *  - It never shows the email address it sent to in full. The server returns a
 *    masked form (`ng****@example.com`), enough to remind the owner which inbox
 *    to open and not enough to hand a stranger an address.
 */

export const Route = createFileRoute("/forgot")({ component: Forgot });

function Forgot() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"phone" | "reset">("phone");
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [demoOtp, setDemoOtp] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;
  const tooWeak =
    password.length > 0 && !(password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password));

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiPost<{ sent_to?: string | null; otp?: string }>("/auth/password/forgot", {
        phone,
      });
      setSentTo(res.sent_to ?? null);
      setDemoOtp(res.otp ?? null);
      setStep("reset");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send a code");
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await apiPost("/auth/otp/verify", { phone, otp, purpose: "reset", password });
      toast.success("Password changed — sign in with the new one.");
      void navigate({ to: "/login" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That code is not right");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-4">
      <Card className="w-full p-6">
        <h1 className="font-display text-3xl">Forgot your password</h1>

        <AnimatePresence mode="wait">
          {step === "phone" ? (
            <motion.form
              key="phone"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="mt-6 grid gap-4"
              onSubmit={requestCode}
            >
              <p className="text-sm text-muted">
                Enter the phone number on your account. We will email a code to the address we hold for
                it.
              </p>
              <Field label="Phone">
                <Input
                  required
                  value={phone}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0901 234 567"
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={busy || !phone} className="w-full">
                {busy ? "Sending…" : "Send the code"}
              </Button>
            </motion.form>
          ) : (
            <motion.form
              key="reset"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="mt-6 grid gap-4"
              onSubmit={reset}
            >
              {/*
                Same wording whether or not that number has an account — this
                page must not be usable to find out who is a member here.
              */}
              <p className="rounded-[var(--radius-md)] bg-wood px-3 py-2 text-sm">
                {sentTo ? (
                  <>
                    If that number has an account, a code is on its way to{" "}
                    <span className="font-medium">{sentTo}</span>. It expires in 5 minutes.
                  </>
                ) : (
                  <>
                    If that number has an account with an email on file, a code is on its way. It expires
                    in 5 minutes.
                  </>
                )}
              </p>
              {demoOtp ? (
                <p className="rounded-[var(--radius-md)] border border-hold/40 px-3 py-2 text-sm text-hold">
                  Demo build — the code is <span className="font-medium tabular-nums">{demoOtp}</span>.
                </p>
              ) : null}

              <Field label="6-digit code">
                <Input
                  required
                  value={otp}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  onChange={(e) => setOtp(e.target.value)}
                />
              </Field>
              <Field label="New password" hint={tooWeak ? "At least 8 characters, letters and digits." : undefined}>
                <div className="relative">
                  <Input
                    required
                    type={show ? "text" : "password"}
                    value={password}
                    autoComplete="new-password"
                    onChange={(e) => setPassword(e.target.value)}
                    className={cn(tooWeak && "border-danger/60")}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-3 grid place-items-center text-muted"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? "Hide password" : "Show password"}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Confirm password" hint={mismatch ? "The two passwords do not match." : undefined}>
                <Input
                  required
                  type={show ? "text" : "password"}
                  value={confirm}
                  autoComplete="new-password"
                  onChange={(e) => setConfirm(e.target.value)}
                  className={cn(mismatch && "border-danger/60")}
                />
              </Field>
              <Button
                type="submit"
                disabled={busy || !otp || !password || mismatch || tooWeak}
                className="w-full"
              >
                {busy ? "Changing…" : "Change the password"}
              </Button>
            </motion.form>
          )}
        </AnimatePresence>

        <p className="mt-6 text-sm text-muted">
          Remembered it?{" "}
          <Link to="/login" className="text-accent-2 hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}
