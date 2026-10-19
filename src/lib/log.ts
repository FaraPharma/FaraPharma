/**
 * ثبت خطای واقعی سرور در لاگ Cloudflare (Workers Logs) با نام مسیر.
 * فقط فیلدهای تشخیصی امن (کد PostgreSQL، متن خطا، جدول/قید) نوشته می‌شود؛
 * مقدار ردیف‌ها، رمزها، کوکی و آدرس اتصال هرگز.
 */
export function logServerError(where: string, e: unknown): void {
  const x = (e ?? {}) as { message?: string; code?: string; table?: string; constraint?: string; routine?: string; cause?: unknown };
  const cause = x.cause as { message?: string; code?: string } | undefined;
  const parts = [
    `[server-error] ${where}`,
    `code=${x.code ?? cause?.code ?? "-"}`,
    x.table ? `table=${x.table}` : "",
    x.constraint ? `constraint=${x.constraint}` : "",
    x.routine ? `routine=${x.routine}` : "",
    `msg=${(x.message ?? String(e)).slice(0, 300)}`,
    cause?.message ? `cause=${String(cause.message).slice(0, 300)}` : "",
  ].filter(Boolean);
  console.error(parts.join(" | "));
}
