import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { pool } from "./pool";
import { ensureDb } from "./bootstrap";
import * as schema from "./schema";

export { ensureDb };

export const db = drizzle(pool, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AuthCtx {
  userId: string;
  tenantId: string;
  role: "owner" | "admin";
}

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Runs a set of queries inside one transaction with the tenant context
 * installed as local GUCs. Combined with the RLS policies this guarantees
 * the caller can only touch its own tenant's rows (defense in depth:
 * callers additionally filter by tenantId explicitly).
 */
export async function withTenant<T>(
  ctx: AuthCtx,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  await ensureDb();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.role', ${ctx.role}, true)`
    );
    return fn(tx);
  });
}
