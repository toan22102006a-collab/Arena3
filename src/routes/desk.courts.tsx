import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CourtGrid, DateStrip, sportLabel, type Court, type OccSlot } from "@/components/court-grid";
import { Shell, money } from "@/components/shell";
import { Button, Card, DateField, Field, Input, Select, Seg, Skeleton } from "@/components/ui";
import { AnimatePresence, motion } from "motion/react";
import { SpotlightCard, StarBorder } from "@/components/fx";
import { ClassDetailModal, OccupancyDetailModal } from "@/components/class-detail";
import { apiGet, apiPost, openInvoice } from "@/lib/arena3/client";
import { todayISO } from "@/lib/arena3/labels";
import { t, tServer } from "@/lib/i18n";

export const Route = createFileRoute("/desk/courts")({
  component: Page,
});

function Page() {
  const [date, setDate] = useState(todayISO);
  const [sport, setSport] = useState("");
  const [data, setData] = useState<{ courts: Court[]; slots: OccSlot[] } | null>(null);
  const [pick, setPick] = useState<{ court: Court; hour: number } | null>(null);
  const [form, setForm] = useState({ guest_name: "", guest_phone: "", method: "cash" });
  // The taken hour whose owner the desk is looking up, and the class it may lead to.
  const [look, setLook] = useState<{ kind: string; ref: string } | null>(null);
  const [lookClass, setLookClass] = useState<string | null>(null);

  async function load() {
    setData(await apiGet(`/occupancy?date=${date}`));
  }
  useEffect(() => {
    setData(null);
    void load().catch((e) => toast.error(tServer(e.message)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  function isoAt(hour: number) {
    return `${date}T${String(hour).padStart(2, "0")}:00:00+07:00`;
  }

  return (
    <Shell
      role="receptionist"
      title={t("Court map")}
      subtitle={t("Take walk-in payment on the spot.")}
    >
      <div className="mb-4 grid gap-3">
        <DateStrip value={date} onChange={setDate} />
        <div className="flex flex-wrap items-center gap-2">
          <Seg
            value={sport}
            onChange={setSport}
            options={[
              { value: "", label: t("All") },
              { value: "badminton", label: t("Badminton") },
              { value: "basketball", label: t("Basketball") },
              { value: "volleyball", label: t("Volleyball") },
            ]}
          />
          <DateField value={date} onChange={setDate} />
        </div>
      </div>
      <AnimatePresence>
      {pick ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
        <SpotlightCard className="mb-4 rounded-[var(--radius-xl)]" size={420} strength={0.1}>
        <Card className="relative z-[2] grid gap-3 md:grid-cols-4">
          <div className="md:col-span-4">
            <p className="text-sm text-muted">
              {t("Walk-in")} · {pick.court.court_code} · {sportLabel(pick.court.sport)} · {String(pick.hour).padStart(2, "0")}
              :00
            </p>
          </div>
          <Field label={t("Full name")}>
            <Input
              value={form.guest_name}
              onChange={(e) => setForm({ ...form, guest_name: e.target.value })}
              placeholder={t("Guest name")}
            />
          </Field>
          <Field label={t("Phone")}>
            <Input
              value={form.guest_phone}
              onChange={(e) => setForm({ ...form, guest_phone: e.target.value })}
              placeholder="0901…"
            />
          </Field>
          <Field label={t("Payment method")}>
            <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              <option value="cash">{t("Cash")}</option>
              <option value="transfer">{t("Bank transfer")}</option>
              <option value="card">{t("Card")}</option>
            </Select>
          </Field>
          {/* Own row: the star border needs the button at its natural width, and
              a quarter-column squeezes "Take payment & hold" onto three lines. */}
          <div className="flex items-end gap-2 md:col-span-4">
            {/* The one control that moves money on this screen. */}
            <StarBorder speed={4}>
              <Button
                onClick={async () => {
                  try {
                    const res = await apiPost<{ payment: { amount_vnd: number; code: string }; invoice_id: string }>(
                      "/walk-in",
                      { court_id: pick.court.id, start_at: isoAt(pick.hour), ...form },
                      true,
                    );
                    toast.success(t("Took {amount} · {code}", { amount: money(res.payment.amount_vnd), code: res.payment.code }));
                    setPick(null);
                    setForm({ guest_name: "", guest_phone: "", method: "cash" });
                    await load();
                    if (res.invoice_id) await openInvoice(res.invoice_id);
                  } catch (e) {
                    toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
                  }
                }}
              >
                {t("Take payment & hold")}
              </Button>
            </StarBorder>
            <Button variant="ghost" onClick={() => setPick(null)}>
              {t("Never mind")}
            </Button>
          </div>
        </Card>
        </SpotlightCard>
        </motion.div>
      ) : null}
      </AnimatePresence>
      {data ? (
        <CourtGrid
          date={date}
          courts={data.courts}
          slots={data.slots}
          sport={sport || undefined}
          onInspect={(_c, _h, occ) => setLook({ kind: occ.kind, ref: occ.ref })}
          onPick={(c, h) => {
            setPick({ court: c, hour: h });
          }}
          // A full day is a question a walk-in asks at the counter, so the
          // same two answers reception would give are on the grid itself.
          onPickSport={setSport}
          onPickDate={setDate}
        />
      ) : (
        <Skeleton className="h-72" />
      )}
      <OccupancyDetailModal
        target={look}
        onClose={() => setLook(null)}
        onOpenClass={(id) => {
          setLook(null);
          setLookClass(id);
        }}
      />
      <ClassDetailModal classId={lookClass} onClose={() => setLookClass(null)} />
    </Shell>
  );
}
