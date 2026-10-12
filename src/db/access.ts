import { eq } from "drizzle-orm";
import { profiles } from "./schema";
import { AppError, type AuthCtx, type Tx } from "./index";
import { effectiveStatus } from "@/lib/format";

/**
 * Loads the caller's profile and rejects mutations when the subscription
 * has expired (admins are always allowed). Read-only access stays open so
 * owners can still consult/export their own data.
 */
export async function assertWritable(ctx: AuthCtx, tx: Tx) {
  const rows = await tx
    .select()
    .from(profiles)
    .where(eq(profiles.id, ctx.tenantId))
    .limit(1);
  const profile = rows[0];
  if (!profile) throw new AppError("حساب کاربری یافت نشد", 404);
  if (ctx.role !== "admin" && effectiveStatus(profile) === "expired") {
    throw new AppError(
      "اشتراک شما منقضی شده است؛ ثبت و ویرایش غیرفعال است. برای تمدید با پشتیبانی تماس بگیرید.",
      403
    );
  }
  return profile;
}
