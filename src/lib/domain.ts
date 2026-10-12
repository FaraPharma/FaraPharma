import type { Condition, Order } from "@/lib/types";

/**
 * Scoring algorithm for ranking visitors per product:
 * stock availability matters most, then cash discount, cheque days,
 * presence of an offer, and finally penalizes expired conditions.
 */
export function conditionScore(c: {
  stock: string;
  cashDiscountPct: number;
  checkDays: number;
  offer: string | null;
  validUntil: string | null;
}): number {
  let score = 0;
  if (c.stock === "in") score += 200;
  else if (c.stock === "low") score += 90;
  else score -= 1000;

  score += Math.min(c.cashDiscountPct || 0, 60) * 2;
  score += Math.min(c.checkDays || 0, 90) * 3;
  if (c.offer && c.offer.trim().length > 0) score += 15;

  if (c.validUntil) {
    const d = new Date(c.validUntil);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d.getTime() < today.getTime()) score -= 200;
  }
  return score;
}

export function bestCondition(
  conditions: Condition[],
  productId: string
): Condition | null {
  return (
    conditions
      .filter((c) => c.productId === productId)
      .sort((a, b) => conditionScore(b) - conditionScore(a))[0] ?? null
  );
}

export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  let digits = phone.replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "98" + digits.slice(1);
  return digits;
}

export function whatsappUrl(phone: string | null | undefined, text: string): string {
  const p = normalizePhone(phone);
  if (!p) return "";
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

/** تمیز کردن آیدی پیامرسان: حذف @ و فاصله‌ها */
export function normalizeUsername(
  username: string | null | undefined
): string {
  if (!username) return "";
  return username
    .trim()
    .replace(/^@+/, "")
    .replace(/[\s\u200C]+/g, "")
    .slice(0, 64);
}

/**
 * لینک مستقیم چت تلگرام با یوزرنیم.
 * پیش‌پرکردن متن در لینک مستقیم چت پشتیبانی نمیشود؛ متن را باید
 * جداگانه کپی کرد — به همین دلیل همیشه کنار لینک، دکمه «کپی متن» باشد.
 */
export function telegramUrl(username: string | null | undefined): string {
  const u = normalizeUsername(username);
  if (!u) return "";
  return `https://t.me/${u}`;
}

/** لینک مستقیم چت بله با یوزرنیم (همان محدودیت متن) */
export function baleUrl(username: string | null | undefined): string {
  const u = normalizeUsername(username);
  if (!u) return "";
  return `https://ble.ir/${u}`;
}

/** لینک مستقیم چت روبیکا با یوزرنیم (همان محدودیت متن) */
export function rubikaUrl(username: string | null | undefined): string {
  const u = normalizeUsername(username);
  if (!u) return "";
  return `https://rubika.ir/${u}`;
}

export function buildRequestText(
  productNames: string[],
  note?: string | null
): string {
  const lines = [
    "سلام، وقت بخیر",
    "لطفاً قیمت و شرایط اقلام زیر را اعلام بفرمایید:",
    "",
    ...productNames.map((n, i) => `${i + 1}) ${n}`),
  ];
  if (note && note.trim()) lines.push("", `توضیح: ${note.trim()}`);
  lines.push("", "ممنون 🌹");
  return lines.join("\n");
}

export function buildOrderText(order: Order, pharmacyName?: string): string {
  const lines: string[] = [];
  lines.push("📋 سفارش جدید");
  lines.push("——————————");
  if (pharmacyName) lines.push(`داروخانه: ${pharmacyName}`);
  lines.push(`ویزیتور: ${order.visitorName ?? "—"}${order.visitorCompany ? ` — ${order.visitorCompany}` : ""}`);
  lines.push(`تاریخ: ${new Date(order.createdAt).toLocaleDateString("fa-IR")}`);
  lines.push("——————————");
  const items = order.items ?? [];
  let total = 0;
  items.forEach((it, i) => {
    const line = Math.round(
      it.qty * it.unitPrice * (1 - (it.discountPct || 0) / 100)
    );
    total += line;
    lines.push(
      `${(i + 1).toLocaleString("fa-IR")}. ${it.productName}`
    );
    lines.push(
      `   تعداد: ${it.qty.toLocaleString("fa-IR")} × ${it.unitPrice.toLocaleString("fa-IR")}${it.discountPct ? ` (تخفیف ${it.discountPct.toLocaleString("fa-IR")}٪)` : ""} = ${line.toLocaleString("fa-IR")} تومان`
    );
  });
  lines.push("——————————");
  lines.push(`جمع کل سفارش: ${total.toLocaleString("fa-IR")} تومان`);
  lines.push(
    `نحوه‌ی تسویه: ${order.settlementType === "cheque" ? "چک" : "نقدی"}${
      order.settlementDays ? ` ${order.settlementDays.toLocaleString("fa-IR")} روزه` : ""
    }`
  );
  if (order.note) lines.push(`توضیحات: ${order.note}`);
  lines.push("——————————");
  return lines.join("\n");
}

export function orderTotal(order: { items?: Array<{ qty: number; unitPrice: number; discountPct: number }> }): number {
  return (order.items ?? []).reduce(
    (sum, it) =>
      sum + Math.round(it.qty * it.unitPrice * (1 - (it.discountPct || 0) / 100)),
    0
  );
}
