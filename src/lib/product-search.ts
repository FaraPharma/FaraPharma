/**
 * جستجوی قیمت کالا: نرمال‌سازی و امتیازدهی کاملاً در کد (بدون extension دیتابیس).
 * توابع این فایل خالص‌اند (بدون وابستگی به دیتابیس/Next) تا هم مسیر /api/search و هم آزمون خودکار از آن استفاده کنند.
 */

const AR_DIGIT_BASE = 0x0660; // ٠
const FA_DIGIT_BASE = 0x06f0; // ۰

/** نرمال‌سازی یکسان برای پرسش و نام کالا (خروجی: توکن‌ها با یک فاصله، حروف کوچک) */
export function normalizeText(input: string): string {
  let s = String(input ?? "");
  s = s
    // ارقام فارسی/عربی → لاتین
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - FA_DIGIT_BASE))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - AR_DIGIT_BASE))
    // اعراب، کشیده، نیم‌فاصله و نشانه‌های جهت
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200C\u200D\u200E\u200F\u061C]/g, "")
    // ی/ي/ى و ک/ك و هم‌خانواده‌ها
    .replace(/[\u064A\u0649\u06CC\u06D0]/g, "\u06CC")
    .replace(/[\u0643\u06A9]/g, "\u06A9")
    .replace(/[\u0623\u0625\u0671\u0622]/g, "\u0627") // أ إ ٱ آ → ا
    .replace(/[\u06C0\u0629]/g, "\u0647") // ۀ ة → ه
    .toLowerCase();
  // نشانه‌گذاری → فاصله؛ سپس جدا کردن مرز رقم/حرف («400ml» = «400 ml»)
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ");
  s = s.replace(/(\d)(\p{L})/gu, "$1 $2").replace(/(\p{L})(\d)/gu, "$1 $2");
  return s.replace(/\s+/g, " ").trim();
}

export function tokenize(normalized: string): string[] {
  return normalized ? normalized.split(" ") : [];
}

/** فاصله‌ی ویرایشی ≤ ۱ (درج، حذف، جایگزینی یا جابه‌جایی دو حرف مجاور) */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // یک حرف اشتباه
    return (
      i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
    ); // جابه‌جایی
  }
  return la < lb ? a.slice(i) === b.slice(i + 1) : a.slice(i + 1) === b.slice(i);
}

/** کلاس تطبیق یک توکن پرسش با یک توکن نام: ۴ دقیق، ۳ پیشوندی، ۲ غلط املایی، ۱ میانه‌ی کلمه، ۰ بی‌ربط */
export function matchToken(q: string, t: string): 0 | 1 | 2 | 3 | 4 {
  if (q === t) return 4;
  if (t.startsWith(q)) return 3;
  if (/\d/.test(q)) return 0; // عدد/اندازه: فقط دقیق یا پیشوندی (۴۰۰ ≠ ۳۰۰)
  if (q.length >= 4 && (withinOneEdit(q, t) || withinOneEdit(q, t.slice(0, q.length)))) return 2;
  if (q.length >= 3 && t.includes(q)) return 1;
  return 0;
}

/**
 * سطح ارتباط یک نام با پرسش (null = نامرتبط). همه‌ی توکن‌های پرسش باید جایی از نام بنشینند (ترتیب مهم نیست).
 * سطح = ضعیف‌ترین توکن (۱ تا ۴) + ۰٫۵ اگر نام توکن اضافه‌ای نسبت به پرسش ندارد.
 */
export function scoreName(qTokens: string[], nameTokens: string[]): number | null {
  if (qTokens.length === 0 || nameTokens.length === 0) return null;
  let worst = 4;
  for (const q of qTokens) {
    let best = 0;
    for (const t of nameTokens) {
      const c = matchToken(q, t);
      if (c > best) best = c;
      if (best === 4) break;
    }
    if (best === 0) return null;
    if (best < worst) worst = best;
  }
  return worst + (nameTokens.length <= qTokens.length ? 0.5 : 0);
}

