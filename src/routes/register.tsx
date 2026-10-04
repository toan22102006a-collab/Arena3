import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { ArenaMark } from "@/components/mark";
import { Cover, media } from "@/components/media";
import { Button, Card, DateField, Field, Input } from "@/components/ui";
import { AnimatePresence, motion } from "motion/react";
import { Reveal } from "@/components/motion";
import { GLBackground, Magnet, SplitText, SpotlightCard } from "@/components/fx";
import { apiPost, homeFor, setSession, type SessionUser } from "@/lib/arena3/client";
import { LangSwitch } from "@/components/lang-switch";
import { t, tServer } from "@/lib/i18n";

export const Route = createFileRoute("/register")({ component: Register });

/** Puts a styled node where a translated sentence has its single placeholder. */
const SLOT = "";
const slot = (text: string, node: ReactNode) => {
  const [a, b] = text.split(SLOT);
  return (
    <>
      {a}
      {node}
      {b}
    </>
  );
};

function Register() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"form" | "otp">("form");
  const [otp, setOtp] = useState("");
  const [shown, setShown] = useState("");
  const [busy, setBusy] = useState(false);
  // Nothing about the password is pre-filled. It used to arrive holding the
  // demo password, which is printed in the README and was printed on the sign-in
  // page — so every real member who registered and pressed straight on ended up
  // with an account secured by a credential anyone could read.
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    // The verification code is emailed, so this is not an optional extra —
    // without it there is no way to reach the person signing up.
    email: "",
    password: "",
    dob: "1998-01-15",
    pii_consent: true,
  });
  /** The masked address the code went to, e.g. `ng****@example.com`. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);

  // Only complain once there is something to complain about — a red line under
  // an empty box the moment the page loads is noise, not help.
  const mismatch = confirm.length > 0 && confirm !== form.password;
  const tooWeak =
    form.password.length > 0 && !(form.password.length >= 8 && /[A-Za-z]/.test(form.password) && /\d/.test(form.password));

  async function send(e: FormEvent) {
    e.preventDefault();
    if (form.password !== confirm) {
      toast.error(t("The two passwords do not match."));
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ otp?: string; sent_to?: string | null }>("/auth/register", form);
      setShown(res.otp ?? "");
      setSentTo(res.sent_to ?? null);
      setStep("otp");
      toast.message(
        res.sent_to ? t("Code sent to {email}", { email: res.sent_to }) : t("Code generated — check with the front desk."),
      );
    } catch (err) {
      toast.error(err instanceof Error ? tServer(err.message) : t("Could not create the account"));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiPost<{ token: string; user: SessionUser }>("/auth/otp/verify", {
        phone: form.phone,
        otp,
      });
      setSession(res.token, res.user);
      navigate({ to: homeFor(res.user.role) });
    } catch (err) {
      toast.error(err instanceof Error ? tServer(err.message) : t("That OTP is not right"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-dvh lg:grid lg:grid-cols-2">
      <div className="grain relative hidden overflow-hidden lg:block">
        <Cover src={media.athlete} alt="" className="h-full min-h-dvh" scrim="hero">
          <GLBackground
            variant="threads"
            className="opacity-50 mix-blend-screen"
            color="#eadfcb"
            amplitude={1}
            speed={0.45}
            opacity={0.28}
          />
          <div className="relative flex h-full min-h-dvh flex-col justify-between p-10">
            <Link to="/" className="inline-flex items-center gap-2 self-start rounded-full bg-pass/90 px-3 py-1.5 text-pass-fg">
              <ArenaMark className="size-8" />
              <span className="font-display text-2xl">Arena3</span>
            </Link>
            <div className="max-w-sm rounded-[var(--radius-xl)] bg-pass/92 p-6 text-pass-fg">
              <SplitText
                as="p"
                text={t("A live plan is your key to the courts and the classes.")}
                splitBy="words"
                stagger={0.05}
                delay={0.2}
                className="block font-display text-4xl leading-tight"
              />
            </div>
          </div>
        </Cover>
      </div>
      <div className="relative grid min-h-dvh place-items-center px-4 py-10">
        <LangSwitch className="absolute right-4 top-3 z-10" />
        <Reveal className="w-full max-w-md" from="up">
        <SpotlightCard className="rounded-[var(--radius-xl)]" size={360} strength={0.1}>
        <Card className="relative z-[2] w-full p-6">
          <div className="flex items-center gap-2">
            <ArenaMark className="size-7" />
            <p className="text-2xs uppercase tracking-wider text-muted">Arena3</p>
          </div>
          <h1 className="mt-3 font-display text-3xl">{t("Create an account")}</h1>
          <AnimatePresence mode="wait">
          {step === "form" ? (
            <motion.form
              key="form"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="mt-6 grid gap-4"
              onSubmit={send}
            >
              <Field label={t("Full name")}>
                <Input
                  required
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                />
              </Field>
              <Field label={t("Phone number")}>
                <Input
                  required
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="0901…"
                />
              </Field>
              <Field label={t("Date of birth")}>
                <DateField value={form.dob} onChange={(v) => setForm({ ...form, dob: v })} aria-label={t("Date of birth")} />
              </Field>
              <Field label={t("Password")} hint={tooWeak ? t("At least 8 characters, with a letter and a number.") : undefined}>
                <div className="relative">
                  <Input
                    required
                    type={show ? "text" : "password"}
                    value={form.password}
                    autoComplete="new-password"
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className={cn("pr-12", tooWeak && "border-danger/60")}
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1 grid size-9 place-items-center text-muted hover:text-fg"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? t("Hide password") : t("Show password")}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
              <Field
                label={t("Email")}
                tone="muted"
                hint={t("Where your verification code is sent, and how you recover the account.")}
              >
                <Input
                  required
                  type="email"
                  autoComplete="email"
                  placeholder="ban@example.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label={t("Confirm password")} hint={mismatch ? t("The two passwords do not match.") : undefined}>
                <Input
                  required
                  type={show ? "text" : "password"}
                  value={confirm}
                  autoComplete="new-password"
                  onChange={(e) => setConfirm(e.target.value)}
                  className={cn(mismatch && "border-danger/60")}
                />
              </Field>
              <label className="flex items-start gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--color-accent)]"
                  checked={form.pii_consent}
                  onChange={(e) => setForm({ ...form, pii_consent: e.target.checked })}
                />
                {t("I agree to the terms and to Decree 13/2023 on personal data protection.")}
              </label>
              <Magnet radius={140} pull={0.22} wrapperClassName="w-full" className="w-full">
                <Button
                  type="submit"
                  disabled={busy || mismatch || tooWeak || !form.password || !form.email}
                  className="w-full"
                >
                  {busy ? t("Sending…") : t("Send OTP")}
                </Button>
              </Magnet>
            </motion.form>
          ) : (
            <motion.form
              key="otp"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="mt-6 grid gap-4"
              onSubmit={verify}
            >
              {/*
                Say where the code went. Somebody staring at an empty code box
                needs to know which inbox to open before anything else.
              */}
              <p className="rounded-[var(--radius-md)] bg-wood px-3 py-2 text-sm">
                {sentTo ? (
                  <>
                    {slot(t("We emailed a code to {email}. It expires in 5 minutes.", { email: SLOT }), <span className="font-medium">{sentTo}</span>)}
                  </>
                ) : (
                  <>{t("We could not email the code. Ask the front desk to verify you in person.")}</>
                )}
              </p>
              {shown ? (
                <p className="rounded-[var(--radius-md)] border border-hold/40 px-3 py-2 text-sm text-hold">
                  {slot(t("Demo build — the code is {code}.", { code: SLOT }), <span className="font-medium tabular-nums">{shown}</span>)}
                </p>
              ) : null}
              <Field label={t("6-digit OTP")}>
                <Input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" />
              </Field>
              <Magnet radius={140} pull={0.22} wrapperClassName="w-full" className="w-full">
                <Button type="submit" disabled={busy} className="w-full">
                  {t("Verify")}
                </Button>
              </Magnet>
            </motion.form>
          )}
          </AnimatePresence>
          <p className="mt-4 text-sm text-muted">
            {t("Already have an account?")}{" "}
            <Link to="/login" className="text-accent-2 underline underline-offset-2">
              {t("Sign in")}
            </Link>
          </p>
        </Card>
        </SpotlightCard>
        </Reveal>
      </div>
    </main>
  );
}
