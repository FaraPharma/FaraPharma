import type { Order, OrderItem } from "@/lib/types";
import { faNum, toman } from "@/lib/format";
import { listAgeInfo } from "@/lib/product-search";

/**
 * لیست خرید (سبد): توابع خالص برای ساخت نما، گروه‌بندی بر اساس ویزیتور، متن آماده‌ی ارسال و تبدیل به سفارش.
 * بدون وابستگی به دیتابیس تا هم API، هم صفحه و هم آزمون خودکار از همین‌ها استفاده کنند.
 */

export const QTY_MAX = 99999;

/** ردیفِ جایگزین: یک ویزیتورِ دارای کالا (موجود) با قیمت و سن لیست */
export interface BasketAlt {
  visitorId: string;
  visitorName: string;
  price: number | null;
  ageDays: number | null;
  stale: boolean;
  cheapest: boolean;
}

export interface BasketItem {
  id: string;
  productId: string;
  productName: string;
  visitorId: string | null;
  visitorName: string | null;
  qty: number;
  /** قیمت لحظه‌ی افزودن (تومان) */
  price: number | null;
  ageDays: number | null;
  stale: boolean;
  /** هیچ ویزیتوری این کالا را موجود ندارد */
  unavailable: boolean;
  /** ویزیتور انتخابی دیگر این کالا را موجود ندارد (بعد از ورود لیست تازه) */
  visitorOut: boolean;
  alternatives: BasketAlt[];
}

export interface BasketGroup {
  key: string;
  visitorId: string | null;
  visitorName: string;
  items: BasketItem[];
  totalQty: number;
  /** جمع مبلغ ردیف‌هایی که قیمت دارند */
  totalAmount: number;
  hasPrices: boolean;
  ageDays: number | null;
  stale: boolean;
  /** فقط گروهِ دارای ویزیتور را می‌شود سفارش داد یا فرستاد */
  orderable: boolean;
}

/** «امروز / دیروز / ۱۲ روز پیش» برای سن لیست */
export function listAgeLabel(days: number | null): string {
  if (days === null) return "بدون تاریخ";
  if (days <= 0) return "امروز";
  if (days === 1) return "دیروز";
  return `${faNum(days)} روز پیش`;
}

const cmp = (a: string, b: string) => a.localeCompare(b, "fa");

/** تعداد از ورودی کاربر (ارقام فارسی/عربی/لاتین)؛ نامعتبر = null */
export function parseQty(input: string): number | null {
  const latin = String(input ?? "")
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
  if (!/^\d{1,5}$/.test(latin)) return null;
  const n = parseInt(latin, 10);
  return n >= 1 && n <= QTY_MAX ? n : null;
}

/** ترتیب انتخاب ویزیتور: ارزان‌تر، بعد تازه‌تر بودن لیست، بعد نام */
export function compareAlternatives(
  a: { price: number | null; ageDays: number | null; visitorName: string },
  b: { price: number | null; ageDays: number | null; visitorName: string }
): number {
  return (
    (a.price ?? Infinity) - (b.price ?? Infinity) ||
    (a.ageDays ?? Infinity) - (b.ageDays ?? Infinity) ||
    cmp(a.visitorName, b.visitorName)
  );
}

export interface RawBasketRow {
  id: string;
  productId: string;
  productName: string;
  visitorId: string | null;
  visitorName: string | null;
  qty: number;
  price: number | null;
}

export interface RawAvailable {
  productId: string;
  visitorId: string;
  visitorName: string;
  price: number | null;
}

