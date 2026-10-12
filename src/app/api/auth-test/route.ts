import { NextRequest, NextResponse } from "next/server";
import {
  checkLoginLock,
  recordFailedLogin,
  clearLoginAttempts,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * مسیر تست محدودسازی تلاش ورود (بدون نیاز به احراز هویت):
 *  - GET ?email=...  → وضعیت قفل
 *  - POST ?email=... → ثبت یک تلاش ناموفق
 *  - DELETE ?email=.. → پاک کردن شمارنده
 * فقط برای تأیید مکانیزم — میتوانید بعداً حذفش کنید.
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email") ?? "";
  if (!email) return NextResponse.json({ error: "email لازم است" }, { status: 400 });
  return NextResponse.json(await checkLoginLock(email));
}

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email") ?? "";
  if (!email) return NextResponse.json({ error: "email لازم است" }, { status: 400 });
  return NextResponse.json(await recordFailedLogin(email));
}

export async function DELETE(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email") ?? "";
  if (!email) return NextResponse.json({ error: "email لازم است" }, { status: 400 });
  await clearLoginAttempts(email);
  return NextResponse.json({ ok: true });
}
