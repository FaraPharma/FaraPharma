import { normalizeText, tokenize, listAgeInfo } from "@/lib/product-search";

/**
 * «دفعه‌ی قبل»: آخرین خرید واقعی هر کالا از سفارش‌های ثبت‌شده (سفارش حذف‌شده/لغوشده حساب نمی‌شود).
 * توابع خالص‌اند (بدون دیتابیس) تا API جستجو، لیست خرید و آزمون خودکار یکسان عمل کنند.
 * هیچ محاسبه‌ی آفر یا تخفیفی انجام نمی‌شود؛ فقط قیمت واحد ثبت‌شده در سفارش.
 */

/** بیش از این درصد اختلاف قیمت، یک نشان ساده می‌گیرد */
export const TREND_PCT = 5;

/** کلید تطبیق: همان نرمال‌سازی جستجو؛ ترتیب کلمه‌ها مهم نیست («پنتن شامپو ۴۰۰» = «شامپو پنتن ۴۰۰») */
export function historyKey(name: string): string {
  return tokenize(normalizeText(name)).sort().join(" ");
}

export interface LastPurchase {
  visitorId: string;
  visitorName: string;
  /** قیمت واحد (تومان) */
  price: number;
  /** زمان ثبت سفارش (ISO) */
  at: string;
}

export interface RawPurchaseRow {
  productName: string;
  unitPrice: number;
  at: Date | string;
  visitorId: string;
  visitorName: string;
}

/** آخرین خرید هر کالا (کلید = historyKey)؛ ردیف‌های بدون قیمت (۰) نادیده گرفته می‌شوند */
export function buildLastPurchases(rows: RawPurchaseRow[]): Map<string, LastPurchase> {
  const out = new Map<string, LastPurchase>();
  for (const r of rows) {
    if (!(r.unitPrice > 0)) continue;
    const key = historyKey(r.productName);
    if (!key) continue;
    const at = new Date(r.at).toISOString();
    const cur = out.get(key);
    if (!cur || at > cur.at) out.set(key, { visitorId: r.visitorId, visitorName: r.visitorName, price: r.unitPrice, at });
  }
  return out;
}

export interface LastBuyInfo {
  visitorName: string;
  price: number;
  at: string;
  ageDays: number | null;
}

export function lastBuyFor(map: Map<string, LastPurchase>, productName: string, now = Date.now()): LastBuyInfo | null {
  const p = map.get(historyKey(productName));
  if (!p) return null;
  return { visitorName: p.visitorName, price: p.price, at: p.at, ageDays: listAgeInfo(p.at, now).ageDays };
}

export type PriceTrend = "up" | "down" | null;

/** گران‌تر/ارزان‌تر فقط وقتی اختلاف از ۵٪ بیشتر باشد (دقیقاً ۵٪ = بدون نشان)؛ محاسبه‌ی صحیح بدون خطای اعشار */
export function priceTrend(current: number | null | undefined, previous: number | null | undefined): PriceTrend {
  if (!current || !previous || current <= 0 || previous <= 0) return null;
  if (current * 100 > previous * (100 + TREND_PCT)) return "up";
  if (current * 100 < previous * (100 - TREND_PCT)) return "down";
  return null;
}
