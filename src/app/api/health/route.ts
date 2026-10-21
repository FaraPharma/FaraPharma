import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // ?light=1: فقط «سرور زنده است» (بدون دیتابیس) برای پایش اتصال مرورگر
  if (new URL(request.url).searchParams.get("light") === "1") return Response.json({ ok: true });
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
