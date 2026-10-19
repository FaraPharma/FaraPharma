import { NextRequest, NextResponse } from "next/server";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { pushSubscriptions } from "@/db/schema";
import { sendPush } from "@/lib/push";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

/** ارسال اعلان push به اشتراکهای تنانت (ادمین: به همه) */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth();
    const j = (await request.json().catch(() => null)) as {
      title?: string;
      body?: string;
      tag?: string;
      url?: string;
    } | null;
    const title = (j?.title ?? "").trim();
    const body = (j?.body ?? "").trim();
    if (!title || !body) {
      return NextResponse.json({ error: "عنوان و متن لازم است" }, { status: 400 });
    }

    const subs = await withTenant(ctx, async (tx) => {
      const rows = await tx
        .select({
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .where(
          ctx.role === "admin" ? undefined : undefined // همه اشتراکهای تنانت (admin هم تنانت خودش را میبیند)
        );
      return rows;
    });

    let sent = 0;
    for (const s of subs) {
      const ok = await sendPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        {
          title,
          body,
          tag: j?.tag ?? "pharma",
          url: j?.url ?? "/cheques",
        }
      );
      if (ok) sent++;
    }
    return NextResponse.json({ ok: true, sent, total: subs.length });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/push/send", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
