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

/**
 * زمینه‌ی احراز هویتِ قبل از شناخت tenant (ورود، ثبت‌نام، شمارنده‌ی تلاش‌ها).
 * فقط GUCهای باریک نصب می‌شود؛ سیاست‌های RLS جدول‌های users/profiles/login_attempts
 * فقط ردیف همان ایمیل/همان کاربر را باز می‌کنند (نه همه‌ی ردیف‌ها):
 *  - email: app.login_email (باید کوچک‌شده و تمیز باشد)
 *  - userId: app.user_id
 *  - tenantId: app.tenant_id (فقط برای ساخت پروفایل تازه در ثبت‌نام)
 */
export async function withAuthCtx<T>(
  ctx: { email?: string; userId?: string; tenantId?: string },
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.login_email', ${ctx.email ?? ""}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true), set_config('app.tenant_id', ${ctx.tenantId ?? ""}, true)`
    );
    return fn(tx);
  });
}

/**
 * کارهای سیستمی بدون کاربر (مثلاً یادآوری چک‌ها که همه‌ی tenantها را می‌چرخد):
 * با app.role = 'admin' اجرا می‌شود، مثل مهاجرت‌ها. فقط از کد سمت سرور صدا زده شود.
 */
export async function withSystemRole<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.role', 'admin', true)`);
    return fn(tx);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * بررسی غیرفعال بودن کاربر در هر درخواست — فقط یک رفت‌وبرگشت (دو دستور در یک پیام ساده،
 * که PostgreSQL خودش آن‌ها را در یک تراکنش ضمنی اجرا می‌کند؛ پس set_config محلی برای
 * دستور دوم هم برقرار است). شناسه با regex اعتبارسنجی می‌شود، پس درج مستقیم امن است.
 * null یعنی کاربری با این شناسه نیست.
 */
export async function isUserDisabled(userId: string): Promise<boolean | null> {
  if (!UUID_RE.test(userId)) return null;
  const res = (await pool.query(
    `SELECT set_config('app.user_id', '${userId}', true); SELECT disabled FROM users WHERE id = '${userId}'::uuid`
  )) as unknown as Array<{ rows: Array<{ disabled: boolean }> }>;
  const row = res[1]?.rows[0];
  return row ? row.disabled === true : null;
}
