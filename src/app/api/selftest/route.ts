import { NextRequest, NextResponse } from "next/server";
import { Client, Pool, type PoolClient } from "pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin, signSession } from "@/lib/auth";
import { AUTH_COOKIE } from "@/lib/config";
import { ensureDb } from "@/db/bootstrap";
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
 * آزمون ۹: وضعیت اشتراک پروفایل مدیر موقتاً «آزمایشی-منقضی» می‌شود (commit می‌شود تا اکشن‌های
 *   واقعی ببینند) و در finally حتماً به مقدار اصلی برمی‌گردد؛ مقدار قبلی در پاک‌سازی هم بررسی می‌شود.
 */
export const dynamic = "force-dynamic";

const POOL_MAX = 5; // + یک اتصال برنامه = سقف ۶ اتصال هم‌زمان در Workers
const EMAIL_PATTERN = "selftest-%@invalid.test";
const NOTE = "SELFTEST";
const LOCK_ID = 7270001;

type Row = { name: string; pass: boolean; detail: string };
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
  const url = process.env.DATABASE_URL;
  if (!url) {
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

  async function test(name: string, fn: () => Promise<{ pass: boolean; detail: string }>) {
    try {
      const r = await fn();
      results.push({ name, pass: r.pass, detail: r.detail });
    } catch (e) {
      results.push({ name, pass: false, detail: `خطا: ${errMsg(e)}` });
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
  const failed = results.length - passed;
  return NextResponse.json({
    ok: !setupError && failed === 0 && results.length >= 10,
    passed,
    failed,
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
