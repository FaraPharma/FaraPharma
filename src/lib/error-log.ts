import { errorLog } from "@/db/schema";
import { logServerError } from "@/lib/log";

/** حذف آدرس‌ها و مقدارهای حساس از متن خطا، و کوتاه‌سازی */
export function sanitizeMessage(raw: string): string {
  return raw
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "[url]")
    .replace(/(password|passwd|secret|token|apikey|api_key|key)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 300);
}

/**
 * ثبت خطا در لاگ سرور و (بهترین تلاش) جدول error_log. هرگز خطا پرت نمی‌کند.
 */
export async function recordError(
  place: string,
  e: unknown,
  opts: { source?: "server" | "client"; tenantId?: string; userId?: string } = {}
): Promise<void> {
  try {
    logServerError(place, e);
    const x = (e ?? {}) as { message?: string; code?: string; cause?: { code?: string; message?: string } };
    // علت اصلی (cause) اول می‌آید؛ متن دستور SQL طولانی است و علت را قطع می‌کرد
    const base = x.message ?? String(e);
    const message = sanitizeMessage(x.cause?.message ? `${x.cause.message} :: ${base}` : base);
    const { withSystemRole } = await import("@/db");
    await withSystemRole((tx) =>
      tx.insert(errorLog).values({
        source: opts.source ?? "server",
        place: place.slice(0, 200),
        code: String(x.code ?? x.cause?.code ?? "") || null,
        message,
        tenantId: opts.tenantId ?? null,
        userId: opts.userId ?? null,
      })
    );
  } catch {
    // ثبت خطا نباید خودش مشکل بسازد
  }
}
