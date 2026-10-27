import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Client, Pool, type PoolClient } from "pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin, signSession } from "@/lib/auth";
import { withTenant, withSystemRole } from "@/db";
import { writeAudit } from "@/lib/audit";
import { AUTH_COOKIE } from "@/lib/config";
import { ensureDb } from "@/db/bootstrap";
import { diffSchema } from "@/db/schema-check";
import { APP_ROLE, listPendingMigrations, runMigrations } from "@/db/migrations";
import { pool as appPool } from "@/db/pool";
import { registerAction, updateProfileAction } from "@/actions/auth";
import { adminSetSubscriptionAction, adminToggleAccountAction } from "@/actions/admin";
import { checkIpLock, recordIpAttempt, rateLimitKey, ipLockMessage, IP_RULES, type IpBucket } from "@/lib/rate-limit";
import { normalizeIp } from "@/lib/client-ip";
import { effectiveStatus } from "@/lib/format";
import { addVisitorAction, deleteVisitorAction } from "@/actions/visitors";
import {
  createOrderAction,
  deleteOrderAction,
  restoreOrderAction,
  purgeOrderAction,
} from "@/actions/orders";
import { GET as ordersGET } from "@/app/api/orders/route";
import { GET as dashboardGET } from "@/app/api/dashboard/route";
import { GET as backupGET } from "@/app/api/backup/route";
import { GET as chequesGET } from "@/app/api/cheques/route";
import { GET as visitorsGET } from "@/app/api/visitors/route";
import { GET as auditGET } from "@/app/api/admin/audit/route";
import { GET as errorsGET } from "@/app/api/admin/errors/route";
import { recordError } from "@/lib/error-log";
import { storage, MAX_CATALOG_BYTES, STORAGE_INFO } from "@/lib/storage";
import { importVisitorListAction } from "@/actions/listImport";
import { parseTable, visualToLogical } from "@/lib/list-import";
import { POOL_REV } from "@/db/pool";
import { catalogFileChunks } from "@/db/schema";
import { POST as notesSyncPOST } from "@/app/api/quick-notes/sync/route";
import { GET as searchGET } from "@/app/api/search/route";
import { normalizeText, clearSearchCache } from "@/lib/product-search";
import { GET as basketGET } from "@/app/api/basket/route";
import {
  addToBasketAction,
  addAllShortagesAction,
  setBasketQtyAction,
  setBasketVisitorAction,
  removeBasketItemAction,
  clearBasketAction,
  placeBasketOrderAction,
} from "@/actions/basket";
import { groupBasket, basketGroupText, basketGroupOrder, parseQty, type BasketItem } from "@/lib/basket";
import { POST as shareTargetPOST, GET as shareTargetGET } from "@/app/share-target/route";
import { GET as shareVisitorsGET } from "@/app/api/import-share/visitors/route";
import { SHARE_MAX_BYTES, classifyShareFile, detectVisitor, orderChoices, type Detection, type VisitorCand } from "@/lib/share-detect";
import { listAgeInfo } from "@/lib/product-search";
import { updateVisitorTermsAction } from "@/actions/visitors";
import { clearHistoryCache } from "@/lib/purchase-history-db";
import { priceTrend } from "@/lib/purchase-history";

/**
 * مسیر آزمایشیِ موقت برای آزمون‌های مرحله‌ی سفارش — فقط مدیر، فقط با ?confirm=yes.
 * بعد از تست این فایل را حذف کنید.
 *
 * داده‌ی آزمایشی:
 *  - داروخانه‌ی آزمایشی B (کاربر موقت selftest-…@invalid.test): آزمون‌های همزمانی و ایزوله‌ی tenant
 *  - در tenant خودِ مدیر (A): فقط یک ویزیتور به نام SELFTEST-… و سفارش‌هایی با یادداشت SELFTEST
 *    (چون اکشن‌های واقعی فقط برای tenant نشست جاری کار می‌کنند). همه در finally پاک می‌شوند
 *    و شمارنده‌ی سفارش A به مقدار قبل برمی‌گردد.
 *
 * آزمون‌های ۱ و ۲ (همزمانی) همان دنباله‌ی SQL ثبت سفارش را با اتصال‌های جدا اجرا می‌کنند؛
 * آزمون‌های ۳ تا ۷ اکشن‌ها و مسیرهای واقعی (فهرست، داشبورد، پشتیبان) را صدا می‌زنند؛
 * آزمون ۸ مسیر واقعی را با نشست داروخانه‌ی B (از طریق WORKER_SELF_REFERENCE) صدا می‌زند.
 * آزمون‌های ۱۰ تا ۱۲: مقایسه‌ی اسکیمای واقعی با schema.ts، ثبت‌نام آزمایشی با اکشن واقعی
 *   (کوکی نشست مدیر برگردانده می‌شود) و اجرای دوباره‌ی مهاجرت‌ها با اتصال ممتاز (اشتراک مدیر ثابت بماند).
 * آزمون‌های ۱۳ و ۱۴: هدر no-cache روی /sw.js و /manifest.json (از مسیر واقعی Workers) و وجود شناسه‌ی نسخه/منطق به‌روزرسانی در sw.js.
 * آزمون‌های ۱۵ تا ۲۱ (مرحله‌ی ۳ب): نقش اتصال برنامه، و با اتصال جداگانه به app_runtime (همه داخل تراکنش با ROLLBACK):
 *   صفر ردیف بدون tenant، فقط ردیف‌های A، رد INSERT بیگانه، UPDATE/DELETE بیگانه، نبود DDL؛ و RLS+FORCE روی همه‌ی جدول‌ها.
 *   اگر اتصال app_runtime ممکن نباشد آن آزمون‌ها «اجرا نشد» می‌شوند (skipped، نه pass).
 * آزمون ۹: وضعیت اشتراک پروفایل مدیر موقتاً «آزمایشی-منقضی» می‌شود (commit می‌شود تا اکشن‌های
 *   واقعی ببینند) و در finally حتماً به مقدار اصلی برمی‌گردد؛ مقدار قبلی در پاک‌سازی هم بررسی می‌شود.
 */
export const dynamic = "force-dynamic";

const POOL_MAX = 5; // + یک اتصال برنامه = سقف ۶ اتصال هم‌زمان در Workers
const EMAIL_PATTERN = "selftest-%@invalid.test";
const NOTE = "SELFTEST";
const LOCK_ID = 7270001;

