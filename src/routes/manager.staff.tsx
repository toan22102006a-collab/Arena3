import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell, when } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton } from "@/components/ui";
import { ApiClientError, apiGet, apiPost, apiPatch } from "@/lib/arena3/client";
import { roleLabel, sportLabel } from "@/lib/arena3/labels";
import { t, tServer } from "@/lib/i18n";

export const Route = createFileRoute("/manager/staff")({ component: Page });

type Staff = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  role: string;
  status: string;
  must_change_password: boolean;
  created_at: string;
  sports: string[] | null;
  open_sessions: number;
  issued_by: string | null;
  issued_at: string | null;
};

const SPORTS = ["badminton", "basketball", "volleyball", "all"] as const;

type Issued = { name: string; phone: string; password: string; why: string };

function Page() {
  const [items, setItems] = useState<Staff[] | null>(null);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [editing, setEditing] = useState<Staff | null>(null);

  async function load() {
    const qs = new URLSearchParams();
    if (role) qs.set("role", role);
    if (status) qs.set("status", status);
    if (q.trim()) qs.set("q", q.trim());
    const r = await apiGet<{ items: Staff[] }>(`/staff${qs.size ? `?${qs}` : ""}`);
    setItems(r.items);
  }
  useEffect(() => {
    const timer = setTimeout(() => void load().catch((e) => toast.error(tServer(e.message))), q ? 200 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, status, q]);

  async function act(s: Staff, what: "lock" | "unlock" | "reset" | "revoke") {
    try {
      if (what === "lock" || what === "unlock") {
        await apiPatch(`/staff/${s.id}`, { status: what === "lock" ? "locked" : "active" });
        toast.success(
          what === "lock"
            ? t("{name} is locked out", { name: s.full_name })
            : t("{name} can sign in again", { name: s.full_name }),
        );
      } else if (what === "reset") {
        const r = await apiPost<{ temp_password: string }>(`/staff/${s.id}/reset-password`);
        setIssued({
          name: s.full_name,
          phone: s.phone,
          password: r.temp_password,
          why: t("Password reset. Every open session for this account was signed out."),
        });
      } else {
        const r = await apiPost<{ revoked: number }>(`/staff/${s.id}/revoke-sessions`);
        toast.success(
          r.revoked
            ? t("Signed {name} out of {n} session(s)", { name: s.full_name, n: r.revoked })
            : t("No open sessions"),
        );
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
    }
  }

  return (
    <Shell
      role="manager"
      title={t("Staff")}
      subtitle={t("Receptionist and coach logins are issued here and nowhere else. Members sign themselves up.")}
    >
      <Card className="mb-4 grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
        <Input aria-label={t("Search staff")} placeholder={t("Search name, phone or email")} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label={t("Role")} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">{t("All roles")}</option>
          <option value="receptionist">{t("Receptionist")}</option>
          <option value="coach">{t("Coach")}</option>
          <option value="manager">{t("Manager")}</option>
        </Select>
        <Select aria-label={t("Status")} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("Any status")}</option>
          <option value="active">{t("Active")}</option>
          <option value="locked">{t("Locked")}</option>
        </Select>
        <Button onClick={() => setCreating(true)}>{t("Add staff")}</Button>
      </Card>

      {!items ? (
        <Skeleton className="h-40" />
      ) : !items.length ? (
        <EmptyState
          title={role || status || q ? t("Nobody matches those filters") : t("No staff accounts yet")}
          hint={role || status || q ? t("Clear a filter to see everyone.") : t("Add the first receptionist or coach to give them a login.")}
        >
          {!(role || status || q) ? <Button onClick={() => setCreating(true)}>{t("Add staff")}</Button> : null}
        </EmptyState>
      ) : (
        <div className="grid gap-2">
          {items.map((s) => {
            const managed = s.role === "receptionist" || s.role === "coach";
            return (
              <Card key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {s.full_name}
                    <Badge tone={s.role === "manager" ? "ink" : "accent"}>{roleLabel(s.role)}</Badge>
                    {s.status !== "active" ? <Badge tone="danger">{t("Locked")}</Badge> : null}
                    {s.must_change_password ? <Badge tone="hold">{t("Must change password")}</Badge> : null}
                  </p>
                  <p className="text-sm tabular-nums text-muted">
                    {s.phone}
                    {s.email ? ` · ${s.email}` : ""}
                    {s.role === "coach" && s.sports?.length ? ` · ${s.sports.map(sportLabel).join(", ")}` : ""}
                  </p>
                  <p className="text-xs text-muted">
                    {s.issued_at
                      ? t("Issued by {name} · {when}", { name: s.issued_by ?? "—", when: when(s.issued_at) })
                      : t("Seeded account")}{" "}
                    · {s.open_sessions === 1 ? t("1 open session") : t("{n} open sessions", { n: s.open_sessions })}
                  </p>
                </div>
                {managed ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                      {t("Role")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void act(s, "reset")}>
                      {t("Reset password")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!s.open_sessions}
                      onClick={() => void act(s, "revoke")}
                    >
                      {t("Sign out everywhere")}
                    </Button>
                    {s.status === "active" ? (
                      <Button size="sm" variant="danger" onClick={() => void act(s, "lock")}>
                        {t("Lock")}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => void act(s, "unlock")}>
                        {t("Unlock")}
                      </Button>
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <CreateModal
        open={creating}
        onClose={() => setCreating(false)}
        onDone={(i) => {
          setCreating(false);
          setIssued(i);
          void load();
        }}
      />
      <RoleModal
        staff={editing}
        onClose={() => setEditing(null)}
        onDone={() => {
          setEditing(null);
          void load();
        }}
      />
      <Modal
        open={!!issued}
        onClose={() => setIssued(null)}
        title={t("Hand this over now")}
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setIssued(null)}>{t("Done")}</Button>
          </div>
        }
      >
        {issued ? (
          <div className="grid gap-3 text-sm">
            <p>{issued.why}</p>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-1">
              <dt className="text-muted">{t("Account")}</dt>
              <dd className="font-medium">{issued.name}</dd>
              <dt className="text-muted">{t("Sign in with")}</dt>
              <dd className="tabular-nums">{issued.phone}</dd>
              <dt className="text-muted">{t("Temporary password")}</dt>
              <dd className="select-all font-mono text-base">{issued.password}</dd>
            </dl>
            <p className="text-xs text-muted">
              {t("This is the only time it is shown. They will be asked to choose their own at first sign-in.")}
            </p>
          </div>
        ) : null}
      </Modal>
    </Shell>
  );
}

function SportPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SPORTS.map((s) => {
        const on = value.includes(s);
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== s) : [...value, s])}
            className={`rounded-full px-3 py-1 text-sm ${on ? "bg-accent text-white" : "bg-wood text-muted"}`}
          >
            {s === "all" ? t("Any sport") : sportLabel(s)}
          </button>
        );
      })}
    </div>
  );
}

function CreateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (i: Issued) => void }) {
  const [f, setF] = useState({ full_name: "", phone: "", email: "", role: "receptionist" });
  const [sports, setSports] = useState<string[]>([]);
  const [fe, setFe] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const bad = (field: string) => (fe?.field === field ? fe.message : undefined);

  async function submit() {
    setFe(null);
    setBusy(true);
    try {
      const r = await apiPost<{ staff: Staff; temp_password: string }>("/staff", {
        ...f,
        email: f.email || undefined,
        sports: f.role === "coach" ? sports : undefined,
      });
      setF({ full_name: "", phone: "", email: "", role: "receptionist" });
      setSports([]);
      onDone({
        name: r.staff.full_name,
        phone: r.staff.phone,
        password: r.temp_password,
        why: t("{role} account created.", { role: roleLabel(r.staff.role) }),
      });
    } catch (e) {
      if (e instanceof ApiClientError && e.body.field) setFe({ field: e.body.field, message: tServer(e.message) });
      else toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Add staff")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {t("Create account")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Field label={t("Role")}>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="receptionist">{t("Receptionist")}</option>
            <option value="coach">{t("Coach")}</option>
          </Select>
        </Field>
        <Field label={t("Full name")} hint={bad("full_name")}>
          <Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        </Field>
        <Field label={t("Phone")} hint={bad("phone")}>
          <Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label={t("Email (optional)")} hint={bad("email")}>
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        {f.role === "coach" ? (
          <Field label={t("Sports they teach")} hint={bad("sports")}>
            <SportPicker value={sports} onChange={setSports} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

function RoleModal({ staff, onClose, onDone }: { staff: Staff | null; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState("receptionist");
  const [sports, setSports] = useState<string[]>([]);
  const [fe, setFe] = useState<string | null>(null);

  useEffect(() => {
    if (staff) {
      setRole(staff.role);
      setSports(staff.sports ?? []);
      setFe(null);
    }
  }, [staff]);

  async function save() {
    if (!staff) return;
    try {
      await apiPatch(`/staff/${staff.id}`, { role, sports: role === "coach" ? sports : undefined });
      toast.success(t("{name} is now {role}. They were signed out.", { name: staff.full_name, role: roleLabel(role).toLowerCase() }));
      onDone();
    } catch (e) {
      setFe(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
    }
  }

  return (
    <Modal
      open={!!staff}
      onClose={onClose}
      title={staff ? t("Role · {name}", { name: staff.full_name }) : t("Role")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void save()}>{t("Save")}</Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Field label={t("Role")}>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="receptionist">{t("Receptionist")}</option>
            <option value="coach">{t("Coach")}</option>
          </Select>
        </Field>
        {role === "coach" ? (
          <Field label={t("Sports they teach")}>
            <SportPicker value={sports} onChange={setSports} />
          </Field>
        ) : null}
        {fe ? <p className="text-sm text-danger">{fe}</p> : null}
        <p className="text-xs text-muted">{t("Changing the role signs them out so the new permissions apply at the next sign-in.")}</p>
      </div>
    </Modal>
  );
}
