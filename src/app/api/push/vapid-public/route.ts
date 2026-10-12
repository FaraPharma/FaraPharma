import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** کلید عمومی VAPID — در اختیار کلاینت برای ساخت اشتراک push */
export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "VAPID تنظیم نشده است — یادآوری push غیرفعال است" },
      { status: 501 }
    );
  }
  return NextResponse.json({ publicKey: key });
}
