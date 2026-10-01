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

export const Route = createFileRoute("/desk/courts")({
  component: Page,
});

function Page() {
  const [date, setDate] = useState(todayISO);
  const [sport, setSport] = useState("");
  const [mode, setMode] = useState("walkin");
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
    void load().catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  function isoAt(hour: number) {
    return `${date}T${String(hour).padStart(2, "0")}:00:00+07:00`;
  }

  return (
    <Shell
      role="receptionist"
      title="Court map"
      subtitle="Take walk-in payment on the spot. Merge BR and BC when both courts are free."
    >
      <div className="mb-4 grid gap-3">
        <DateStrip value={date} onChange={setDate} />
        <div className="flex flex-wrap items-center gap-2">
          <Seg
            value={mode}
            onChange={setMode}
            options={[
              { value: "walkin", label: "Walk-in" },
              { value: "convert", label: "Merge BR + BC" },
            ]}
          />
          <Seg
            value={sport}
            onChange={setSport}
            options={[
              { value: "", label: "All" },
              { value: "badminton", label: "Badminton" },
              { value: "basketball", label: "Basketball" },
              { value: "volleyball", label: "Volleyball" },
            ]}
          />
          <DateField value={date} onChange={setDate} />
        </div>
      </div>
      <AnimatePresence>
      {pick && mode === "walkin" ? (
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
              Walk-in · {pick.court.court_code} · {sportLabel(pick.court.sport)} · {String(pick.hour).padStart(2, "0")}
              :00
            </p>
          </div>
          <Field label="Full name">
            <Input
              value={form.guest_name}
              onChange={(e) => setForm({ ...form, guest_name: e.target.value })}
              placeholder="Guest name"
            />
          </Field>
          <Field label="Phone">
            <Input
              value={form.guest_phone}
              onChange={(e) => setForm({ ...form, guest_phone: e.target.value })}
              placeholder="0901…"
            />
          </Field>
          <Field label="Payment method">
            <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              <option value="cash">Cash</option>
              <option value="transfer">Bank transfer</option>
              <option value="card">Card</option>
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
                    toast.success(`Took ${money(res.payment.amount_vnd)} · ${res.payment.code}`);
                    setPick(null);
                    setForm({ guest_name: "", guest_phone: "", method: "cash" });
                    await load();
                    if (res.invoice_id) await openInvoice(res.invoice_id);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Something went wrong");
                  }
                }}
              >
                Take payment & hold
              </Button>
            </StarBorder>
            <Button variant="ghost" onClick={() => setPick(null)}>
              Never mind
            </Button>
          </div>
        </Card>
        </SpotlightCard>
        </motion.div>
      ) : null}
      </AnimatePresence>
      <AnimatePresence>
      {pick && mode === "convert" ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
        <SpotlightCard className="mb-4 rounded-[var(--radius-xl)]" size={420} strength={0.1}>
        <Card className="relative z-[2]">
          <p className="text-sm">
            Merge {pick.court.court_code} ({sportLabel(pick.court.sport)}) at {String(pick.hour).padStart(2, "0")}
            :00 — this locks both courts of the pair for 60 minutes.
          </p>
          {!pick.court.convertible ? (
            <p className="mt-2 text-sm text-danger">This court cannot be merged. Only the BR ↔ BC pairs convert.</p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button
              disabled={!pick.court.convertible}
              onClick={async () => {
                try {
                  await apiPost(
                    "/convert",
                    {
                      court_id: pick.court.id,
                      start_at: isoAt(pick.hour),
                      end_at: isoAt(pick.hour + 1),
                    },
                    true,
                  );
                  toast.success("Courts merged");
                  setPick(null);
                  await load();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not merge those courts");
                }
              }}
            >
              Lock the pair
            </Button>
            <Button variant="ghost" onClick={() => setPick(null)}>
              Never mind
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
          onPick={async (c, h) => {
            const occ = data.slots.find((s) => {
              if (s.court_id !== c.id) return false;
              const start = new Date(`${date}T${String(h).padStart(2, "0")}:00:00+07:00`).getTime();
              const a = new Date(s.start).getTime();
              const b = new Date(s.end).getTime();
              return a < start + 3600000 && b > start;
            });
            if (occ?.kind === "convert" && occ.convert_group_id) {
              try {
                await apiPost(`/convert/${occ.convert_group_id}/release`);
                toast.success("Pair released");
                await load();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Something went wrong");
              }
              return;
            }
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
