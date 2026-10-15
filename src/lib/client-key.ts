/** کلید یکتای ثبت (idempotency) — ۸ تا ۶۴ نویسه‌ی [A-Za-z0-9_-] */
export function newClientKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `k${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
