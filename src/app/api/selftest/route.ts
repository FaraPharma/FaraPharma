import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Client, Pool, type PoolClient } from "pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin, signSession } from "@/lib/auth";
import { AUTH_COOKIE } from "@/lib/config";
import { ensureDb } from "@/db/bootstrap";
import { diffSchema } from "@/db/schema-check";
import { APP_ROLE, listPendingMigrations, runMigrations } from "@/db/migrations";
import { pool as appPool } from "@/db/pool";
import { registerAction } from "@/actions/auth";
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
  // ?stage=old فقط ۱ تا ۱۴؛ ?stage=new فقط ۱۵ تا ۲۱؛ ?stage=app تشخیص خطاهای نقش app_runtime (۲۲ تا ۲۵)؛ پیش‌فرض: ۱ تا ۲۱
  const stageParam = new URL(request.url).searchParams.get("stage");
  const stage = stageParam === "old" || stageParam === "new" || stageParam === "app" ? stageParam : "all";
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
  const S: { vA?: string; o1?: string; o2?: string; o3?: string; n1?: number; n2?: number; repeat?: string; userB?: string; emailB?: string; vB?: string } = {};
  let counterBefore: number | null | undefined; // undefined = هنوز خوانده نشده
  let setupError: string | null = null;
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
    await withTx("admin", A, async (c) => {
      await c.query("DELETE FROM orders WHERE tenant_id = $1 AND note = $2", [A, NOTE]);
      await c.query("DELETE FROM visitors WHERE tenant_id = $1 AND name LIKE 'SELFTEST-%'", [A]);
    });
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

      // ---------- ۹) مدیر از محدودیت اشتراک معاف است ----------
      await test("۹) مدیر با اشتراک آزمایشی-منقضی محدود نمی‌شود و بنر نمی‌بیند", async () => {
        const row = await dbOne("SELECT status, trial_ends_at, subscription_ends_at FROM profiles WHERE id = $1", [A]);
        P.orig = {
          status: String(row.status),
          trial_ends_at: row.trial_ends_at ?? null,
          subscription_ends_at: row.subscription_ends_at ?? null,
        };
        P.restored = false;
        try {
          await withTx("admin", A, (c) =>
            c.query("UPDATE profiles SET status = 'trial', trial_ends_at = now() - interval '30 days' WHERE id = $1", [A])
          );
          const dash = await dashA();
          const [lo, lc, lv] = await Promise.all([listA(), getJson(await chequesGET()), getJson(await visitorsGET())]);
          const write = await createOrderAction({ clientKey: newKey("admin-expired"), visitorId: S.vA as string, note: NOTE, items });
          const c = {
            profileReallyExpired: effectiveStatus(dash.profile) === "expired", // شرط آزمون: پروفایل واقعاً منقضی است
            roleIsAdmin: dash.role === "admin",
            roleInAllBannerApis: [dash.role, lo.role, lc.role, lv.role].every((x) => x === "admin"),
            bannerHiddenForAdmin: effectiveStatus(dash.profile, dash.role) === "active",
            ownerStillRestricted: effectiveStatus(dash.profile, "owner") === "expired",
            writeAllowed: write.ok === true,
          };
          const pass = Object.values(c).every(Boolean);
          return {
            pass,
            detail: pass
              ? "پروفایل مدیر آزمایشی-منقضی بود ولی ثبت سفارش مجاز ماند و منطق بنر برای مدیر «فعال» است (برای غیرمدیر همچنان منقضی)"
              : `ناموفق: ${JSON.stringify(c)}${write.ok ? "" : ` خطای ثبت=${write.error}`}`,
          };
        } finally {
          await restoreProfile();
        }
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
            ? "همه‌ی داده‌ی آزمایشی پاک شد؛ شمارنده‌ی A و وضعیت اشتراک مدیر به مقدار قبل برگشتند"
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
  const warnings = results.filter((r) => r.warning).length;
  const failed = results.length - passed - skipped;
  const expected = stage === "old" ? 15 : stage === "new" ? 8 : stage === "app" ? 5 : 22;
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
