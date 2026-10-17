const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

/** Convert latin digits in a string/number to Persian digits. */
export function faNum(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

export function toNum(value: string): number {
  const cleaned = value.replace(/[۰-۹]/g, (d) =>
    String(FA_DIGITS.indexOf(d))
  );
  const n = parseInt(cleaned.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function faDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export function faDateShort(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function faDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function toman(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${faNum(Math.round(n).toLocaleString("en-US"))} تومان`;
}

/** نمایش فشرده مبلغ (برای سلولهای کوچک تقویم) */
export function compactToman(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000_000)
    return `${faNum((n / 1_000_000_000).toFixed(1))}میلیارد`;
  if (n >= 1_000_000) return `${faNum((n / 1_000_000).toFixed(1))}م`;
  if (n >= 1_000) return `${faNum(Math.round(n / 1000))}هزار`;
  return faNum(n);
}

export function daysLeft(iso: string | Date | null | undefined): number | null {
  if (!iso) return null;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const ms = d.getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export interface SubProfile {
  status: string;
  trialEndsAt?: string | Date | null;
  subscriptionEndsAt?: string | Date | null;
}

/** Effective subscription status, derived from dates too. */
export function effectiveStatus(
  p: SubProfile,
  role?: string
): "trial" | "active" | "expired" {
  if (role === "admin") return "active"; // مدیر از محدودیت اشتراک معاف است
  const now = Date.now();
  if (p.status === "active") {
    return p.subscriptionEndsAt &&
      new Date(p.subscriptionEndsAt).getTime() < now
      ? "expired"
      : "active";
  }
  if (p.status === "trial") {
    return p.trialEndsAt && new Date(p.trialEndsAt).getTime() < now
      ? "expired"
      : "trial";
  }
  return "expired";
}
