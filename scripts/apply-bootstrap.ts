/**
 * Ops script: runs the idempotent bootstrap (tables, indexes, RLS policies,
 * admin seed, base-products seed) on the configured DATABASE_URL.
 * Usage: DATABASE_URL=... npx -y tsx scripts/apply-bootstrap.ts
 */
import { ensureDb } from "../src/db/bootstrap";
import { pool } from "../src/db/pool";

/**
 * چک خودکار هماهنگی schema با کد — هر ستون حیاتی که schema.ts انتظار دارد
 * باید در دیتابیس موجود باشد؛ در غیر این صورت هشدار داده میشود.
 * (اینجا فهرست را با آخرین نسخه schema.ts بهروز نگه دارید)
 */
const CRITICAL_COLUMNS: Record<string, string[]> = {
  users: ["disabled"],
  profiles: [
    "owner_user_id",
    "name",
    "status",
    "trial_ends_at",
    "subscription_ends_at",
    "cheque_warning_days",
  ],
  products: ["active", "is_short", "short_at"],
  visitors: ["messenger_username"],
  visitor_products: ["stock", "cash_discount_pct", "check_days", "price"],
  visitor_product_history: [
    "stock",
    "cash_discount_pct",
    "check_days",
    "valid_until",
    "price",
  ],
  catalog_files: [
    "visitor_id",
    "file_name",
    "file_key",
    "mime_type",
    "size_bytes",
    "status",
    "created_at",
  ],
  price_responses: [
    "product_id",
    "stock",
    "cash_discount_pct",
    "check_days",
    "responded_at",
  ],
  orders: ["created_at", "settlement_type", "settlement_days"],
  order_items: ["qty", "unit_price", "discount_pct", "product_name"],
  cheques: ["last_notified_at"],
  quick_notes: ["body", "created_at"],
  login_attempts: ["email", "count", "locked_until"],
  push_subscriptions: ["endpoint", "p256dh", "auth"],
};

async function verifyCriticalColumns() {
  const missing: string[] = [];
  for (const [table, cols] of Object.entries(CRITICAL_COLUMNS)) {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1`,
      [table]
    );
    const present = new Set(rows.map((r) => String(r.column_name)));
    for (const c of cols) {
      if (!present.has(c)) missing.push(`${table}.${c}`);
    }
  }
  if (missing.length > 0) {
    console.log("SCHEMA_MISMATCH (در دیتابیس کم است):", missing.join(", "));
  } else {
    console.log("SCHEMA_SYNC: ✅ همه ستونهای حیاتی با کد هماهنگاند");
  }
}

async function main() {
  await ensureDb();
  await verifyCriticalColumns();
  const tables = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  console.log("TABLES:");
  for (const r of tables.rows) console.log(" -", r.tablename);

  const rls = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true ORDER BY tablename`
  );
  console.log(
    "RLS_ENABLED:",
    rls.rows.map((r) => r.tablename).join(", ")
  );

  const policies = await pool.query(
    `SELECT tablename, count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename ORDER BY tablename`
  );
  console.log("POLICIES:");
  for (const r of policies.rows) console.log(` - ${r.tablename}: ${r.n}`);

  const bp = await pool.query(
    `SELECT category, count(*)::int AS n FROM base_products GROUP BY category ORDER BY category`
  );
  console.log("BASE_PRODUCTS:", JSON.stringify(bp.rows));

  const users = await pool.query(`SELECT email, role FROM users`);
  console.log("USERS:", JSON.stringify(users.rows));

  await pool.end();
  console.log("DONE");
}

main().catch((e) => {
  console.error("BOOTSTRAP FAILED:", e);
  process.exit(1);
});