export interface SearchEntry {
  id: string;
  name: string;
  tokens: string[];
  visitorId: string;
  visitorName: string;
  price: number | null;
  qty: number | null;
  unit: string | null;
  stock: string;
  /** زمان آخرین ورود لیست این ویزیتور (ISO) */
  listAt: string | null;
}

export interface SearchHit {
  conditionId: string;
  productName: string;
  visitorId: string;
  visitorName: string;
  price: number | null;
  qty: number | null;
  unit: string | null;
  stock: string;
  listAt: string | null;
  ageDays: number | null;
  stale: boolean;
  cheapest: boolean;
}

export const MAX_RESULTS = 40;
export const STALE_DAYS = 30;

/** جستجوی کامل روی فهرست آماده (فقط کالاهای موجود) و مرتب‌سازی: مرتبط‌ترین، سپس ارزان‌ترین */
export function searchEntries(entries: SearchEntry[], query: string, now = Date.now()): SearchHit[] {
  const qTokens = tokenize(normalizeText(query));
  if (qTokens.join("").length < 2) return [];
  const scored: Array<{ e: SearchEntry; level: number }> = [];
  for (const e of entries) {
    if (e.stock === "out") continue;
    const level = scoreName(qTokens, e.tokens);
    if (level !== null) scored.push({ e, level });
  }
  scored.sort(
    (a, b) =>
      b.level - a.level ||
      (a.e.price ?? Infinity) - (b.e.price ?? Infinity) ||
      a.e.name.localeCompare(b.e.name, "fa") ||
      a.e.visitorName.localeCompare(b.e.visitorName, "fa")
  );
  const top = scored.slice(0, MAX_RESULTS);
  // «ارزان‌ترین»: کمترین قیمت بین نتیجه‌های هم‌سطحِ بالا (حداکثر نیم‌پله‌ی اختلاف با مرتبط‌ترین)
  const topLevel = top.length ? top[0].level : 0;
  let cheapestId: string | null = null;
  let cheapestPrice = Infinity;
  for (const { e, level } of top) {
    if (level >= topLevel - 1 && e.price !== null && e.price < cheapestPrice) {
      cheapestPrice = e.price;
      cheapestId = e.id;
    }
  }
  return top.map(({ e }) => {
    const t = e.listAt ? new Date(e.listAt).getTime() : NaN;
    const ageDays = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
    return {
      conditionId: e.id,
      productName: e.name,
      visitorId: e.visitorId,
      visitorName: e.visitorName,
      price: e.price,
      qty: e.qty,
      unit: e.unit,
      stock: e.stock,
      listAt: e.listAt,
      ageDays,
      stale: ageDays !== null && ageDays > STALE_DAYS,
      cheapest: e.id === cheapestId,
    };
  });
}

// ---------- کش کوتاه‌مدتِ فهرست هر tenant (کلید = tenantId؛ داده فقط با خود همان tenant خوانده می‌شود) ----------
const CACHE_TTL_MS = 10_000;
const CACHE_MAX_TENANTS = 20;
const entryCache = new Map<string, { at: number; entries: SearchEntry[] }>();

export function getCachedEntries(tenantId: string): SearchEntry[] | null {
  const hit = entryCache.get(tenantId);
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.entries : null;
}

export function setCachedEntries(tenantId: string, entries: SearchEntry[]): void {
  if (entryCache.size >= CACHE_MAX_TENANTS) {
    const oldest = [...entryCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) entryCache.delete(oldest[0]);
  }
  entryCache.set(tenantId, { at: Date.now(), entries });
}

/** برای آزمون خودکار (و هر جا داده‌ی جستجو دست‌کاری می‌شود) */
export function clearSearchCache(tenantId?: string): void {
  if (tenantId) entryCache.delete(tenantId);
  else entryCache.clear();
}
