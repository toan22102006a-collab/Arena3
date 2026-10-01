import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell, when } from "@/components/shell";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton } from "@/components/ui";
import { ApiClientError, apiGet, apiPost, apiPatch } from "@/lib/arena3/client";
import { roleLabel, sportLabel } from "@/lib/arena3/labels";

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
    const t = setTimeout(() => void load().catch((e) => toast.error(e.message)), q ? 200 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, status, q]);

  async function act(s: Staff, what: "lock" | "unlock" | "reset" | "revoke") {
    try {
      if (what === "lock" || what === "unlock") {
        await apiPatch(`/staff/${s.id}`, { status: what === "lock" ? "locked" : "active" });
        toast.success(what === "lock" ? `${s.full_name} is locked out` : `${s.full_name} can sign in again`);
      } else if (what === "reset") {
        const r = await apiPost<{ temp_password: string }>(`/staff/${s.id}/reset-password`);
        setIssued({
          name: s.full_name,
          phone: s.phone,
          password: r.temp_password,
          why: "Password reset. Every open session for this account was signed out.",
        });
      } else {
        const r = await apiPost<{ revoked: number }>(`/staff/${s.id}/revoke-sessions`);
        toast.success(r.revoked ? `Signed ${s.full_name} out of ${r.revoked} session(s)` : "No open sessions");
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <Shell
      role="manager"
      title="Staff"
      subtitle="Receptionist and coach logins are issued here and nowhere else. Members sign themselves up."
    >
      <Card className="mb-4 grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
        <Input aria-label="Search staff" placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          <option value="receptionist">Receptionist</option>
          <option value="coach">Coach</option>
          <option value="manager">Manager</option>
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="locked">Locked</option>
        </Select>
        <Button onClick={() => setCreating(true)}>Add staff</Button>
      </Card>

      {!items ? (
        <Skeleton className="h-40" />
      ) : !items.length ? (
        <EmptyState
          title={role || status || q ? "Nobody matches those filters" : "No staff accounts yet"}
          hint={role || status || q ? "Clear a filter to see everyone." : "Add the first receptionist or coach to give them a login."}
        >
          {!(role || status || q) ? <Button onClick={() => setCreating(true)}>Add staff</Button> : null}
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
                    {s.status !== "active" ? <Badge tone="danger">Locked</Badge> : null}
                    {s.must_change_password ? <Badge tone="hold">Must change password</Badge> : null}
                  </p>
                  <p className="text-sm tabular-nums text-muted">
                    {s.phone}
                    {s.email ? ` · ${s.email}` : ""}
                    {s.role === "coach" && s.sports?.length ? ` · ${s.sports.map(sportLabel).join(", ")}` : ""}
                  </p>
                  <p className="text-xs text-muted">
                    {s.issued_at ? `Issued by ${s.issued_by ?? "—"} · ${when(s.issued_at)}` : "Seeded account"} ·{" "}
                    {s.open_sessions} open session{s.open_sessions === 1 ? "" : "s"}
                  </p>
                </div>
                {managed ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                      Role
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void act(s, "reset")}>
                      Reset password
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!s.open_sessions}
                      onClick={() => void act(s, "revoke")}
                    >
                      Sign out everywhere
                    </Button>
                    {s.status === "active" ? (
                      <Button size="sm" variant="danger" onClick={() => void act(s, "lock")}>
                        Lock
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => void act(s, "unlock")}>
                        Unlock
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
        title="Hand this over now"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setIssued(null)}>Done</Button>
          </div>
        }
      >
        {issued ? (
          <div className="grid gap-3 text-sm">
            <p>{issued.why}</p>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-1">
              <dt className="text-muted">Account</dt>
              <dd className="font-medium">{issued.name}</dd>
              <dt className="text-muted">Sign in with</dt>
              <dd className="tabular-nums">{issued.phone}</dd>
              <dt className="text-muted">Temporary password</dt>
              <dd className="select-all font-mono text-base">{issued.password}</dd>
            </dl>
            <p className="text-xs text-muted">
              This is the only time it is shown. They will be asked to choose their own at first sign-in.
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
            {s === "all" ? "Any sport" : sportLabel(s)}
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
        why: `${roleLabel(r.staff.role)} account created.`,
      });
    } catch (e) {
      if (e instanceof ApiClientError && e.body.field) setFe({ field: e.body.field, message: e.message });
      else toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add staff"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            Create account
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Field label="Role">
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="receptionist">Receptionist</option>
            <option value="coach">Coach</option>
          </Select>
        </Field>
        <Field label="Full name" hint={bad("full_name")}>
          <Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        </Field>
        <Field label="Phone" hint={bad("phone")}>
          <Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Email (optional)" hint={bad("email")}>
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        {f.role === "coach" ? (
          <Field label="Sports they teach" hint={bad("sports")}>
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
      toast.success(`${staff.full_name} is now ${roleLabel(role).toLowerCase()}. They were signed out.`);
      onDone();
    } catch (e) {
      setFe(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <Modal
      open={!!staff}
      onClose={onClose}
      title={staff ? `Role · ${staff.full_name}` : "Role"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save</Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="receptionist">Receptionist</option>
            <option value="coach">Coach</option>
          </Select>
        </Field>
        {role === "coach" ? (
          <Field label="Sports they teach">
            <SportPicker value={sports} onChange={setSports} />
          </Field>
        ) : null}
        {fe ? <p className="text-sm text-danger">{fe}</p> : null}
        <p className="text-xs text-muted">Changing the role signs them out so the new permissions apply at the next sign-in.</p>
      </div>
    </Modal>
  );
}