type Row = { name: string; pass: boolean; detail: string; skipped?: boolean; warning?: boolean; ms?: number };
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(request: NextRequest) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin();
  } catch {
    return new NextResponse(null, { status: 404 });
  }
  if (request.nextUrl.searchParams.get("confirm") !== "yes") {
    return NextResponse.json(
      { ok: false, error: "تأیید صریح لازم است", usage: "?confirm=yes" },
      { status: 400 }
    );
  }
  const appUrl = process.env.DATABASE_URL;
  // اتصال‌های خودِ آزمون (قفل، پاک‌سازی، شمارش مستقیم) ممتاز هستند؛ کوئری‌های برنامه با DATABASE_URL می‌روند
  const url = process.env.MIGRATE_DATABASE_URL || appUrl;
  if (!appUrl || !url) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL تنظیم نشده است" }, { status: 500 });
  }
  try {
    await ensureDb();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "آماده‌سازی دیتابیس ناموفق بود", detail: errMsg(e) },
      { status: 500 }
    );
  }

  // قفل: فقط یک اجرای هم‌زمان مجاز است (جلوگیری از پاک شدن داده‌ی یک اجرا توسط اجرای دیگر)
  const lockClient = new Client({ connectionString: url, connectionTimeoutMillis: 20_000 });
  let locked = false;
  try {
    await lockClient.connect();
    const g = await lockClient.query("SELECT pg_try_advisory_lock($1) AS got", [LOCK_ID]);
    locked = g.rows[0]?.got === true;
  } catch (e) {
    await lockClient.end().catch(() => undefined);
    return NextResponse.json({ ok: false, error: "اتصال قفل ناموفق بود", detail: errMsg(e) }, { status: 500 });
  }
  if (!locked) {
    await lockClient.end().catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: "آزمون دیگری همین حالا در حال اجراست. چند دقیقه صبر کنید و فقط یک بار لینک را باز کنید." },
      { status: 409 }
    );
  }

  const A = admin.tenantId;
  const stamp = crypto.randomUUID().slice(0, 8);
  const visitorName = `SELFTEST-${stamp}`;
  const origin = new URL(request.url).origin;
  // ?stage=old فقط ۱ تا ۱۴؛ ?stage=new فقط ۱۵ تا ۲۱؛ ?stage=app تشخیص خطاهای نقش app_runtime (۲۲ تا ۲۵)؛ ?stage=sec آزمون‌های امنیتی قفل IP/ارتقای نقش/سابقه‌ی مدیر (۲۶ تا ۴۰)؛ ?stage=search آزمون جستجوی قیمت کالا (۴۱ تا ۵۰)؛ ?stage=basket آزمون لیست خرید (۵۱ تا ۵۹)؛ ?stage=share آزمون ورود لیست از اشتراک‌گذاری (۶۰ تا ۶۸)؛ ?stage=history آزمون «دفعه‌ی قبل» و یادداشت ویزیتور (۶۹ تا ۷۶)؛ پیش‌فرض: ۱ تا ۲۱
  const stageParam = new URL(request.url).searchParams.get("stage");
  const stage = stageParam === "old" || stageParam === "new" || stageParam === "app" || stageParam === "sec" || stageParam === "search" || stageParam === "basket" || stageParam === "share" || stageParam === "history" ? stageParam : "all";
  const t0All = Date.now();

  const pool = new Pool({
    connectionString: url,
    max: POOL_MAX,
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 1_000,
    query_timeout: 20_000,
    statement_timeout: 20_000,
  });
  pool.on("error", () => undefined);

  const results: Row[] = [];
  const S: { rlKeys?: string[]; auditTargets?: string[]; vA?: string; o1?: string; o2?: string; o3?: string; n1?: number; n2?: number; repeat?: string; userB?: string; emailB?: string; vB?: string } = {};
  let counterBefore: number | null | undefined; // undefined = هنوز خوانده نشده
  let setupError: string | null = null;
  let adminProfileWarning: string | null = null;
  // وضعیت اشتراک اصلیِ پروفایل مدیر (برای آزمون ۹؛ همیشه برگردانده می‌شود)
  type ProfSnap = { status: string; trial_ends_at: Date | null; subscription_ends_at: Date | null };
  // (شیء نگه‌دارنده تا TypeScript مقدار را «همیشه null» فرض نکند)
  const P: { orig: ProfSnap | null; restored: boolean } = { orig: null, restored: true };

  async function withTx<T>(role: "owner" | "admin", tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.role', $2, true)", [tenantId, role]);
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  /** همان مراحل createOrderAction روی tenant داده‌شده (برای آزمون همزمانی) */
  async function simulateCreateOrder(tenantId: string, visitorId: string, clientKey: string | null) {
    return withTx("owner", tenantId, async (c) => {
      await c.query("INSERT INTO order_counters (tenant_id, last_no) VALUES ($1, 0) ON CONFLICT (tenant_id) DO NOTHING", [tenantId]);
      await c.query("SELECT last_no FROM order_counters WHERE tenant_id = $1 FOR UPDATE", [tenantId]);
      await c.query("SELECT pg_sleep(0.05)"); // نگه داشتن قفل تا هم‌پوشانی واقعی ایجاد شود
      if (clientKey) {
        const ex = await c.query("SELECT id FROM orders WHERE tenant_id = $1 AND client_key = $2 LIMIT 1", [tenantId, clientKey]);
        if (ex.rows[0]) return { id: String(ex.rows[0].id), orderNo: null as number | null, duplicate: true };
      }
      const bumped = await c.query("UPDATE order_counters SET last_no = last_no + 1 WHERE tenant_id = $1 RETURNING last_no", [tenantId]);
      const orderNo = Number(bumped.rows[0].last_no);
      const o = await c.query(
        `INSERT INTO orders (tenant_id, order_no, client_key, visitor_id, status, note, settlement_type, settlement_days)
         VALUES ($1, $2, $3, $4, 'registered', 'SELFTEST', 'cash', 0) RETURNING id`,
        [tenantId, orderNo, clientKey, visitorId]
      );
      const id = String(o.rows[0].id);
      await c.query(
        "INSERT INTO order_items (tenant_id, order_id, product_name, qty, unit_price, discount_pct) VALUES ($1, $2, 'کالای SELFTEST', 1, 1000, 0)",
        [tenantId, id]
      );
      return { id, orderNo, duplicate: false };
    });
  }

  const items = [{ productName: "کالای SELFTEST", qty: 1, unitPrice: 1000, discountPct: 0 }];
  const newKey = (tag: string) => `selftest-${tag}-${crypto.randomUUID()}`;
  const getJson = async (res: Response): Promise<Json> => (await res.json()) as Json;
  const listA = async () => getJson(await ordersGET());
  const dashA = async () => getJson(await dashboardGET());
  const backupA = async () => getJson(await backupGET());
  const has = (arr: Json[] | undefined, id: string, key = "id") => (arr ?? []).some((x) => x[key] === id);

  async function test(name: string, fn: () => Promise<{ pass: boolean; detail: string; warning?: boolean }>) {
    const t0 = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // هر آزمون حداکثر ۳۰ ثانیه؛ اگر گیر کرد همان آزمون «شکست» می‌شود و بقیه ادامه می‌دهند
      const r = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("بیش از ۳۰ ثانیه طول کشید (گیر کرده)")), 30_000);
        }),
      ]);
      results.push({ name, pass: r.pass, detail: r.detail, ms: Date.now() - t0, ...(r.warning ? { warning: true } : {}) });
    } catch (e) {
      results.push({ name, pass: false, detail: `خطا: ${errMsg(e)}`, ms: Date.now() - t0 });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const dbOne = async (sql: string, p: unknown[]) =>
    withTx("admin", A, async (c) => (await c.query(sql, p)).rows[0] as Json);

  async function restoreProfile() {
    if (!P.orig || P.restored) return;
    const o = P.orig;
    await withTx("admin", A, (c) =>
      c.query("UPDATE profiles SET status = $2, trial_ends_at = $3, subscription_ends_at = $4 WHERE id = $1", [
        A,
        o.status,
        o.trial_ends_at,
        o.subscription_ends_at,
      ])
    );
    P.restored = true;
  }

  try {
    // ---------- آماده‌سازی ----------
    await pool.query("DELETE FROM users WHERE email LIKE $1", [EMAIL_PATTERN]); // بقایای اجرای نیمه‌کاره‌ی قبلی
    // شمارنده‌های قفل IP خودِ اجراکننده پاک می‌شود تا ثبت‌نام آزمایشیِ آزمون ۱۱ (که از IP واقعی می‌رود) قفل نشود
    S.rlKeys = [];
    S.auditTargets = [];
    try {
      const myIp = normalizeIp(request.headers.get("cf-connecting-ip") ?? "");
      if (myIp && (await pool.query("SELECT to_regclass('public.rate_limits') AS t")).rows[0]?.t) {
        const mine = [await rateLimitKey("login-fail", myIp), await rateLimitKey("register", myIp)];
        await pool.query("DELETE FROM rate_limits WHERE key = ANY($1::text[])", [mine]);
        S.rlKeys.push(...mine);
      }
    } catch {
      /* آزمون‌های قدیمی نباید به این وابسته باشند */
    }
    await withTx("admin", A, async (c) => {
      await c.query("DELETE FROM orders WHERE tenant_id = $1 AND note = $2", [A, NOTE]);
      await c.query("DELETE FROM visitors WHERE tenant_id = $1 AND name LIKE 'SELFTEST-%'", [A]);
    });
    // فقط خواندن: اگر وضعیت مدیر واقعی trial است ولی اشتراکش در آینده است، فقط هشدار (چیزی تغییر نمی‌کند)
    const ap = await pool.query("SELECT status, subscription_ends_at FROM profiles WHERE id = $1", [A]);
    const apRow = ap.rows[0] as Json | undefined;
    if (apRow && apRow.status === "trial" && apRow.subscription_ends_at && new Date(apRow.subscription_ends_at).getTime() > Date.now()) {
      adminProfileWarning = "هشدار: وضعیت پروفایل مدیر واقعی «trial» است ولی subscription_ends_at در آینده است (احتمالاً بقایای یک اجرای قطع‌شده‌ی قدیمی). آزمون چیزی را تغییر نداد.";
    }
    const cb = await pool.query("SELECT last_no FROM order_counters WHERE tenant_id = $1", [A]);
    counterBefore = cb.rows[0] ? Number(cb.rows[0].last_no) : null;

    // داروخانه‌ی آزمایشی B
    S.emailB = `selftest-${crypto.randomUUID()}@invalid.test`;
    const u = await pool.query(
      "INSERT INTO users (email, password_hash, role, disabled) VALUES ($1, '!selftest', 'owner', false) RETURNING id",
      [S.emailB]
    );
    S.userB = String(u.rows[0].id);
    const colRows = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles'"
    );
    const have = new Set(colRows.rows.map((r) => String(r.column_name)));
    const cols = ["id", "owner_user_id", "name", "status", "subscription_ends_at"];
    const vals = ["$1", "$1", "$2", "'active'", "now() + interval '1 day'"];
    const params: unknown[] = [S.userB, "SELFTEST داروخانه‌ی آزمایشی (موقت)"];
    if (have.has("email")) { cols.push("email"); vals.push(`$${params.length + 1}`); params.push(S.emailB); }
    if (have.has("password_hash")) { cols.push("password_hash"); vals.push(`$${params.length + 1}`); params.push("!selftest"); }
    if (have.has("role")) { cols.push("role"); vals.push("'owner'"); }
    await withTx("admin", S.userB, (c) => c.query(`INSERT INTO profiles (${cols.join(", ")}) VALUES (${vals.join(", ")})`, params));
    S.vB = await withTx("owner", S.userB, async (c) => {
      const v = await c.query("INSERT INTO visitors (tenant_id, name) VALUES ($1, $2) RETURNING id", [S.userB, `SELFTEST-B-${stamp}`]);
      return String(v.rows[0].id);
    });

    // ویزیتور آزمایشی در tenant مدیر (با اکشن واقعی) و دو سفارش
    const va = await addVisitorAction({ name: visitorName });
    if (!va.ok || !va.id) throw new Error(`ساخت ویزیتور آزمایشی ناموفق: ${va.error ?? "؟"}`);
    S.vA = va.id;
    const k1 = newKey("real1");
    const r1 = await createOrderAction({ clientKey: k1, visitorId: S.vA, note: NOTE, items });
    const r1b = await createOrderAction({ clientKey: k1, visitorId: S.vA, note: NOTE, items });
    S.o1 = r1.id;
    S.repeat = r1.ok && r1b.ok && r1.id === r1b.id ? "same" : `ok1=${r1.ok} ok2=${r1b.ok} ids=${r1.id}/${r1b.id}`;
    const r2 = await createOrderAction({ clientKey: newKey("real2"), visitorId: S.vA, note: NOTE, items });
    S.o2 = r2.id;
  } catch (e) {
    setupError = errMsg(e);
  }

  try {
    if (!setupError) {
      const tenantB = S.userB as string;
      const vB = S.vB as string;

      if (stage === "all" || stage === "old") {
      // ---------- ۱) ده ثبت همزمان ----------
      await test("۱) ده ثبت سفارش همزمان", async () => {
        const runId = crypto.randomUUID();
        const settled = await Promise.allSettled(
          Array.from({ length: 10 }, (_, i) => simulateCreateOrder(tenantB, vB, `selftest-${i}-${runId}`))
        );
        const failed = settled.filter((s) => s.status === "rejected").map((s) => errMsg((s as PromiseRejectedResult).reason));
        const nos = settled
          .filter((s): s is PromiseFulfilledResult<{ id: string; orderNo: number | null; duplicate: boolean }> => s.status === "fulfilled")
          .map((s) => s.value.orderNo)
          .filter((n): n is number => typeof n === "number")
          .sort((a, b) => a - b);
        const db = await withTx("owner", tenantB, async (c) => {
          const r = await c.query(
            "SELECT count(*)::int AS total, count(DISTINCT order_no)::int AS d, coalesce(min(order_no),0)::int AS mn, coalesce(max(order_no),0)::int AS mx FROM orders WHERE tenant_id = $1",
            [tenantB]
          );
          const k = await c.query("SELECT last_no FROM order_counters WHERE tenant_id = $1", [tenantB]);
          return { ...(r.rows[0] as Json), last: Number(k.rows[0]?.last_no ?? -1) } as Json;
        });
        const consecutive = nos.length === 10 && nos.every((n, i) => n === i + 1);
        const pass = failed.length === 0 && consecutive && db.total === 10 && db.d === 10 && db.mn === 1 && db.mx === 10 && db.last === 10;
        return { pass, detail: pass ? `شماره‌ها ${nos.join("،")} پشت‌سرهم و بدون تکرار (حداکثر ${POOL_MAX} اتصال هم‌زمان)` : `ناموفق: شماره‌ها=[${nos.join(",")}] خطاها=[${failed.join("|")}] db=${JSON.stringify(db)}` };
      });

      // ---------- ۲) یک clientKey پنج بار همزمان ----------
      await test("۲) یک clientKey پنج بار همزمان", async () => {
        const key = newKey("dup");
        const settled = await Promise.allSettled(Array.from({ length: 5 }, () => simulateCreateOrder(tenantB, vB, key)));
        const failed = settled.filter((s) => s.status === "rejected").map((s) => errMsg((s as PromiseRejectedResult).reason));
        const ok = settled
          .filter((s): s is PromiseFulfilledResult<{ id: string; orderNo: number | null; duplicate: boolean }> => s.status === "fulfilled")
          .map((s) => s.value);
        const ids = Array.from(new Set(ok.map((x) => x.id)));
        const created = ok.filter((x) => !x.duplicate).length;
        const db = await withTx("owner", tenantB, async (c) => {
          const byKey = await c.query("SELECT count(*)::int AS n FROM orders WHERE tenant_id = $1 AND client_key = $2", [tenantB, key]);
          const all = await c.query("SELECT count(*)::int AS n FROM orders WHERE tenant_id = $1", [tenantB]);
          const k = await c.query("SELECT last_no FROM order_counters WHERE tenant_id = $1", [tenantB]);
          return { withKey: byKey.rows[0].n as number, total: all.rows[0].n as number, last: Number(k.rows[0]?.last_no ?? -1) };
        });
        const concurrentOk = failed.length === 0 && created === 1 && ids.length === 1 && db.withKey === 1 && db.total === 11 && db.last === 11;
        const realOk = S.repeat === "same";
        const pass = concurrentOk && realOk;
        return {
          pass,
          detail: pass
            ? "پنج درخواست همزمان → فقط یک سفارش و همان برگشت؛ ثبت مجدد با اکشن واقعی هم همان سفارش را برگرداند"
            : `ناموفق: همزمان=${concurrentOk ? "ok" : JSON.stringify({ created, ids: ids.length, failed, db })} اکشن‌واقعی=${realOk ? "ok" : S.repeat}`,
        };
      });

      // ---------- ۳) شماره‌ی سفارش در فهرست و جزئیات ----------
      await test("۳) شماره‌ی سفارش در فهرست و جزئیات", async () => {
        const list = await listA();
        const a = (list.orders as Json[] | undefined)?.find((o) => o.id === S.o1);
        const b = (list.orders as Json[] | undefined)?.find((o) => o.id === S.o2);
        if (!a || !b) return { pass: false, detail: `سفارش‌های آزمایشی در فهرست نیامدند (o1=${!!a}, o2=${!!b})` };
        S.n1 = a.orderNo;
        S.n2 = b.orderNo;
        const items1 = (list.items as Json[]).filter((i) => i.orderId === S.o1).length;
        const pass = Number.isInteger(a.orderNo) && a.orderNo >= 1 && b.orderNo === a.orderNo + 1 && items1 === 1;
        return { pass, detail: pass ? `شماره‌ها ${a.orderNo} و ${b.orderNo}؛ جزئیات (اقلام) همراه فهرست برمی‌گردد` : `ناموفق: orderNo=${a.orderNo}/${b.orderNo} اقلام=${items1}` };
      });

      // ---------- ۴) حذف ----------
      await test("۴) حذف سفارش (فهرست، داشبورد، پشتیبان، سطل بازیافت)", async () => {
        const d0 = (await dashA()).counts?.openOrders as number;
        const del = await deleteOrderAction(S.o1 as string);
        if (!del.ok) return { pass: false, detail: `حذف ناموفق: ${del.error}` };
        const list = await listA();
        const dash = await dashA();
        const backup = await backupA();
        const row = await dbOne("SELECT (deleted_at IS NOT NULL) AS soft FROM orders WHERE id = $1", [S.o1]);
        const c = {
          outOfList: !has(list.orders, S.o1 as string),
          inTrash: has(list.trash, S.o1 as string),
          dashCount: dash.counts?.openOrders === d0 - 1,
          dashRecent: !JSON.stringify(dash.recentOrders ?? []).includes(S.o1 as string),
          backupOrders: !has(backup.orders, S.o1 as string),
          backupItems: !has(backup.orderItems, S.o1 as string, "orderId"),
          rowKept: row?.soft === true,
        };
        const pass = Object.values(c).every(Boolean);
        return { pass, detail: pass ? "از فهرست، داشبورد و پشتیبان بیرون رفت، در سطل بازیافت است و ردیف فیزیکی پاک نشده" : `ناموفق: ${JSON.stringify(c)}` };
      });

      // ---------- ۵) بازگردانی ----------
      await test("۵) بازگردانی از سطل بازیافت", async () => {
        const d0 = (await dashA()).counts?.openOrders as number;
        const res = await restoreOrderAction(S.o1 as string);
        if (!res.ok) return { pass: false, detail: `بازگردانی ناموفق: ${res.error}` };
        const list = await listA();
        const dash = await dashA();
        const backup = await backupA();
        const c = {
          inList: has(list.orders, S.o1 as string),
          notInTrash: !has(list.trash, S.o1 as string),
          dashCount: dash.counts?.openOrders === d0 + 1,
          inBackup: has(backup.orders, S.o1 as string),
        };
        const pass = Object.values(c).every(Boolean);
        return { pass, detail: pass ? "دوباره در فهرست، داشبورد و پشتیبان آمد" : `ناموفق: ${JSON.stringify(c)}` };
      });

      // ---------- ۶) حذف نهایی ----------
      await test("۶) حذف نهایی و عدم استفاده‌ی مجدد از شماره", async () => {
        const refuse = await purgeOrderAction(S.o2 as string); // سفارش فعال → باید رد شود
        await deleteOrderAction(S.o2 as string);
        const purge = await purgeOrderAction(S.o2 as string);
        const gone = await dbOne(
          "SELECT (SELECT count(*)::int FROM orders WHERE id = $1) AS o, (SELECT count(*)::int FROM order_items WHERE order_id = $1) AS i",
          [S.o2]
        );
        const list = await listA();
        const r3 = await createOrderAction({ clientKey: newKey("real3"), visitorId: S.vA as string, note: NOTE, items });
        S.o3 = r3.id;
        const list2 = await listA();
        const n3 = (list2.orders as Json[] | undefined)?.find((o) => o.id === S.o3)?.orderNo as number | undefined;
        const c = {
          activePurgeRefused: refuse.ok === false,
          purged: purge.ok === true && gone.o === 0 && gone.i === 0,
          notListed: !has(list.orders, S.o2 as string) && !has(list.trash, S.o2 as string),
          numberNotReused: typeof n3 === "number" && typeof S.n2 === "number" && n3 === S.n2 + 1,
        };
        const pass = Object.values(c).every(Boolean);
        return { pass, detail: pass ? `سفارش ${S.n2} برای همیشه پاک شد؛ سفارش بعدی شماره‌ی ${n3} گرفت (نه ${S.n2})` : `ناموفق: ${JSON.stringify(c)} شماره‌ی جدید=${n3}` };
      });

      // ---------- ۷) حذف ویزیتور دارای سفارش ----------
      await test("۷) حذف ویزیتور دارای سفارش (حتی داخل سطل)", async () => {
        const a = await deleteVisitorAction(S.vA as string); // سفارش فعال دارد
        await deleteOrderAction(S.o1 as string);
        await deleteOrderAction(S.o3 as string); // اکنون همه‌ی سفارش‌هایش در سطل بازیافت‌اند
        const b = await deleteVisitorAction(S.vA as string);
        const still = await dbOne("SELECT count(*)::int AS n FROM visitors WHERE id = $1", [S.vA]);
        const persian = (m?: string) => !!m && /[\u0600-\u06FF]/.test(m) && m.includes("سفارش");
        const c = {
          rejectedWithActive: a.ok === false && persian(a.error),
          rejectedWithTrashOnly: b.ok === false && persian(b.error),
          visitorStillExists: still?.n === 1,
        };
        const pass = Object.values(c).every(Boolean);
        return { pass, detail: pass ? `رد شد با پیام: «${(b.error ?? "").slice(0, 60)}…»` : `ناموفق: ${JSON.stringify(c)} پیام‌ها=[${a.error}|${b.error}]` };
      });

      // ---------- ۸) ایزوله‌ی tenant ----------
      await test("۸) ایزوله‌ی tenant", async () => {
        const env = (getCloudflareContext() as unknown as { env?: { WORKER_SELF_REFERENCE?: { fetch(r: Request): Promise<Response> } } }).env;
        const selfRef = env?.WORKER_SELF_REFERENCE;
        if (!selfRef) return { pass: false, detail: "WORKER_SELF_REFERENCE در این محیط نیست؛ آزمون ایزوله‌سازی اجرا نشد" };
        const token = await signSession({ sub: tenantB, tid: tenantB, role: "owner", email: S.emailB as string });
        const res = await selfRef.fetch(new Request(`${origin}/api/orders`, { headers: { cookie: `${AUTH_COOKIE}=${token}` } }));
        const listB = (await res.json()) as Json;
        const listAjson = await listA();
        const idsA = new Set<string>([...(listAjson.orders ?? []), ...(listAjson.trash ?? [])].map((o: Json) => o.id));
        const idsB = new Set<string>([...(listB.orders ?? []), ...(listB.trash ?? [])].map((o: Json) => o.id));
        const dbB = await dbOne("SELECT count(*)::int AS n FROM orders WHERE tenant_id = $1", [tenantB]);
        const overlap = [...idsA].filter((x) => idsB.has(x)).length;
        const c = {
          status200: res.status === 200,
          bSeesOnlyOwn: idsB.size === dbB?.n && idsB.size > 0,
          noOverlap: overlap === 0,
          aSeesNoneOfB: !(listAjson.orders as Json[] | undefined)?.some((o) => o.visitorId === S.vB),
        };
        const pass = Object.values(c).every(Boolean);
        return { pass, detail: pass ? `داروخانه‌ی B فقط ${idsB.size} سفارش خودش را می‌بیند و هیچ سفارشی با A مشترک نیست` : `ناموفق: ${JSON.stringify(c)}` };
      });

      // ---------- ۹) مدیر از محدودیت اشتراک معاف است (با کاربر مدیر آزمایشی؛ به حساب واقعی مدیر دست نمی‌زند) ----------
      await test("۹) مدیر آزمایشی با اشتراک منقضی محدود نمی‌شود و بنر نمی‌بیند", async () => {
        const env9 = (getCloudflareContext() as unknown as { env?: { WORKER_SELF_REFERENCE?: { fetch(r: Request): Promise<Response> } } }).env;
        const selfRef9 = env9?.WORKER_SELF_REFERENCE;
        if (!selfRef9) return { pass: false, detail: "WORKER_SELF_REFERENCE در این محیط نیست؛ آزمون اجرا نشد" };

        // کاربر مدیر موقت (selftest-...@invalid.test؛ در پاک‌سازی همراه همه‌ی داده‌هایش حذف می‌شود)
        const emailT = `selftest-adm-${crypto.randomUUID()}@invalid.test`;
        const ut = await pool.query(
          "INSERT INTO users (email, password_hash, role, disabled) VALUES ($1, '!selftest', 'admin', false) RETURNING id",
          [emailT]
        );
        const idT = String(ut.rows[0].id);
        const colRows9 = await pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles'"
        );
        const have9 = new Set(colRows9.rows.map((r) => String(r.column_name)));
        const cols9 = ["id", "owner_user_id", "name", "status", "trial_ends_at"];
        const vals9 = ["$1", "$1", "$2", "'trial'", "now() - interval '30 days'"];
        const params9: unknown[] = [idT, "SELFTEST مدیر آزمایشی (موقت)"];
        if (have9.has("email")) { cols9.push("email"); vals9.push(`$${params9.length + 1}`); params9.push(emailT); }
        if (have9.has("password_hash")) { cols9.push("password_hash"); vals9.push(`$${params9.length + 1}`); params9.push("!selftest"); }
        if (have9.has("role")) { cols9.push("role"); vals9.push("'admin'"); }
        await withTx("admin", idT, (c) => c.query(`INSERT INTO profiles (${cols9.join(", ")}) VALUES (${vals9.join(", ")})`, params9));

        // نشست کاربر مدیر آزمایشی (مثل آزمون ۸): بنر/نقش در APIها
        const tokT = await signSession({ sub: idT, tid: idT, role: "admin", email: emailT });
        const getT = async (path: string) =>
          (await (await selfRef9.fetch(new Request(`${origin}${path}`, { headers: { cookie: `${AUTH_COOKIE}=${tokT}` } }))).json()) as Json;
        const dash = await getT("/api/dashboard");
        const lo = await getT("/api/orders");
        const lc = await getT("/api/cheques");
        const lv = await getT("/api/visitors");

        // ثبت سفارش با اکشن واقعی زیر نشست مدیر آزمایشی؛ بعد نشست مدیر واقعی برگردانده می‌شود
        const adminTok9 = request.cookies.get(AUTH_COOKIE)?.value;
        const adminTid9 = request.cookies.get("pharma_tid")?.value;
        const store9 = await cookies();
        const opts9 = { sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };
        let write: { ok: boolean; error?: string } = { ok: false, error: "اجرا نشد" };
        try {
          store9.set(AUTH_COOKIE, tokT, { ...opts9, httpOnly: true });
          store9.set("pharma_tid", idT, { ...opts9, httpOnly: false });
          const vT = await addVisitorAction({ name: `SELFTEST-adm-${stamp}` });
          write = vT.ok && vT.id
            ? await createOrderAction({ clientKey: newKey("admin-expired"), visitorId: vT.id, note: NOTE, items })
            : { ok: false, error: `ساخت ویزیتور: ${vT.error ?? "؟"}` };
        } finally {
          if (adminTok9) store9.set(AUTH_COOKIE, adminTok9, { ...opts9, httpOnly: true });
          if (adminTid9) store9.set("pharma_tid", adminTid9, { ...opts9, httpOnly: false });
        }

        const c = {
          profileReallyExpired: effectiveStatus(dash.profile) === "expired", // شرط آزمون: پروفایل آزمایشی واقعاً منقضی است
          roleIsAdmin: dash.role === "admin",
          roleInAllBannerApis: [dash.role, lo.role, lc.role, lv.role].every((x) => x === "admin"),
          bannerHiddenForAdmin: effectiveStatus(dash.profile, dash.role) === "active",
          ownerStillRestricted: effectiveStatus(dash.profile, "owner") === "expired",
          writeAllowed: write.ok === true,
          realAdminSessionKept: !adminTok9 || (await cookies()).get(AUTH_COOKIE)?.value === adminTok9,
        };
        const pass = Object.values(c).every(Boolean);
        return {
          pass,
          detail: pass
            ? "مدیر آزمایشی با پروفایل منقضی: ثبت سفارش مجاز ماند و بنر برای او «فعال» است (برای غیرمدیر همچنان منقضی)؛ پروفایل مدیر واقعی دست نخورد"
            : `ناموفق: ${JSON.stringify(c)}${write.ok ? "" : ` خطای ثبت=${write.error}`}`,
        };
      });

      // ---------- ۱۰) اسکیمای واقعی دیتابیس با schema.ts ----------
      await test("۱۰) اسکیمای واقعی با schema.ts هماهنگ است", async () => {
        const d = await diffSchema(pool);
        const pass =
          d.missingTables.length === 0 &&
          d.missingColumns.length === 0 &&
          d.nullabilityMismatch.length === 0 &&
          d.legacyRequired.length === 0;
        const fmt = (a: { table: string; column: string }[]) => a.map((x) => `${x.table}.${x.column}`).join("، ");
        return {
          pass,
          detail: pass
            ? `${d.tablesChecked} جدول و ${d.columnsChecked} ستون هماهنگ‌اند${d.skippedViews.length ? ` (view: ${d.skippedViews.join("،")})` : ""}`
            : `ناموفق — ستون گم‌شده: [${fmt(d.missingColumns)}] | اجباریِ بدون پیش‌فرض که کد پر نمی‌کند: [${fmt(d.legacyRequired)}] | کد خالی‌پذیر ولی دیتابیس NOT NULL: [${fmt(d.nullabilityMismatch)}] | جدول گم‌شده: [${d.missingTables.join("،")}] — ابتدا /api/admin/migrate?confirm=yes را اجرا کنید`,
        };
      });

      // ---------- ۱۱) ثبت‌نام آزمایشی کاربر جدید با اکشن واقعی ----------
      await test("۱۱) ثبت‌نام آزمایشی کاربر جدید (اکشن واقعی)", async () => {
        const email = `selftest-reg-${crypto.randomUUID()}@invalid.test`;
        const adminTok = request.cookies.get(AUTH_COOKIE)?.value;
        const adminTid = request.cookies.get("pharma_tid")?.value;
        let res: Awaited<ReturnType<typeof registerAction>>;
        try {
          res = await registerAction({
            pharmacyName: `SELFTEST-reg-${stamp}`,
            phone: "09120000000",
            email,
            password: `Selftest-${crypto.randomUUID().slice(0, 12)}`,
          });
        } finally {
          // ثبت‌نام واقعی کوکی نشست کاربر جدید را می‌گذارد؛ نشست مدیر برگردانده می‌شود
          const store = await cookies();
          const opts = { sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };
          if (adminTok) store.set(AUTH_COOKIE, adminTok, { ...opts, httpOnly: true });
          if (adminTid) store.set("pharma_tid", adminTid, { ...opts, httpOnly: false });
        }
        const row = await dbOne(
          `SELECT (SELECT count(*)::int FROM users WHERE email = $1) AS u,
                  (SELECT count(*)::int FROM profiles p JOIN users x ON x.id = p.owner_user_id WHERE x.email = $1) AS p`,
          [email]
        );
        const c = {
          actionOk: res.ok === true,
          userCreated: row?.u === 1,
          profileCreated: row?.p === 1,
          adminSessionKept: !adminTok || (await cookies()).get(AUTH_COOKIE)?.value === adminTok,
        };
        const pass = Object.values(c).every(Boolean);
        return {
          pass,
          detail: pass
            ? "کاربر و داروخانه‌ی آزمایشی با اکشن واقعی ساخته شد (در پاک‌سازی حذف می‌شود) و نشست مدیر برگشت"
            : `ناموفق: ${JSON.stringify(c)}${res.ok ? "" : ` خطای ثبت‌نام=${res.error}`}`,
        };
      });

      // ---------- ۱۲) اجرای مهاجرت‌ها؛ اشتراک مدیر تغییر نکند ----------
      await test("۱۲) مهاجرت‌ها اجرا شدند و وضعیت/تاریخ اشتراک مدیر تغییر نکرد", async () => {
        const snap = () => dbOne("SELECT status, trial_ends_at, subscription_ends_at FROM profiles WHERE id = $1", [A]);
        const t = (d: Date | null | undefined) => (d ? new Date(d).getTime() : null);
        const before = await snap();
        const pendingBefore = await listPendingMigrations(pool);
        const report = await runMigrations({ force: true }); // همه‌ی مهاجرت‌ها (تکرارپذیرند) دوباره اجرا می‌شوند
        const after = await snap();
        const c = {
          nonePendingBefore: pendingBefore.length === 0,
          migrationsOk: report.ok === true,
          statusSame: before?.status === after?.status,
          trialEndSame: t(before?.trial_ends_at) === t(after?.trial_ends_at),
          subEndSame: t(before?.subscription_ends_at) === t(after?.subscription_ends_at),
        };
        const pass = Object.values(c).every(Boolean);
        return {
          pass,
          detail: pass
            ? `${report.applied.length} مهاجرت دوباره اجرا شد؛ اشتراک مدیر (${before?.status}) بدون تغییر ماند`
            : `ناموفق: ${JSON.stringify(c)} قبل=${before?.status} بعد=${after?.status} معوق=[${pendingBefore.join("،")}]${report.failed ? ` شکست=${report.failed.name}: ${report.failed.error}` : ""}${report.error ? ` خطا=${report.error}` : ""}`,
        };
      });

      // ---------- ۱۳) هدر no-cache روی /sw.js و /manifest.json (مسیر واقعی Workers) ----------
      const swFetch = async (path: string): Promise<Response> => {
        const env = (getCloudflareContext() as unknown as { env?: { WORKER_SELF_REFERENCE?: { fetch(r: Request): Promise<Response> } } }).env;
        const selfRef = env?.WORKER_SELF_REFERENCE;
        if (!selfRef) throw new Error("WORKER_SELF_REFERENCE در این محیط نیست");
        return selfRef.fetch(new Request(`${origin}${path}`, { headers: { "cache-control": "no-cache" } }));
      };
      const swState: { text: string | null } = { text: null };
      await test("۱۳) /sw.js و /manifest.json همیشه بدون کش (no-cache)", async () => {
        const check = async (path: string) => {
          const res = await swFetch(path);
          const cc = (res.headers.get("cache-control") || "").toLowerCase();
          if (path === "/sw.js" && res.ok) swState.text = await res.text();
          else await res.arrayBuffer().catch(() => undefined);
          return {
            path,
            status: res.status,
            cc,
            ok: res.status === 200 && cc.includes("no-cache") && cc.includes("max-age=0") && cc.includes("must-revalidate"),
          };
        };
        const rows = [await check("/sw.js"), await check("/manifest.json")];
        const pass = rows.every((r) => r.ok);
        return {
          pass,
          detail: pass
            ? "هر دو فایل با Cache-Control: no-cache, max-age=0, must-revalidate سرو می‌شوند"
            : `ناموفق: ${rows.map((r) => `${r.path} → ${r.status} «${r.cc || "بدون هدر"}»`).join(" | ")}`,
        };
      });

      // ---------- ۱۴) شناسه‌ی نسخه و منطق به‌روزرسانی در sw.js ----------
      await test("۱۴) شناسه‌ی نسخه‌ی build و منطق سرویس‌ورکر", async () => {
        const text = swState.text ?? "";
        const buildId = process.env.NEXT_PUBLIC_BUILD_ID || "";
        const c = {
          swFetched: text.length > 0,
          buildIdPresent: /^[a-z0-9]{6,40}$/.test(buildId),
          versionFromQuery: /searchParams\.get\(\s*["']v["']\s*\)/.test(text),
          noHardcodedVersion: !/const\s+VERSION\s*=\s*["']pharma-v\d+["']/.test(text),
          skipWaiting: text.includes("skipWaiting"),
          clientsClaim: text.includes("clients.claim"),
          networkFirst: text.includes("networkFirst") && !text.includes("staleWhileRevalidate"),
          tenantCache: text.includes("pharma_tid"),
        };
        const pass = Object.values(c).every(Boolean);
        return {
          pass,
          detail: pass
            ? `شناسه‌ی build=${buildId}؛ نسخه‌ی سرویس‌ورکر از ?v= خوانده می‌شود، network-first و skipWaiting/claim فعال است`
            : `ناموفق: ${JSON.stringify(c)} شناسه‌ی build=«${buildId}»`,
        };
      });

      }

      if (stage === "all" || stage === "new") {
      // ================= مرحله‌ی ۳ب: نقش app_runtime و RLS =================
      // ---------- ۱۵) نقش اتصال فعلی برنامه ----------
      await test("۱۵) اتصال برنامه (DATABASE_URL) ممتاز نیست (بدون SUPERUSER/BYPASSRLS)", async () => {
        const r = await appPool.query(
          "SELECT current_user AS u, r.rolsuper AS su, r.rolbypassrls AS br FROM pg_roles r WHERE r.rolname = current_user"
        );
        const row = r.rows[0] as Json | undefined;
        if (!row) return { pass: false, detail: "نقش اتصال فعلی در pg_roles پیدا نشد" };
        if (row.su || row.br) {
          return {
            pass: true,
            warning: true,
            detail: `هشدار: اتصال فعلی برنامه (${row.u}) ${row.su ? "SUPERUSER" : ""}${row.su && row.br ? " و " : ""}${row.br ? "BYPASSRLS" : ""} است، پس RLS برای برنامه اعمال نمی‌شود. بعد از ساخت نقش، DATABASE_URL را به app_runtime تغییر دهید`,
          };
        }
        return { pass: true, detail: `اتصال برنامه با نقش «${row.u}» است و ممتاز نیست؛ RLS واقعاً اعمال می‌شود` };
      });

      // ---------- اتصال جداگانه به نقش app_runtime (برای آزمون‌های ۱۶ تا ۲۰) ----------
      let rt: Client | null = null;
      let rtWhy = "";
      let rtUser = "";
      const rtPassEnv = process.env.APP_RUNTIME_PASSWORD;
      const scrub = (m: string) => (rtPassEnv ? m.split(rtPassEnv).join("***") : m);
      try {
        const appU = new URL(appUrl);
        let connStr: string | null = null;
        if (decodeURIComponent(appU.username).startsWith(APP_ROLE)) {
          connStr = appUrl; // برنامه همین حالا با app_runtime کار می‌کند
        } else if (rtPassEnv) {
          const base = new URL(url);
          const baseUser = decodeURIComponent(base.username);
          const dot = baseUser.indexOf(".");
          const u = new URL(base.toString());
          u.username = encodeURIComponent(APP_ROLE + (dot >= 0 ? baseUser.slice(dot) : ""));
          u.password = encodeURIComponent(rtPassEnv);
          connStr = u.toString();
        } else {
          rtWhy = "APP_RUNTIME_PASSWORD تنظیم نشده (و DATABASE_URL هنوز نقش app_runtime نیست)";
        }
        if (connStr) {
          rtUser = decodeURIComponent(new URL(connStr).username);
          // سه تلاش با فاصله‌ی ۱٫۵ ثانیه: Supavisor بعد از تغییر رمز نقش، گاهی در تلاش اول رد می‌کند
          let cl: Client | null = null;
          let lastErr: unknown;
          for (let i = 0; i < 3 && !cl; i++) {
            const c = new Client({ connectionString: connStr, connectionTimeoutMillis: 15_000, query_timeout: 15_000, statement_timeout: 15_000 });
            c.on("error", () => undefined);
            try {
              await c.connect();
              cl = c;
            } catch (e) {
              lastErr = e;
              await c.end().catch(() => undefined);
              if (i < 2) await new Promise((r) => setTimeout(r, 1500));
            }
          }
          if (!cl) throw lastErr;
          const who = await cl.query("SELECT current_user AS u");
          if (who.rows[0]?.u === APP_ROLE) {
            rt = cl;
          } else {
            await cl.end().catch(() => undefined);
            rtWhy = `اتصال با نقش «${who.rows[0]?.u}» برقرار شد نه ${APP_ROLE}`;
          }
        }
      } catch (e) {
        rtWhy = scrub(`اتصال به نقش ${APP_ROLE} ناموفق (کاربر اتصال: ${rtUser || "؟"}، ۳ تلاش): ${errMsg(e)}`);
      }
      try {
        const rtTest = async (name: string, fn: (c: Client) => Promise<{ pass: boolean; detail: string }>) => {
          if (!rt) {
            results.push({ name, pass: false, skipped: true, detail: `اجرا نشد: ${rtWhy}` });
            return;
          }
          const c = rt;
          await test(name, async () => {
            await c.query("BEGIN");
            try {
              return await fn(c);
            } finally {
              await c.query("ROLLBACK").catch(() => undefined); // هیچ‌چیز ماندگار نمی‌شود
            }
          });
        };
        const setCtx = (c: Client, tenant: string, role: string) =>
          c.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.role', $2, true)", [tenant, role]);
        const sqlState = async (p: Promise<unknown>) => {
          try {
            await p;
            return null;
          } catch (e) {
            return String((e as { code?: string }).code ?? "ERR");
          }
        };
        const tenantB = S.userB as string;

        // داده‌ی داروخانه‌ی B (وقتی آزمون‌های ۱ تا ۱۴ اجرا نشده‌اند B سفارشی ندارد): یک سفارش آزمایشی با note استاندارد
        // تا پاک‌سازی آن را حذف کند. فقط اگر B سفارش ندارد ساخته می‌شود.
        const bOrders = await dbOne("SELECT count(*)::int AS n FROM orders WHERE tenant_id = $1", [tenantB]);
        if (Number(bOrders.n) === 0) {
          await withTx("owner", tenantB, (c) =>
            c.query("INSERT INTO orders (tenant_id, visitor_id, note, order_no) VALUES ($1, $2, $3, 1)", [tenantB, S.vB, NOTE])
          );
        }

        // ---------- ۱۶) بدون tenant هیچ ردیفی دیده نمی‌شود ----------
        await rtTest("۱۶) نقش app_runtime بدون app.tenant_id صفر ردیف می‌بیند", async (c) => {
          const priv = await dbOne("SELECT (SELECT count(*)::int FROM orders) AS o, (SELECT count(*)::int FROM visitors) AS v", []);
          const cnt = async () =>
            (await c.query("SELECT (SELECT count(*)::int FROM orders) AS o, (SELECT count(*)::int FROM visitors) AS v")).rows[0] as Json;
          const unset = await cnt();
          await c.query("SELECT set_config('app.tenant_id', '', true)");
          const empty = await cnt();
          const k = {
            dataExists: priv.o > 0 && priv.v > 0,
            unsetZero: unset.o === 0 && unset.v === 0,
            emptyZero: empty.o === 0 && empty.v === 0,
          };
          const pass = Object.values(k).every(Boolean);
          return {
            pass,
            detail: pass
              ? `با وجود ${priv.o} سفارش و ${priv.v} ویزیتور در دیتابیس، بدون tenant (تنظیم‌نشده یا خالی) صفر ردیف دیده شد`
              : `ناموفق: ${JSON.stringify(k)} دیده‌شده(تنظیم‌نشده)=${JSON.stringify(unset)} دیده‌شده(خالی)=${JSON.stringify(empty)}`,
          };
        });

        // ---------- ۱۷) با tenant A فقط ردیف‌های A ----------
        await rtTest("۱۷) SELECT * FROM orders بدون WHERE فقط ردیف‌های A را برمی‌گرداند", async (c) => {
          await setCtx(c, A, "owner");
          const r = await c.query("SELECT tenant_id FROM orders");
          const seen = new Set(r.rows.map((x) => String(x.tenant_id)));
          const priv = await dbOne("SELECT count(*)::int AS other FROM orders WHERE tenant_id <> $1", [A]);
          const k = { hasRows: r.rows.length > 0, onlyA: seen.size === 1 && seen.has(A), otherTenantsExist: priv.other > 0 };
          const pass = Object.values(k).every(Boolean);
          return {
            pass,
            detail: pass
              ? `${r.rows.length} ردیف برگشت و همه مال A بود (در دیتابیس ${priv.other} سفارش داروخانه‌ی دیگر هست که دیده نشد)`
              : `ناموفق: ${JSON.stringify(k)} tenantهای دیده‌شده=${seen.size}`,
          };
        });

        // ---------- ۱۸) INSERT با tenant داروخانه‌ی دیگر رد می‌شود ----------
        await rtTest("۱۸) INSERT با tenant_id داروخانه‌ی دیگر رد می‌شود", async (c) => {
          await setCtx(c, A, "owner");
          const own = await c.query("INSERT INTO visitors (tenant_id, name) VALUES ($1, $2)", [A, `SELFTEST-rls-own-${stamp}`]);
          const code = await sqlState(c.query("INSERT INTO visitors (tenant_id, name) VALUES ($1, $2)", [tenantB, `SELFTEST-rls-x-${stamp}`]));
          const k = { ownInsertOk: own.rowCount === 1, otherRejected: code === "42501" };
          const pass = Object.values(k).every(Boolean);
          return {
            pass,
            detail: pass ? "ثبت برای tenant خودش مجاز و برای داروخانه‌ی دیگر با خطای RLS (42501) رد شد" : `ناموفق: ${JSON.stringify(k)} کد خطا=${code}`,
          };
        });

        // ---------- ۱۹) UPDATE/DELETE روی ردیف داروخانه‌ی دیگر صفر ردیف ----------
        await rtTest("۱۹) UPDATE و DELETE روی ردیف داروخانه‌ی دیگر صفر ردیف را تغییر می‌دهد", async (c) => {
          const priv = await dbOne(
            "SELECT (SELECT count(*)::int FROM visitors WHERE tenant_id = $1) AS v, (SELECT count(*)::int FROM orders WHERE tenant_id = $1) AS o",
            [tenantB]
          );
          await setCtx(c, A, "owner");
          const u1 = await c.query("UPDATE visitors SET name = name WHERE tenant_id = $1", [tenantB]);
          const u2 = await c.query("UPDATE orders SET note = note WHERE tenant_id = $1", [tenantB]);
          const d1 = await c.query("DELETE FROM visitors WHERE tenant_id = $1", [tenantB]);
          const d2 = await c.query("DELETE FROM orders WHERE tenant_id = $1", [tenantB]);
          const k = {
            dataExists: priv.v > 0 && priv.o > 0,
            updatesZero: u1.rowCount === 0 && u2.rowCount === 0,
            deletesZero: d1.rowCount === 0 && d2.rowCount === 0,
          };
          const pass = Object.values(k).every(Boolean);
          return {
            pass,
            detail: pass
              ? `داروخانه‌ی B ${priv.v} ویزیتور و ${priv.o} سفارش دارد؛ UPDATE و DELETE از طرف A روی هیچ‌کدام اثر نکرد`
              : `ناموفق: ${JSON.stringify(k)} update=${u1.rowCount}/${u2.rowCount} delete=${d1.rowCount}/${d2.rowCount}`,
          };
        });

        // ---------- ۲۰) بدون DDL و بدون امتیاز ویژه ----------
        await rtTest("۲۰) نقش app_runtime اجازه‌ی CREATE TABLE و DROP TABLE ندارد", async (c) => {
          const at = (await c.query("SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user")).rows[0] as Json;
          await c.query("SAVEPOINT s_create");
          const createCode = await sqlState(c.query("CREATE TABLE public.selftest_rt_probe (id int)"));
          await c.query("ROLLBACK TO SAVEPOINT s_create");
          await c.query("SAVEPOINT s_drop");
          const dropCode = await sqlState(c.query("DROP TABLE public.quick_notes"));
          await c.query("ROLLBACK TO SAVEPOINT s_drop");
          const k = {
            noPrivilegedAttrs: !at.rolsuper && !at.rolbypassrls && !at.rolcreatedb && !at.rolcreaterole,
            createDenied: createCode === "42501",
            dropDenied: dropCode === "42501",
          };
          const pass = Object.values(k).every(Boolean);
          return {
            pass,
            detail: pass ? "بدون SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE؛ CREATE TABLE و DROP TABLE با 42501 رد شد" : `ناموفق: ${JSON.stringify(k)} create=${createCode} drop=${dropCode}`,
          };
        });
      } finally {
        if (rt) await (rt as Client).end().catch(() => undefined);
      }

      // ---------- ۲۱) RLS فعال و FORCE روی همه‌ی جدول‌های tenant و احراز هویت ----------
      await test("۲۱) همه‌ی جدول‌های tenant و احراز هویت دارای RLS فعال و FORCE هستند", async () => {
        const must = ["users", "profiles", "login_attempts", "base_products"];
        const r = await pool.query(
          `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS frc
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
              AND (c.relname = ANY($1)
                   OR EXISTS (SELECT 1 FROM information_schema.columns k
                               WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'tenant_id'))`,
          [must]
        );
        const present = new Set(r.rows.map((x) => String(x.relname)));
        const missing = must.filter((t) => !present.has(t));
        const bad = r.rows.filter((x) => !x.rls || !x.frc).map((x) => `${x.relname}(${x.rls ? "" : "بدون RLS"}${!x.rls && !x.frc ? "،" : ""}${x.frc ? "" : "بدون FORCE"})`);
        const pass = bad.length === 0 && missing.length === 0;
        return {
          pass,
          detail: pass
            ? `${r.rows.length} جدول (همه‌ی جدول‌های دارای tenant_id + users/profiles/login_attempts/base_products) RLS و FORCE دارند`
            : `ناموفق — ناقص: [${bad.join("، ")}] جدول گم‌شده: [${missing.join("، ")}] — ابتدا /api/admin/migrate?confirm=yes را اجرا کنید`,
        };
      });
      }

      // ================= تشخیص خطای نقش app_runtime (stage=app) =================
      if (stage === "app") {
        const errOf = (e: unknown) => {
          const x = e as { code?: string; message?: string; table?: string };
          return { code: String(x.code ?? "ERR"), message: String(x.message ?? e).slice(0, 160) };
        };

        // ---------- ۲۲) دسترسی‌ها، پیش‌فرض‌ها و تریگرها (با اتصال ممتاز) ----------
        await test("۲۲) GRANTهای نقش app_runtime، پیش‌فرض ستون‌ها و تریگرها", async () => {
          const expectPriv: Record<string, string[]> = {};
          for (const t of ["visitors", "visitor_notes", "products", "visitor_products", "visitor_product_history", "catalog_files", "quick_notes", "cheques", "push_subscriptions", "price_requests", "price_request_items", "price_responses", "orders", "order_items", "order_counters", "login_attempts"]) expectPriv[t] = ["SELECT", "INSERT", "UPDATE", "DELETE"];
          expectPriv.users = ["SELECT", "INSERT", "UPDATE"];
          expectPriv.profiles = ["SELECT", "INSERT", "UPDATE"];
          expectPriv.base_products = ["SELECT"];
          expectPriv.schema_migrations = ["SELECT"];
          const missing: string[] = [];
          for (const [t, privs] of Object.entries(expectPriv)) {
            for (const pr of privs) {
              const r = await pool.query("SELECT has_table_privilege($1, $2, $3) AS ok", [APP_ROLE, `public.${t}`, pr]);
              if (!r.rows[0]?.ok) missing.push(`${t}:${pr}`);
            }
          }
          const sch = await pool.query(
            "SELECT has_schema_privilege($1, 'public', 'USAGE') AS pub, (SELECT has_schema_privilege($1, 'extensions', 'USAGE') FROM pg_namespace WHERE nspname = 'extensions') AS ext",
            [APP_ROLE]
          );
          const defs = await pool.query(
            `SELECT c.relname AS t, a.attname AS col, pg_get_expr(d.adbin, d.adrelid) AS expr
               FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
              WHERE n.nspname = 'public' AND pg_get_expr(d.adbin, d.adrelid) ~ '(extensions\\.|uuid_generate|gen_random_bytes|crypt\\()'`
          );
          const trg = await pool.query(
            `SELECT c.relname AS t, g.tgname AS name FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND NOT g.tgisinternal`
          );
          const seq = await pool.query(
            `SELECT c.relname AS s, has_sequence_privilege($1, c.oid, 'USAGE') AS ok FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S'`,
            [APP_ROLE]
          );
          const seqBad = seq.rows.filter((r) => !r.ok).map((r) => String(r.s));
          const extNeeded = defs.rows.length > 0 && sch.rows[0]?.ext === false;
          const pass = missing.length === 0 && !!sch.rows[0]?.pub && seqBad.length === 0 && !extNeeded;
          return {
            pass,
            detail:
              `گم‌شده: [${missing.join("، ") || "هیچ"}] | USAGE روی public=${sch.rows[0]?.pub} روی extensions=${sch.rows[0]?.ext ?? "ندارد"} | ` +
              `sequenceهای بدون دسترسی: [${seqBad.join("، ") || "هیچ"}] | پیش‌فرض‌های وابسته به extensions: [${defs.rows.map((r) => `${r.t}.${r.col}`).join("، ") || "هیچ"}] | ` +
              `تریگرها: [${trg.rows.map((r) => `${r.t}.${r.name}`).join("، ") || "هیچ"}]`,
          };
        });

        // ---------- ۲۳) همان کوئری‌های برنامه (ورود، نشست، ثبت‌نام، بارگذاری) با اتصال جدا به app_runtime ----------
        const rtPassEnv2 = process.env.APP_RUNTIME_PASSWORD;
        let rt2: Client | null = null;
        let rt2Why = "";
        try {
          const appU = new URL(appUrl);
          let connStr: string | null = null;
          if (decodeURIComponent(appU.username).startsWith(APP_ROLE)) connStr = appUrl;
          else if (rtPassEnv2) {
            const base = new URL(url);
            const baseUser = decodeURIComponent(base.username);
            const dot = baseUser.indexOf(".");
            const u2 = new URL(base.toString());
            u2.username = encodeURIComponent(APP_ROLE + (dot >= 0 ? baseUser.slice(dot) : ""));
            u2.password = encodeURIComponent(rtPassEnv2);
            connStr = u2.toString();
          } else rt2Why = "APP_RUNTIME_PASSWORD تنظیم نشده";
          if (connStr) {
            let cl: Client | null = null;
            let lastErr: unknown;
            for (let i = 0; i < 3 && !cl; i++) {
              const c = new Client({ connectionString: connStr, connectionTimeoutMillis: 15_000, query_timeout: 15_000, statement_timeout: 15_000 });
              c.on("error", () => undefined);
              try { await c.connect(); cl = c; } catch (e) { lastErr = e; await c.end().catch(() => undefined); if (i < 2) await new Promise((r) => setTimeout(r, 1500)); }
            }
            if (!cl) throw lastErr;
            rt2 = cl;
          }
        } catch (e) {
          rt2Why = `اتصال app_runtime ناموفق: ${(rtPassEnv2 ? errMsg(e).split(rtPassEnv2).join("***") : errMsg(e))}`;
        }
        try {
          if (!rt2) {
            results.push({ name: "۲۳) کوئری‌های برنامه با نقش app_runtime (ورود، نشست، ثبت‌نام، بارگذاری)", pass: false, skipped: true, detail: `اجرا نشد: ${rt2Why}` });
          } else {
            const c = rt2;
            await test("۲۳) کوئری‌های برنامه با نقش app_runtime (ورود، نشست، ثبت‌نام، بارگذاری)", async () => {
              const emailRow = await dbOne("SELECT email FROM users WHERE id = $1", [S.userB]);
              const e1 = String(emailRow.email);
              const fails: string[] = [];
              let total = 0;
              const guc = (o: { tenant?: string; role?: string; user?: string; email?: string }) =>
                c.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.role', $2, true), set_config('app.user_id', $3, true), set_config('app.login_email', $4, true)", [o.tenant ?? "", o.role ?? "", o.user ?? "", o.email ?? ""]);
              const step = async (name: string, q: string, params: unknown[] = []) => {
                total++;
                await c.query("SAVEPOINT st");
                try {
                  await c.query(q, params);
                } catch (e) {
                  const er = errOf(e);
                  fails.push(`${name} → [${er.code}] ${er.message}`);
                } finally {
                  await c.query("ROLLBACK TO SAVEPOINT st").catch(() => undefined);
                }
              };
              await c.query("BEGIN");
              try {
                // بدون زمینه (health / middleware / ensureDb)
                await guc({});
                await step("health SELECT 1", "SELECT 1");
                await step("ensureDb: schema_migrations", "SELECT name FROM schema_migrations");
                // requireAuth: بررسی disabled
                total++;
                try {
                  const r = (await c.query(`SELECT set_config('app.user_id', '${S.userB}', true); SELECT disabled FROM users WHERE id = '${S.userB}'::uuid`)) as unknown as Array<{ rows: Json[] }>;
                  if (!r[1]?.rows?.length) fails.push("requireAuth: کاربر پیدا نشد (RLS روی users)");
                } catch (e) { const er = errOf(e); fails.push(`requireAuth(multi-statement) → [${er.code}] ${er.message}`); await c.query("ROLLBACK TO SAVEPOINT st").catch(() => undefined); }
                // ورود
                await guc({ email: e1 });
                await step("login: users بر اساس ایمیل", "SELECT * FROM users WHERE email = $1 LIMIT 1", [e1]);
                await step("login_attempts: SELECT", "SELECT * FROM login_attempts WHERE email = $1 LIMIT 1", [e1]);
                await step("login_attempts: INSERT", "INSERT INTO login_attempts (email, count, window_start) VALUES ($1, 1, now())", [e1]);
                await guc({ email: e1, user: S.userB as string });
                await step("login: profiles بر اساس owner_user_id", "SELECT * FROM profiles WHERE owner_user_id = $1 LIMIT 1", [S.userB]);
                // ثبت‌نام
                const nu = crypto.randomUUID();
                const ne = `selftest-rt-${crypto.randomUUID()}@invalid.test`;
                await guc({ email: ne, user: nu, tenant: nu });
                await step("register: بررسی ایمیل تکراری", "SELECT id FROM users WHERE email = $1 LIMIT 1", [ne]);
                await step("register: INSERT users", "INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, '!x', 'owner')", [nu, ne]);
                await step("register: INSERT users+profiles", "WITH u AS (INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, '!x', 'owner') RETURNING id) INSERT INTO profiles (id, owner_user_id, name, status, trial_ends_at) SELECT id, id, 'x', 'trial', now() + interval '7 days' FROM u", [nu, ne]);
                // بارگذاری صفحه‌ی اصلی / API با tenant و نقش owner
                await guc({ tenant: S.userB as string, role: "owner", user: S.userB as string });
                for (const t of ["visitors", "visitor_notes", "products", "visitor_products", "visitor_product_history", "catalog_files", "quick_notes", "cheques", "push_subscriptions", "price_requests", "price_request_items", "price_responses", "orders", "order_items", "order_counters"]) {
                  await step(`owner: SELECT ${t}`, `SELECT count(*) FROM ${t}`);
                }
                await step("owner: profiles (خودش)", "SELECT * FROM profiles WHERE id = $1", [S.userB]);
                await step("owner: base_products", "SELECT count(*) FROM base_products");
                await step("owner: users (خودش)", "SELECT id FROM users WHERE id = $1", [S.userB]);
                await step("owner: order_counters upsert", "INSERT INTO order_counters (tenant_id, last_no) VALUES ($1, 0) ON CONFLICT (tenant_id) DO NOTHING", [S.userB]);
                await step("owner: order_counters FOR UPDATE", "SELECT last_no FROM order_counters WHERE tenant_id = $1 FOR UPDATE", [S.userB]);
                await step("owner: INSERT visitors", "INSERT INTO visitors (tenant_id, name) VALUES ($1, 'SELFTEST-rt2')", [S.userB]);
                await step("owner: UPDATE profiles", "UPDATE profiles SET name = name WHERE id = $1", [S.userB]);
                // مدیر
                await guc({ tenant: A, role: "admin", user: A });
                await step("admin: فهرست profiles+users", "SELECT p.id, u.email, u.disabled FROM profiles p LEFT JOIN users u ON u.id = p.owner_user_id LIMIT 5");
                await step("admin: UPDATE users", "UPDATE users SET disabled = disabled WHERE id = $1", [S.userB]);
                await step("admin: UPDATE profiles", "UPDATE profiles SET name = name WHERE id = $1", [S.userB]);
                await step("admin: SELECT orders (همه)", "SELECT count(*) FROM orders");
              } finally {
                await c.query("ROLLBACK").catch(() => undefined);
              }
              const pass = fails.length === 0;
              return { pass, detail: pass ? `${total} کوئری برنامه با app_runtime بدون خطا اجرا شد` : `${fails.length} خطا از ${total} کوئری: ${fails.join(" ‖ ")}` };
            });
          }
        } finally {
          if (rt2) await (rt2 as Client).end().catch(() => undefined);
        }

        // ---------- ۲۴ و ۲۵) جاروی مسیرهای واقعی با اتصال خود برنامه (DATABASE_URL) ----------
        const env2 = (getCloudflareContext() as unknown as { env?: { WORKER_SELF_REFERENCE?: { fetch(r: Request): Promise<Response> } } }).env;
        const selfRef2 = env2?.WORKER_SELF_REFERENCE;
        const sweep = async (paths: string[], cookie: string, isPage: boolean) => {
          const bad: string[] = [];
          for (const path of paths) {
            try {
              const res = await selfRef2!.fetch(new Request(`${origin}${path}`, { headers: { cookie }, redirect: "manual" }));
              const body = res.status >= 400 ? (await res.text()).slice(0, 140).replace(/\s+/g, " ") : (await res.arrayBuffer(), "");
              const okStatus = isPage ? res.status < 400 : res.status >= 200 && res.status < 300;
              if (!okStatus) bad.push(`${path} → ${res.status} ${body}`);
            } catch (e) {
              bad.push(`${path} → ${errMsg(e)}`);
            }
          }
          return bad;
        };
        const tokB = await signSession({ sub: S.userB as string, tid: S.userB as string, role: "owner", email: S.emailB as string });
        const cookieB = `${AUTH_COOKIE}=${tokB}`;
        const apiPaths = ["/api/dashboard", "/api/orders", "/api/visitors", "/api/products", "/api/cheques", "/api/shortages", "/api/price-requests", "/api/quick-notes", "/api/history", "/api/base-products", "/api/search?q=a", "/api/backup"];
        await test("۲۴) مسیرهای API با نشست «صاحب داروخانه» (با اتصال فعلی برنامه)", async () => {
          if (!selfRef2) return { pass: false, detail: "اجرا نشد: WORKER_SELF_REFERENCE در این محیط نیست" };
          const bad = await sweep(apiPaths, cookieB, false);
          return { pass: bad.length === 0, detail: bad.length === 0 ? `${apiPaths.length} مسیر API همگی ۲xx` : `${bad.length} مسیر خطا: ${bad.join(" ‖ ")}` };
        });
        const pagePaths = ["/dashboard", "/orders", "/visitors", "/products", "/cheques", "/shortages", "/price-requests", "/quick-notes", "/history", "/settings", "/login", "/register"];
        await test("۲۵) صفحه‌ها با نشست «صاحب داروخانه» (بدون Internal Server Error)", async () => {
          if (!selfRef2) return { pass: false, detail: "اجرا نشد: WORKER_SELF_REFERENCE در این محیط نیست" };
          const bad = await sweep(pagePaths, cookieB, true);
          return { pass: bad.length === 0, detail: bad.length === 0 ? `${pagePaths.length} صفحه بدون خطای ۴xx/۵xx` : `${bad.length} صفحه خطا: ${bad.join(" ‖ ")}` };
        });
      }

      // ================= آزمون‌های امنیتی (stage=sec) =================
      if (stage === "sec") {
        const errCode = (e: unknown) => String((e as { code?: string }).code ?? "ERR");
        const r16 = () => Math.floor(Math.random() * 65536).toString(16);
        const testIp = () => `2001:db8:${r16()}:${r16()}::${r16()}`; // محدوده‌ی مستندسازی IPv6؛ فضای بزرگ = بدون برخورد با ردیف مانده؛ هرگز IP واقعی کاربر نیست
        const trackKey = async (b: IpBucket, ip: string) => {
          const k = await rateLimitKey(b, ip);
          S.rlKeys!.push(k);
          await pool.query("DELETE FROM rate_limits WHERE key = $1", [k]); // شروع از وضعیت پاک
        };
        const tenantB = S.userB as string;

        // ---------- ۲۶) قفل ورود بر اساس IP ----------
        await test("۲۶) ۱۱ ورود ناموفق پشت‌سرهم از یک IP قفل می‌شود (IP دیگر آزاد می‌ماند)", async () => {
          const ip = testIp();
          const other = `203.0.114.${Math.floor(Math.random() * 250) + 1}`;
          await trackKey("login-fail", ip);
          let lockedAtAttempt = 0;
          let tenthLocked = false;
          let msg = "";
          const trace: string[] = [];
          let loopErr = "";
          try {
            for (let i = 1; i <= 11; i++) {
              const c = await checkIpLock("login-fail", ip);
              if (c.locked) {
                lockedAtAttempt = i;
                msg = ipLockMessage(c.retryAfterMin ?? 0);
                trace.push(`${i}:L`);
                break;
              }
              const r = await recordIpAttempt("login-fail", ip);
              trace.push(`${i}:${r.locked ? "lock" : "ok"}`);
              if (i === IP_RULES["login-fail"].max) tenthLocked = r.locked;
            }
          } catch (e) {
            loopErr = e instanceof Error ? e.message.slice(0, 200) : String(e);
          }
          const otherFree = !(await checkIpLock("login-fail", other)).locked;
          const raw = await pool.query("SELECT count(*)::int AS n FROM rate_limits WHERE key = $1 OR key = $2", [ip, `login-fail:${ip}`]);
          const k = {
            locksAt11: lockedAtAttempt === 11,
            tenthFailureLocks: tenthLocked,
            messageHasMinutes: /\d+ دقیقه/.test(msg),
            otherIpFree: otherFree,
            rawIpNotStored: raw.rows[0].n === 0,
          };
          const pass = Object.values(k).every(Boolean) && !loopErr;
          let detail = `ده شکست قفل را فعال کرد و تلاش ۱۱ رد شد؛ «${msg}»؛ IP دیگر آزاد؛ IP خام ذخیره نمی‌شود (IP آزمایشی، نه IP واقعی)`;
          if (!pass) {
            const snap = await pool.query("SELECT count, locked_until, window_start FROM rate_limits WHERE key = $1", [await rateLimitKey("login-fail", ip)]);
            detail = `ناموفق: ${JSON.stringify(k)} trace=[${trace.join(",")}] error=${loopErr || "-"} row=${JSON.stringify(snap.rows[0] ?? null)}`;
            await recordError("selftest/26 rate-limit", new Error(detail));
          }
          return { pass, detail };
        });

        // ---------- ۲۷) باز شدن قفل بعد از زمان مقرر ----------
        await test("۲۷) قفل IP بعد از ۱۵ دقیقه باز می‌شود و شمارنده از نو شروع می‌شود", async () => {
          const ip = testIp();
          await trackKey("login-fail", ip);
          const t0 = Date.now();
          for (let i = 0; i < IP_RULES["login-fail"].max; i++) await recordIpAttempt("login-fail", ip, t0);
          const at14 = await checkIpLock("login-fail", ip, t0 + 14 * 60_000);
          const at16 = await checkIpLock("login-fail", ip, t0 + 16 * 60_000);
          const after = await recordIpAttempt("login-fail", ip, t0 + 16 * 60_000);
          const row = await pool.query("SELECT count FROM rate_limits WHERE key = $1", [await rateLimitKey("login-fail", ip)]);
          const k = { lockedAt14min: at14.locked, openAt16min: !at16.locked, newAttemptNotLocked: !after.locked, counterRestarted: row.rows[0]?.count === 1 };
          const pass = Object.values(k).every(Boolean);
          return { pass, detail: pass ? "بعد از ۱۴ دقیقه هنوز قفل بود؛ بعد از ۱۶ دقیقه باز شد و شمارنده دوباره از ۱ شروع شد (زمان شبیه‌سازی شد)" : `ناموفق: ${JSON.stringify(k)}` };
        });

        // ---------- ۲۸) قفل ثبت‌نام بر اساس IP ----------
        await test("۲۸) تلاش بیش از سقف ثبت‌نام از یک IP رد می‌شود", async () => {
          const ip = testIp();
          await trackKey("register", ip);
          const max = IP_RULES.register.max;
          let blockedAt = 0;
          for (let i = 1; i <= max + 1; i++) {
            const c = await checkIpLock("register", ip);
            if (c.locked) { blockedAt = i; break; }
            await recordIpAttempt("register", ip);
          }
          const pass = blockedAt === max + 1;
          return { pass, detail: pass ? `${max} تلاش ثبت‌نام مجاز بود و تلاش ${max + 1} رد شد` : `ناموفق: رد شدن در تلاش ${blockedAt || "هیچ"} (انتظار ${max + 1})` };
        });

        // ---------- ۲۹) ارتقای نقش/اشتراک از طریق اکشن‌ها ----------
        await test("۲۹) اکشن‌ها نمی‌گذارند صاحب داروخانه نقش یا اشتراک را تغییر دهد", async () => {
          const adminTok = request.cookies.get(AUTH_COOKIE)?.value;
          const adminTid = request.cookies.get("pharma_tid")?.value;
          const store = await cookies();
          const opts = { sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };
          const before = await dbOne("SELECT p.status, p.subscription_ends_at, p.trial_ends_at, u.role, u.disabled FROM profiles p JOIN users u ON u.id = p.owner_user_id WHERE p.id = $1", [tenantB]);
          const tokB = await signSession({ sub: tenantB, tid: tenantB, role: "owner", email: S.emailB as string });
          const res: Record<string, string> = {};
          try {
            store.set(AUTH_COOKIE, tokB, { ...opts, httpOnly: true });
            store.set("pharma_tid", tenantB, { ...opts, httpOnly: false });
            // الف) اکشن واقعی پروفایل با فیلدهای اضافی دستکاری‌شده
            const r1 = await updateProfileAction({ name: "SELFTEST تغییر نام", phone: "0", role: "admin", status: "expired", subscriptionEndsAt: "2099-01-01", trialEndsAt: "2099-01-01" } as never);
            res.profileUpdate = r1.ok ? "ok" : `ok=false`;
            // ب) اکشن‌های مخصوص مدیر با نشست صاحب داروخانه
            try {
              const r2 = await adminSetSubscriptionAction({ profileId: tenantB, status: "active", endDate: "2099-12-31" });
              res.adminSub = r2.ok ? "اجرا شد!" : "رد شد";
            } catch { res.adminSub = "رد شد"; }
            try {
              const r3 = await adminToggleAccountAction({ userId: tenantB, disabled: true });
              res.adminToggle = r3.ok ? "اجرا شد!" : "رد شد";
            } catch { res.adminToggle = "رد شد"; }
          } finally {
            if (adminTok) store.set(AUTH_COOKIE, adminTok, { ...opts, httpOnly: true });
            if (adminTid) store.set("pharma_tid", adminTid, { ...opts, httpOnly: false });
          }
          const after = await dbOne("SELECT p.status, p.subscription_ends_at, p.trial_ends_at, u.role, u.disabled FROM profiles p JOIN users u ON u.id = p.owner_user_id WHERE p.id = $1", [tenantB]);
          const same = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);
          const k = {
            adminSubRejected: res.adminSub === "رد شد",
            adminToggleRejected: res.adminToggle === "رد شد",
            statusUnchanged: after.status === before.status,
            subscriptionUnchanged: same(after.subscription_ends_at, before.subscription_ends_at) && same(after.trial_ends_at, before.trial_ends_at),
            roleUnchanged: after.role === before.role && after.role === "owner",
            disabledUnchanged: after.disabled === before.disabled,
          };
          const pass = Object.values(k).every(Boolean);
          return { pass, detail: pass ? `اکشن پروفایل فقط نام/تلفن را تغییر داد (فیلدهای role/status/اشتراک نادیده شد)؛ دو اکشن مدیر با نشست صاحب داروخانه رد شد؛ نشست مدیر برگشت` : `ناموفق: ${JSON.stringify(k)} ${JSON.stringify(res)}` };
        });

        // ---------- اتصال جدا به app_runtime برای آزمون‌های ۳۰ و ۳۲ ----------
        const rtPw = process.env.APP_RUNTIME_PASSWORD;
        let rt3: Client | null = null;
        let rt3Why = "";
        try {
          const appU = new URL(appUrl);
          let connStr: string | null = null;
          if (decodeURIComponent(appU.username).startsWith(APP_ROLE)) connStr = appUrl;
          else if (rtPw) {
            const base = new URL(url);
            const bu = decodeURIComponent(base.username);
            const dot = bu.indexOf(".");
            const u3 = new URL(base.toString());
            u3.username = encodeURIComponent(APP_ROLE + (dot >= 0 ? bu.slice(dot) : ""));
            u3.password = encodeURIComponent(rtPw);
            connStr = u3.toString();
          } else rt3Why = "APP_RUNTIME_PASSWORD تنظیم نشده";
          if (connStr) {
            let cl: Client | null = null;
            let lastErr: unknown;
            for (let i = 0; i < 3 && !cl; i++) {
              const c = new Client({ connectionString: connStr, connectionTimeoutMillis: 15_000, query_timeout: 15_000, statement_timeout: 15_000 });
              c.on("error", () => undefined);
              try { await c.connect(); cl = c; } catch (e) { lastErr = e; await c.end().catch(() => undefined); if (i < 2) await new Promise((r) => setTimeout(r, 1500)); }
            }
            if (!cl) throw lastErr;
            rt3 = cl;
          }
        } catch (e) {
          rt3Why = `اتصال app_runtime ناموفق: ${rtPw ? errMsg(e).split(rtPw).join("***") : errMsg(e)}`;
        }
        try {
          const rtTest3 = async (name: string, fn: (c: Client) => Promise<{ pass: boolean; detail: string }>) => {
            if (!rt3) {
              results.push({ name, pass: false, skipped: true, detail: `اجرا نشد: ${rt3Why}` });
              return;
            }
            const c = rt3;
            await test(name, async () => {
              await c.query("BEGIN");
              try { return await fn(c); } finally { await c.query("ROLLBACK").catch(() => undefined); }
            });
          };
          const guc3 = (c: Client, o: { tenant?: string; role?: string; user?: string; email?: string }) =>
            c.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.role', $2, true), set_config('app.user_id', $3, true), set_config('app.login_email', $4, true)", [o.tenant ?? "", o.role ?? "", o.user ?? "", o.email ?? ""]);
          // اجرای یک دستور داخل savepoint؛ کد خطا یا تعداد ردیف تغییرکرده را برمی‌گرداند
          const attempt = async (c: Client, q: string, params: unknown[] = []): Promise<{ code: string | null; rows: number | null }> => {
            await c.query("SAVEPOINT a1");
            try {
              const r = await c.query(q, params);
              return { code: null, rows: r.rowCount };
            } catch (e) {
              return { code: errCode(e), rows: null };
            } finally {
              await c.query("ROLLBACK TO SAVEPOINT a1").catch(() => undefined);
            }
          };

          // ---------- ۳۰) ارتقای نقش مستقیم با نقش app_runtime ----------
          await rtTest3("۳۰) نقش app_runtime مستقیم هم نمی‌تواند role یا اشتراک را ارتقا دهد", async (c) => {
            const ne = `selftest-esc-${crypto.randomUUID()}@invalid.test`;
            const nu = crypto.randomUUID();
            await guc3(c, { email: ne, user: nu, tenant: nu });
            const insAdmin = await attempt(c, "INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, '!x', 'admin')", [nu, ne]);
            const insOwner = await attempt(c, "WITH u AS (INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, '!x', 'owner') RETURNING id) INSERT INTO profiles (id, owner_user_id, name, status, trial_ends_at) SELECT id, id, 'x', 'trial', now() + interval '7 days' FROM u", [nu, ne]);
            const insActive = await attempt(c, "WITH u AS (INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, '!x', 'owner') RETURNING id) INSERT INTO profiles (id, owner_user_id, name, status, subscription_ends_at) SELECT id, id, 'x', 'active', now() + interval '1 year' FROM u", [nu, ne]);
            await guc3(c, { tenant: S.userB as string, role: "admin", user: S.userB as string });
            const toAdmin = await attempt(c, "UPDATE users SET role = 'admin' WHERE id = $1", [S.userB]);
            const adminDisable = await attempt(c, "UPDATE users SET disabled = true WHERE id = $1", [S.userB]);
            const adminSub = await attempt(c, "UPDATE profiles SET subscription_ends_at = now() + interval '30 days' WHERE id = $1", [S.userB]);
            await guc3(c, { tenant: S.userB as string, role: "owner", user: S.userB as string });
            const ownSub = await attempt(c, "UPDATE profiles SET subscription_ends_at = now() + interval '10 years' WHERE id = $1", [S.userB]);
            const ownStatus = await attempt(c, "UPDATE profiles SET status = 'expired' WHERE id = $1", [S.userB]);
            const ownName = await attempt(c, "UPDATE profiles SET name = name WHERE id = $1", [S.userB]);
            const ownRole = await attempt(c, "UPDATE users SET role = 'admin' WHERE id = $1", [S.userB]);
            const k = {
              insertAdminBlocked: insAdmin.code === "42501",
              registerOwnerAllowed: insOwner.code === null,
              registerActiveBlocked: insActive.code === "42501",
              roleToAdminBlockedEvenForAdminGuc: toAdmin.code === "42501",
              adminCanDisable: adminDisable.code === null && adminDisable.rows === 1,
              adminCanSetSubscription: adminSub.code === null && adminSub.rows === 1,
              ownerSubscriptionBlocked: ownSub.code === "42501",
              ownerStatusBlocked: ownStatus.code === "42501",
              ownerNameAllowed: ownName.code === null && ownName.rows === 1,
              ownerCannotTouchUsers: ownRole.code !== null || ownRole.rows === 0,
            };
            const pass = Object.values(k).every(Boolean);
            return { pass, detail: pass ? "ساخت مدیر، ارتقای role و تغییر اشتراک توسط app_runtime رد شد؛ عملیات مجاز (ثبت‌نام owner، تغییر نام، عملیات مدیر غیر از ارتقا) کار کرد" : `ناموفق: ${JSON.stringify(k)} ${JSON.stringify({ insAdmin, insOwner, insActive, toAdmin, ownSub, ownStatus })}` };
          });

          // ---------- ۳۲) audit_log فقط افزودنی ----------
          await rtTest3("۳۲) audit_log با app_runtime قابل UPDATE و DELETE نیست", async (c) => {
            await guc3(c, { tenant: A, role: "admin", user: A });
            const insAdmin = await attempt(c, "INSERT INTO audit_log (actor_user_id, action) VALUES ($1, 'selftest.append')", [A]);
            await guc3(c, { tenant: tenantB, role: "owner", user: tenantB });
            const insOwner = await attempt(c, "INSERT INTO audit_log (actor_user_id, action) VALUES ($1, 'selftest.fake')", [tenantB]);
            const selOwner = await attempt(c, "SELECT * FROM audit_log");
            await guc3(c, { tenant: A, role: "admin", user: A });
            const upd = await attempt(c, "UPDATE audit_log SET action = 'x'");
            const del = await attempt(c, "DELETE FROM audit_log");
            const priv = await pool.query("SELECT has_table_privilege($1, 'public.audit_log', 'UPDATE') AS u, has_table_privilege($1, 'public.audit_log', 'DELETE') AS d, has_table_privilege($1, 'public.audit_log', 'TRUNCATE') AS tr, (SELECT count(*)::int FROM pg_trigger WHERE tgname = 'audit_log_no_change') AS t", [APP_ROLE]);
            const k = {
              adminAppendAllowed: insAdmin.code === null,
              ownerInsertBlocked: insOwner.code === "42501",
              ownerReadsNothing: selOwner.code === null && selOwner.rows === 0,
              updateDenied: upd.code === "42501",
              deleteDenied: del.code === "42501",
              noUpdateDeleteTruncateGrant: priv.rows[0].u === false && priv.rows[0].d === false && priv.rows[0].tr === false,
              immutableTriggerPresent: priv.rows[0].t === 1,
            };
            const pass = Object.values(k).every(Boolean);
            return { pass, detail: pass ? "فقط مدیر می‌تواند ثبت کند؛ UPDATE/DELETE با 42501 رد شد و دسترسی UPDATE/DELETE/TRUNCATE وجود ندارد؛ تریگر ضدتغییر برقرار است" : `ناموفق: ${JSON.stringify(k)}` };
          });
        } finally {
          if (rt3) await (rt3 as Client).end().catch(() => undefined);
        }

        // ---------- ۳۱) ثبت audit برای عملیات واقعی مدیر ----------
        await test("۳۱) عملیات مدیر در audit_log ثبت می‌شود (کی، چه، روی چه، کی)", async () => {
          S.auditTargets!.push(tenantB);
          const r1 = await adminSetSubscriptionAction({ profileId: tenantB, status: "active", endDate: "2099-12-31" });
          const r2 = await adminToggleAccountAction({ userId: tenantB, disabled: true });
          const r3 = await adminToggleAccountAction({ userId: tenantB, disabled: false });
          const rows = await pool.query("SELECT action, target_type, target_id, actor_user_id, at, detail FROM audit_log WHERE target_id = $1 ORDER BY at", [tenantB]);
          const actions = rows.rows.map((r) => String(r.action));
          const k = {
            actionsOk: r1.ok && r2.ok && r3.ok,
            hasSubscription: actions.includes("subscription.set"),
            hasDisable: actions.includes("account.disable"),
            hasEnable: actions.includes("account.enable"),
            actorIsRealAdmin: rows.rows.length > 0 && rows.rows.every((r) => r.actor_user_id === admin.userId),
            hasTimeAndTarget: rows.rows.every((r) => r.at && r.target_type && r.target_id),
            detailHasStatus: rows.rows.find((r) => r.action === "subscription.set")?.detail?.status === "active",
          };
          const pass = Object.values(k).every(Boolean);
          return { pass, detail: pass ? `${rows.rows.length} ردیف audit با مدیر، عمل، هدف و زمان ثبت شد (روی داروخانه‌ی آزمایشی؛ حساب واقعی مدیر دست نخورد)` : `ناموفق: ${JSON.stringify(k)} actions=${actions.join(",")}` };
        });

        // ---------- ۳۴) خواندن سابقه از مسیر واقعی صفحه‌ی مدیر (با نشست مدیر و اتصال app_runtime) ----------
        await test("۳۴) مسیر خواندن سابقه‌ی مدیر: ردیف آزمایشی برمی‌گردد، حداکثر ۵۰ مورد، تازه‌ترین اول", async () => {
          const marker = `selftest-audit-${stamp}`;
          S.auditTargets!.push(marker);
          await withTenant(admin, (tx) =>
            writeAudit(tx, admin.userId, { action: "selftest.audit_read", targetType: "selftest", targetId: marker, detail: { ok: true } })
          );
          const res = await auditGET();
          const j = await getJson(res);
          const rows = (Array.isArray(j.rows) ? j.rows : []) as Json[];
          const mine = rows.find((x) => x.targetId === marker);
          const times = rows.map((x) => new Date(String(x.at)).getTime());
          const k = {
            status200: res.status === 200,
            rowsIsArray: Array.isArray(j.rows),
            atMost50: rows.length <= 50,
            hasMyRow: !!mine,
            actionOk: mine?.action === "selftest.audit_read",
            detailOk: mine?.detail?.ok === true,
            actorEmailJoined: typeof mine?.actorEmail === "string" && String(mine.actorEmail).length > 0,
            newestFirst: times.every((t, i) => i === 0 || times[i - 1] >= t),
          };
          const pass = Object.values(k).every(Boolean);
          return { pass, detail: pass ? `مسیر خواندن با نشست مدیر ${rows.length} ردیف (حداکثر ۵۰) برگرداند و ردیف آزمایشی با ایمیل مدیر در آن بود` : `ناموفق: ${JSON.stringify(k)} status=${res.status}${j.error ? ` error=${String(j.error)}` : ""}` };
        });

        // ---------- ۳۵) جدول خطای مدیر: ثبت با پاک‌سازی رمز/آدرس، خواندن با مسیر مدیر، RLS ----------
        await test("۳۵) جدول خطا: خطا ثبت و رمز/آدرس پاک می‌شود؛ فقط مدیر می‌خواند؛ UPDATE ممنوع", async () => {
          const place = `selftest-err-${stamp}`;
          await recordError(place, new Error("boom postgres://user:pw123@host:5432/db password=abc123"), { source: "server" });
          const res = await errorsGET();
          const j = await getJson(res);
          const rows = (Array.isArray(j.rows) ? j.rows : []) as Json[];
          const mine = rows.find((x) => x.place === place);
          const msg = String(mine?.message ?? "");
          const q = await pool.query("SELECT has_table_privilege($1, 'public.error_log', 'UPDATE') AS upd, has_table_privilege($1, 'public.error_log', 'SELECT') AS sel", [APP_ROLE]);
          const k = {
            status200: res.status === 200,
            atMost50: rows.length <= 50,
            hasMyRow: !!mine,
            urlRedacted: !msg.includes("pw123") && !msg.includes("postgres://"),
            secretRedacted: !msg.includes("abc123"),
            appRoleNoUpdate: q.rows[0]?.upd === false && q.rows[0]?.sel === true,
          };
          const pass = Object.values(k).every(Boolean);
          return { pass, detail: pass ? "خطا ثبت شد، آدرس و رمز پاک شد، مسیر مدیر آن را برگرداند و app_runtime اجازه‌ی UPDATE ندارد" : `ناموفق: ${JSON.stringify(k)} status=${res.status}${j.error ? ` error=${String(j.error)}` : ""}` };
        });

        // ---------- ۳۶) همگام‌سازی یادداشت آفلاین: ارسال مجدد با همان کلید تکراری نمی‌سازد ----------
        await test("۳۶) همگام‌سازی آفلاین: کلید یکتا جلوی ثبت تکراری را می‌گیرد (نشست صاحب داروخانه‌ی آزمایشی)", async () => {
          const adminTok = request.cookies.get(AUTH_COOKIE)?.value;
          const adminTid = request.cookies.get("pharma_tid")?.value;
          const store = await cookies();
          const opts = { sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };
          const marker = `selftest-note-${stamp}`;
          const post = (b: Json) => notesSyncPOST(new NextRequest("http://localhost/api/quick-notes/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }));
          const count = async (body: string) => Number((await dbOne("SELECT count(*)::int AS n FROM quick_notes WHERE tenant_id = $1 AND body = $2", [tenantB, body])).n);
          const k: Record<string, boolean> = {};
          try {
            const tokB = await signSession({ sub: tenantB, tid: tenantB, role: "owner", email: S.emailB as string });
            store.set(AUTH_COOKIE, tokB, { ...opts, httpOnly: true });
            store.set("pharma_tid", tenantB, { ...opts, httpOnly: false });
            const key = `selftest_${crypto.randomUUID()}`;
            const r1 = await post({ body: marker, createdAt: Date.now(), clientKey: key });
            const r2 = await post({ body: marker, createdAt: Date.now(), clientKey: key });
            k.sameKeyTwiceOneRow = r1.status === 200 && r2.status === 200 && (await count(marker)) === 1;
            const r3 = await post({ body: marker, createdAt: Date.now(), clientKey: `selftest_${crypto.randomUUID()}` });
            k.otherKeyNewRow = r3.status === 200 && (await count(marker)) === 2;
            const r4 = await post({ body: "   ", clientKey: key });
            k.emptyRejected400 = r4.status === 400;
          } finally {
            if (adminTok) store.set(AUTH_COOKIE, adminTok, { ...opts, httpOnly: true });
            if (adminTid) store.set("pharma_tid", adminTid, { ...opts, httpOnly: false });
            await pool.query("DELETE FROM quick_notes WHERE tenant_id = $1 AND body = $2", [tenantB, marker]);
          }
          const pass = Object.values(k).every(Boolean);
          return { pass, detail: pass ? "ارسال مجدد با همان کلید یک ردیف ساخت، کلید دیگر ردیف جدید، متن خالی رد شد؛ نشست مدیر برگشت (منطق IndexedDB در مرورگر با این آزمون پوشش داده نمی‌شود)" : `ناموفق: ${JSON.stringify(k)}` };
        });

        // ---------- ۳۷) شاخص یکتای visitor_products (لازم برای ON CONFLICT ورود اکسل) ----------
        await test("۳۷) visitor_products شاخص یکتای (tenant_id, visitor_id, product_id) دارد", async () => {
          const q = await pool.query(`SELECT 1 FROM pg_index i WHERE i.indrelid = 'public.visitor_products'::regclass AND i.indisunique AND i.indpred IS NULL AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)) = ARRAY['product_id','tenant_id','visitor_id']`);
          const pass = q.rows.length > 0;
          return { pass, detail: pass ? "شاخص یکتای سه‌ستونه برقرار است (ورود اکسل با ON CONFLICT کار می‌کند)" : "شاخص یکتا وجود ندارد؛ مهاجرت ۰۱۷ را اجرا کنید" };
        });

        // ---------- ۳۸) ذخیره‌ی فایل بزرگ در مخزن (روی همین Workers): نوشتن و خواندن بدون تغییر ----------
        await test("۳۸) مخزن فایل: فایلِ هم‌اندازه‌ی سقف آپلود (سقف فعلی) نوشته و بدون تغییر خوانده می‌شود", async () => {
          const key = `selftest/${stamp}.bin`;
          const size = MAX_CATALOG_BYTES - 123; // بزرگ‌ترین فایلی که مسیر آپلود می‌پذیرد
          const data = new Uint8Array(size);
          for (let o = 0; o < size; o += 65536) crypto.getRandomValues(data.subarray(o, Math.min(o + 65536, size)));
          const t0 = Date.now();
          try {
            await storage.put(key, data, "application/octet-stream");
            const tw = Date.now() - t0;
            const back = await storage.get(key);
            const tr = Date.now() - t0 - tw;
            const same = !!back && back.length === size && back.every((b, i) => b === data[i]);
            const missing = (await storage.get(`selftest/none-${stamp}.bin`)) === null;
            const pass = same && missing;
            return { pass, detail: pass ? `فایل ${(size / 1048576).toFixed(2)} مگابایتی عیناً نوشته و خوانده شد؛ قطعه=${STORAGE_INFO.chunkBytes}B خام (${STORAGE_INFO.b64Chars} کاراکتر base64) × ${STORAGE_INFO.rowsPerInsert} ردیف در هر INSERT و ${STORAGE_INFO.stmtsPerTx} INSERT در هر تراکنش؛ خواندن ${STORAGE_INFO.readBatch} ردیف در هر کوئری؛ نوشتن ${tw}ms، خواندن ${tr}ms؛ توان نوشتن ${(size / 1048576 / (tw / 1000)).toFixed(2)}MB/s، سقف عملیِ پیشنهادی برای ≈۱۰ثانیه آپلود: ${Math.max(1, Math.floor((size / 1048576 / (tw / 1000)) * 10))}MB؛ poolRev=${POOL_REV}؛ کلید ناموجود null برگشت` : `ناموفق: same=${same} missing=${missing} chunk=${STORAGE_INFO.chunkBytes}B poolRev=${POOL_REV}` };
          } catch (e) {
            // تشخیص: کدام اندازه‌ی متن روی اتصال Workers می‌گذرد؟ (هر اندازه در تراکنش جدا)
            const probe: string[] = [];
            for (const kb of [8, 16, 24, 32, 48]) {
              try {
                await withSystemRole((tx) => tx.insert(catalogFileChunks).values({ fileKey: `selftest/probe-${stamp}`, part: kb, b64: "A".repeat(kb * 1024) }));
                probe.push(`${kb}KB:ok`);
              } catch (pe) {
                probe.push(`${kb}KB:FAIL(${(pe instanceof Error ? pe.message : String(pe)).slice(0, 80)})`);
              }
            }
            const msg = `poolRev=${POOL_REV} chunk=${STORAGE_INFO.chunkBytes}B×${STORAGE_INFO.rowsPerInsert}/INSERT، ${Date.now() - t0}ms: ${e instanceof Error ? e.message.slice(0, 160) : String(e)} | probe: ${probe.join(" ")}`;
            await recordError("selftest/38 storage", new Error(msg));
            return { pass: false, detail: msg };
          } finally {
            await storage.delete(key).catch(() => undefined);
            await pool.query("DELETE FROM catalog_file_chunks WHERE file_key = $1 OR file_key = $2", [key, `selftest/probe-${stamp}`]);
          }
        });

        // ---------- ۳۹) خواندن لیست (قاعده‌ها، بدون دیتابیس) ----------
        await test("۳۹) خواندن لیست: ترتیب حروف PDF، نقش ستون‌ها، ارقام فارسی، ردیف جمع، مبلغ ناهمخوان", async () => {
          const rev = visualToLogical("لوﻠﺣﻣ"); // «محلول» به ترتیب دیداری
          const num = visualToLogical("٩۵٢،٢٩٧،۵٠٠"); // عدد نباید برعکس شود
          const r = parseTable([
            ["ردیف", "کد کالا", "نام کالا", "مانده", "قیمت واحد", "مبلغ", "توضیحات"],
            [1, "۱۰۱", "شامپو الف", "۱۰", "۱٬۰۰۰", "۱۰٬۰۰۰", "نکته"],
            [2, "۱۰۲", "کرم ب ب", "۵", "۲۰۰", "۵۰۰۰", ""],
            ["", "", "جمع", "", "", "۱۰٬۹۹۹", ""],
          ]);
          const k = {
            reversedWord: rev === "محلول",
            numberKept: num === "952،297،500" || num === "952,297,500" || num.replace(/[,،]/g, "") === "952297500",
            twoRows: r.rows.length === 2,
            roles: r.columns.map((c) => c.role).join(",") === "extra,code,name,qty,price,amount,extra",
            numbers: r.rows[0]?.price === 1000 && r.rows[0]?.qty === 10 && r.rows[0]?.amount === 10000,
            extraKept: r.rows[0]?.extra["توضیحات"] === "نکته",
            mismatchFlagged: r.suspicious === 1,
          };
          const pass = Object.values(k).every(Boolean);
          return { pass, detail: pass ? "ترتیب حروف، نقش ستون‌ها، ارقام فارسی، حذف ردیف «جمع» و کنترل مبلغ درست کار کرد" : `ناموفق: ${JSON.stringify(k)}` };
        });

        // ---------- ۴۰) ثبت لیست در دیتابیس (نشست صاحب داروخانه‌ی آزمایشی) ----------
        await test("۴۰) ثبت لیست ویزیتور: ساخت، به‌روزرسانی، تاریخچه، ناموجود، بدون تکرار، همه‌ی ستون‌ها", async () => {
          const adminTok = request.cookies.get(AUTH_COOKIE)?.value;
          const adminTid = request.cookies.get("pharma_tid")?.value;
          const store = await cookies();
          const opts = { sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };
          const pfx = `selftest-item-${stamp}-`;
          const vis = await pool.query("INSERT INTO visitors (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenantB, `selftest-visitor-${stamp}`]);
          const vid = vis.rows[0].id as string;
          const k: Record<string, boolean> = {};
          const dbg: Record<string, unknown> = {};
          let r2info: unknown = null;
          try {
            const tokB = await signSession({ sub: tenantB, tid: tenantB, role: "owner", email: S.emailB as string });
            store.set(AUTH_COOKIE, tokB, { ...opts, httpOnly: true });
            store.set("pharma_tid", tenantB, { ...opts, httpOnly: false });
            const mk = (i: number, extra: Record<string, unknown> = {}) => ({ code: `C${i}`, name: `${pfx}${i}`, qty: 10 + i, unit: "عدد", warehouse: "2", price: 1000 + i, amount: (10 + i) * (1000 + i), extra: { "ستون ناشناخته": `v${i}` }, ...extra });
            const first = Array.from({ length: 45 }, (_, i) => mk(i));
            first.push(mk(5)); // ردیف هم‌نام در همان فایل: خطای upsert ندهد
            first.push({ name: "x" } as ReturnType<typeof mk>); // نامعتبر
            const r1 = await importVisitorListAction({ visitorId: vid, rows: first });
            k.firstOk = r1.ok === true && r1.newProducts === 45 && r1.created === 45 && r1.updated === 0 && r1.invalid === 1;
            const c1 = await pool.query("SELECT count(*)::int AS n FROM visitor_products WHERE visitor_id = $1", [vid]);
            const row3 = (await pool.query("SELECT vp.code AS code, vp.warehouse AS warehouse, vp.unit AS unit, vp.qty::text AS qty, vp.amount AS amount, vp.extra AS extra FROM visitor_products vp JOIN products p ON p.id = vp.product_id WHERE vp.visitor_id = $1 AND p.name = $2", [vid, `${pfx}3`])).rows[0];
            k.countAndColumns = c1.rows[0].n === 45 && row3?.code === "C3" && row3?.unit === "عدد" && row3?.qty === "13" && Number(row3?.amount) === 13 * 1003 && row3?.extra?.["ستون ناشناخته"] === "v3";
            // ورود دوم: ردیف ۰ حذف، قیمت ردیف ۱ تغییر، مانده‌ی ردیف ۲ صفر
            const second = Array.from({ length: 45 }, (_, i) => i).filter((i) => i !== 0).map((i) => mk(i, i === 1 ? { price: 5000, amount: 5000 * 11 } : i === 2 ? { qty: 0, amount: 0 } : {}));
            const r2 = await importVisitorListAction({ visitorId: vid, rows: second });
            r2info = { ok: r2.ok, error: r2.error, newProducts: r2.newProducts, created: r2.created, updated: r2.updated, markedOut: r2.markedOut, history: r2.history };
            k.secondOk = r2.ok === true && r2.newProducts === 0 && r2.created === 0 && r2.updated === 44 && r2.markedOut === 1 && (r2.history ?? 0) >= 2;
            const st = await pool.query("SELECT p.name, vp.stock, vp.price FROM visitor_products vp JOIN products p ON p.id = vp.product_id WHERE vp.visitor_id = $1 AND p.name = ANY($2)", [vid, [`${pfx}0`, `${pfx}1`, `${pfx}2`]]);
            const by = Object.fromEntries(st.rows.map((x) => [x.name, x]));
            dbg.item0_stock = { expected: "out", actual: by[`${pfx}0`]?.stock };
            dbg.item2_stock = { expected: "out", actual: by[`${pfx}2`]?.stock };
            dbg.item1_price = { expected: 5000, actual: by[`${pfx}1`]?.price, actualType: typeof by[`${pfx}1`]?.price };
            k.item0Out = by[`${pfx}0`]?.stock === "out";
            k.item2Out = by[`${pfx}2`]?.stock === "out";
            k.item1Price = Number(by[`${pfx}1`]?.price) === 5000; // ستون در دیتابیس عددی است و pg آن را رشته برمی‌گرداند
            const h = await pool.query("SELECT count(*)::int AS n FROM visitor_product_history WHERE visitor_id = $1", [vid]);
            const c2 = await pool.query("SELECT count(*)::int AS n FROM visitor_products WHERE visitor_id = $1", [vid]);
            k.historyAndNoDup = h.rows[0].n >= 2 && c2.rows[0].n === 45;
          } finally {
            if (adminTok) store.set(AUTH_COOKIE, adminTok, { ...opts, httpOnly: true });
            if (adminTid) store.set("pharma_tid", adminTid, { ...opts, httpOnly: false });
            await pool.query("DELETE FROM visitors WHERE id = $1", [vid]);
            await pool.query("DELETE FROM products WHERE tenant_id = $1 AND name LIKE $2", [tenantB, `${pfx}%`]);
          }
          const pass = Object.values(k).every(Boolean);
          return { pass, detail: pass ? "ورود اول ۴۵ کالا ساخت (هم‌نام و نامعتبر رد شد)، ورود دوم ۴۴ را به‌روز کرد، یک کالا «ناموجود» شد، تاریخچه ثبت شد و همه‌ی ستون‌ها (کد، انبار، واحد، مانده، مبلغ، extra) ماند؛ نشست مدیر برگشت" : `ناموفق: ${JSON.stringify(k)} | مقدار انتظار/واقعی: ${JSON.stringify(dbg)} | ورود دوم: ${JSON.stringify(r2info)}` };
        });

        // ---------- ۳۳) RLS و FORCE جدول‌های جدید ----------
        await test("۳۳) جدول‌های audit_log و rate_limits دارای RLS فعال و FORCE هستند", async () => {
          const r = await pool.query("SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS frc FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('audit_log', 'rate_limits')");
          const bad = r.rows.filter((x) => !x.rls || !x.frc).map((x) => String(x.relname));
          const pass = r.rows.length === 2 && bad.length === 0;
          return { pass, detail: pass ? "هر دو جدول RLS و FORCE دارند" : `ناموفق: پیدا شد=${r.rows.length} ناقص=[${bad.join("،")}] — ابتدا مهاجرت را اجرا کنید` };
        });
      }

      // ================= آزمون جستجوی قیمت کالا (stage=search) =================
      // داده‌ی ساختگی فقط در داروخانه‌ی آزمایشی B (و یک کالای طعمه با نام یکتا در A برای آزمون جداسازی)؛ همه در finally پاک می‌شود.
      if (stage === "search") {
        const tenantB = S.userB as string;
        const adminTok = request.cookies.get(AUTH_COOKIE)?.value;
        const adminTid = request.cookies.get("pharma_tid")?.value;
        const store = await cookies();
        const opts = { sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };
        const AR_YEH = "\u064A";
        const AR_KAF = "\u0643";
        const VN12 = `SELFTEST-B-S12-${stamp}`;
        const VN45 = `SELFTEST-B-S45-${stamp}`;
        const VN0 = `SELFTEST-B-S00-${stamp}`;
        const N1 = "شامپو پنتن ۴۰۰";
        const N2 = "پنتن شامپو ۴۰۰ml";
        const N3 = `شامپو پانت${AR_YEH}ن ۴۰۰`; // «ي» عربی
        const N4 = `${AR_KAF}رم مرطوب ${AR_KAF}ننده ن${AR_YEH}وا ٢٠٠`; // «ك» و «ي» و ارقام عربی
        const N5 = "شامپو پنتن ۲۰۰"; // ناموجود
        const decoyName = `شامپو پنتن ۴۰۰ SELFTEST-${stamp}`;
        let seedErr: string | null = null;
        let decoyProductId: string | null = null;
        let decoyLinkId: string | null = null;
        try {
          const mkVisitor = async (tenant: string, name: string) =>
            String((await pool.query("INSERT INTO visitors (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenant, name])).rows[0].id);
          const mkProduct = async (tenant: string, name: string) =>
            String((await pool.query("INSERT INTO products (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenant, name])).rows[0].id);
          const link = async (tenant: string, vid: string, pid: string, price: number, stockVal: string, ageDays: number) =>
            String(
              (
                await pool.query(
                  "INSERT INTO visitor_products (tenant_id, visitor_id, product_id, stock, price, qty, unit, last_import_id, updated_at) VALUES ($1, $2, $3, $4, $5, 10, 'عدد', $6, now() - make_interval(hours => $7::int)) RETURNING id",
                  [tenant, vid, pid, stockVal, price, crypto.randomUUID(), ageDays === 0 ? 0 : ageDays * 24 + 1]
                )
              ).rows[0].id
            );
          const v12 = await mkVisitor(tenantB, VN12);
          const v45 = await mkVisitor(tenantB, VN45);
          const v0 = await mkVisitor(tenantB, VN0);
          const p1 = await mkProduct(tenantB, N1);
          const p2 = await mkProduct(tenantB, N2);
          const p3 = await mkProduct(tenantB, N3);
          const p4 = await mkProduct(tenantB, N4);
          const p5 = await mkProduct(tenantB, N5);
          await link(tenantB, v12, p1, 120000, "in", 12);
          await link(tenantB, v45, p1, 95000, "in", 45);
          await link(tenantB, v0, p1, 110000, "in", 0);
          await link(tenantB, v0, p2, 80000, "in", 0);
          await link(tenantB, v12, p3, 130000, "in", 12);
          await link(tenantB, v12, p4, 60000, "in", 12);
          await link(tenantB, v12, p5, 50000, "out", 12);
          await pool.query("INSERT INTO products (tenant_id, name) SELECT $1, 'کالای انبوه ' || g FROM generate_series(1, 45) g", [tenantB]);
          await pool.query(
            "INSERT INTO visitor_products (tenant_id, visitor_id, product_id, stock, price, last_import_id) SELECT $1, $2, id, 'in', 1000 + length(name), $3 FROM products WHERE tenant_id = $1 AND name LIKE 'کالای انبوه %'",
            [tenantB, v0, crypto.randomUUID()]
          );
          decoyProductId = await mkProduct(A, decoyName);
          decoyLinkId = await link(A, S.vA as string, decoyProductId, 1, "in", 1);
        } catch (e) {
          seedErr = errMsg(e);
        }
        clearSearchCache(); // داده‌ی تازه‌ی بالا مستقیم در دیتابیس نوشته شد؛ کش قبلی نباید دیده شود
        const needSeed = () => {
          if (seedErr) throw new Error(`آماده‌سازی داده‌ی آزمایشی ناموفق: ${seedErr}`);
        };
        const searchAs = async (who: "B" | "A", q: string): Promise<Json[]> => {
          try {
            if (who === "B") {
              const tokB = await signSession({ sub: tenantB, tid: tenantB, role: "owner", email: S.emailB as string });
              store.set(AUTH_COOKIE, tokB, { ...opts, httpOnly: true });
              store.set("pharma_tid", tenantB, { ...opts, httpOnly: false });
            }
            const res = await searchGET(new NextRequest(`${origin}/api/search?q=${encodeURIComponent(q)}`));
            const j = await getJson(res);
            if (res.status !== 200) throw new Error(`/api/search کد ${res.status}: ${String(j.error ?? "")}`);
            return (j.products ?? []) as Json[];
          } finally {
            if (adminTok) store.set(AUTH_COOKIE, adminTok, { ...opts, httpOnly: true });
            if (adminTid) store.set("pharma_tid", adminTid, { ...opts, httpOnly: false });
          }
        };
        const namesOf = (rows: Json[]) => rows.map((r) => String(r.productName));
        const hasName = (rows: Json[], n: string) => rows.some((r) => r.productName === n);
        try {
          // ---------- ۴۱) نرمال‌سازی ----------
          await test("۴۱) نرمال‌سازی: ی/ي، ک/ك، ارقام فارسی/عربی/لاتین، نیم‌فاصله، اعراب، حروف کوچک، فاصله‌ی اضافه", async () => {
            const cases: Array<[string, string]> = [
              [`${AR_KAF}${AR_YEH}${AR_KAF} \u0622\u0628`, "کیک اب"],
              ["١٢٣ ۱۲۳ 123", "123 123 123"],
              ["\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645", "میخواهم"],
              ["\u0634\u064E\u0627\u0645\u067E\u064F\u0648", "شامپو"],
              ["  SHAMPOO   Pantene ", "shampoo pantene"],
              ["۴۰۰ml", "400 ml"],
              ["400 ML", "400 ml"],
            ];
            const bad = cases.filter(([i, o]) => normalizeText(i) !== o).map(([i, o]) => `«${i}» → «${normalizeText(i)}» (انتظار «${o}»)`);
            return { pass: bad.length === 0, detail: bad.length === 0 ? `${cases.length} نمونه درست نرمال شد` : bad.join(" | ") };
          });

          // ---------- ۴۲) ترتیب کلمه‌ها ----------
          await test("۴۲) جستجو بی‌توجه به ترتیب کلمه‌ها (و املای متفاوت ml/۴۰۰)", async () => {
            needSeed();
            const fwd = await searchAs("B", "شامپو پنتن ۴۰۰");
            const rev = await searchAs("B", "پنتن شامپو ۴۰۰");
            const ids = (r: Json[]) => r.map((x) => String(x.conditionId)).sort().join(",");
            const pass = hasName(fwd, N1) && hasName(fwd, N2) && hasName(rev, N1) && hasName(rev, N2) && ids(fwd) === ids(rev);
            return { pass, detail: pass ? `هر دو ترتیب ${fwd.length} نتیجه‌ی یکسان دادند (شامل «${N1}» و «${N2}»)` : `ترتیب عادی: [${namesOf(fwd).join("، ")}] | معکوس: [${namesOf(rev).join("، ")}]` };
          });

          // ---------- ۴۳) غلط املایی ----------
          await test("۴۳) تحمل غلط املایی ساده (یک حرف اشتباه یا جابه‌جایی)؛ عدد اشتباه رد می‌شود", async () => {
            needSeed();
            const wrong = await searchAs("B", "شامپو پنتم ۴۰۰");
            const swap = await searchAs("B", "شاپمو پنتن ۴۰۰");
            const num = await searchAs("B", "شامپو پنتن ۳۰۰");
            const pass = hasName(wrong, N1) && hasName(swap, N1) && num.length === 0;
            return { pass, detail: pass ? "«پنتم» و «شاپمو» هم کالا را پیدا کردند؛ «۳۰۰» هیچ نتیجه‌ای نداد" : `یک حرف اشتباه: ${wrong.length} نتیجه | جابه‌جایی: ${swap.length} | عدد اشتباه: ${num.length} (باید ۰)` };
          });

          // ---------- ۴۴) پیشوندی ----------
          await test("۴۴) جستجوی پیشوندی (وسط تایپ هم نتیجه می‌آید)", async () => {
            needSeed();
            const a = await searchAs("B", "شام پن");
            const b = await searchAs("B", "پنت شامپو ۴");
            const pass = hasName(a, N1) && hasName(a, N2) && hasName(b, N1) && hasName(b, N2);
            return { pass, detail: pass ? "«شام پن» و «پنت شامپو ۴» هر دو کالاها را پیدا کردند" : `«شام پن»: ${a.length} نتیجه | «پنت شامپو ۴»: ${b.length}` };
          });

          // ---------- ۴۵) ی/ک و ارقام ----------
          await test("۴۵) «ي/ك» و ارقام عربی در نام ذخیره‌شده با پرسش فارسی/لاتین یکی حساب می‌شود", async () => {
            needSeed();
            const a = await searchAs("B", "شامپو پانتین ۴۰۰");
            const b = await searchAs("B", "کرم مرطوب کننده نیوا 200");
            const c = await searchAs("B", "شامپو پنتن ٤٠٠");
            const pass = hasName(a, N3) && hasName(b, N4) && hasName(c, N1);
            return { pass, detail: pass ? "ی عربی، ک عربی، ارقام عربی/فارسی/لاتین همه تطبیق شدند" : `پانتین: ${hasName(a, N3)} | کرم نیوا: ${hasName(b, N4)} | ارقام عربی: ${hasName(c, N1)}` };
          });

          // ---------- ۴۶) ناموجود ----------
          await test("۴۶) کالای ناموجود (stock = out) در نتیجه نمی‌آید", async () => {
            needSeed();
            const a = await searchAs("B", "شامپو پنتن ۲۰۰");
            const b = await searchAs("B", "شامپو پنتن");
            const pass = a.length === 0 && !hasName(b, N5) && b.every((r) => r.stock !== "out" && Number(r.price) !== 50000);
            return { pass, detail: pass ? "کالای ناموجود نه با نام کامل و نه در جستجوی عمومی برگشت" : `جستجوی دقیق ناموجود: ${a.length} نتیجه | در جستجوی عمومی: ${hasName(b, N5)}` };
          });

          // ---------- ۴۷) ترتیب و ارزان‌ترین ----------
          await test("۴۷) ترتیب: مرتبط‌ترین اول، بین هم‌سطح‌ها ارزان‌ترین؛ برچسب «ارزان‌ترین»", async () => {
            needSeed();
            const rows = await searchAs("B", N1);
            const first3 = rows.slice(0, 3).map((r) => Number(r.price));
            const fourth = rows[3];
            const flagged = rows.filter((r) => r.cheapest === true);
            const pass =
              rows.length === 4 &&
              first3.join(",") === "95000,110000,120000" &&
              fourth?.productName === N2 &&
              Number(fourth?.price) === 80000 &&
              flagged.length === 1 &&
              flagged[0] === fourth;
            return { pass, detail: pass ? "سه ردیفِ دقیقاً هم‌نام به‌ترتیب ۹۵٬۰۰۰ < ۱۱۰٬۰۰۰ < ۱۲۰٬۰۰۰، بعد نام کم‌شباهت‌تر (۸۰٬۰۰۰)؛ فقط ارزان‌ترین برچسب خورد" : `قیمت‌ها: [${rows.map((r) => `${r.productName}=${r.price}`).join("، ")}] | تعداد برچسب: ${flagged.length}` };
          });

          // ---------- ۴۸) سن لیست ----------
          await test("۴۸) سن لیست درست محاسبه می‌شود و بیش از ۳۰ روز هشدار می‌گیرد", async () => {
            needSeed();
            const rows = await searchAs("B", N1);
            const by = (vn: string) => rows.find((r) => r.productName === N1 && r.visitorName === vn);
            const a = by(VN12);
            const b = by(VN45);
            const c = by(VN0);
            const pass = a?.ageDays === 12 && a?.stale === false && b?.ageDays === 45 && b?.stale === true && c?.ageDays === 0 && c?.stale === false;
            return { pass, detail: pass ? "۱۲ روز: عادی، ۴۵ روز: هشدار، امروز: ۰" : `۱۲روزه=${a?.ageDays}/${a?.stale} | ۴۵روزه=${b?.ageDays}/${b?.stale} | امروز=${c?.ageDays}/${c?.stale}` };
          });

          // ---------- ۴۹) سقف نتیجه ----------
          await test("۴۹) حداکثر ۴۰ نتیجه برمی‌گردد", async () => {
            needSeed();
            const rows = await searchAs("B", "انبوه");
            const pass = rows.length === 40;
            return { pass, detail: pass ? "از ۴۵ کالای مطابق، دقیقاً ۴۰ نتیجه برگشت" : `تعداد نتیجه: ${rows.length} (باید ۴۰)` };
          });

          // ---------- ۵۰) جداسازی tenant ----------
          await test("۵۰) جداسازی داروخانه‌ها: نتیجه‌ی داروخانه‌ی دیگر نمی‌آید", async () => {
            needSeed();
            const asA = await searchAs("A", "شامپو پنتن ۴۰۰ SELFTEST");
            const foundByA = asA.some((r) => r.conditionId === decoyLinkId);
            const asB = await searchAs("B", "شامپو پنتن");
            const leaked = asB.some((r) => r.conditionId === decoyLinkId || r.visitorId === S.vA || Number(r.price) === 1);
            const pass = foundByA && !leaked;
            return { pass, detail: pass ? "کالای طعمه فقط برای صاحب خودش دیده شد و برای داروخانه‌ی B برنگشت" : `طعمه برای صاحبش پیدا شد: ${foundByA} | به B نشت کرد: ${leaked}` };
          });
        } finally {
          if (decoyProductId) await pool.query("DELETE FROM products WHERE id = $1 AND tenant_id = $2", [decoyProductId, A]).catch(() => undefined);
          await pool.query("DELETE FROM visitors WHERE tenant_id = $1 AND name LIKE 'SELFTEST-B-S%'", [tenantB]).catch(() => undefined);
          await pool.query("DELETE FROM products WHERE tenant_id = $1", [tenantB]).catch(() => undefined);
          clearSearchCache();
        }
      }

      // ================= آزمون لیست خرید (stage=basket) =================
      // داده‌ی ساختگی فقط در داروخانه‌ی آزمایشی B (و یک ردیف طعمه با کالای یکتا در A برای آزمون جداسازی)؛ همه در finally پاک می‌شود.
      if (stage === "basket") {
        const tenantB = S.userB as string;
        const adminTok = request.cookies.get(AUTH_COOKIE)?.value;
        const adminTid = request.cookies.get("pharma_tid")?.value;
        const store = await cookies();
        const opts = { sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };
        const VN_A = `SELFTEST-B-K1-${stamp}`;
        const VN_B = `SELFTEST-B-K2-${stamp}`;
        const VN_C = `SELFTEST-B-K3-${stamp}`;
        const X1 = "شامپو بیوتی ۴۰۰";
        const X2 = "کرم دست رز";
        const X3 = "ناموجود نمونه";
        const X4 = "سرم سلول";
        const X5 = "قطره چشم";
        const decoyName = `کالای طعمه سبد SELFTEST-${stamp}`;
        const ids: { vA?: string; vB?: string; vC?: string; x1c?: string; x1outC?: string; decoyProduct?: string; decoyRow?: string } = {};
        let seedErr: string | null = null;
        try {
          const mkVisitor = async (name: string) =>
            String((await pool.query("INSERT INTO visitors (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenantB, name])).rows[0].id);
          const mkProduct = async (tenant: string, name: string, short: boolean) =>
            String(
              (
                await pool.query("INSERT INTO products (tenant_id, name, is_short, short_at) VALUES ($1, $2, $3, CASE WHEN $3 THEN now() ELSE NULL END) RETURNING id", [tenant, name, short])
              ).rows[0].id
            );
          const link = async (vid: string, pid: string, price: number, stockVal: string, ageDays: number) =>
            String(
              (
                await pool.query(
                  "INSERT INTO visitor_products (tenant_id, visitor_id, product_id, stock, price, qty, unit, last_import_id, updated_at) VALUES ($1, $2, $3, $4, $5, 10, 'عدد', $6, now() - make_interval(hours => $7::int)) RETURNING id",
                  [tenantB, vid, pid, stockVal, price, crypto.randomUUID(), ageDays === 0 ? 0 : ageDays * 24 + 1]
                )
              ).rows[0].id
            );
          ids.vA = await mkVisitor(VN_A);
          ids.vB = await mkVisitor(VN_B);
          ids.vC = await mkVisitor(VN_C);
          const p1 = await mkProduct(tenantB, X1, true);
          const p2 = await mkProduct(tenantB, X2, false);
          const p3 = await mkProduct(tenantB, X3, true);
          const p4 = await mkProduct(tenantB, X4, true);
          const p5 = await mkProduct(tenantB, X5, true);
          await link(ids.vA, p1, 100000, "in", 10);
          await link(ids.vB, p1, 90000, "in", 45);
          ids.x1outC = await link(ids.vC, p1, 50000, "out", 0);
          await link(ids.vA, p2, 70000, "in", 10);
          await link(ids.vA, p3, 40000, "out", 10);
          await link(ids.vA, p4, 40000, "in", 10);
          await link(ids.vC, p4, 40000, "in", 0);
          await link(ids.vB, p5, 30000, "in", 45);
          ids.decoyProduct = await mkProduct(A, decoyName, false);
          ids.decoyRow = String(
            (await pool.query("INSERT INTO basket_items (tenant_id, product_id, product_name, qty) VALUES ($1, $2, $3, 7) RETURNING id", [A, ids.decoyProduct, decoyName])).rows[0].id
          );
        } catch (e) {
          seedErr = `${errMsg(e)} — اگر «basket_items» نیست، مهاجرت ۰۲۱ را اجرا کنید`;
        }
        clearSearchCache();
        const needSeed = () => {
          if (seedErr) throw new Error(`آماده‌سازی داده‌ی آزمایشی ناموفق: ${seedErr}`);
        };
        const asB = async <T>(fn: () => Promise<T>): Promise<T> => {
          try {
            const tokB = await signSession({ sub: tenantB, tid: tenantB, role: "owner", email: S.emailB as string });
            store.set(AUTH_COOKIE, tokB, { ...opts, httpOnly: true });
            store.set("pharma_tid", tenantB, { ...opts, httpOnly: false });
            return await fn();
          } finally {
            if (adminTok) store.set(AUTH_COOKIE, adminTok, { ...opts, httpOnly: true });
            if (adminTid) store.set("pharma_tid", adminTid, { ...opts, httpOnly: false });
          }
        };
        const basketOf = async (who: "B" | "A"): Promise<BasketItem[]> => {
          const read = async () => {
            const res = await basketGET();
            const j = await getJson(res);
            if (res.status !== 200) throw new Error(`/api/basket کد ${res.status}: ${String(j.error ?? "")}`);
            return (j.items ?? []) as BasketItem[];
          };
          return who === "B" ? asB(read) : read();
        };
        const byName = (items: BasketItem[], n: string) => items.find((x) => x.productName === n);
        let gA: BasketItem | undefined;
        let orderNo1 = 0;
        try {
          // ---------- ۵۱) افزودن از جستجو ----------
          await test("۵۱) افزودن از نتایج جستجو: ردیف همان ویزیتور، تعداد ۱، قیمت لحظه‌ی افزودن؛ ناموجود رد می‌شود", async () => {
            needSeed();
            const hits = await asB(async () => {
              const res = await searchGET(new NextRequest(`${origin}/api/search?q=${encodeURIComponent(X2)}`));
              return ((await getJson(res)).products ?? []) as Json[];
            });
            const hit = hits.find((h) => h.productName === X2 && h.visitorName === VN_A);
            if (!hit) throw new Error("نتیجه‌ی جستجو برای کالای آزمایشی پیدا نشد");
            const r1 = await asB(() => addToBasketAction({ conditionId: String(hit.conditionId) }));
            const r2 = await asB(() => addToBasketAction({ conditionId: String(hit.conditionId) }));
            const rOut = await asB(() => addToBasketAction({ conditionId: ids.x1outC as string }));
            const rBadQty = await asB(() => addToBasketAction({ conditionId: String(hit.conditionId), qty: 0 }));
            const items = await basketOf("B");
            const it = byName(items, X2);
            const pass =
              r1.ok === true && r1.updated === false && r2.ok === true && r2.updated === true && rOut.ok === false && rBadQty.ok === false &&
              items.length === 1 && it?.visitorName === VN_A && it?.qty === 1 && it?.price === 70000;
            return { pass, detail: pass ? "افزودن از جستجو درست شد؛ افزودن دوباره ردیف تکراری نساخت؛ کالای ناموجود و تعداد نامعتبر رد شد" : `r1=${JSON.stringify(r1)} r2=${JSON.stringify(r2)} ناموجود=${JSON.stringify(rOut)} تعداد۰=${JSON.stringify(rBadQty)} ردیف‌ها=${items.length} ${JSON.stringify(it)}` };
          });

          // ---------- ۵۲) افزودن همه‌ی کسری‌ها ----------
          await test("۵۲) افزودن همه‌ی کسری‌ها: ارزان‌ترین ویزیتور موجود؛ هم‌قیمت = لیست تازه‌تر؛ ناموجود نزد همه بدون ویزیتور", async () => {
            needSeed();
            const r = await asB(() => addAllShortagesAction());
            const r2 = await asB(() => addAllShortagesAction());
            const items = await basketOf("B");
            const i1 = byName(items, X1);
            const i3 = byName(items, X3);
            const i4 = byName(items, X4);
            const i5 = byName(items, X5);
            const i2 = byName(items, X2);
            const pass =
              r.ok === true && r.added === 4 && r.noVisitor === 1 && r.alreadyIn === 0 &&
              r2.ok === true && r2.added === 0 && r2.alreadyIn === 4 &&
              items.length === 5 &&
              i1?.visitorName === VN_B && i1?.price === 90000 && i1?.qty === 1 &&
              i4?.visitorName === VN_C && i4?.price === 40000 &&
              i5?.visitorName === VN_B &&
              i3?.visitorId === null && i3?.unavailable === true &&
              i2?.visitorName === VN_A && i2?.qty === 1;
            return { pass, detail: pass ? "ارزان‌ترین (۹۰٬۰۰۰ نزد ویزیتور دوم)، هم‌قیمت با لیست تازه‌تر، ناموجود نزد همه بدون ویزیتور؛ اجرای دوباره چیزی تکراری نساخت" : `نتیجه اول=${JSON.stringify(r)} دوم=${JSON.stringify(r2)} تعداد=${items.length} X1=${i1?.visitorName}/${i1?.price} X4=${i4?.visitorName} X3=${i3?.visitorId}/${i3?.unavailable}` };
          });

          // ---------- ۵۳) تغییر تعداد و ویزیتور ----------
          await test("۵۳) تغییر تعداد (ارقام فارسی، نامعتبر رد) و ویزیتور (فقط ویزیتورِ دارای کالا)", async () => {
            needSeed();
            let items = await basketOf("B");
            const x1 = byName(items, X1);
            if (!x1) throw new Error("ردیف کالای اول پیدا نشد");
            const q = await asB(() => setBasketQtyAction({ id: x1.id, qty: 3 }));
            const q0 = await asB(() => setBasketQtyAction({ id: x1.id, qty: 0 }));
            const qBad = await asB(() => setBasketQtyAction({ id: x1.id, qty: Number("abc") }));
            const parse = parseQty("۱۲") === 12 && parseQty("١٢٣") === 123 && parseQty("0") === null && parseQty("1.5") === null && parseQty("") === null && parseQty("100000") === null;
            const v1 = await asB(() => setBasketVisitorAction({ id: x1.id, visitorId: ids.vA as string }));
            const vOut = await asB(() => setBasketVisitorAction({ id: x1.id, visitorId: ids.vC as string }));
            const vForeign = await asB(() => setBasketVisitorAction({ id: x1.id, visitorId: S.vA as string }));
            items = await basketOf("B");
            gA = byName(items, X1);
            const pass =
              q.ok === true && q0.ok === false && qBad.ok === false && parse &&
              v1.ok === true && vOut.ok === false && vForeign.ok === false &&
              gA?.qty === 3 && gA?.visitorName === VN_A && gA?.price === 100000;
            return { pass, detail: pass ? "تعداد ۳ شد، ۰ و غیرعدد رد شد؛ ویزیتور به اولی رفت و قیمتش ۱۰۰٬۰۰۰ شد؛ ویزیتورِ ناموجود/بیگانه رد شد" : `qty=${JSON.stringify(q)} صفر=${JSON.stringify(q0)} غیرعدد=${JSON.stringify(qBad)} parse=${parse} ویزیتور=${JSON.stringify(v1)} ناموجود=${JSON.stringify(vOut)} بیگانه=${JSON.stringify(vForeign)} نهایی=${gA?.qty}/${gA?.visitorName}/${gA?.price}` };
          });

          // ---------- ۵۴) گروه‌بندی ----------
          await test("۵۴) گروه‌بندی بر اساس ویزیتور، ترتیب کالاها، هشدار لیست کهنه، گروهِ ناموجود", async () => {
            needSeed();
            const groups = groupBasket(await basketOf("B"));
            const names = groups.map((g) => g.visitorName);
            const ga = groups[0];
            const gb = groups[1];
            const gc = groups[2];
            const gn = groups[3];
            const pass =
              groups.length === 4 && names.slice(0, 3).join("|") === [VN_A, VN_B, VN_C].join("|") && gn?.visitorId === null && gn?.orderable === false &&
              ga?.items.map((i) => i.productName).join("|") === [X1, X2].join("|") && ga?.totalQty === 4 && ga?.stale === false && ga?.ageDays === 10 &&
              gb?.items.length === 1 && gb?.stale === true && gb?.ageDays === 45 &&
              gc?.items[0]?.productName === X4 && gn?.items[0]?.productName === X3 && gn?.items[0]?.unavailable === true;
            return { pass, detail: pass ? "۴ گروه: سه ویزیتور به‌ترتیب نام + «بدون ویزیتور»؛ گروه ۴۵ روزه هشدار گرفت و ۱۰ روزه نه" : `گروه‌ها: ${groups.map((g) => `${g.visitorName}[${g.items.map((i) => i.productName).join("،")}] stale=${g.stale}/${g.ageDays}`).join(" ؛ ")}` };
          });

          // ---------- ۵۵) متن خروجی ----------
          await test("۵۵) متن خروجی فارسی: سلام، «نام — تعداد»، ترتیب، مجموع؛ بدون قیمت مگر روشن شود", async () => {
            needSeed();
            const g = groupBasket(await basketOf("B"))[0];
            const plain = basketGroupText(g);
            const priced = basketGroupText(g, { withPrice: true });
            const lines = plain.split("\n");
            const i1 = lines.findIndex((l) => l.includes(`${X1} — ۳`));
            const i2 = lines.findIndex((l) => l.includes(`${X2} — ۱`));
            const order = basketGroupOrder(g);
            const pass =
              lines[0] === "سلام" && i1 >= 0 && i2 > i1 && plain.includes("مجموع تعداد: ۴") && !/[0-9]/.test(plain) && !plain.includes("تومان") &&
              priced.includes("تومان") && priced.includes("۱۰۰,۰۰۰") && order.items?.length === 2 && order.items?.[0]?.qty === 3 && order.visitorName === VN_A;
            return { pass, detail: pass ? "متن درست، بدون ارقام لاتین و بدون قیمت؛ با گزینه‌ی قیمت، مبلغ آمد؛ ورودی اکسل/PDF هم ساخته شد" : `متن:\n${plain}\n---\nبا قیمت:\n${priced}` };
          });

          // ---------- ۵۶) ثبت به‌عنوان سفارش ----------
          await test("۵۶) ثبت به‌عنوان سفارش: شماره‌ی یکتا، ردیف‌های گروه پاک، کسری رفع، تکرار کلید سفارش تازه نمی‌سازد", async () => {
            needSeed();
            const key = `basket-${crypto.randomUUID()}`;
            const r = await asB(() => placeBasketOrderAction({ visitorId: ids.vA as string, clientKey: key }));
            const again = await asB(() => placeBasketOrderAction({ visitorId: ids.vA as string, clientKey: key }));
            const noVisitor = await asB(() => placeBasketOrderAction({ visitorId: "", clientKey: `basket-${crypto.randomUUID()}` }));
            const emptyGroup = await asB(() => placeBasketOrderAction({ visitorId: ids.vA as string, clientKey: `basket-${crypto.randomUUID()}` }));
            const cnt = await pool.query("SELECT count(*)::int AS n FROM orders WHERE tenant_id = $1 AND client_key = $2", [tenantB, key]);
            const its = await pool.query(
              "SELECT oi.product_name AS n, oi.qty AS q, oi.unit_price AS p FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.tenant_id = $1 AND o.client_key = $2 ORDER BY oi.product_name",
              [tenantB, key]
            );
            const left = await basketOf("B");
            const short = await pool.query("SELECT is_short FROM products WHERE tenant_id = $1 AND name = $2", [tenantB, X1]);
            const r2 = await asB(() => placeBasketOrderAction({ visitorId: ids.vC as string, clientKey: `basket-${crypto.randomUUID()}` }));
            orderNo1 = Number(r.orderNo ?? 0);
            const got = its.rows.map((x) => `${x.n}:${x.q}:${x.p}`).sort().join("|");
            const want = [`${X1}:3:100000`, `${X2}:1:70000`].sort().join("|");
            const pass =
              r.ok === true && orderNo1 >= 1 && again.ok === true && again.duplicate === true && again.id === r.id &&
              cnt.rows[0].n === 1 && got === want && noVisitor.ok === false && emptyGroup.ok === false &&
              left.length === 3 && !left.some((x) => x.productName === X1 || x.productName === X2) &&
              short.rows[0]?.is_short === false &&
              r2.ok === true && Number(r2.orderNo) === orderNo1 + 1;
            return { pass, detail: pass ? `سفارش شماره ${orderNo1} با دو قلم ثبت شد؛ تکرار همان کلید سفارش تازه نساخت؛ ردیف‌های آن گروه پاک و کسری رفع شد؛ سفارش بعدی شماره ${orderNo1 + 1} گرفت` : `r=${JSON.stringify(r)} تکرار=${JSON.stringify(again)} تعداد=${cnt.rows[0].n} اقلام=${got} باقی=${left.length} کسری=${short.rows[0]?.is_short} دوم=${JSON.stringify(r2)} بدونویزیتور=${JSON.stringify(noVisitor)} گروهخالی=${JSON.stringify(emptyGroup)}` };
          });

          // ---------- ۵۷) جداسازی tenant ----------
          await test("۵۷) جداسازی داروخانه‌ها: لیست داروخانه‌ی دیگر دیده یا تغییر داده نمی‌شود", async () => {
            needSeed();
            const asBItems = await basketOf("B");
            const asAItems = await basketOf("A");
            const seenByB = asBItems.some((x) => x.productName === decoyName);
            const seenByA = asAItems.some((x) => x.productName === decoyName);
            const rm = await asB(() => removeBasketItemAction(ids.decoyRow as string));
            const q = await asB(() => setBasketQtyAction({ id: ids.decoyRow as string, qty: 9 }));
            const row = await pool.query("SELECT qty FROM basket_items WHERE id = $1", [ids.decoyRow]);
            const pass = !seenByB && seenByA && rm.ok === false && q.ok === false && row.rows[0]?.qty === 7;
            return { pass, detail: pass ? "ردیف داروخانه‌ی A فقط برای خودش دیده شد؛ حذف و تغییر آن از نشست B رد شد و ردیف دست‌نخورده ماند" : `B دید=${seenByB} | A دید=${seenByA} | حذف=${JSON.stringify(rm)} | تغییر=${JSON.stringify(q)} | تعداد فعلی=${row.rows[0]?.qty}` };
          });

          // ---------- ۵۸) حذف و پاک‌کردن ----------
          await test("۵۸) حذف یک ردیف و پاک‌کردن همه (فقط لیست خودِ داروخانه)", async () => {
            needSeed();
            const before = await basketOf("B");
            const x3 = byName(before, X3);
            if (!x3) throw new Error("ردیف ناموجود نمونه پیدا نشد");
            const rm = await asB(() => removeBasketItemAction(x3.id));
            const mid = await basketOf("B");
            const clr = await asB(() => clearBasketAction());
            const after = await basketOf("B");
            const decoy = await pool.query("SELECT count(*)::int AS n FROM basket_items WHERE id = $1", [ids.decoyRow]);
            const pass = rm.ok === true && before.length === 2 && mid.length === 1 && clr.ok === true && after.length === 0 && decoy.rows[0].n === 1;
            return { pass, detail: pass ? "حذف یک ردیف (۲ ← ۱) و پاک‌کردن همه (← ۰) درست بود؛ ردیف داروخانه‌ی A دست نخورد" : `پیش=${before.length} میانه=${mid.length} پس=${after.length} ردیفA=${decoy.rows[0].n} حذف=${JSON.stringify(rm)} پاک=${JSON.stringify(clr)}` };
          });

          // ---------- ۵۹) RLS و دسترسی جدول ----------
          await test("۵۹) جدول basket_items: RLS + FORCE، سیاست tenant و مدیر، دسترسی app_runtime فقط DML", async () => {
            const t = await pool.query("SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS frc FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'basket_items'");
            const pol = await pool.query("SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'basket_items'");
            const priv = await pool.query(
              `SELECT has_table_privilege('${APP_ROLE}', 'public.basket_items', 'SELECT') AS s, has_table_privilege('${APP_ROLE}', 'public.basket_items', 'INSERT') AS i, has_table_privilege('${APP_ROLE}', 'public.basket_items', 'UPDATE') AS u, has_table_privilege('${APP_ROLE}', 'public.basket_items', 'DELETE') AS d, has_table_privilege('${APP_ROLE}', 'public.basket_items', 'TRUNCATE') AS tr`
            );
            const names = pol.rows.map((x) => String(x.policyname));
            const p = priv.rows[0] as Json;
            const pass = t.rows[0]?.rls === true && t.rows[0]?.frc === true && names.includes("basket_items_tenant_policy") && names.includes("basket_items_admin_policy") && p.s && p.i && p.u && p.d && !p.tr;
            return { pass: Boolean(pass), detail: pass ? "RLS و FORCE فعال، هر دو سیاست برقرار، app_runtime فقط SELECT/INSERT/UPDATE/DELETE دارد" : `جدول=${JSON.stringify(t.rows[0])} سیاست‌ها=[${names.join("،")}] دسترسی=${JSON.stringify(p)}` };
          });
        } finally {
          if (ids.decoyProduct) await pool.query("DELETE FROM products WHERE id = $1 AND tenant_id = $2", [ids.decoyProduct, A]).catch(() => undefined);
          await pool.query("DELETE FROM visitors WHERE tenant_id = $1 AND name LIKE 'SELFTEST-B-K%'", [tenantB]).catch(() => undefined);
          await pool.query("DELETE FROM products WHERE tenant_id = $1", [tenantB]).catch(() => undefined);
          clearSearchCache();
        }
      }

      // ================= آزمون ورود لیست از اشتراک‌گذاری (stage=share) =================
      // داده‌ی ساختگی فقط در داروخانه‌ی آزمایشی B (و یک ویزیتور طعمه با نام یکتا در A برای آزمون جداسازی)؛ همه در finally پاک می‌شود.
      // رفتار واقعی اشتراک‌گذاری در اندروید (پیام‌رسان ← اپ نصب‌شده) خودکار قابل‌آزمون نیست؛ راهنمای تست دستی در گزارش آمده است.
      if (stage === "share") {
        const tenantB = S.userB as string;
        const adminTok = request.cookies.get(AUTH_COOKIE)?.value;
        const adminTid = request.cookies.get("pharma_tid")?.value;
        const store = await cookies();
        const opts = { sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };
        const VN_A = "داروسازان";
        const VN_B = "پخش البرز";
        const VN_C = "سلامت گستر";
        const decoyName = `SELFTEST-A-SH-${stamp}`;
        const ids: { vA?: string; vB?: string; vC?: string; decoy?: string } = {};
        let seedErr: string | null = null;
        const readAsset = async (path: string): Promise<string> => {
          const env = (getCloudflareContext() as unknown as { env?: { ASSETS?: { fetch(r: Request): Promise<Response> }; WORKER_SELF_REFERENCE?: { fetch(r: Request): Promise<Response> } } }).env;
          const target = env?.ASSETS ?? env?.WORKER_SELF_REFERENCE;
          if (!target) throw new Error("دسترسی به فایل‌های ثابت در این محیط نیست");
          const res = await target.fetch(new Request(`${origin}${path}`));
          if (!res.ok) throw new Error(`${path} کد ${res.status}`);
          return res.text();
        };
        try {
          const mkVisitor = async (tenant: string, name: string) =>
            String((await pool.query("INSERT INTO visitors (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenant, name])).rows[0].id);
          ids.vA = await mkVisitor(tenantB, VN_A);
          ids.vB = await mkVisitor(tenantB, VN_B);
          ids.vC = await mkVisitor(tenantB, VN_C);
          ids.decoy = await mkVisitor(A, decoyName);
          // داروسازان: لیست ۱۲ روز پیش وارد شده + فایل قبلی؛ سلامت گستر: فقط یک فایل ۳ روز پیش؛ البرز: هیچ
          const p = String(
            (await pool.query("INSERT INTO products (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenantB, `کالای آزمون اشتراک ${stamp}`])).rows[0].id
          );
          await pool.query(
            "INSERT INTO visitor_products (tenant_id, visitor_id, product_id, stock, price, last_import_id, updated_at) VALUES ($1, $2, $3, 'in', 1000, $4, now() - make_interval(hours => 289))",
            [tenantB, ids.vA, p, crypto.randomUUID()]
          );
          await pool.query(
            "INSERT INTO catalog_files (tenant_id, visitor_id, file_name, file_key, mime_type, size_bytes, status, created_at) VALUES ($1, $2, $3, $4, 'application/pdf', 10, 'stored', now() - make_interval(hours => 289))",
            [tenantB, ids.vA, "لیست قیمت داروسازان ۱۴۰۵-۰۶.xlsx", `selftest/share-a-${stamp}`]
          );
          await pool.query(
            "INSERT INTO catalog_files (tenant_id, visitor_id, file_name, file_key, mime_type, size_bytes, status, created_at) VALUES ($1, $2, $3, $4, 'application/pdf', 10, 'stored', now() - make_interval(hours => 73))",
            [tenantB, ids.vC, "گستر.pdf", `selftest/share-c-${stamp}`]
          );
        } catch (e) {
          seedErr = errMsg(e);
        }
        const needSeed = () => {
          if (seedErr) throw new Error(`آماده‌سازی داده‌ی آزمایشی ناموفق: ${seedErr}`);
        };
        const asB = async <T>(fn: () => Promise<T>): Promise<T> => {
          try {
            const tokB = await signSession({ sub: tenantB, tid: tenantB, role: "owner", email: S.emailB as string });
            store.set(AUTH_COOKIE, tokB, { ...opts, httpOnly: true });
            store.set("pharma_tid", tenantB, { ...opts, httpOnly: false });
            return await fn();
          } finally {
            if (adminTok) store.set(AUTH_COOKIE, adminTok, { ...opts, httpOnly: true });
            if (adminTid) store.set("pharma_tid", adminTid, { ...opts, httpOnly: false });
          }
        };
        const candsOf = async (who: "B" | "A"): Promise<VisitorCand[]> => {
          const read = async () => {
            const res = await shareVisitorsGET();
            const j = await getJson(res);
            if (res.status !== 200) throw new Error(`/api/import-share/visitors کد ${res.status}: ${String(j.error ?? "")}`);
            return (j.visitors ?? []) as VisitorCand[];
          };
          return who === "B" ? asB(read) : read();
        };
        try {
          // ---------- ۶۰) manifest ----------
          await test("۶۰) manifest.json دارای share_target درست (action، method، enctype، فایل‌ها با mime و پسوند)", async () => {
            const m = JSON.parse(await readAsset("/manifest.json")) as Json;
            const st = m.share_target as Json | undefined;
            const acc: string[] = st?.params?.files?.[0]?.accept ?? [];
            const need = ["application/pdf", ".pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx", "application/vnd.ms-excel", ".xls", "text/csv", ".csv"];
            const missing = need.filter((x) => !acc.includes(x));
            const pass =
              st?.action === "/share-target" && st?.method === "POST" && st?.enctype === "multipart/form-data" &&
              st?.params?.files?.[0]?.name === "files" && missing.length === 0 &&
              m.start_url === "/dashboard" && Array.isArray(m.icons) && m.icons.length >= 3;
            return { pass, detail: pass ? "share_target (POST، multipart، فیلد files) با pdf/xlsx/xls/csv هم mime هم پسوند؛ بقیه‌ی manifest سالم" : `action=${st?.action} method=${st?.method} enctype=${st?.enctype} فیلد=${st?.params?.files?.[0]?.name} کم‌شده=[${missing.join("،")}]` };
          });

          // ---------- ۶۱) sw.js ----------
          await test("۶۱) sw.js مسیر /share-target را مدیریت می‌کند و کش network-first و نسخه‌ی خودکار سالم مانده", async () => {
            const sw = await readAsset("/sw.js");
            const must: Array<[string, string]> = [
              ["مسیر /share-target", '"/share-target"'],
              ["رویداد POST", 'request.method === "POST"'],
              ["خواندن فرم چندبخشی", "formData()"],
              ["ذخیره در IndexedDB", "indexedDB.open"],
              ["پایگاه pharma-share", '"pharma-share"'],
              ["ریدایرکت به /import-share", "/import-share"],
              ["سقف ۳MB", "3 * 1024 * 1024"],
              ["network-first", "async function networkFirst"],
              ["cache-first", "async function cacheFirst"],
              ["نسخه‌ی خودکار از ?v=", 'searchParams.get("v")'],
              ["فقط GET در مسیر عادی", 'request.method !== "GET"'],
              ["API هنوز network-first", 'url.pathname.startsWith("/api/")'],
            ];
            const missing = must.filter(([, t]) => !sw.includes(t)).map(([n]) => n);
            return { pass: missing.length === 0, detail: missing.length === 0 ? "هندلر اشتراک‌گذاری هست و network-first، cache-first، نسخه‌ی خودکار و فقط‌GET عادی دست‌نخورده‌اند" : `ناقص: ${missing.join("، ")}` };
          });

          // ---------- ۶۲) مسیر سروری جایگزین ----------
          await test("۶۲) مسیر سروری /share-target بدون سرویس‌ورکر: پیام فارسی، نه ۴۰۵ و نه ۵۰۰", async () => {
            const fd = new FormData();
            fd.append("files", new File([new Uint8Array([1, 2, 3])], "لیست قیمت.xlsx", { type: "application/octet-stream" }));
            const post = await shareTargetPOST(new Request(`${origin}/share-target`, { method: "POST", body: fd }));
            const html = await post.text();
            const post2 = await shareTargetPOST(new Request(`${origin}/share-target`, { method: "POST", body: "نه-چندبخشی" }));
            const get = await shareTargetGET(new Request(`${origin}/share-target`));
            const pass =
              post.status === 200 && (post.headers.get("content-type") ?? "").includes("text/html") && html.includes("از دکمه‌ی آپلود استفاده کنید") &&
              post2.status === 200 && get.status === 303 && (get.headers.get("location") ?? "").endsWith("/import-share");
            return { pass, detail: pass ? "POST با فایل ساختگی و با بدنه‌ی نامعتبر هر دو ۲۰۰ با پیام «از دکمه‌ی آپلود استفاده کنید»؛ GET به /import-share می‌رود" : `POST=${post.status} POST2=${post2.status} GET=${get.status} پیام=${html.includes("از دکمه‌ی آپلود استفاده کنید")}` };
          });

          // ---------- ۶۳) نوع و حجم ----------
          await test("۶۳) بررسی فایل: پسوند/mime درست، octet-stream با پسوند، خالی، نوع ناشناخته، بیش از سقف ۳MB", async () => {
            const c = (n: string, m: string, s: number) => classifyShareFile(n, m, s);
            const okXlsxOctet = c("لیست.xlsx", "application/octet-stream", 1000);
            const okPdfNoExt = c("لیست", "application/pdf", 1000);
            const okUpper = c("PRICE.XLSX", "", 1000);
            const okCsvMime = c("price", "text/csv; charset=utf-8", 1000);
            const docx = c("لیست.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1000);
            const empty = c("a.pdf", "application/pdf", 0);
            const big = c("a.pdf", "application/pdf", SHARE_MAX_BYTES + 1);
            const edge = c("a.pdf", "application/pdf", SHARE_MAX_BYTES);
            const pass =
              okXlsxOctet.ok && okXlsxOctet.ext === "xlsx" && okPdfNoExt.ok && okPdfNoExt.fileName === "لیست.pdf" && okUpper.ok && okCsvMime.ok && okCsvMime.fileName === "price.csv" &&
              !docx.ok && docx.problem === "type" && !empty.ok && empty.problem === "empty" && !big.ok && big.problem === "big" && big.message.includes("۳ مگابایت") && edge.ok;
            return { pass, detail: pass ? "نوع/خالی/حجم با پیام فارسی رد شد؛ octet-stream با پسوند و pdf بدون پسوند پذیرفته شد؛ دقیقاً ۳MB مجاز است" : JSON.stringify({ okXlsxOctet, okPdfNoExt, okUpper, okCsvMime, docx, empty, big, edge }) };
          });

          // ---------- ۶۴) تشخیص ویزیتور (نام‌های واقع‌گرایانه) ----------
          await test("۶۴) تشخیص ویزیتور از نام فایل: مطمئن، مبهم، تکراری، ناشناس، فایل تکراری، آخرین‌استفاده‌شده اول", async () => {
            const day = 86_400_000;
            const t = Date.now();
            const C: VisitorCand[] = [
              { id: "1", name: "داروسازان", lastFileName: "لیست قیمت داروسازان ۱۴۰۵-۰۶.xlsx", lastImportAt: new Date(t - 5 * day).toISOString() },
              { id: "2", name: "پخش البرز دارو", lastImportAt: new Date(t - 2 * day).toISOString() },
              { id: "3", name: "البرز شمال", lastImportAt: new Date(t - 9 * day).toISOString() },
              { id: "4", name: "سلامت گستر", company: "گروه دارویی سلامت گستر" },
              { id: "5", name: "کیمیا", lastImportAt: new Date(t - 1 * day).toISOString() },
              { id: "6", name: "کیمیا" },
              { id: "7", name: "فرادارو", lastFileName: "export (1).xlsx" },
            ];
            const d1 = detectVisitor("لیست قیمت داروسازان ۱۴۰۵-۰۷.xlsx", C);
            const d2 = detectVisitor("pricelist-سلامت گستر-1405.pdf", C);
            const d3 = detectVisitor("قیمت البرز ۱۴۰۵.xlsx", C);
            const d4 = detectVisitor("کیمیا.xlsx", C);
            const d5 = detectVisitor("report_final(3).pdf", C);
            const d6 = detectVisitor("لیست قیمت داروسازان ۱۴۰۵-۰۶.xlsx", C);
            const d7 = detectVisitor("export (2).xlsx", C);
            const d8 = detectVisitor("WhatsApp Document 2026-10-24 at 10.21.pdf", C);
            const order = orderChoices(C, d5).map((v) => v.id).join("");
            const top2 = (d: Detection) => d.matches.slice(0, 2).map((m) => m.visitor.id).sort().join(",");
            const pass =
              d1.status === "sure" && d1.best?.visitor.id === "1" &&
              d2.status === "sure" && d2.best?.visitor.id === "4" &&
              d3.status === "ambiguous" && top2(d3) === "2,3" &&
              d4.status === "ambiguous" && d4.matches[0]?.visitor.id === "5" && d4.matches[1]?.visitor.id === "6" &&
              d5.status === "none" && d8.status === "none" &&
              d6.status === "sure" && d6.best?.visitor.id === "1" &&
              d7.status === "ambiguous" && d7.best?.visitor.id === "7" &&
              order.startsWith("5213");
            return { pass, detail: pass ? "«داروسازان ۱۴۰۵-۰۷» ← مطمئن؛ «البرز» ← مبهم (دو نامزد)؛ «کیمیا» تکراری ← مبهم با آخرین‌استفاده‌شده اول؛ «report_final» ← ناشناس؛ همان نام فایل قبلی ← مطمئن" : JSON.stringify({ d1: [d1.status, d1.best?.visitor.id], d2: [d2.status, d2.best?.visitor.id], d3: [d3.status, top2(d3)], d4: [d4.status, d4.matches.map((m) => m.visitor.id)], d5: d5.status, d6: [d6.status, d6.best?.visitor.id], d7: [d7.status, d7.best?.visitor.id], d8: d8.status, order }) };
          });

          // ---------- ۶۵) نامزدها از دیتابیس ----------
          await test("۶۵) /api/import-share/visitors: آخرین فایل و زمان آخرین ورود هر ویزیتور؛ فقط ویزیتورهای همین داروخانه", async () => {
            needSeed();
            const list = await candsOf("B");
            const dbIds = await pool.query("SELECT id FROM visitors WHERE tenant_id = $1", [tenantB]);
            const want = new Set(dbIds.rows.map((r) => String(r.id)));
            const got = new Set(list.map((v) => v.id));
            const a = list.find((v) => v.id === ids.vA);
            const b = list.find((v) => v.id === ids.vB);
            const c = list.find((v) => v.id === ids.vC);
            const pass =
              want.size === got.size && [...want].every((x) => got.has(x)) &&
              a?.lastFileName === "لیست قیمت داروسازان ۱۴۰۵-۰۶.xlsx" && listAgeInfo(a?.lastImportAt).ageDays === 12 &&
              b?.lastFileName === null && b?.lastImportAt === null &&
              c?.lastFileName === "گستر.pdf" && listAgeInfo(c?.lastImportAt).ageDays === 3;
            return { pass, detail: pass ? "داروسازان: فایل قبلی و ۱۲ روز؛ البرز: بدون فایل؛ سلامت گستر: فقط فایل (۳ روز)؛ هیچ ویزیتور بیگانه‌ای نیامد" : `تعداد=${got.size}/${want.size} A=${a?.lastFileName}/${a?.lastImportAt} B=${b?.lastFileName}/${b?.lastImportAt} C=${c?.lastFileName}/${c?.lastImportAt}` };
          });

          // ---------- ۶۶) تشخیص روی داده‌ی زنده ----------
          await test("۶۶) تشخیص ویزیتور روی فهرست واقعیِ همین داروخانه (نام فایل‌های واقع‌گرایانه)", async () => {
            needSeed();
            const list = await candsOf("B");
            const a = detectVisitor("لیست قیمت داروسازان ۱۴۰۵-۰۷.xlsx", list);
            const b = detectVisitor("قیمت پخش البرز ۰۷.pdf", list);
            const c = detectVisitor("سلامت-گستر.xls", list);
            const d = detectVisitor("unknown_123.xlsx", list);
            const pass =
              a.status === "sure" && a.best?.visitor.id === ids.vA && b.status === "sure" && b.best?.visitor.id === ids.vB &&
              c.status === "sure" && c.best?.visitor.id === ids.vC && d.status === "none";
            return { pass, detail: pass ? "هر سه نام فایل به ویزیتور درست رسید و نام ناشناس «ناشناس» ماند" : JSON.stringify({ a: [a.status, a.best?.visitor.name], b: [b.status, b.best?.visitor.name], c: [c.status, c.best?.visitor.name], d: d.status }) };
          });

          // ---------- ۶۷) ثبت با مسیر ورود فعلی ----------
          await test("۶۷) ثبت با همان مسیر ورود فعلی: جدید/به‌روز/ناموجود و جایگزینی لیست قبلی در ورود دوم", async () => {
            needSeed();
            const nA = `اشتراک الف ${stamp}`;
            const nB = `اشتراک ب ${stamp}`;
            const nC = `اشتراک ج ${stamp}`;
            const nD = `اشتراک د ${stamp}`;
            const row = (name: string, price: number) => ({ name, price, qty: 5, unit: "عدد" });
            const first = await asB(() => importVisitorListAction({ visitorId: ids.vB as string, rows: [row(nA, 1000), row(nB, 2000), row(nC, 3000)] }));
            const second = await asB(() => importVisitorListAction({ visitorId: ids.vB as string, rows: [row(nA, 1500), row(nD, 4000)] }));
            const db = await pool.query(
              "SELECT p.name AS n, vp.stock AS s, vp.price AS pr FROM visitor_products vp JOIN products p ON p.id = vp.product_id WHERE vp.tenant_id = $1 AND vp.visitor_id = $2",
              [tenantB, ids.vB]
            );
            // مقدار خام pg به عدد/متن نرمال می‌شود (ستون‌های عددی ممکن است رشته برگردند)
            const rowOf = (name: string) => db.rows.find((r) => String(r.n) === name);
            const priceOf = (name: string) => {
              const r = rowOf(name);
              return r ? Number(r.pr) : null;
            };
            const stockOf = (name: string) => {
              const r = rowOf(name);
              return r ? String(r.s) : null;
            };
            // هر شرط: [نام، انتظار، مقدار واقعی]
            const checks: Array<[string, unknown, unknown]> = [
              ["ورود اول ok", true, first.ok],
              ["ورود اول: کالای جدید", 3, first.newProducts],
              ["ورود دوم ok", true, second.ok],
              ["ورود دوم: کالای جدید", 1, second.newProducts],
              ["ورود دوم: به‌روز", 1, second.updated],
              ["ورود دوم: ناموجود", 2, second.markedOut],
              ["قیمت «الف» بعد از ورود دوم", 1500, priceOf(nA)],
              ["موجودی «الف»", "in", stockOf(nA)],
              ["موجودی «ب» (در لیست دوم نیست)", "out", stockOf(nB)],
              ["موجودی «ج» (در لیست دوم نیست)", "out", stockOf(nC)],
              ["قیمت «د» (کالای تازه)", 4000, priceOf(nD)],
              ["موجودی «د»", "in", stockOf(nD)],
              ["تعداد ردیف‌های این ویزیتور", 4, db.rows.length],
            ];
            const bad = checks.filter(([, want, got]) => want !== got);
            return {
              pass: bad.length === 0,
              detail:
                bad.length === 0
                  ? "ورود اول ۳ کالای جدید؛ ورود دوم ۱ جدید، ۱ به‌روز، ۲ ناموجود؛ قیمت و موجودی همه‌ی ردیف‌ها درست (لیست قبلی جایگزین شد)"
                  : bad.map(([n, want, got]) => `${n}: انتظار ${JSON.stringify(want)}، واقعی ${JSON.stringify(got)}`).join(" | "),
            };
          });

          // ---------- ۶۸) جداسازی tenant ----------
          await test("۶۸) جداسازی داروخانه‌ها: ویزیتور داروخانه‌ی دیگر در تشخیص نمی‌آید", async () => {
            needSeed();
            const asBList = await candsOf("B");
            const asAList = await candsOf("A");
            const leaked = asBList.some((v) => v.id === ids.decoy || v.name === decoyName);
            const aSees = asAList.some((v) => v.id === ids.decoy);
            const det = detectVisitor(`لیست قیمت ${decoyName}.xlsx`, asBList);
            const pass = !leaked && aSees && !(det.best && det.best.visitor.id === ids.decoy);
            return { pass, detail: pass ? "ویزیتور طعمه‌ی A فقط برای خودش دیده شد و در فهرستِ B و تشخیص آن نیامد" : `نشت به B=${leaked} | A دید=${aSees}` };
          });
        } finally {
          await pool.query("DELETE FROM catalog_files WHERE file_key LIKE $1", [`selftest/share-%-${stamp}`]).catch(() => undefined);
          if (ids.decoy) await pool.query("DELETE FROM visitors WHERE id = $1 AND tenant_id = $2", [ids.decoy, A]).catch(() => undefined);
          await pool.query("DELETE FROM visitors WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantB, [ids.vA, ids.vB, ids.vC].filter(Boolean)]).catch(() => undefined);
          await pool.query("DELETE FROM products WHERE tenant_id = $1", [tenantB]).catch(() => undefined);
        }
      }

      // ================= آزمون «دفعه‌ی قبل» و یادداشت ویزیتور (stage=history) =================
      // داده‌ی ساختگی فقط در داروخانه‌ی آزمایشی B (و یک سفارش/یادداشت طعمه با نام یکتا در A برای آزمون جداسازی)؛ همه در finally پاک می‌شود.
      if (stage === "history") {
        const tenantB = S.userB as string;
        const adminTok = request.cookies.get(AUTH_COOKIE)?.value;
        const adminTid = request.cookies.get("pharma_tid")?.value;
        const store = await cookies();
        const opts = { sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };
        const VN = [1, 2, 3, 4].map((i) => `SELFTEST-B-H${i}-${stamp}`);
        const P1 = "شامپو تاریخچه ۴۰۰";
        const P2 = "کرم تاریخچه 200";
        const P2_ORDER_NAME = "\u0662\u0660\u0660 \u0643\u0631\u0645 \u062A\u0627\u0631\u064A\u062E\u0686\u0647"; // «٢٠٠ كرم تاريخچه» با ارقام و حروف عربی و ترتیب متفاوت
        const P3 = "قطره بی‌سابقه تاریخچه";
        const FINAL_NOTE = "۶+۱، ۱۰٪ نقد، چک ۲ ماهه";
        const DECOY_NOTE = `یادداشت طعمه ${stamp}`;
        const ids: { v: string[]; o3?: string; decoyV?: string; decoyO?: string } = { v: [] };
        let seedErr: string | null = null;
        let orderSeq = 9001;
        try {
          const mkVisitor = async (tenant: string, name: string, note: string | null = null) =>
            String((await pool.query("INSERT INTO visitors (tenant_id, name, note_terms) VALUES ($1, $2, $3) RETURNING id", [tenant, name, note])).rows[0].id);
          const mkProduct = async (name: string) =>
            String((await pool.query("INSERT INTO products (tenant_id, name) VALUES ($1, $2) RETURNING id", [tenantB, name])).rows[0].id);
          const link = async (vid: string, pid: string, price: number) =>
            pool.query(
              "INSERT INTO visitor_products (tenant_id, visitor_id, product_id, stock, price, qty, unit, last_import_id) VALUES ($1, $2, $3, 'in', $4, 10, 'عدد', $5)",
              [tenantB, vid, pid, price, crypto.randomUUID()]
            );
          const mkOrder = async (tenant: string, vid: string, daysAgo: number, items: Array<[string, number]>, opt: { deleted?: boolean; status?: string; orderNo?: number } = {}) => {
            const oid = String(
              (
                await pool.query(
                  "INSERT INTO orders (tenant_id, visitor_id, status, order_no, created_at, deleted_at) VALUES ($1, $2, $3, $4, now() - make_interval(hours => $5::int), CASE WHEN $6::boolean THEN now() ELSE NULL END) RETURNING id",
                  [tenant, vid, opt.status ?? "registered", opt.orderNo ?? orderSeq++, daysAgo * 24 + 1, Boolean(opt.deleted)]
                )
              ).rows[0].id
            );
            for (const [name, price] of items) {
              await pool.query("INSERT INTO order_items (tenant_id, order_id, product_name, qty, unit_price) VALUES ($1, $2, $3, 1, $4)", [tenant, oid, name, price]);
            }
            return oid;
          };
          for (const n of VN) ids.v.push(await mkVisitor(tenantB, n));
          const [Va, Vb, Vc, Vd] = ids.v;
          const p1 = await mkProduct(P1);
          const p2 = await mkProduct(P2);
          const p3 = await mkProduct(P3);
          // قیمت‌های فعلی P1 نسبت به آخرین خرید ۱۲۰٬۰۰۰: +۵٪ دقیق، +۵٫۸٪، −۵٫۸٪، −۴٪
          await link(Va, p1, 126000);
          await link(Vb, p1, 127000);
          await link(Vc, p1, 113000);
          await link(Vd, p1, 115200);
          await link(Va, p2, 70000);
          await link(Va, p3, 30000);
          await mkOrder(tenantB, Va, 50, [[P1, 90000]]);
          await mkOrder(tenantB, Vc, 30, [[P1, 100000]]);
          ids.o3 = await mkOrder(tenantB, Vb, 12, [[P1, 120000]]); // آخرین خرید معتبر
          await mkOrder(tenantB, Va, 2, [[P1, 50000]], { deleted: true }); // سطل بازیافت
          await mkOrder(tenantB, Vc, 1, [[P1, 70000]], { status: "cancelled" }); // لغوشده
          await mkOrder(tenantB, Va, 3, [[P1, 0]]); // قیمت ثبت‌نشده
          await mkOrder(tenantB, Vb, 5, [[P2_ORDER_NAME, 80000]]);
          ids.decoyV = await mkVisitor(A, `SELFTEST-A-H-${stamp}`, DECOY_NOTE);
          ids.decoyO = await mkOrder(A, ids.decoyV, 1, [[P1, 1]], { orderNo: 1_900_000_000 + Math.floor(Math.random() * 1_000_000) });
        } catch (e) {
          seedErr = errMsg(e);
        }
        clearSearchCache();
        clearHistoryCache();
        const needSeed = () => {
          if (seedErr) throw new Error(`آماده‌سازی داده‌ی آزمایشی ناموفق: ${seedErr} — اگر «note_terms» نیست، مهاجرت ۰۲۲ را اجرا کنید`);
        };
        const asB = async <T>(fn: () => Promise<T>): Promise<T> => {
          try {
            const tokB = await signSession({ sub: tenantB, tid: tenantB, role: "owner", email: S.emailB as string });
            store.set(AUTH_COOKIE, tokB, { ...opts, httpOnly: true });
            store.set("pharma_tid", tenantB, { ...opts, httpOnly: false });
            return await fn();
          } finally {
            if (adminTok) store.set(AUTH_COOKIE, adminTok, { ...opts, httpOnly: true });
            if (adminTid) store.set("pharma_tid", adminTid, { ...opts, httpOnly: false });
          }
        };
        const searchB = async (q: string): Promise<{ products: Json[]; terms: Record<string, string> }> =>
          asB(async () => {
            const res = await searchGET(new NextRequest(`${origin}/api/search?q=${encodeURIComponent(q)}`));
            const j = await getJson(res);
            if (res.status !== 200) throw new Error(`/api/search کد ${res.status}: ${String(j.error ?? "")}`);
            return { products: (j.products ?? []) as Json[], terms: (j.terms ?? {}) as Record<string, string> };
          });
        const hitOf = (rows: Json[], visitorName: string) => rows.find((r) => r.visitorName === visitorName);
        const noteOf = async (vid: string) => (await pool.query("SELECT note_terms FROM visitors WHERE id = $1", [vid])).rows[0]?.note_terms as string | null;
        try {
          // ---------- ۶۹) آخرین خرید ----------
          await test("۶۹) «دفعه‌ی قبل»: آخرین خرید واقعی (ویزیتور، قیمت، سن) از بین چند سفارش، برای همه‌ی ردیف‌های نتیجه", async () => {
            needSeed();
            const { products } = await searchB(P1);
            const bad = products.filter((h) => !(h.lastBuy?.visitorName === VN[1] && h.lastBuy?.price === 120000 && h.lastBuy?.ageDays === 12));
            const pass = products.length === 4 && bad.length === 0;
            return { pass, detail: pass ? "هر ۴ ردیف نتیجه: آخرین خرید = ویزیتور دوم، ۱۲۰٬۰۰۰، ۱۲ روز پیش (سفارش‌های ۳۰ و ۵۰ روزه قدیمی‌ترند)" : `نتیجه=${products.length} (انتظار ۴) | ناسازگار: ${JSON.stringify(bad.map((h) => [h.visitorName, h.lastBuy]))}` };
          });

          // ---------- ۷۰) سطل بازیافت و لغوشده ----------
          await test("۷۰) سفارش حذف‌شده (سطل)، لغوشده و ردیف بدون قیمت حساب نمی‌شود", async () => {
            needSeed();
            const first = hitOf((await searchB(P1)).products, VN[0]);
            await pool.query("UPDATE orders SET deleted_at = now() WHERE id = $1", [ids.o3]);
            clearHistoryCache();
            const afterTrash = hitOf((await searchB(P1)).products, VN[0]);
            await pool.query("UPDATE orders SET deleted_at = NULL, status = 'cancelled' WHERE id = $1", [ids.o3]);
            clearHistoryCache();
            const afterCancel = hitOf((await searchB(P1)).products, VN[0]);
            await pool.query("UPDATE orders SET status = 'registered' WHERE id = $1", [ids.o3]);
            clearHistoryCache();
            const restored = hitOf((await searchB(P1)).products, VN[0]);
            const ok = (h: Json | undefined, v: string, p: number, d: number) => h?.lastBuy?.visitorName === v && h?.lastBuy?.price === p && h?.lastBuy?.ageDays === d;
            const pass = ok(first, VN[1], 120000, 12) && ok(afterTrash, VN[2], 100000, 30) && ok(afterCancel, VN[2], 100000, 30) && ok(restored, VN[1], 120000, 12);
            return { pass, detail: pass ? "با سفارشِ ۱۲ روزه در سطل یا لغوشده، خرید ۳۰ روزه (۱۰۰٬۰۰۰) آخرین می‌شود؛ بعد از برگشت دوباره ۱۲۰٬۰۰۰؛ سفارش‌های ۲ و ۱ روزه (سطل/لغو) و ردیف بدون قیمت هیچ‌وقت حساب نشد" : JSON.stringify({ first: first?.lastBuy, afterTrash: afterTrash?.lastBuy, afterCancel: afterCancel?.lastBuy, restored: restored?.lastBuy }) };
          });

          // ---------- ۷۱) املای متفاوت ----------
          await test("۷۱) اسم کالا با املای متفاوت (ي/ك، ارقام عربی، ترتیب کلمه‌ها) به همان سابقه می‌رسد", async () => {
            needSeed();
            const { products } = await searchB(P2);
            const h = hitOf(products, VN[0]);
            const pass = h?.lastBuy?.visitorName === VN[1] && h?.lastBuy?.price === 80000 && h?.lastBuy?.ageDays === 5;
            return { pass, detail: pass ? "«٢٠٠ كرم تاريخچه» (در سفارش) به «کرم تاریخچه 200» (محصول) رسید: ویزیتور دوم، ۸۰٬۰۰۰، ۵ روز پیش" : `نتیجه=${JSON.stringify(h?.lastBuy)} تعداد=${products.length}` };
          });

          // ---------- ۷۲) نشان گران/ارزان ----------
          await test("۷۲) نشان «گران‌تر/ارزان‌تر شد» فقط بیش از ۵٪؛ دقیقاً ۵٪ و کمتر بدون نشان", async () => {
            needSeed();
            const { products } = await searchB(P1);
            const t = (i: number) => hitOf(products, VN[i])?.trend ?? null;
            const bounds = [priceTrend(105, 100), priceTrend(106, 100), priceTrend(95, 100), priceTrend(94, 100), priceTrend(100, 0), priceTrend(null, 100)].map(String).join(",");
            const pass = t(0) === null && t(1) === "up" && t(2) === "down" && t(3) === null && bounds === "null,up,null,down,null,null";
            return { pass, detail: pass ? "+۵٪ دقیق: بدون نشان؛ +۵٫۸٪: گران‌تر؛ −۵٫۸٪: ارزان‌تر؛ −۴٪: بدون نشان" : `ترند: ${[0, 1, 2, 3].map((i) => `${i}=${t(i)}`).join(" ")} مرزها=${bounds}` };
          });

          // ---------- ۷۳) بدون سابقه ----------
          await test("۷۳) کالای بدون سابقه‌ی خرید: چیزی برنمی‌گردد (نه خط «قبلاً»، نه نشان)", async () => {
            needSeed();
            const { products } = await searchB(P3);
            const h = hitOf(products, VN[0]);
            const pass = products.length === 1 && h?.lastBuy === null && h?.trend === null;
            return { pass, detail: pass ? "lastBuy و trend هر دو null" : `نتیجه=${products.length} lastBuy=${JSON.stringify(h?.lastBuy)} trend=${h?.trend}` };
          });

          // ---------- ۷۴) ذخیره‌ی یادداشت ----------
          await test("۷۴) یادداشت ویزیتور: ذخیره، حداکثر ۵۰۰ نویسه، رد بیش از ۵۰۰، پاک‌کردن با متن خالی", async () => {
            needSeed();
            const v = ids.v[1];
            const save = (note: string) => asB(() => updateVisitorTermsAction({ id: v, note }));
            const r1 = await save(FINAL_NOTE);
            const db1 = await noteOf(v);
            const over = await save("ب".repeat(501));
            const dbOver = await noteOf(v);
            const r500 = await save("ب".repeat(500));
            const db500 = await noteOf(v);
            const empty = await save("   ");
            const dbEmpty = await noteOf(v);
            const rFinal = await save(FINAL_NOTE);
            const dbFinal = await noteOf(v);
            const checks: Array<[string, unknown, unknown]> = [
              ["ذخیره‌ی متن فارسی ok", true, r1.ok],
              ["متن ذخیره‌شده", FINAL_NOTE, db1],
              ["۵۰۱ نویسه رد شد", false, over.ok],
              ["بعد از ردِ ۵۰۱ متن قبلی ماند", FINAL_NOTE, dbOver],
              ["۵۰۰ نویسه ok", true, r500.ok],
              ["طول ذخیره‌شده‌ی ۵۰۰", 500, db500 ? [...db500].length : null],
              ["متن خالی ok", true, empty.ok],
              ["متن خالی = پاک (null)", null, dbEmpty],
              ["ذخیره‌ی نهایی ok", true, rFinal.ok],
              ["متن نهایی", FINAL_NOTE, dbFinal],
            ];
            const bad = checks.filter(([, want, got]) => want !== got);
            return { pass: bad.length === 0, detail: bad.length === 0 ? "ذخیره، ۵۰۰ مجاز، ۵۰۱ رد (متن قبلی دست‌نخورده)، خالی = پاک" : bad.map(([n, w, g]) => `${n}: انتظار ${JSON.stringify(w)}، واقعی ${JSON.stringify(g)}`).join(" | ") };
          });

          // ---------- ۷۵) یادداشت در جستجو و لیست خرید ----------
          await test("۷۵) یادداشت در نتایج جستجو و در لیست خرید برمی‌گردد (به‌همراه «دفعه‌ی قبل» و نشان)", async () => {
            needSeed();
            const { products, terms } = await searchB(P1);
            const hb = hitOf(products, VN[1]);
            if (!hb) throw new Error("ردیف ویزیتور دوم در نتایج نیست");
            const add = await asB(() => addToBasketAction({ conditionId: String(hb.conditionId) }));
            const items = await asB(async () => {
              const res = await basketGET();
              return ((await getJson(res)).items ?? []) as BasketItem[];
            });
            const it = items.find((x) => x.productName === P1);
            const g = groupBasket(items).find((x) => x.visitorId === ids.v[1]);
            const pass =
              terms[ids.v[1]] === FINAL_NOTE && Object.keys(terms).every((k) => ids.v.includes(k)) && add.ok === true &&
              it?.visitorNote === FINAL_NOTE && it?.lastBuy?.price === 120000 && it?.trend === "up" && g?.note === FINAL_NOTE;
            return { pass, detail: pass ? "جستجو: یادداشت ویزیتور دوم؛ لیست خرید: یادداشت گروه، «قبلاً ۱۲۰٬۰۰۰» و نشان «گران‌تر» (۱۲۷٬۰۰۰)" : `terms=${JSON.stringify(terms)} add=${JSON.stringify(add)} یادداشت=${it?.visitorNote} lastBuy=${JSON.stringify(it?.lastBuy)} trend=${it?.trend} گروه=${g?.note}` };
          });

          // ---------- ۷۶) جداسازی tenant ----------
          await test("۷۶) جداسازی داروخانه‌ها: سابقه و یادداشت داروخانه‌ی دیگر دیده یا تغییر داده نمی‌شود", async () => {
            needSeed();
            const decoyRows = await pool.query("SELECT (SELECT count(*)::int FROM orders WHERE id = $1) AS o, (SELECT note_terms FROM visitors WHERE id = $2) AS n", [ids.decoyO, ids.decoyV]);
            const { products, terms } = await searchB(P1);
            const leakedPrice = products.some((h) => h.lastBuy?.price === 1 || h.lastBuy?.visitorName === `SELFTEST-A-H-${stamp}`);
            const leakedNote = Object.values(terms).some((t) => t === DECOY_NOTE);
            const write = await asB(() => updateVisitorTermsAction({ id: ids.decoyV as string, note: "تغییر بیگانه" }));
            const after = await noteOf(ids.decoyV as string);
            const pass = decoyRows.rows[0].o === 1 && decoyRows.rows[0].n === DECOY_NOTE && !leakedPrice && !leakedNote && write.ok === false && after === DECOY_NOTE;
            return { pass, detail: pass ? "سفارش (قیمت ۱) و یادداشت داروخانه‌ی A فقط برای خودش ماند؛ در جستجوی B نیامد و تغییرش از نشست B رد شد" : `طعمه سر جاست=${decoyRows.rows[0].o}/${decoyRows.rows[0].n} | نشت قیمت=${leakedPrice} | نشت یادداشت=${leakedNote} | تغییر=${JSON.stringify(write)} | یادداشت فعلی=${after}` };
          });
        } finally {
          if (ids.decoyV) await pool.query("DELETE FROM visitors WHERE id = $1 AND tenant_id = $2", [ids.decoyV, A]).catch(() => undefined);
          if (ids.v.length) await pool.query("DELETE FROM visitors WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantB, ids.v]).catch(() => undefined);
          await pool.query("DELETE FROM products WHERE tenant_id = $1", [tenantB]).catch(() => undefined);
          clearSearchCache();
          clearHistoryCache();
        }
      }
    }
  } finally {
    // ---------- پاک‌سازی (همیشه) ----------
    let cleanup: { pass: boolean; detail: string };
    try {
      await restoreProfile(); // شبکه‌ی اطمینان: اگر آزمون ۹ وسط کار خطا داد
      await withTx("admin", A, async (c) => {
        await c.query("DELETE FROM orders WHERE tenant_id = $1 AND note = $2", [A, NOTE]);
        await c.query("DELETE FROM visitors WHERE tenant_id = $1 AND name LIKE 'SELFTEST-%'", [A]);
        if (counterBefore === null) await c.query("DELETE FROM order_counters WHERE tenant_id = $1", [A]);
        else if (typeof counterBefore === "number") await c.query("UPDATE order_counters SET last_no = $2 WHERE tenant_id = $1", [A, counterBefore]);
      });
      await pool.query("DELETE FROM users WHERE email LIKE $1", [EMAIL_PATTERN]);
      // داده‌ی آزمون‌های امنیتی (با اتصال ممتاز؛ نقش app_runtime اجازه‌ی حذف audit_log را ندارد)
      const hasSec = (await pool.query("SELECT to_regclass('public.audit_log') AS a, to_regclass('public.rate_limits') AS r")).rows[0] as Json;
      if (hasSec?.a && (S.auditTargets ?? []).length > 0) await pool.query("DELETE FROM audit_log WHERE target_id = ANY($1::text[])", [S.auditTargets]);
      if ((await pool.query("SELECT to_regclass('public.error_log') AS e")).rows[0]?.e) await pool.query("DELETE FROM error_log WHERE place LIKE 'selftest-err-%'");
      if (hasSec?.r && (S.rlKeys ?? []).length > 0) await pool.query("DELETE FROM rate_limits WHERE key = ANY($1::text[])", [S.rlKeys]);
      const left = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM users WHERE email LIKE $1) AS users,
           (SELECT count(*)::int FROM orders WHERE tenant_id = $2::uuid AND note = $3) AS orders_a,
           (SELECT count(*)::int FROM visitors WHERE tenant_id = $2::uuid AND name LIKE 'SELFTEST-%') AS visitors_a,
           (SELECT count(*)::int FROM visitors WHERE name LIKE 'SELFTEST-B-%') AS visitors_b,
           (SELECT count(*)::int FROM orders WHERE note = $3 AND tenant_id <> $2::uuid) AS orders_b,
           (SELECT last_no FROM order_counters WHERE tenant_id = $2::uuid) AS counter_a`,
        [EMAIL_PATTERN, A, NOTE]
      );
      const r = left.rows[0] as Json;
      const counterOk = counterBefore === undefined ? true : counterBefore === null ? r.counter_a == null : Number(r.counter_a) === counterBefore;
      const leftover = Number(r.users) + Number(r.orders_a) + Number(r.visitors_a) + Number(r.visitors_b) + Number(r.orders_b);
      let profileOk = true;
      if (P.orig) {
        const o = P.orig;
        const x = await dbOne("SELECT status, trial_ends_at, subscription_ends_at FROM profiles WHERE id = $1", [A]);
        const t = (d: Date | null | undefined) => (d ? new Date(d).getTime() : null);
        profileOk = x?.status === o.status && t(x?.trial_ends_at) === t(o.trial_ends_at) && t(x?.subscription_ends_at) === t(o.subscription_ends_at);
      }
      cleanup = {
        pass: leftover === 0 && counterOk && profileOk,
        detail:
          leftover === 0 && counterOk && profileOk
            ? "همه‌ی داده‌ی آزمایشی پاک شد؛ شمارنده‌ی A به مقدار قبل برگشت (پروفایل مدیر واقعی هرگز تغییر داده نمی‌شود)"
            : `باقی‌مانده: ${JSON.stringify(r)} اشتراک‌مدیر‌برگشت=${profileOk} اصل=${JSON.stringify(P.orig)} — پاک‌سازی دستی: DELETE FROM users WHERE email LIKE '${EMAIL_PATTERN}'; DELETE FROM orders WHERE note = '${NOTE}'; DELETE FROM visitors WHERE name LIKE 'SELFTEST-%';`,
      };
    } catch (e) {
      cleanup = { pass: false, detail: `پاک‌سازی ناموفق: ${errMsg(e)} اصلِ اشتراک مدیر=${JSON.stringify(P.orig)} — دستی: DELETE FROM users WHERE email LIKE '${EMAIL_PATTERN}'; DELETE FROM orders WHERE note = '${NOTE}'; DELETE FROM visitors WHERE name LIKE 'SELFTEST-%';` };
    }
    results.push({ name: "پاک‌سازی داده‌ی آزمایشی", ...cleanup });
    await pool.end().catch(() => undefined);
    await lockClient.end().catch(() => undefined); // بسته شدن اتصال، قفل را آزاد می‌کند
  }

  const passed = results.filter((r) => r.pass).length;
  const skipped = results.filter((r) => r.skipped).length;
  const warnings = results.filter((r) => r.warning).length + (adminProfileWarning ? 1 : 0);
  const failed = results.length - passed - skipped;
  const expected = stage === "old" ? 15 : stage === "new" ? 8 : stage === "app" ? 5 : stage === "sec" ? 16 : stage === "search" ? 11 : stage === "basket" ? 10 : stage === "share" ? 10 : stage === "history" ? 9 : 22;
  const ok = !setupError && failed === 0 && results.length >= expected;
  return NextResponse.json({
    ok,
    // کامل = بدون شکست، بدون «اجرا نشد» و بدون هشدار (یعنی برنامه با نقش app_runtime کار می‌کند و همه چیز راستی‌آزمایی شد)
    complete: ok && skipped === 0 && warnings === 0,
    passed,
    failed,
    skipped,
    warnings,
    stage,
    ...(adminProfileWarning ? { adminProfileWarning } : {}),
    totalMs: Date.now() - t0All,
    ...(setupError ? { setupError } : {}),
    tests: results,
  });
}

function errMsg(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as { cause?: unknown }).cause;
    return cause instanceof Error ? `${e.message} | علت: ${cause.message}` : e.message;
  }
  return String(e);
}
