"use server";

import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, AppError, ensureDb } from "@/db";
import { users, profiles } from "@/db/schema";
import {
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSession,
  requireAuth,
} from "@/lib/auth";
import { TRIAL_DAYS } from "@/lib/config";
import { withTenant } from "@/db";
import { assertWritable } from "@/db/access";
import {
  checkLoginLock,
  recordFailedLogin,
  clearLoginAttempts,
} from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ActionResult = { ok: boolean; error?: string; id?: string };

const ACTION_TIMEOUT_MS = 15_000;
const GENERIC_ERROR = "مشکلی پیش آمد. لطفاً چند لحظه بعد دوباره تلاش کنید.";

/** خطاهای غیرمنتظره را لاگ می‌کند، timeout ۱۵ ثانیه دارد و همیشه جواب برمی‌گرداند. */
async function guarded(
  name: string,
  fn: () => Promise<ActionResult>
): Promise<ActionResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timeout after ${ACTION_TIMEOUT_MS}ms`)),
          ACTION_TIMEOUT_MS
        );
      }),
    ]);
  } catch (e) {
    console.error(`[${name}] failed:`, e);
    if (e instanceof AppError) return { ok: false, error: e.message };
    return { ok: false, error: GENERIC_ERROR };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function registerAction(input: {
  pharmacyName: string;
  phone?: string;
  email: string;
  password: string;
}): Promise<ActionResult> {
  return guarded("registerAction", () => registerImpl(input));
}

async function registerImpl(input: {
  pharmacyName: string;
  phone?: string;
  email: string;
  password: string;
}): Promise<ActionResult> {
  await ensureDb();
  const name = (input.pharmacyName ?? "").trim();
  const email = (input.email ?? "").trim().toLowerCase();
  const password = input.password ?? "";
  if (name.length < 2) return { ok: false, error: "نام داروخانه را وارد کنید" };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "ایمیل معتبر نیست" };
  if (password.length < 8)
    return { ok: false, error: "رمز عبور باید حداقل ۸ کاراکتر باشد" };

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0)
    return { ok: false, error: "این ایمیل قبلاً ثبت شده است" };

  const userId = randomUUID();
  const profileId = randomUUID();
  const passwordHash = await hashPassword(password);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);

  await db.insert(users).values({
    id: userId,
    email,
    passwordHash,
    role: "owner",
  });
  await db.insert(profiles).values({
    id: profileId,
    ownerUserId: userId,
    name,
    phone: input.phone?.trim() || null,
    status: "trial",
    trialEndsAt,
  });

  await setSessionCookie({ sub: userId, tid: profileId, role: "owner", email });
  // بدون redirect سمت سرور — ناوبری در کلاینت انجام میشود (سازگار با Netlify)
  return { ok: true };
}

export async function loginAction(input: {
  email: string;
  password: string;
}): Promise<ActionResult> {
  return guarded("loginAction", () => loginImpl(input));
}

async function loginImpl(input: {
  email: string;
  password: string;
}): Promise<ActionResult> {
  await ensureDb();
  const email = (input.email ?? "").trim().toLowerCase();
  const password = input.password ?? "";
  if (!EMAIL_RE.test(email) || !password)
    return { ok: false, error: "ایمیل و رمز عبور را وارد کنید" };

  // قفل ۱۵ دقیقهای بعد از ۵ تلاش ناموفق پشتسرهم (دیتابیسمحور)
  const lock = await checkLoginLock(email);
  if (lock.locked) {
    return {
      ok: false,
      error: `به دلیل تلاشهای ناموفق زیاد، ورود برای ${lock.remainingMinutes} دقیقه قفل شد`,
    };
  }

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    const failed = await recordFailedLogin(email);
    if (failed.locked) {
      return {
        ok: false,
        error: "ایمیل یا رمز عبور اشتباه است — ورود برای ۱۵ دقیقه قفل شد",
      };
    }
    return { ok: false, error: "ایمیل یا رمز عبور اشتباه است" };
  }
  if (user.disabled) {
    return { ok: false, error: "دسترسی این حساب توسط مدیر قطع شده است" };
  }

  // ورود موفق → شمارنده تلاشها صفر میشود
  await clearLoginAttempts(email);

  const pRows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.ownerUserId, user.id))
    .limit(1);
  const profile = pRows[0];
  if (!profile) return { ok: false, error: "پروفایل داروخانه یافت نشد" };

  await setSessionCookie({
    sub: user.id,
    tid: profile.id,
    role: user.role === "admin" ? "admin" : "owner",
    email: user.email,
  });
  // بدون redirect سمت سرور — ناوبری در کلاینت انجام میشود (سازگار با Netlify)
  return { ok: true };
}

export async function logoutAction(): Promise<ActionResult> {
  await clearSession();
  // بدون redirect سمت سرور — ناوبری در کلاینت انجام میشود (سازگار با Netlify)
  return { ok: true };
}

export async function updateProfileAction(input: {
  name: string;
  phone?: string;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  const name = (input.name ?? "").trim();
  if (name.length < 2) return { ok: false, error: "نام داروخانه را وارد کنید" };
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .update(profiles)
        .set({ name, phone: input.phone?.trim() || null })
        .where(eq(profiles.id, ctx.tenantId));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
