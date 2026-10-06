import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { SectionTitle } from "@/components/section";
import { Shell, money, useSessionUser, when } from "@/components/shell";
import { Badge, Button, Card, DateField, EmptyState, Field, Input, LoadError, Modal, Select, Skeleton, Stat } from "@/components/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { TillNotice, useTillOpen } from "@/components/till-notice";
import { ApiClientError, apiPost, openInvoice } from "@/lib/arena3/client";
import { todayISO } from "@/lib/arena3/labels";
import { t, tServer } from "@/lib/i18n";
import { useRead } from "@/lib/use-read";

export const Route = createFileRoute("/desk/day-passes")({ component: Page });

type Pass = {
  id: string;
  code: string;
  guest_name: string | null;
  guest_phone: string | null;
  valid_on: string;
  price_vnd: number;
  status: "issued" | "used" | "void";
  issued_at: string;
  used_at: string | null;
  method: string | null;
};
type Day = { date: string; items: Pass[]; sold: number; revenue_vnd: number; price_vnd: number };

function Page() {
  const user = useSessionUser();
  const role = user?.role === "manager" ? "manager" : "receptionist";
  const [date, setDate] = useState(todayISO());
  const { data, error, reload } = useRead<Day>(`/day-passes?date=${date}`);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState("cash");
  const [fieldErr, setFieldErr] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState<Pass | null>(null);
  const tillOpen = useTillOpen(role === "receptionist");

  async function sell(e: FormEvent) {
    e.preventDefault();
    setFieldErr(null);
    setBusy(true);
    try {
      const r = await apiPost<{ pass: Pass; invoice_id: string | null }>(
        "/day-passes",
        { guest_name: name || undefined, phone: phone || undefined, method, valid_on: date },
        true,
      );
      toast.success(t("Day pass {code} sold", { code: r.pass.code }), {
        action: r.invoice_id ? { label: t("Open receipt"), onClick: () => void openInvoice(r.invoice_id!) } : undefined,
      });
      setName("");
      setPhone("");
      reload();
    } catch (error) {
      if (error instanceof ApiClientError) setFieldErr({ field: error.body.field, message: tServer(error.message) });
      else setFieldErr({ message: error instanceof Error ? tServer(error.message) : t("Something went wrong") });
    } finally {
      setBusy(false);
    }
  }

  async function letIn(p: Pass) {
    try {
      await apiPost(`/day-passes/${p.id}/use`, {});
      toast.success(t("Checked in"));
    } catch (error) {
      toast.error(error instanceof Error ? tServer(error.message) : t("Something went wrong"));
    }
    // Either way the list is what the server says now: a pass someone else already used must not stay "Let in".
    reload();
  }

  const fe = (f: string) => (fieldErr?.field === f ? fieldErr.message : undefined);

  return (
    <Shell
      role={role}
      title={t("Day passes")}
      subtitle={t("One-day entry for a walk-in. Sell it, then tick it off when they come through the gate.")}
    >
      {tillOpen ? null : <TillNotice />}
      <Reveal from="down">
        <form className="mb-4" onSubmit={(e) => void sell(e)}>
          <Card className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.4fr_1.2fr_1fr_1fr_auto]">
            <Field label={t("Name")} hint={fe("guest_name")}>
              <Input
                autoComplete="off"
                value={name}
                aria-invalid={fe("guest_name") ? true : undefined}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label={t("Phone (optional)")} hint={fe("phone")}>
              <Input
                inputMode="tel"
                autoComplete="off"
                value={phone}
                aria-invalid={fe("phone") ? true : undefined}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Field label={t("Valid on")} hint={fe("valid_on")}>
              <DateField
                required
                value={date}
                onChange={setDate}
                invalid={error?.refused === true}
                aria-label={t("Valid on")}
              />
            </Field>
            <Field label={t("Paid by")}>
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">{t("Cash")}</option>
                <option value="card">{t("Card")}</option>
                <option value="transfer">{t("Bank transfer")}</option>
              </Select>
            </Field>
            <div className="flex items-end sm:col-span-2 xl:col-span-1">
              <Button type="submit" className="w-full" disabled={busy || !name.trim() || !tillOpen}>
                {data ? t("Sell pass · {amount}", { amount: money(data.price_vnd) }) : t("Sell pass")}
              </Button>
            </div>
            {fieldErr && !fieldErr.field ? (
              <p role="alert" className="text-sm text-danger sm:col-span-2 xl:col-span-5">
                {fieldErr.message}
              </p>
            ) : null}
          </Card>
        </form>
      </Reveal>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Stat label={t("Passes for this day")} value={data ? String(data.sold) : "—"} />
        <Stat label={t("Takings")} value={data ? money(data.revenue_vnd) : "—"} />
      </div>

      <SectionTitle text={t("Passes")} className="mb-3 font-display text-2xl" />
      {error ? (
        <LoadError message={error.message} onRetry={error.refused ? undefined : reload} />
      ) : !data ? (
        <Skeleton className="h-24" />
      ) : data.items.length === 0 ? (
        <EmptyState title={t("No passes for this day")} hint={t("Sell one above and it shows up here.")} />
      ) : (
        <Stagger className="grid gap-2" gap={0.04}>
          {data.items.map((p) => (
            <StaggerItem key={p.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">
                    {p.guest_name} <span className="font-mono text-xs text-muted">{p.code}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {p.guest_phone ?? t("No phone")} · {money(p.price_vnd)} · {t("sold")} {when(p.issued_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={p.status === "issued" ? "hold" : p.status === "used" ? "accent" : "muted"}>
                    {p.status === "issued" ? t("Not used") : p.status === "used" ? t("Used") : t("Voided")}
                  </Badge>
                  {p.status === "issued" ? (
                    <>
                      <Button size="sm" onClick={() => void letIn(p)}>
                        {t("Let in")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setVoiding(p)}>
                        {t("Void & refund")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <VoidDialog
        pass={voiding}
        onClose={() => setVoiding(null)}
        onDone={() => {
          setVoiding(null);
          reload();
        }}
      />
    </Shell>
  );
}

/** Voiding hands money back, so it asks first and says how much. */
function VoidDialog({ pass, onClose, onDone }: { pass: Pass | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  // The dialog fades out after `pass` is cleared; keep what it showed so the text does not blink away.
  const [shown, setShown] = useState<Pass | null>(null);
  useEffect(() => {
    if (pass) setShown(pass);
  }, [pass]);
  const p = pass ?? shown;

  async function go() {
    if (!pass) return;
    setBusy(true);
    try {
      await apiPost(`/day-passes/${pass.id}/void`, {});
      toast.success(t("Pass voided and refunded"));
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? tServer(error.message) : t("Something went wrong"));
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!pass}
      onClose={onClose}
      title={t("Void this pass?")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("Keep it")}
          </Button>
          <Button variant="danger" onClick={() => void go()} disabled={busy}>
            {busy ? t("Voiding…") : t("Yes, void it")}
          </Button>
        </>
      }
    >
      {p ? (
        <div className="grid gap-2 text-sm">
          <p className="font-medium">
            {p.guest_name} · <span className="font-mono">{p.code}</span>
          </p>
          <p>{t("The {amount} paid for it is refunded. A big refund waits for a manager to approve it.", { amount: money(p.price_vnd) })}</p>
        </div>
      ) : null}
    </Modal>
  );
}
