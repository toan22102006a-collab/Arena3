import type { Sql } from "@/lib/db";
import { err } from "./errors";
import { one } from "./tx";

export type FlagKey = "F4" | "F5" | "F6";

export async function flagsMap(sql: Sql): Promise<Record<string, boolean>> {
  const rows = await sql.query<{ key: string; enabled: boolean }>(
    `select key, enabled from feature_flags`,
  );
  const out: Record<string, boolean> = { F4: false, F5: false, F6: false };
  for (const r of rows) out[r.key] = r.enabled;
  return out;
}

export async function flagOn(sql: Sql, key: FlagKey): Promise<boolean> {
  const row = await one<{ enabled: boolean }>(sql, `select enabled from feature_flags where key = $1`, [key]);
  return row?.enabled === true;
}

export async function requireFlag(sql: Sql, key: FlagKey) {
  if (!(await flagOn(sql, key))) throw err.br("C-07", `Feature ${key} is switched off.`);
}
