import { pool } from "./pool";
import { listPendingMigrations } from "./migrations";

/**
 * بررسی سبکِ مهاجرت‌ها روی مسیر درخواست‌ها — هیچ DDL اجرا نمی‌کند و هرگز
 * خطا نمی‌دهد. اگر مهاجرتی اجرا نشده باشد فقط در لاگ هشدار می‌دهد و برنامه
 * کار می‌کند. مهاجرت‌ها را از /api/admin/migrate?confirm=yes اجرا کنید
 * (تعریف‌ها در src/db/migrations.ts).
 */

let checkedOk = false; // فقط نتیجه‌ی boolean بین درخواست‌ها نگه داشته می‌شود
let lastCheckAt = 0;
const RECHECK_MS = 60_000;

export async function ensureDb(): Promise<void> {
  if (checkedOk) return;
  const now = Date.now();
  if (now - lastCheckAt < RECHECK_MS) return; // وقتی مهاجرت ناتمام است، حداکثر دقیقه‌ای یک بار
  lastCheckAt = now;
  try {
    const pending = await listPendingMigrations(pool);
    if (pending.length === 0) {
      checkedOk = true;
      return;
    }
    console.warn(
      `[db] ${pending.length} مهاجرت اجراشده‌نشده: ${pending.join(", ")} — برای اجرا /api/admin/migrate?confirm=yes را (با حساب مدیر) باز کنید`
    );
  } catch (e) {
    console.warn("[db] بررسی مهاجرت‌ها ناموفق بود:", e instanceof Error ? e.message : String(e));
  }
}
