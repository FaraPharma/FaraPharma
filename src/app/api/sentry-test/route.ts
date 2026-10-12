import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * مسیر تست پایش خطا: با یک درخواست GET عمداً خطا میدهد تا در
 * Sentry ثبت شود. فقط برای تأیید اتصال — بعداً میتوانید حذفش کنید.
 */
export async function GET() {
  throw new Error("Sentry test error — تأیید اتصال پایش خطا");
}
