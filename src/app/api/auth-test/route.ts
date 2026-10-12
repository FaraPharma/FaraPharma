import { NextRequest, NextResponse } from "next/server";
import {
  checkLoginLock,
  recordFailedLogin,
  clearLoginAttempts,
} from "@/lib/rate-limit";
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
 * مسیر تست محدودسازی تلاش ورود (بدون نیاز به احراز هویت):
 *  - GET ?email=...  → وضعیت قفل
 *  - POST ?email=... → ثبت یک تلاش ناموفق
 *  - DELETE ?email=.. → پاک کردن شمارنده
 * فقط برای تأیید مکانیزم — میتوانید بعداً حذفش کنید.
 */
export async function GET(request: NextRequest) {
  const denied = await notAdmin();
  if (denied) return denied;
  const email = request.nextUrl.searchParams.get("email") ?? "";
  if (!email) return NextResponse.json({ error: "email لازم است" }, { status: 400 });
  return NextResponse.json(await checkLoginLock(email));
}

export async function POST(request: NextRequest) {
  const denied = await notAdmin();
  if (denied) return denied;
  const email = request.nextUrl.searchParams.get("email") ?? "";
  if (!email) return NextResponse.json({ error: "email لازم است" }, { status: 400 });
  return NextResponse.json(await recordFailedLogin(email));
}

export async function DELETE(request: NextRequest) {
  const denied = await notAdmin();
  if (denied) return denied;
  const email = request.nextUrl.searchParams.get("email") ?? "";
  if (!email) return NextResponse.json({ error: "email لازم است" }, { status: 400 });
  await clearLoginAttempts(email);
  return NextResponse.json({ ok: true });
}
