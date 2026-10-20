import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { recordError } from "@/lib/error-log";

export const dynamic = "force-dynamic";

/** گزارش خطای صفحه از مرورگرِ کاربر واردشده (فقط پیام کوتاه) */
export async function POST(request: Request) {
  const ctx = await getAuth();
  if (!ctx) return new NextResponse(null, { status: 204 });
  let b: { place?: unknown; message?: unknown } = {};
  try {
    b = (await request.json()) as typeof b;
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const place = typeof b.place === "string" ? b.place.slice(0, 120) : "?";
  const message = typeof b.message === "string" ? b.message : "client error";
  await recordError(`client ${place}`, new Error(message), { source: "client", tenantId: ctx.tenantId, userId: ctx.userId });
  return new NextResponse(null, { status: 204 });
}
