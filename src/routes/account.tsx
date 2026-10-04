import { createFileRoute } from "@tanstack/react-router";
import { Download, Eye, EyeOff, KeyRound, Receipt, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Guard, Shell, money, useSessionUser, when } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Field, Input, Label, Seg, Skeleton, Textarea } from "@/components/ui";
import { Lift, Stagger, StaggerItem } from "@/components/motion";
import { SpotlightCard, StarBorder } from "@/components/fx";
import {
  apiGet,
  apiPatch,
  apiPost,
  getStoredUser,
  homeFor,
  openInvoice,
  setStoredUser,
  type SessionUser,
} from "@/lib/arena3/client";
import { formatDate } from "@/lib/arena3/labels";
import { t, tk } from "@/lib/i18n";

export const Route = createFileRoute("/account")({ component: Page });

type Invoice = {
  id: string;
  code: string;
  issued_at: string;
  payment_code: string;
  method: string;
  amount_vnd: number;
  status: string;
  ref_type: string;
};

const METHOD: Record<string, string> = {
  cash: tk("Cash"),
  transfer: tk("Bank transfer"),
  card: tk("Card"),
};

const REF: Record<string, string> = {
  booking: tk("Court booking"),
  subscription: tk("Membership"),
  enrollment: tk("Class"),
  loan: tk("Equipment"),
  walkin: tk("Walk-in"),
};

function Page() {
  const user = useSessionUser();
  const [tab, setTab] = useState(() => (getStoredUser()?.must_change_password ? "security" : "profile"));

  return (
    <Guard roles={["member", "receptionist", "coach", "manager"]}>
      <Shell
        role={user?.role ?? "member"}
        title={t("Account settings")}
        subtitle={t("Your details, your password, your receipts, and anything you have asked us.")}
      >
        <div className="mb-5">
          <Seg
            value={tab}
            onChange={setTab}
            options={[
              { value: "profile", label: t("Profile") },
              { value: "security", label: t("Security") },
              // Staff take payments, they do not make them: their receipts are
              // the centre's, and live under Payments (D-04).
              ...(user?.role === "member" || !user ? [{ value: "receipts", label: t("Receipts") }] : []),
              { value: "support", label: t("Support") },
            ]}
          />
        </div>
        {tab === "profile" ? <Profile user={user} /> : null}
        {tab === "security" ? <Security forced={!!user?.must_change_password} /> : null}
        {tab === "receipts" ? <Receipts /> : null}
        {tab === "support" ? <Support /> : null}
      </Shell>
    </Guard>
  );
}

function Profile({ user }: { user: SessionUser | null }) {
  const [form, setForm] = useState({ full_name: "", health_notes: "" });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  // Seed from the cached session the moment it arrives, then let `/me` correct
  // it — the cached copy paints instantly, the server copy is authoritative.
  useEffect(() => {
    if (!user || loaded) return;
    setForm({ full_name: user.full_name, health_notes: user.health_notes ?? "" });
    setLoaded(true);
  }, [user, loaded]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiPatch<{ user: SessionUser }>("/me", form);
      setStoredUser(res.user);
      toast.success(t("Saved."));
      // The header reads the cached user once on mount, so a reload is the
      // honest way to show the new name everywhere at once.
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Could not save your details"));
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <Skeleton className="h-72" />;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <SpotlightCard className="rounded-[var(--radius-xl)]" size={420} strength={0.09}>
        <Card className="relative z-[2] p-6">
          <div className="mb-5 flex items-center gap-2.5">
            <UserRound className="size-4 text-accent" strokeWidth={1.75} />
            <h2 className="font-display text-xl">{t("Your details")}</h2>
          </div>
          <form className="grid gap-4" onSubmit={save}>
            <Field label={t("Full name")}>
              <Input
                required
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </Field>
            <Field
              label={t("Health notes")}
              tone="muted"
              hint={t("Coaches see this before a session — injuries, asthma, anything they should know.")}
            >
              <Textarea
                rows={3}
                value={form.health_notes}
                placeholder={t("Nothing to declare")}
                onChange={(e) => setForm({ ...form, health_notes: e.target.value })}
              />
            </Field>
            <div className="flex items-center gap-3 pt-1">
              <StarBorder speed={4}>
                <Button type="submit" disabled={busy}>
                  {busy ? t("Saving…") : t("Save changes")}
                </Button>
              </StarBorder>
            </div>
          </form>
        </Card>
      </SpotlightCard>

      <Card className="h-fit p-6">
        <Label>{t("Cannot be changed here")}</Label>
        <dl className="mt-4 grid gap-4">
          <Row label={t("Phone")} value={user.phone} note={t("Ask the desk — changing it needs an OTP.")} />
          <Row label={t("Email")} value={user.email ?? t("Not set")} />
          <Row
            label={t("Date of birth")}
            value={user.date_of_birth ? formatDate(user.date_of_birth) : t("Not set")}
          />
          {user.member_code ? <Row label={t("Member code")} value={user.member_code} mono /> : null}
        </dl>
      </Card>
    </div>
  );
}

