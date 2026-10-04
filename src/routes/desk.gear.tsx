import { createFileRoute } from "@tanstack/react-router";
import { SectionTitle } from "@/components/section";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell, money } from "@/components/shell";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { Lift, Reveal, Stagger, StaggerItem } from "@/components/motion";
import { SpotlightCard } from "@/components/fx";
import { ApiClientError, apiGet, apiPost } from "@/lib/arena3/client";
import { sportLabel } from "@/lib/arena3/labels";
import { t, tServer } from "@/lib/i18n";

export const Route = createFileRoute("/desk/gear")({ component: Page });

type Item = { id: string; sku: string; name: string; sport: string | null; stock: number; rent_vnd: number };
type Loan = {
  id: string;
  name: string;
  sku: string;
  phone: string;
  qty: number;
  due_at: string;
  member_name: string | null;
  member_code: string | null;
};
type Hit = { id: string; member_code: string | null; full_name: string; phone: string };

function Page() {
  const [items, setItems] = useState<Item[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(1);
  const [who, setWho] = useState<"member" | "guest">("member");
  const [phone, setPhone] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [member, setMember] = useState<Hit | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  async function load() {
    const [eq, ln] = await Promise.all([
      apiGet<{ items: Item[] }>("/equipment"),
      apiGet<{ items: Loan[] }>("/equipment/loans"),
    ]);
    setItems(eq.items);
    setLoans(ln.items);
    setItemId((cur) => cur || eq.items[0]?.id || "");
  }
  useEffect(() => {
    void load().catch((e) => toast.error(tServer(e.message)));
  }, []);

  useEffect(() => {
    if (who !== "member" || member || q.trim().length < 3) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void apiGet<{ items: Hit[] }>(`/members?q=${encodeURIComponent(q)}`)
        .then((r) => setHits(r.items))
        .catch((e) => toast.error(tServer(e.message)));
    }, 180);
    return () => clearTimeout(timer);
  }, [q, who, member]);

  const item = items.find((i) => i.id === itemId);
  const max = item?.stock ?? 0;
  // Keep the count inside what is on the shelf when the item (or its stock) changes.
  const shown = Math.max(1, Math.min(qty, Math.max(max, 1)));
  const canRent = !!item && max > 0 && (who === "member" ? !!member : phone.trim().length > 0);

  async function rent() {
    setFieldError(null);
    try {
      const r = await apiPost<{ rent_vnd: number }>("/equipment/loans", {
        item_id: itemId,
        qty: shown,
        ...(who === "member" ? { user_id: member?.id } : { phone }),
      });
      toast.success(t("Rented out · {amount}", { amount: money(r.rent_vnd) }));
      setQty(1);
      setPhone("");
      setMember(null);
      setQ("");
      await load();
    } catch (e) {
      if (e instanceof ApiClientError && e.body.field) setFieldError({ field: e.body.field, message: tServer(e.message) });
      else toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
      void load().catch(() => {});
    }
  }

  return (
    <Shell
      role="receptionist"
      title={t("Gear")}
      subtitle={t("Rent to a member's account or to a guest by phone — stock comes down on the way out, back up on return.")}
    >
      <Reveal from="down">
        <Card className="mb-4 grid gap-3 md:grid-cols-[1.2fr_1.6fr_auto_auto]">
          <Field label={t("Item")}>
            <Select
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                setQty(1);
              }}
            >
              {items.map((i) => (
                <option key={i.id} value={i.id} disabled={i.stock < 1}>
                  {i.name} · {i.stock ? t("{n} left", { n: i.stock }) : t("none left")} · {money(i.rent_vnd)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid content-start gap-2">
            <div className="flex gap-1 text-sm" role="tablist" aria-label={t("Who is renting")}>
              {(["member", "guest"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={who === k}
                  onClick={() => {
                    setWho(k);
                    setFieldError(null);
                  }}
                  className={`rounded-full px-3 py-1 ${who === k ? "bg-accent text-white" : "bg-wood text-muted"}`}
                >
                  {k === "member" ? t("Member") : t("Guest")}
                </button>
              ))}
            </div>
            {who === "member" ? (
              member ? (
                <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-wood/60 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{member.full_name}</span>{" "}
                    <span className="tabular-nums text-muted">
                      {member.member_code ?? ""} · {member.phone}
                    </span>
                  </span>
                  <button type="button" className="text-muted underline" onClick={() => setMember(null)}>
                    {t("Change")}
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    aria-label={t("Find a member")}
                    placeholder={t("Search name, phone or member code")}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  {hits.length ? (
                    <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface text-sm shadow-lg">
                      {hits.map((h) => (
                        <li key={h.id}>
                          <button
                            type="button"
                            className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-wood"
                            onClick={() => {
                              setMember(h);
                              setHits([]);
                            }}
                          >
                            <span className="font-medium">{h.full_name}</span>
                            <span className="tabular-nums text-muted">
                              {h.member_code ?? ""} · {h.phone}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            ) : (
              <Input
                aria-label={t("Guest phone")}
                inputMode="tel"
                placeholder={t("Guest phone, e.g. 09xx xxx xxx")}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
            {fieldError && (fieldError.field === "phone" || fieldError.field === "user_id") ? (
              <p className="text-xs text-danger">{fieldError.message}</p>
            ) : null}
          </div>
          <Field label={t("Qty")}>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                aria-label={t("One fewer")}
                disabled={shown <= 1}
                onClick={() => setQty(shown - 1)}
              >
                −
              </Button>
              <span className="w-8 text-center tabular-nums" aria-live="polite">
                {shown}
              </span>
              <Button
                size="sm"
                variant="outline"
                aria-label={t("One more")}
                disabled={shown >= max}
                onClick={() => setQty(shown + 1)}
              >
                +
              </Button>
            </div>
          </Field>
          <div className="flex items-end">
            <Button className="w-full" disabled={!canRent} onClick={() => void rent()}>
              {t("Rent out")}
            </Button>
          </div>
        </Card>
      </Reveal>
      <Stagger className="grid gap-3 md:grid-cols-2" gap={0.05}>
        {items.map((i) => (
          <StaggerItem key={i.id} className="h-full">
            <Lift className="h-full">
              <SpotlightCard className="h-full rounded-[var(--radius-xl)]" size={280} strength={0.1}>
                <Card interactive className="relative z-[2] h-full p-4">
                  <p className="text-2xs uppercase tracking-wider text-muted">{i.sport ? sportLabel(i.sport) : t("General")}</p>
                  <p className="font-medium">{i.name}</p>
                  <p className="text-sm text-muted">
                    {t("{n} in stock · {amount} each", { n: i.stock, amount: money(i.rent_vnd) })}
                  </p>
                </Card>
              </SpotlightCard>
            </Lift>
          </StaggerItem>
        ))}
      </Stagger>
      <SectionTitle text={t("Out on loan")} className="mt-8 font-display text-2xl" />
      <Stagger className="mt-3 grid gap-2" gap={0.05}>
        {loans.map((l) => (
          <StaggerItem key={l.id}>
            <Card className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">
                  {l.name} × {l.qty}
                </p>
                <p className="text-xs text-muted">
                  {l.member_name ? `${l.member_name}${l.member_code ? ` · ${l.member_code}` : ""} · ` : `${t("Guest")} · `}
                  {l.phone}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await apiPost(`/equipment/loans/${l.id}/return`);
                    toast.success(t("Returned"));
                    await load();
                  } catch (e) {
                    toast.error(e instanceof Error ? tServer(e.message) : t("Something went wrong"));
                    void load().catch(() => {});
                  }
                }}
              >
                {t("Take it back")}
              </Button>
            </Card>
          </StaggerItem>
        ))}
        {!loans.length ? <p className="text-sm text-muted">{t("Nothing is out right now.")}</p> : null}
      </Stagger>
    </Shell>
  );
}
