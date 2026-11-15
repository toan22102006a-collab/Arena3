import type { Sql } from "@/server/data/db";
import { getSettings } from "../controllers/helpers";
import { one } from "../controllers/tx";

const TIERS = [
  { key: "gold", min: 600 },
  { key: "silver", min: 200 },
  { key: "bronze", min: 0 },
] as const;

export async function loyaltyBalance(sql: Sql, userId: string, clamp = true) {
  const settings = await getSettings(sql);
  const row = await one<{ net: number; spent: number }>(
    sql,
    `select coalesce((select sum(amount_vnd) from payments
                       where user_id = $1 and status in ('posted','refund_pending')
                         -- 'day_pass' stays: day passes are no longer sold, but what a member already paid for them still counts toward loyalty.
                         and ref_type in ('booking','subscription','day_pass')), 0)::int as net,
            coalesce((select sum(points) from loyalty_adjustments where user_id = $1), 0)::int as spent`,
    [userId],
  );
  const earned = Math.floor((row?.net ?? 0) / settings.loyalty_earn_vnd);
  const adjust = row?.spent ?? 0;
  const points = clamp ? Math.max(0, earned + adjust) : earned + adjust;
  // Tier counts every point ever earned, so spending points never demotes a member.
  const lifetime = Math.max(0, earned) + Math.max(0, adjust);
  const tier = TIERS.find((t) => lifetime >= t.min)!;
  const idx = TIERS.indexOf(tier);
  const next = idx > 0 ? TIERS[idx - 1]! : null;
  return {
    points,
    earned,
    spend_vnd: row?.net ?? 0,
    tier: tier.key,
    next_tier: next ? { key: next.key, need: Math.max(0, next.min - lifetime) } : null,
    earn_vnd: settings.loyalty_earn_vnd,
    redeem_vnd: settings.loyalty_redeem_vnd,
    min_redeem: 50,
  };
}


/** Refund creation and redemption serialize on the same member, in their transaction. */
export async function reconcileLoyaltyRefund(sql: Sql, userId: string | null) {
  if (!userId) return;
  await sql.query(`select id from users where id = $1 for update`, [userId]);
  let { points } = await loyaltyBalance(sql, userId, false);
  if (points >= 0) return;
  const codes = await sql.query<{ id: string; code: string; points: number }>(
    `select p.id, p.code, la.points from loyalty_adjustments la
       join promotions p on p.id = la.promo_id
      where la.user_id = $1 and la.reason = 'redeem' and la.points < 0
        and not exists (select 1 from promotion_redemptions r where r.promo_id = p.id)
        and not exists (select 1 from loyalty_adjustments c
                         where c.promo_id = p.id and c.reason = 'correction')
      order by la.created_at desc, la.id desc for update of p`, [userId],
  );
  for (const code of codes) {
    if (points >= 0) break;
    await sql.query(`update promotions set ends_at = now() where id = $1`, [code.id]);
    await sql.query(
      `insert into loyalty_adjustments (user_id, points, reason, note, promo_id)
       values ($1,$2,'correction',$3,$4)`, [userId, -code.points, code.code, code.id],
    );
    points -= code.points;
  }
}
