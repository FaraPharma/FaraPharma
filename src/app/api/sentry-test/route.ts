import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

/** در production فقط مدیر؛ برای بقیه 404 (وجود مسیر فاش نشود). */
async function notAdmin(): Promise<NextResponse | null> {
  if (process.env.NODE_ENV !== "production") return null;
  try {
    await requireAdmin();
    return null;
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

export const dynamic = "force-dynamic";

/**
 * مسیر تست پایش خطا: با یک درخواست GET عمداً خطا میدهد تا در
 * Sentry ثبت شود. فقط برای تأیید اتصال — بعداً میتوانید حذفش کنید.
 */
export async function GET() {
  const denied = await notAdmin();
  if (denied) return denied;
  throw new Error("Sentry test error — تأیید اتصال پایش خطا");
}