/** ساخت نمای کامل ردیف‌ها (جایگزین‌ها، سن لیست، ناموجودی) از داده‌ی خام دیتابیس */
export function buildBasketItems(
  rows: RawBasketRow[],
  available: RawAvailable[],
  listAt: Map<string, string | null>,
  now = Date.now()
): BasketItem[] {
  const byProduct = new Map<string, BasketAlt[]>();
  for (const a of available) {
    const info = listAgeInfo(listAt.get(a.visitorId) ?? null, now);
    const arr = byProduct.get(a.productId) ?? [];
    arr.push({ visitorId: a.visitorId, visitorName: a.visitorName, price: a.price, ageDays: info.ageDays, stale: info.stale, cheapest: false });
    byProduct.set(a.productId, arr);
  }
  for (const arr of byProduct.values()) {
    arr.sort(compareAlternatives);
    const first = arr.find((x) => x.price !== null);
    if (first) first.cheapest = true;
  }
  return rows.map((r) => {
    const alternatives = byProduct.get(r.productId) ?? [];
    const info = listAgeInfo(r.visitorId ? listAt.get(r.visitorId) ?? null : null, now);
    return {
      id: r.id,
      productId: r.productId,
      productName: r.productName,
      visitorId: r.visitorId,
      visitorName: r.visitorName,
      qty: r.qty,
      price: r.price,
      ageDays: info.ageDays,
      stale: info.stale,
      unavailable: alternatives.length === 0,
      visitorOut: r.visitorId !== null && !alternatives.some((a) => a.visitorId === r.visitorId),
      alternatives,
    };
  });
}

/** گروه‌بندی بر اساس ویزیتور (به‌ترتیب نام)؛ ردیف‌های بدون ویزیتور آخر، با نام کالا مرتب */
export function groupBasket(items: BasketItem[]): BasketGroup[] {
  const map = new Map<string, BasketGroup>();
  for (const it of items) {
    const key = it.visitorId ?? "none";
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        visitorId: it.visitorId,
        visitorName: it.visitorId ? it.visitorName ?? "—" : "بدون ویزیتور",
        items: [],
        totalQty: 0,
        totalAmount: 0,
        hasPrices: false,
        ageDays: it.ageDays,
        stale: it.stale,
        orderable: it.visitorId !== null,
      };
      map.set(key, g);
    }
    g.items.push(it);
    g.totalQty += it.qty;
    if (it.price !== null) {
      g.totalAmount += it.price * it.qty;
      g.hasPrices = true;
    }
  }
  const groups = [...map.values()];
  for (const g of groups) g.items.sort((a, b) => cmp(a.productName, b.productName));
  groups.sort((a, b) => (a.visitorId === null ? 1 : 0) - (b.visitorId === null ? 1 : 0) || cmp(a.visitorName, b.visitorName));
  return groups;
}

/**
 * متن فارسی ساده برای ارسال به ویزیتور: سلام، فهرست «نام کالا — تعداد»، مجموع تعداد.
 * قیمت فقط با گزینه‌ی withPrice (پیش‌فرض خاموش).
 */
export function basketGroupText(g: BasketGroup, opts: { withPrice?: boolean } = {}): string {
  const lines: string[] = ["سلام", "لطفاً سفارش زیر را ثبت بفرمایید:", ""];
  g.items.forEach((it, i) => {
    const price = opts.withPrice && it.price !== null ? ` × ${toman(it.price)}` : "";
    lines.push(`${faNum(i + 1)}. ${it.productName} — ${faNum(it.qty)}${price}`);
  });
  lines.push("");
  lines.push(`مجموع تعداد: ${faNum(g.totalQty)} (${faNum(g.items.length)} قلم)`);
  if (opts.withPrice && g.hasPrices) lines.push(`جمع تقریبی: ${toman(g.totalAmount)}`);
  lines.push("ممنون");
  return lines.join("\n");
}

/** تبدیل گروه به «سفارش» برای ابزارهای خروجی فعلی (اکسل/PDF) */
export function basketGroupOrder(g: BasketGroup, now = new Date()): Order {
  const items: OrderItem[] = g.items.map((it, i) => ({
    id: `b${i}`,
    orderId: "draft",
    productName: it.productName,
    qty: it.qty,
    unitPrice: it.price ?? 0,
    discountPct: 0,
  }));
  return {
    id: "پیش‌نویس",
    // خروجی‌ها «شماره‌ی سفارش» را فقط وقتی نشان می‌دهند که مقدار داشته باشد؛ پیش‌نویس شماره ندارد
    orderNo: undefined as unknown as number,
    visitorId: g.visitorId ?? "",
    visitorName: g.visitorName,
    visitorCompany: null,
    status: "draft",
    note: null,
    settlementType: "cash",
    settlementDays: 0,
    createdAt: now.toISOString(),
    items,
  };
}