function Row({ label, value, note, mono }: { label: string; value: string; note?: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wider text-subtle">{label}</dt>
      <dd className={mono ? "mt-0.5 font-mono text-sm font-semibold tracking-wider" : "mt-0.5 text-sm"}>{value}</dd>
      {note ? <dd className="mt-1 text-xs text-subtle">{note}</dd> : null}
    </div>
  );
}

function Security({ forced }: { forced: boolean }) {
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const mismatch = form.confirm_password.length > 0 && form.confirm_password !== form.new_password;
  const tooWeak =
    form.new_password.length > 0 &&
    !(form.new_password.length >= 8 && /[A-Za-z]/.test(form.new_password) && /\d/.test(form.new_password));
  const ready = form.current_password.length > 0 && form.new_password.length > 0 && !mismatch && !tooWeak;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await apiPost("/me/password", form);
      setForm({ current_password: "", new_password: "", confirm_password: "" });
      toast.success(t("Password changed. Your other devices stay signed in."));
      const u = getStoredUser();
      if (u?.must_change_password) {
        setStoredUser({ ...u, must_change_password: false });
        // Let the menu and guard see the cleared flag.
        window.location.assign(homeFor(u.role));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Could not change your password"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SpotlightCard className="max-w-xl rounded-[var(--radius-xl)]" size={420} strength={0.09}>
      <Card className="relative z-[2] p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <KeyRound className="size-4 text-accent" strokeWidth={1.75} />
          <h2 className="font-display text-xl">{t("Change password")}</h2>
        </div>
        {forced ? (
          <p className="mb-4 rounded-[var(--radius-md)] bg-wood px-3 py-2 text-sm">
            {t(
              "You signed in with a temporary password. Choose your own to continue — enter the temporary one as the current password.",
            )}
          </p>
        ) : null}
        <form className="grid gap-4" onSubmit={submit}>
          <Field label={t("Current password")}>
            <Input
              required
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={form.current_password}
              onChange={(e) => setForm({ ...form, current_password: e.target.value })}
            />
          </Field>
          <Field
            label={t("New password")}
            hint={tooWeak ? t("At least 8 characters, with a letter and a number.") : undefined}
          >
            <div className="relative">
              <Input
                required
                type={show ? "text" : "password"}
                autoComplete="new-password"
                className="pr-12"
                value={form.new_password}
                onChange={(e) => setForm({ ...form, new_password: e.target.value })}
              />
              <button
                type="button"
                className="absolute right-1 top-1 grid size-9 place-items-center text-muted hover:text-fg"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? t("Hide passwords") : t("Show passwords")}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <Field
            label={t("Confirm new password")}
            hint={mismatch ? t("The two passwords do not match.") : undefined}
          >
            <Input
              required
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={form.confirm_password}
              onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
            />
          </Field>
          <div className="pt-1">
            <Button type="submit" disabled={busy || !ready}>
              {busy ? t("Changing…") : t("Change password")}
            </Button>
          </div>
        </form>
      </Card>
    </SpotlightCard>
  );
}

type Ticket = {
  id: string;
  body: string;
  status: string;
  created_at: string;
  reply: string | null;
  replied_at: string | null;
  replied_by_name: string | null;
};

/**
 * Customer care, from the member's side.
 *
 * Until now the only way to reach the desk was to type «ticket: …» at the
 * assistant, which opened a row nobody could answer and pointed the member at
 * no screen. Everything else in this app — a booking, a class, a receipt — can
 * be looked up afterwards; a complaint was the one thing you sent into silence.
 */
