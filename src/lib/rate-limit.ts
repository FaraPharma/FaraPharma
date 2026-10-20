/* محدودسازی تلاش ورود — دیتابیسمحور (مستقل از instance در serverless).
 * بعد از ۵ تلاش ناموفق پشتسرهم برای یک ایمیل، ورود ۱۵ دقیقه قفل میشود.
 * جدول login_attempts: email (unique)، count، window_start، locked_until */

import { eq, sql } from "drizzle-orm";
import { withAuthCtx, withSystemRole } from "@/db";
import { loginAttempts, rateLimits } from "@/db/schema";
import { getAuthSecret } from "@/lib/config";

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

/* ───────────── قفل تلاش بر اساس IP (جدول rate_limits) ─────────────
 * کلید ذخیره‌شده HMAC(رازِ برنامه، «سطل:IP») است؛ IP خام ذخیره نمی‌شود.
 * login-fail: هر ورود ناموفق می‌شمارد؛ ۱۰ شکست در ۱۵ دقیقه ← ۱۵ دقیقه قفل.
 * register: هر تلاش ثبت‌نام می‌شمارد؛ ۱۰ تلاش در ساعت ← ۱ ساعت قفل. */

export type IpBucket = "login-fail" | "register";

export const IP_RULES: Record<IpBucket, { max: number; windowMs: number; lockMs: number }> = {
  "login-fail": { max: 10, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
  register: { max: 10, windowMs: 60 * 60_000, lockMs: 60 * 60_000 },
};

export interface IpCheck {
  locked: boolean;
  retryAfterMin?: number;
}

export async function rateLimitKey(bucket: IpBucket, id: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", getAuthSecret() as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${bucket}:${id}`)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

const minutesLeft = (until: Date, nowMs: number) => Math.max(1, Math.ceil((until.getTime() - nowMs) / 60_000));

/** فقط وضعیت قفل (بدون تغییر شمارنده). nowMs برای آزمون خودکار قابل تزریق است */
export async function checkIpLock(bucket: IpBucket, ip: string, nowMs: number = Date.now()): Promise<IpCheck> {
  const key = await rateLimitKey(bucket, ip);
  const rows = await withAuthCtx({ rlKeys: [key] }, (tx) =>
    tx.select({ lockedUntil: rateLimits.lockedUntil }).from(rateLimits).where(eq(rateLimits.key, key)).limit(1)
  );
  const lu = rows[0]?.lockedUntil ? new Date(rows[0].lockedUntil) : null;
  if (lu && lu.getTime() > nowMs) return { locked: true, retryAfterMin: minutesLeft(lu, nowMs) };
  return { locked: false };
}

/** ثبت یک تلاش؛ اگر با این تلاش به سقف رسید قفل فعال می‌شود (اتمی با FOR UPDATE) */
export async function recordIpAttempt(bucket: IpBucket, ip: string, nowMs: number = Date.now()): Promise<IpCheck> {
  const rule = IP_RULES[bucket];
  const key = await rateLimitKey(bucket, ip);
  const now = new Date(nowMs);
  const out = await withAuthCtx({ rlKeys: [key] }, async (tx) => {
    await tx.execute(
      sql`INSERT INTO rate_limits (key, bucket, count, window_start) VALUES (${key}, ${bucket}, 0, ${now.toISOString()}::timestamptz) ON CONFLICT (key) DO NOTHING`
    );
    const rows = await tx.select().from(rateLimits).where(eq(rateLimits.key, key)).for("update").limit(1);
    const rec = rows[0];
    if (!rec) return { locked: false } as IpCheck;
    const lockedUntil = rec.lockedUntil ? new Date(rec.lockedUntil) : null;
    if (lockedUntil && lockedUntil.getTime() > nowMs) {
      return { locked: true, retryAfterMin: minutesLeft(lockedUntil, nowMs) } as IpCheck; // قفل فعال را تمدید نمی‌کنیم
    }
    const expired = !!lockedUntil || new Date(rec.windowStart).getTime() <= nowMs - rule.windowMs;
    const count = expired ? 1 : rec.count + 1;
    const newLock = count >= rule.max ? new Date(nowMs + rule.lockMs) : null;
    await tx
      .update(rateLimits)
      .set({ count, windowStart: expired ? now : rec.windowStart, lockedUntil: newLock })
      .where(eq(rateLimits.key, key));
    return newLock ? ({ locked: true, retryAfterMin: minutesLeft(newLock, nowMs) } as IpCheck) : ({ locked: false } as IpCheck);
  });
  // پاک‌سازی تصادفی ردیف‌های قدیمی (حدود ۲٪ درخواست‌ها)
  if (Math.random() < 0.02) {
    try {
      await withSystemRole((tx) =>
        tx.execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day' AND (locked_until IS NULL OR locked_until < now())`)
      );
    } catch {
      /* مهم نیست */
    }
  }
  return out;
}

export const ipLockMessage = (min: number) =>
  `تلاش‌های زیادی از این شبکه ثبت شده است. لطفاً ${min} دقیقه دیگر دوباره تلاش کنید.`;
