import { dbSource, getPglite, type Sql } from "@/lib/db";
import type { Pool, PoolClient } from "pg";

type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

function wrap(run: Run): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    let text = strings[0] ?? "";
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    run<T>(text, params);
  return sql;
}

const globalRef = globalThis as typeof globalThis & { __arena3NeonPool__?: Pool };

async function neonPool(): Promise<Pool> {
  if (!globalRef.__arena3NeonPool__) {
    const { Pool: PgPool, types } = await import("pg");
    types.setTypeParser(20, Number);
    types.setTypeParser(1082, (v: string) => v);
    types.setTypeParser(1186, (v: string) => v);
    const pool = new PgPool({ connectionString: process.env.DATABASE_URL });
    pool.on("error", (err) => {
      console.error("[arena3 neon pool error]", err.message);
    });
    globalRef.__arena3NeonPool__ = pool;
  }
  return globalRef.__arena3NeonPool__;
}

export async function withTx<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  if (dbSource === "pglite") {
    const pg = await getPglite();
    return pg.transaction(async (tx) => {
      const run: Run = async <R>(text: string, params: unknown[]) => {
        const result = await tx.query<R>(text, params ?? []);
        return result.rows;
      };
      return fn(wrap(run));
    });
  }
  const pool = await neonPool();
  const client: PoolClient = await pool.connect();
  const clientErrHandler = (err: Error) => {
    console.error("[arena3 client error]", err.message);
  };
  client.on("error", clientErrHandler);
  let hasError = false;
  try {
    await client.query("BEGIN");
    const run: Run = async <R>(text: string, params: unknown[]) => {
      const result = await client.query(text, params ?? []);
      return result.rows as R[];
    };
    const out = await fn(wrap(run));
    await client.query("COMMIT");
    return out;
  } catch (e) {
    hasError = true;
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.removeListener("error", clientErrHandler);
    client.release(hasError);
  }
}

export async function one<T>(sql: Sql, text: string, params: unknown[] = []): Promise<T | undefined> {
  const rows = await sql.query<T>(text, params);
  return rows[0];
}

export async function q<T>(sql: Sql, text: string, params: unknown[] = []): Promise<T[]> {
  return sql.query<T>(text, params);
}