function Support() {
  const [items, setItems] = useState<Ticket[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await apiGet<{ items: Ticket[] }>("/tickets/mine");
    setItems(r.items);
  }

  useEffect(() => {
    void load().catch((e) => toast.error(e instanceof Error ? e.message : t("Could not load your requests")));
  }, []);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (text.length < 2 || busy) return;
    setBusy(true);
    try {
      await apiPost("/tickets", { body: text });
      setBody("");
      await load();
      toast.success(t("Sent to the front desk"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Could not send that"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Card className="p-5">
        <h2 className="font-display text-xl">{t("Ask the front desk")}</h2>
        <p className="mt-1 text-sm text-muted">
          {t(
            "A question, a complaint, something broken on a court. Reception answers during opening hours and the reply shows up here.",
          )}
        </p>
        <form className="mt-3 grid gap-3" onSubmit={send}>
          <Field label={t("Your message")}>
            <Textarea
              rows={3}
              maxLength={2000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("The lights over BC2 have been out since Tuesday…")}
            />
          </Field>
          <div>
            <StarBorder>
              <Button type="submit" disabled={busy || body.trim().length < 2}>
                {busy ? t("Sending…") : t("Send to reception")}
              </Button>
            </StarBorder>
          </div>
        </form>
      </Card>

      {!items ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <EmptyState title={t("Nothing asked yet")} hint={t("Anything you send the desk will be kept here with its reply.")} />
      ) : (
        <Stagger className="grid gap-2.5" gap={0.05}>
          {items.map((tix) => (
            <StaggerItem key={tix.id}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  {/* `break-words` is doing real work: this is text somebody
                      typed, and a long run without a space — a pasted URL, or
                      the "ticket:ticket:ticket:" that older rows still carry —
                      has nothing to wrap on and pushes the badge off the card. */}
                  <p className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm">{tix.body}</p>
                  <Badge tone={tix.reply ? "accent" : "hold"} className="shrink-0">
                    {tix.reply ? t("Answered") : t("Waiting")}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted">{when(tix.created_at)}</p>
                {tix.reply ? (
                  /* Indented and on the wood tone so the reply reads as somebody
                     else speaking, not as more of the member's own message. */
                  <div className="mt-3 rounded-[var(--radius-md)] border-l-2 border-accent bg-wood/50 p-3">
                    <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm">{tix.reply}</p>
                    <p className="mt-1 text-2xs text-muted">
                      {tix.replied_by_name ?? t("Reception")}
                      {tix.replied_at ? ` · ${when(tix.replied_at)}` : ""}
                    </p>
                  </div>
                ) : null}
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}

function Receipts() {
  const [items, setItems] = useState<Invoice[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: Invoice[] }>("/invoices")
      .then((r) => setItems(r.items))
      .catch((e) => toast.error(e instanceof Error ? e.message : t("Could not load your receipts")));
  }, []);

  if (!items) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title={t("No receipts yet")}
        hint={t("Every payment you make — court, class or membership — lands here as a PDF you can download.")}
      />
    );
  }

  return (
    <Stagger className="grid gap-2.5" gap={0.05}>
      {items.map((r) => (
        <StaggerItem key={r.id}>
          <Lift amount={-2}>
            <Card className="flex flex-wrap items-center gap-x-5 gap-y-3 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-wood text-muted">
                <Receipt className="size-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-[8rem] flex-1">
                <p className="font-mono text-sm font-semibold tracking-wide">{r.code}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {REF[r.ref_type] ? t(REF[r.ref_type]) : r.ref_type} · {when(r.issued_at)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-lg tabular-nums">{money(r.amount_vnd)}</p>
                <p className="text-2xs text-subtle">{METHOD[r.method] ? t(METHOD[r.method]) : r.method}</p>
              </div>
              {r.status !== "posted" ? <Badge tone="danger">{t("Refunded")}</Badge> : null}
              <Button
                variant="outline"
                size="sm"
                disabled={opening === r.id}
                onClick={async () => {
                  setOpening(r.id);
                  try {
                    await openInvoice(r.id);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : t("Could not open that receipt"));
                  } finally {
                    setOpening(null);
                  }
                }}
              >
                <Download className="size-3.5" strokeWidth={2} />
                {opening === r.id ? t("Opening…") : t("PDF")}
              </Button>
            </Card>
          </Lift>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
