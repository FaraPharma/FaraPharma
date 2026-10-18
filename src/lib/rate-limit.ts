/* محدودسازی تلاش ورود — دیتابیسمحور (مستقل از instance در serverless).
 * بعد از ۵ تلاش ناموفق پشتسرهم برای یک ایمیل، ورود ۱۵ دقیقه قفل میشود.
 * جدول login_attempts: email (unique)، count، window_start، locked_until */

import { eq } from "drizzle-orm";
import { withAuthCtx } from "@/db";
import { loginAttempts } from "@/db/schema";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const WINDOW_RESET_MS = 15 * 60 * 1000;

export interface RateCheck {
  locked: boolean;
  remainingMinutes?: number;
}

/** وضعیت قفل ایمیل را برمیگرداند (بدون تغییر شمارنده) */
export async function checkLoginLock(email: string): Promise<RateCheck> {
  const key = email.toLowerCase().trim();
  const rows = await withAuthCtx({ email: key }, (tx) =>
    tx.select().from(loginAttempts).where(eq(loginAttempts.email, key)).limit(1)
  );
  const rec = rows[0];
  if (!rec) return { locked: false };
  if (rec.lockedUntil && new Date(rec.lockedUntil).getTime() > Date.now()) {
    return {
      locked: true,
      remainingMinutes: Math.ceil(
        (new Date(rec.lockedUntil).getTime() - Date.now()) / 60_000
      ),
    };
  }
  return { locked: false };
}

/** ثبت یک تلاش ناموفق؛ در صورت رسیدن به سقف، قفل فعال میشود */
export async function recordFailedLogin(email: string): Promise<RateCheck> {
  const key = email.toLowerCase().trim();
  const now = new Date();
  const lockedUntilOut = await withAuthCtx({ email: key }, async (tx) => {
    const rows = await tx
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.email, key))
      .limit(1);
    const rec = rows[0];

    // پنجره ۱۵ دقیقهای گذشته → شمارنده از نو
    const fresh = !rec || new Date(rec.windowStart).getTime() <= Date.now() - WINDOW_RESET_MS;
    const count = fresh ? 1 : rec.count + 1;
    const lockedUntil =
      count >= MAX_ATTEMPTS
        ? new Date(Date.now() + LOCK_MINUTES * 60_000)
        : null;

    if (!rec) {
      await tx.insert(loginAttempts).values({
        email: key,
        count,
        windowStart: now,
        lockedUntil,
      });
    } else {
      await tx
        .update(loginAttempts)
        .set({
          count,
          windowStart: fresh ? now : rec.windowStart,
          lockedUntil,
        })
        .where(eq(loginAttempts.email, key));
    }
    return lockedUntil;
  });
  const lockedUntil = lockedUntilOut;

  if (lockedUntil) {
    return {
      locked: true,
      remainingMinutes: LOCK_MINUTES,
    };
  }
  return { locked: false };
}

/** ورود موفق → شمارنده صفر میشود */
export async function clearLoginAttempts(email: string) {
  const key = email.toLowerCase().trim();
  await withAuthCtx({ email: key }, (tx) =>
    tx.delete(loginAttempts).where(eq(loginAttempts.email, key))
  );
}
