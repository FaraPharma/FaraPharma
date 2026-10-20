"use server";

import { eq } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { profiles, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { TRIAL_DAYS } from "@/lib/config";
import { writeAudit } from "@/lib/audit";
import type { ActionResult } from "@/actions/auth";

/**
 * RPC-style, admin-only subscription mutation:
 *  - active:  subscriptionEndsAt = endDate (end of day) or +30 days
 *  - trial:   trialEndsAt = endDate (end of day) or +TRIAL_DAYS
 *  - expired: immediately expires the subscription
 */
export async function adminSetSubscriptionAction(input: {
  profileId: string;
  status: "active" | "trial" | "expired";
  endDate?: string; // yyyy-mm-dd
}): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!input.profileId) return { ok: false, error: "پروفایل انتخاب نشده است" };
  if (!["active", "trial", "expired"].includes(input.status))
    return { ok: false, error: "وضعیت معتبر نیست" };

  let trialEndsAt: Date | null = null;
  let subscriptionEndsAt: Date | null = null;

  if (input.endDate && input.status !== "expired") {
    const d = new Date(`${input.endDate}T23:59:59`);
    if (Number.isNaN(d.getTime()))
      return { ok: false, error: "تاریخ معتبر نیست" };
    if (input.status === "active") subscriptionEndsAt = d;
    else trialEndsAt = d;
  } else if (input.status === "active") {
    subscriptionEndsAt = new Date(Date.now() + 30 * 86_400_000);
  } else if (input.status === "trial") {
    trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
  }

  try {
    await withTenant(ctx, async (tx) => {
      const rows = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, input.profileId))
        .limit(1);
      if (!rows[0]) return;
      await tx
        .update(profiles)
        .set({
          status: input.status,
          trialEndsAt: input.status === "trial" ? trialEndsAt : null,
          subscriptionEndsAt: input.status === "active" ? subscriptionEndsAt : null,
        })
        .where(eq(profiles.id, input.profileId));
      await writeAudit(tx, ctx.userId, {
        action: "subscription.set",
        targetType: "profile",
        targetId: input.profileId,
        detail: { status: input.status, endDate: input.endDate ?? null },
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * قطع/وصل کامل و برگشت‌پذیر دسترسیِ ورود یک کاربر — مستقل از وضعیت اشتراک.
 * برخلاف status="expired" (که فقط نوشتن را می‌بندد و خواندن باز می‌ماند)،
 * غیرفعال‌سازی حساب فوری است و حتی نشست‌های از قبل معتبر را هم قطع می‌کند
 * (چون requireAuth این پرچم را در هر درخواست از پایگاه‌داده تازه می‌خواند).
 */
export async function adminToggleAccountAction(input: {
  userId: string;
  disabled: boolean;
}): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!input.userId) return { ok: false, error: "کاربر انتخاب نشده است" };
  if (input.userId === ctx.userId)
    return { ok: false, error: "نمی‌توانید دسترسی حساب خودتان را قطع کنید" };
  try {
    await withTenant(ctx, async (tx) => {
      await tx
        .update(users)
        .set({ disabled: input.disabled })
        .where(eq(users.id, input.userId));
      await writeAudit(tx, ctx.userId, {
        action: input.disabled ? "account.disable" : "account.enable",
        targetType: "user",
        targetId: input.userId,
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
