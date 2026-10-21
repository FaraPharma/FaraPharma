/**
 * پایش «آخرین اتصال موفق واقعی به سرور» — مستقل از هر صفحه‌ی خاصی.
 *
 * قانون: تا وقتی کمتر از ۴۸ ساعت از آخرین اتصال موفق گذشته، اپ کاملاً عادی
 * کار می‌کند (چه آنلاین چه با کش آفلاین). اگر بیش از ۴۸ ساعت هیچ اتصال
 * موفقی برقرار نشده باشد، اپ باید قفل شود تا وضعیت واقعی (ازجمله وضعیت
 * اشتراک و قطع/وصل‌بودن دسترسی) دوباره از سرور تأیید شود — چون در حالت
 * آفلاین هیچ راهی برای دانستن این وضعیت نیست.
 *
 * نوشتن‌های واقعی (سفارش، چک) همیشه به اتصال زنده نیاز دارند و اصلاً از
 * این مکانیزم عبور نمی‌کنند؛ این قانون فقط مربوط به «خواندن از کش» است.
 */

const STORAGE_KEY = "pharma_last_online_at";
export const OFFLINE_LOCK_MS = 48 * 60 * 60 * 1000; // 48 ساعت

/** هر بار که یک دریافت زنده و موفق از سرور اتفاق می‌افتد، این را صدا بزن. */
export function markOnlineNow(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    window.dispatchEvent(new CustomEvent("pharma:online-verified"));
  } catch {
    /* حالت خصوصی مرورگر یا storage پر — بی‌خطر نادیده گرفته می‌شود */
  }
}

/** آخرین زمانی که واقعاً به سرور وصل بوده‌ایم (یا null اگر هرگز ثبت نشده). */
export function getLastOnlineAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

/**
 * آیا اپ باید قفل شود؟
 * اگر هنوز هیچ اتصال موفقی ثبت نشده (کاربر تازه وارد شده)، قفل نمی‌کنیم —
 * چون خودِ لود صفحه یعنی همین الان یک اتصال زنده برقرار بوده است.
 */
export function isOfflineLocked(): boolean {
  const last = getLastOnlineAt();
  if (last === null) return false;
  return Date.now() - last > OFFLINE_LOCK_MS;
}

/** چند ساعت از آخرین اتصال موفق گذشته — برای نمایش در پیام قفل. */
export function hoursSinceLastOnline(): number | null {
  const last = getLastOnlineAt();
  if (last === null) return null;
  return Math.floor((Date.now() - last) / (60 * 60 * 1000));
}

/**
 * تلاش دستی برای بررسی اتصال واقعی (نه فقط navigator.onLine که می‌تواند
 * غیرقابل‌اعتماد باشد — مثلاً وقتی وای‌فای وصل است ولی اینترنت واقعی ندارد).
 */
export async function verifyRealConnection(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (res.ok) {
      markOnlineNow();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * بررسی واقعی اتصال با یک درخواست کوتاه. هر پاسخ از سرور (حتی خطا) یعنی شبکه وصل است.
 * navigator.onLine روی اندروید با VPN/صرفه‌جویی داده اغلب اشتباه «آفلاین» می‌گوید.
 */
export async function probeOnline(timeoutMs = 6000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch("/api/health?light=1", { cache: "no-store", signal: ctrl.signal });
    markOnlineNow();
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(t);
  }
}
