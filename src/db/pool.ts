import { Pool } from "pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * روی Cloudflare Workers سوکت/اتصال به درخواستی که ساخته‌اش تعلق دارد و
 * استفاده‌ی مجدد از آن در درخواست دیگر باعث گیر کردن می‌شود. بنابراین در
 * production برای هر درخواست یک Pool تازه (max: 1) ساخته می‌شود و پس از
 * آخرین کوئری بسته می‌شود. در توسعه/اسکریپت‌ها همان Pool سراسری قبلی است.
 */

/** نشانه‌ی نسخه‌ی دیپلوی‌شده (آزمون ۳۸ آن را گزارش می‌کند تا معلوم باشد این فایل زنده است) */
export const POOL_REV = "ending-check-1";

const POOL_OPTIONS = {
  max: 1,
  idleTimeoutMillis: 1_000, // اتصال بیکار بعد از ۱ ثانیه بسته می‌شود
  connectionTimeoutMillis: 10_000, // انتظار برای اتصال/نوبت
  query_timeout: 15_000,
  statement_timeout: 15_000,
};

type WaitUntilCtx = { waitUntil(promise: Promise<unknown>): void };

const globalForDb = globalThis as typeof globalThis & {
  __pharmaPool?: Pool;
};

const perRequest = new WeakMap<object, Pool>();
let warnedNoContext = false;

/**
 * کلید مرکزی: true = برنامه با نقش app_runtime (بدون دسترسی ممتاز، با RLS واقعی) وصل می‌شود.
 * برای برگشت فوری به اتصال قبلی فقط این را false کنید و فایل را دوباره بگذارید.
 */
const USE_APP_RUNTIME_ROLE = true;

/**
 * آدرس اتصال برنامه را از DATABASE_URL فعلی و APP_RUNTIME_PASSWORD می‌سازد:
 * نام کاربری postgres.<ref> به app_runtime.<ref> تبدیل می‌شود و رمز از متغیر محیطی می‌آید.
 * اگر متغیر نبود یا آدرس از قبل app_runtime بود، همان آدرس بدون تغییر برمی‌گردد.
 */
function runtimeConnectionString(base: string): string {
  if (!USE_APP_RUNTIME_ROLE) return base;
  const password = process.env.APP_RUNTIME_PASSWORD;
  if (!password) return base;
  try {
    const u = new URL(base);
    const user = decodeURIComponent(u.username);
    if (user.startsWith("app_runtime")) return base;
    const dot = user.indexOf(".");
    if (dot < 0) return base; // قالب نام کاربری ناشناخته: دست نزن
    u.username = `app_runtime${user.slice(dot)}`;
    u.password = password;
    return u.toString();
  } catch {
    return base;
  }
}

function createPool(): Pool {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error("DATABASE_URL تنظیم نشده است");
  }
  const connectionString = runtimeConnectionString(base);
  // ssl: فقط از خود connection string خوانده می‌شود (بدون rejectUnauthorized:false)
  const p = new Pool({ connectionString, ...POOL_OPTIONS });
  p.on("error", (e) => console.error("[db] pool error:", e.message));
  return p;
}

/** Pool را پس از آخرین استفاده می‌بندد و درخواست را تا آن لحظه زنده نگه می‌دارد. */
function closeWhenIdle(p: Pool, ctx: WaitUntilCtx) {
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    p.end().catch(() => {});
  };
  p.once("connect", () => {
    ctx.waitUntil(
      new Promise<void>((resolve) => {
        const safety = setTimeout(() => {
          end();
          resolve();
        }, 25_000);
        p.once("remove", () => {
          clearTimeout(safety);
          end();
          resolve();
        });
      })
    );
  });
}

export function getPool(): Pool {
  if (process.env.NODE_ENV !== "production") {
    return (globalForDb.__pharmaPool ??= createPool());
  }

  let ctx: WaitUntilCtx | undefined;
  try {
    ctx = (getCloudflareContext() as unknown as { ctx?: WaitUntilCtx }).ctx;
  } catch {
    ctx = undefined;
  }

  if (!ctx) {
    // خارج از Workers (مثلاً `next start` محلی): Pool مشترک
    if (!warnedNoContext) {
      warnedNoContext = true;
      console.warn("[db] Cloudflare context not found; using shared pool");
    }
    return (globalForDb.__pharmaPool ??= createPool());
  }

  let p = perRequest.get(ctx);
  // «ending» هم باید بررسی شود: بعد از end() (مهلت ۲۵ثانیه‌ی safety) تا خالی شدن اتصال‌ها ended هنوز false است
  // و connect() خطای «Cannot use a pool after calling end» می‌دهد؛ در این حالت Pool تازه می‌سازیم.
  const st = p as unknown as { ended?: boolean; ending?: boolean } | undefined;
  if (!p || st?.ended || st?.ending) {
    p = createPool();
    perRequest.set(ctx, p);
    closeWhenIdle(p, ctx);
  }
  return p;
}

/**
 * نمایه‌ی تنبل: هر دسترسی (query/connect/end/...) به Pool همان درخواست می‌رود.
 * prototype همان Pool است تا بررسی `instanceof Pool` در drizzle (تراکنش) کار کند.
 */
export const pool: Pool = new Proxy(Object.create(Pool.prototype) as Pool, {
  get(target, prop) {
    if (prop === "constructor" || typeof prop === "symbol") {
      return Reflect.get(target, prop);
    }
    const real = getPool();
    const value = (real as unknown as Record<string, unknown>)[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});
