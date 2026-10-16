import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { pool } from "./pool";
import { BASE_PRODUCTS } from "./base-products";

/**
 * Idempotent bootstrap: creates tables/indexes, enables Row Level Security
 * and installs the tenant + admin policies on every tenant-scoped table.
 * Also seeds an initial admin account (fresh database) and the shared
 * base_products catalog.
 *
 * RLS model (equivalent to Supabase RLS):
 *  - normal queries run with `SET LOCAL app.tenant_id = <tenant>` inside a
 *    transaction, so a policy only exposes rows of the caller's tenant.
 *  - `app.role = 'admin'` bypasses tenant checks entirely.
 *  - If the GUCs are not set, all rows are hidden (default-deny).
 *  - base_products is shared/read-only: SELECT allowed for everyone,
 *    mutations require the admin role.
 */

const TABLES_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- استقرارهای قدیمی‌تر ممکن است این ستون را نداشته باشند
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'trial',
  trial_ends_at timestamptz,
  subscription_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  company text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visitors_tenant_idx ON visitors (tenant_id);

ALTER TABLE visitors ADD COLUMN IF NOT EXISTS messenger_username text;

CREATE TABLE IF NOT EXISTS visitor_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visitor_notes_idx ON visitor_notes (tenant_id, visitor_id);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  category text NOT NULL DEFAULT 'cosmetic',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_tenant_idx ON products (tenant_id);
CREATE INDEX IF NOT EXISTS products_name_idx ON products (tenant_id, name);

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_short boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS short_at timestamptz;

CREATE TABLE IF NOT EXISTS visitor_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stock text NOT NULL DEFAULT 'in',
  cash_discount_pct integer NOT NULL DEFAULT 0,
  check_days integer NOT NULL DEFAULT 0,
  offer text,
  valid_until date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visitor_products_tenant_idx ON visitor_products (tenant_id, visitor_id);
CREATE UNIQUE INDEX IF NOT EXISTS visitor_products_uq ON visitor_products (tenant_id, visitor_id, product_id);

-- پاکسازی ستونهای ویژگی حذفشدهی استخراج هوش مصنوعی از PDF
ALTER TABLE visitor_products DROP COLUMN IF EXISTS unit;
-- قیمت لیست (تومان) — دادهی خود تنانت
ALTER TABLE visitor_products ADD COLUMN IF NOT EXISTS price integer;

CREATE TABLE IF NOT EXISTS visitor_product_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stock text NOT NULL DEFAULT 'in',
  cash_discount_pct integer NOT NULL DEFAULT 0,
  check_days integer NOT NULL DEFAULT 0,
  offer text,
  valid_until date,
  price integer,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visitor_product_history_idx ON visitor_product_history (tenant_id, visitor_id, product_id);

ALTER TABLE visitor_product_history ADD COLUMN IF NOT EXISTS price integer;

CREATE TABLE IF NOT EXISTS catalog_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_key text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/pdf',
  size_bytes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'stored',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- در برخی استقرارها catalog_files ممکن است view باشد (اسکیمای سفارشی)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'catalog_files') THEN
    CREATE INDEX IF NOT EXISTS catalog_files_idx ON catalog_files (tenant_id, visitor_id);
  END IF;
END $$;

-- CREATE TABLE IF NOT EXISTS بالا روی جدول‌های از قبل موجود هیچ ستونی اضافه نمی‌کند؛
-- این ALTER ها تضمین می‌کنند استقرارهای قدیمی‌تر هم به schema.ts فعلی برسند.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'catalog_files') THEN
    ALTER TABLE catalog_files ADD COLUMN IF NOT EXISTS file_key text NOT NULL DEFAULT '';
    ALTER TABLE catalog_files ADD COLUMN IF NOT EXISTS mime_type text NOT NULL DEFAULT 'application/pdf';
    ALTER TABLE catalog_files ADD COLUMN IF NOT EXISTS size_bytes integer NOT NULL DEFAULT 0;
    ALTER TABLE catalog_files ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'stored';
    ALTER TABLE catalog_files ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- پاکسازی ستونهای ویژگی حذفشدهی استخراج هوش مصنوعی از PDF
-- (فقط در صورتی که catalog_files جدول واقعی باشد)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'catalog_files') THEN
    ALTER TABLE catalog_files DROP COLUMN IF EXISTS ai_used;
    ALTER TABLE catalog_files DROP COLUMN IF EXISTS extracted_text;
    ALTER TABLE catalog_files DROP COLUMN IF EXISTS items;
    ALTER TABLE catalog_files DROP COLUMN IF EXISTS error;
    UPDATE catalog_files SET status = 'stored' WHERE status IS NULL OR status <> 'stored';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS price_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_requests_tenant_idx ON price_requests (tenant_id);

CREATE TABLE IF NOT EXISTS price_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES price_requests(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS price_request_items_idx ON price_request_items (tenant_id, request_id);

CREATE TABLE IF NOT EXISTS price_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES price_requests(id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  price integer,
  stock text,
  check_days integer,
  cash_discount_pct integer,
  offer text,
  responded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_responses_idx ON price_responses (tenant_id, request_id);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'registered',
  note text,
  settlement_type text NOT NULL DEFAULT 'cash',
  settlement_days integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_tenant_idx ON orders (tenant_id, created_at);
-- استقرارهای قدیمی‌تر ممکن است این دو ستون را نداشته باشند
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_type text NOT NULL DEFAULT 'cash';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_days integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  unit_price integer NOT NULL DEFAULT 0,
  discount_pct integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS order_items_idx ON order_items (tenant_id, order_id);

CREATE TABLE IF NOT EXISTS base_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'cosmetic',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS base_products_name_uq ON base_products (name);

CREATE TABLE IF NOT EXISTS quick_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quick_notes_tenant_idx ON quick_notes (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  count integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts (email);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subs_tenant_idx ON push_subscriptions (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS push_subs_endpoint_uq ON push_subscriptions (endpoint);

CREATE TABLE IF NOT EXISTS cheques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  visitor_name text NOT NULL,
  amount integer NOT NULL,
  due_date date NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  settled boolean NOT NULL DEFAULT false,
  settled_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cheques_tenant_idx ON cheques (tenant_id, due_date);

ALTER TABLE cheques ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

-- تنظیم هشدار سررسید چک (پیشفرض ۷ روز)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cheque_warning_days integer NOT NULL DEFAULT 7;
`;

/**
 * Idempotent migration for price_responses: adds product_id to old tables
 * (backfilling from the request's items), installs the FK and the new
 * per-product unique key. On fresh databases all statements are no-ops.
 */
const MIGRATIONS_DDL = `
ALTER TABLE price_responses ADD COLUMN IF NOT EXISTS product_id uuid;

UPDATE price_responses r SET product_id = sub.product_id
FROM (
  SELECT DISTINCT ON (request_id) request_id, product_id
  FROM price_request_items
  ORDER BY request_id, id
) sub
WHERE r.product_id IS NULL AND sub.request_id = r.request_id;

DELETE FROM price_responses WHERE product_id IS NULL;

ALTER TABLE price_responses ALTER COLUMN product_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'price_responses_product_fk'
  ) THEN
    ALTER TABLE price_responses
      ADD CONSTRAINT price_responses_product_fk
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS price_responses_uq;
CREATE UNIQUE INDEX IF NOT EXISTS price_responses_uq
  ON price_responses (tenant_id, request_id, visitor_id, product_id);
`;

/**
 * سازگارسازی اسکیمای سفارشی دیتابیس واقعی با اسکیمای متعارف اپ.
 * تمام عبارات additive هستند (ADD COLUMN IF NOT EXISTS + backfill محافظت‌شده)
 * و هیچ داده‌ای حذف نمی‌شود؛ حساب‌های ثبت‌نام‌شده بر اساس ایمیل حفظ و
 * به users لینک می‌شوند.
 */
const COMPAT_DDL = `
-- ستون‌های متعارف جدول profiles (در اسکیمای سفارشی ممکن است نباشند)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'trial';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_ends_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cheque_warning_days integer NOT NULL DEFAULT 7;

DO $$
BEGIN
  -- backfill name از ستونهای سفارشی
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='profiles' AND column_name='pharmacy_name') THEN
    UPDATE profiles SET name = pharmacy_name
      WHERE (name IS NULL OR name = '') AND pharmacy_name IS NOT NULL AND pharmacy_name <> '';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='profiles' AND column_name='owner_name') THEN
    UPDATE profiles SET name = owner_name
      WHERE (name IS NULL OR name = '') AND owner_name IS NOT NULL AND owner_name <> '';
  END IF;
  -- backfill status از subscription_status سفارشی (فقط وقتی status خالی است؛
  -- هرگز مقدار تنظیم‌شده‌ی status را بازنویسی نمی‌کند)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='profiles' AND column_name='subscription_status') THEN
    UPDATE profiles SET status = subscription_status
      WHERE subscription_status IN ('trial','active','expired')
        AND (status IS NULL OR status = '');
  END IF;
  -- backfill trial_ends_at برای وضعیت آزمایشی
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='profiles' AND column_name='subscription_ends_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='profiles' AND column_name='subscription_started_at') THEN
    UPDATE profiles SET trial_ends_at =
      COALESCE(subscription_ends_at, subscription_started_at + interval '7 days')
      WHERE status = 'trial' AND trial_ends_at IS NULL
        AND (subscription_ends_at IS NOT NULL OR subscription_started_at IS NOT NULL);
  END IF;
END $$;

-- لینک owner_user_id بر اساس ایمیل: حسابهای موجود حفظ میشوند
-- (فقط در اسکیمای ادغامشده که profiles ایمیل و password_hash دارد)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='profiles' AND column_name='email')
     AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='profiles' AND column_name='password_hash') THEN
    INSERT INTO users (id, email, password_hash, role)
    SELECT p.id, p.email, p.password_hash,
           CASE WHEN p.role = 'admin' THEN 'admin' ELSE 'owner' END
    FROM profiles p
    WHERE p.email IS NOT NULL AND p.email <> '' AND p.password_hash IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = p.email)
    ON CONFLICT DO NOTHING;

    UPDATE profiles p SET owner_user_id = u.id
    FROM users u
    WHERE p.email = u.email AND p.owner_user_id IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_owner_fk') THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_owner_fk
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ساخت پروفایل متعارف برای کاربرانی که ثبتنامشان ناتمام مانده
-- (دادههای موجود حفظ میشوند؛ فقط ردیفهای گمشده ساخته میشوند)
-- فقط در اسکیمای ادغامشده (profiles دارای email/password_hash) اجرا میشود
DO $$
DECLARE u RECORD;
  has_email boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='email'
  ) INTO has_email;
  IF NOT has_email THEN
    RETURN;
  END IF;
  PERFORM set_config('app.role', 'admin', true);
  FOR u IN
    SELECT id, email, password_hash FROM users
    WHERE NOT EXISTS (
      SELECT 1 FROM profiles p WHERE p.owner_user_id = users.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM profiles p WHERE p.email = users.email
    )
  LOOP
    INSERT INTO profiles (
      id, owner_user_id, name, email, password_hash, pharmacy_name,
      subscription_status, subscription_ends_at, status, trial_ends_at
    )
    VALUES (
      u.id,
      u.id,
      COALESCE(NULLIF(split_part(u.email, '@', 1), ''), 'داروخانه'),
      u.email,
      u.password_hash,
      COALESCE(NULLIF(split_part(u.email, '@', 1), ''), 'داروخانه'),
      'trial',
      now() + interval '7 days',
      'trial',
      now() + interval '7 days'
    );
  END LOOP;
END $$;

-- ستونهای متعارف products (اسکیمای سفارشی ممکن است فاقد برخی ستونها باشد)
ALTER TABLE products ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- ستونهای متعارف visitor_products (اسکیمای سفارشی نامهای متفاوتی دارد)
ALTER TABLE visitor_products ADD COLUMN IF NOT EXISTS stock text NOT NULL DEFAULT 'in';
ALTER TABLE visitor_products ADD COLUMN IF NOT EXISTS cash_discount_pct integer NOT NULL DEFAULT 0;
ALTER TABLE visitor_products ADD COLUMN IF NOT EXISTS check_days integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='visitor_products' AND column_name='stock_status') THEN
    UPDATE visitor_products SET stock = stock_status
      WHERE stock_status IN ('in','low','out') AND stock IS DISTINCT FROM stock_status;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='visitor_products' AND column_name='cash_discount') THEN
    UPDATE visitor_products SET cash_discount_pct = cash_discount
      WHERE cash_discount > 0 AND cash_discount_pct = 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='visitor_products' AND column_name='cheque_days') THEN
    UPDATE visitor_products SET check_days = cheque_days
      WHERE cheque_days > 0 AND check_days = 0;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- تطبیق کامل schema.ts با اسکیمای سفارشی دیتابیس واقعی
-- (همه تغییرات additive + تبدیل تایپ محافظتشده — بدون حذف داده)
-- ─────────────────────────────────────────────────────────────

-- order_items: کد qty/unit_price/discount_pct/product_name میخواهد
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty integer NOT NULL DEFAULT 1;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount_pct integer NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name text;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='order_items' AND column_name='quantity') THEN
    UPDATE order_items SET qty = quantity WHERE quantity > 0 AND qty = 1;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='order_items'
               AND column_name='unit_price' AND data_type='numeric') THEN
    ALTER TABLE order_items ALTER COLUMN unit_price TYPE integer USING unit_price::integer;
  END IF;
END $$;

-- orders: کد created_at میخواهد (اسکیمای سفارشی order_date دارد)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='orders' AND column_name='order_date') THEN
    UPDATE orders SET created_at = order_date
      WHERE order_date IS NOT NULL AND created_at = (
        SELECT min(created_at) FROM orders WHERE order_date IS NULL
      );
  END IF;
END $$;

-- ===== orders: شماره‌ی سفارش، کلید ثبت یکتا، حذف نرم (امن و تکرارپذیر) =====
SELECT pg_advisory_xact_lock(727001);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_no integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_key text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS order_counters (
  tenant_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  last_no integer NOT NULL DEFAULT 0
);

-- سفارش‌های بدون شماره: به ترتیب تاریخ ساخت، ادامه‌ی بیشترین شماره‌ی موجود
WITH base AS (
  SELECT tenant_id, COALESCE(max(order_no), 0) AS mx FROM orders GROUP BY tenant_id
), numbered AS (
  SELECT o.id,
         b.mx + row_number() OVER (PARTITION BY o.tenant_id ORDER BY o.created_at, o.id) AS rn
  FROM orders o JOIN base b ON b.tenant_id = o.tenant_id
  WHERE o.order_no IS NULL
)
UPDATE orders SET order_no = numbered.rn FROM numbered WHERE orders.id = numbered.id;

INSERT INTO order_counters (tenant_id, last_no)
  SELECT tenant_id, max(order_no) FROM orders GROUP BY tenant_id
  ON CONFLICT (tenant_id) DO UPDATE
    SET last_no = GREATEST(order_counters.last_no, EXCLUDED.last_no);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE order_no IS NULL) THEN
    ALTER TABLE orders ALTER COLUMN order_no SET NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_order_no_uq ON orders (tenant_id, order_no);
CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_client_key_uq ON orders (tenant_id, client_key);
CREATE INDEX IF NOT EXISTS orders_tenant_deleted_idx ON orders (tenant_id, deleted_at);

-- price_responses: کد stock/cash_discount_pct/check_days/responded_at میخواهد
ALTER TABLE price_responses ADD COLUMN IF NOT EXISTS stock text;
ALTER TABLE price_responses ADD COLUMN IF NOT EXISTS cash_discount_pct integer;
ALTER TABLE price_responses ADD COLUMN IF NOT EXISTS check_days integer;
ALTER TABLE price_responses ADD COLUMN IF NOT EXISTS responded_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='price_responses' AND column_name='stock_status') THEN
    UPDATE price_responses SET stock = stock_status
      WHERE stock_status IS NOT NULL AND stock IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='price_responses' AND column_name='cash_discount') THEN
    UPDATE price_responses SET cash_discount_pct = cash_discount::integer
      WHERE cash_discount IS NOT NULL AND cash_discount_pct IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='price_responses' AND column_name='cheque_days') THEN
    UPDATE price_responses SET check_days = cheque_days
      WHERE cheque_days IS NOT NULL AND check_days IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='price_responses' AND column_name='created_at') THEN
    UPDATE price_responses SET responded_at = created_at
      WHERE created_at IS NOT NULL;
  END IF;
END $$;

-- visitor_products.valid_until: در اسکیمای سفارشی timestamptz است، کد date میخواهد
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='visitor_products'
               AND column_name='valid_until' AND data_type='timestamp with time zone') THEN
    ALTER TABLE visitor_products ALTER COLUMN valid_until TYPE date
      USING valid_until::date;
  END IF;
END $$;

-- ستونهای متعارف visitor_product_history (اسکیمای سفارشی ممکن است
-- فاقد valid_until باشد یا نام ستونهای متفاوتی داشته باشد)
ALTER TABLE visitor_product_history ADD COLUMN IF NOT EXISTS stock text NOT NULL DEFAULT 'in';
ALTER TABLE visitor_product_history ADD COLUMN IF NOT EXISTS cash_discount_pct integer NOT NULL DEFAULT 0;
ALTER TABLE visitor_product_history ADD COLUMN IF NOT EXISTS check_days integer NOT NULL DEFAULT 0;
ALTER TABLE visitor_product_history ADD COLUMN IF NOT EXISTS valid_until date;
ALTER TABLE visitor_product_history ADD COLUMN IF NOT EXISTS price integer;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='visitor_product_history' AND column_name='stock_status') THEN
    UPDATE visitor_product_history SET stock = stock_status
      WHERE stock_status IN ('in','low','out') AND stock IS DISTINCT FROM stock_status;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='visitor_product_history' AND column_name='cash_discount') THEN
    UPDATE visitor_product_history SET cash_discount_pct = cash_discount::integer
      WHERE cash_discount > 0 AND cash_discount_pct = 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='visitor_product_history' AND column_name='cheque_days') THEN
    UPDATE visitor_product_history SET check_days = cheque_days
      WHERE cheque_days > 0 AND check_days = 0;
  END IF;
  -- قیمت ممکن است در اسکیمای سفارشی numeric باشد؛ کد integer میخواند
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='visitor_product_history'
               AND column_name='price' AND data_type='numeric') THEN
    ALTER TABLE visitor_product_history ALTER COLUMN price TYPE integer USING price::integer;
  END IF;
END $$;
`;

/** Tables protected by per-tenant RLS (applied only when they are real tables). */
const TENANT_TABLES = [
  "visitors",
  "visitor_notes",
  "products",
  "visitor_products",
  "visitor_product_history",
  "catalog_files",
  "quick_notes",
  "cheques",
  "push_subscriptions",
  "price_requests",
  "price_request_items",
  "price_responses",
  "orders",
  "order_items",
  "order_counters",
];

function rlsDdl(tables: string[]): string {
  const parts: string[] = [];
  for (const t of tables) {
    parts.push(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
    parts.push(
      `DROP POLICY IF EXISTS ${t}_tenant_policy ON ${t};
       CREATE POLICY ${t}_tenant_policy ON ${t}
         FOR ALL
         USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
         WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);`
    );
    parts.push(
      `DROP POLICY IF EXISTS ${t}_admin_policy ON ${t};
       CREATE POLICY ${t}_admin_policy ON ${t}
         FOR ALL
         USING (current_setting('app.role', true) = 'admin')
         WITH CHECK (current_setting('app.role', true) = 'admin');`
    );
  }
  // Profiles: the owner sees their own profile, admin bypasses everything.
  parts.push(`ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;`);
  parts.push(
    `DROP POLICY IF EXISTS profiles_owner_policy ON profiles;
     CREATE POLICY profiles_owner_policy ON profiles
       FOR ALL
       USING (id = current_setting('app.tenant_id', true)::uuid
              OR current_setting('app.role', true) = 'admin')
       WITH CHECK (id = current_setting('app.tenant_id', true)::uuid
              OR current_setting('app.role', true) = 'admin');`
  );
  // base_products: shared catalog — read-only for everyone, mutations admin-only.
  parts.push(`ALTER TABLE base_products ENABLE ROW LEVEL SECURITY;`);
  parts.push(
    `DROP POLICY IF EXISTS base_products_select_policy ON base_products;
     CREATE POLICY base_products_select_policy ON base_products
       FOR SELECT USING (true);`
  );
  parts.push(
    `DROP POLICY IF EXISTS base_products_admin_policy ON base_products;
     CREATE POLICY base_products_admin_policy ON base_products
       FOR ALL
       USING (current_setting('app.role', true) = 'admin')
       WITH CHECK (current_setting('app.role', true) = 'admin');`
  );
  return parts.join("\n");
}

async function runBootstrap(): Promise<void> {
  await pool.query(TABLES_DDL);
  await pool.query(MIGRATIONS_DDL);
  await pool.query(COMPAT_DDL);
  // RLS فقط برای جدولهای واقعی اعمال میشود (در استقرارهای سفارشی ممکن است
  // برخی نامها view باشند)
  const { rows: tableRows } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
  );
  const realTables = new Set(tableRows.map((r) => String(r.tablename)));
  const rlsTargets = TENANT_TABLES.filter((t) => realTables.has(t));
  await pool.query(rlsDdl(rlsTargets));

  // Seed a system admin when there is no user at all (fresh database) —
  // only when the schema matches the canonical model. Custom deployments
  // (e.g. a re-designed profiles/auth schema) are left untouched.
  const schemaOk = await (async () => {
    try {
      const { rows: c } = await pool.query(
        `SELECT count(*)::int AS n
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'profiles'
           AND column_name IN ('owner_user_id', 'name', 'trial_ends_at', 'status')`
      );
      return Number(c[0]?.n ?? 0) >= 4;
    } catch {
      return false;
    }
  })();

  const { rows } = await pool.query("SELECT count(*)::int AS n FROM users");
  const count = Number(rows[0]?.n ?? 0);
  if (count === 0 && schemaOk) {
    const userId = randomUUID();
    const profileId = randomUUID();
    // رمز یکبارمصرف تصادفی — فقط در لاگ سرور چاپ میشود و باید بلافاصله
    // توسط ادمین تغییر کند؛ هرگز هیچ رمز پیشفرض ثابتی وجود ندارد
    const initialPassword = randomUUID().slice(0, 16).replace(/-/g, "A");
    const passwordHash = await bcrypt.hash(initialPassword, 10);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.role', 'admin', true)",
        [profileId]
      );
      await client.query(
        "INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'admin')",
        [userId, process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@pharma.app", passwordHash]
      );
      await client.query(
        `INSERT INTO profiles (id, owner_user_id, name, status, subscription_ends_at)
         VALUES ($1, $2, $3, 'active', now() + interval '10 years')`,
        [profileId, userId, "مدیریت سیستم"]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    console.log(
      `[bootstrap] seeded admin account (change password immediately): ${process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@pharma.app"} / ${initialPassword}`
    );
  } else if (count === 0) {
    console.log(
      "[bootstrap] admin seed skipped — custom auth schema detected (profiles re-designed)"
    );
  }

  // Seed the shared base-products catalog (independent of the admin seed).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.role', 'admin', true)");
    const { rows: bp } = await client.query(
      "SELECT count(*)::int AS n FROM base_products"
    );
    const n = Number(bp[0]?.n ?? 0);
    if (n === 0 && BASE_PRODUCTS.length > 0) {
      const values: string[] = [];
      const params: string[] = [];
      BASE_PRODUCTS.forEach((p, i) => {
        params.push(p.name, p.category);
        values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
      });
      await client.query(
        `INSERT INTO base_products (name, category) VALUES ${values.join(",")} ON CONFLICT (name) DO NOTHING`,
        params
      );
      console.log(`[bootstrap] seeded ${BASE_PRODUCTS.length} base products`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * آیا اسکیما و سیاست‌های RLS از قبل آماده‌اند؟ (فقط خواندن؛ بدون DDL)
 * اگر بله، بوت‌استرپ سنگین (DROP/CREATE POLICY روی همه‌ی جدول‌ها) اجرا نمی‌شود.
 */
async function isBootstrapped(): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename::text = ANY($1::text[])) AS tables,
       (SELECT count(*)::int FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename::text = ANY($1::text[])
            AND policyname::text = tablename::text || '_tenant_policy') AS policies,
       to_regclass('public.users') IS NOT NULL AS has_users,
       to_regclass('public.profiles') IS NOT NULL AS has_profiles,
       to_regclass('public.base_products') IS NOT NULL AS has_base_products,
       (SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'orders'
            AND column_name IN ('order_no', 'client_key', 'deleted_at')) AS order_cols,
       to_regclass('public.order_counters') IS NOT NULL AS has_counters,
       to_regclass('public.orders_tenant_order_no_uq') IS NOT NULL AS has_order_no_idx,
       to_regclass('public.orders_tenant_client_key_uq') IS NOT NULL AS has_client_key_idx`,
    [TENANT_TABLES]
  );
  const r = rows[0];
  return (
    !!r &&
    r.has_users === true &&
    r.has_profiles === true &&
    r.has_base_products === true &&
    Number(r.order_cols) === 3 &&
    r.has_counters === true &&
    r.has_order_no_idx === true &&
    r.has_client_key_idx === true &&
    Number(r.tables) > 0 &&
    Number(r.policies) === Number(r.tables)
  );
}

// فقط نتیجه‌ی موفق (boolean) بین درخواست‌ها نگه داشته می‌شود؛ Promise مشترک
// بین درخواست‌ها روی Workers باعث گیر کردن می‌شود.
let bootstrapped = false;

/**
 * بوت‌استرپ فقط وقتی اجرا می‌شود که اسکیما آماده نباشد (یا
 * FORCE_DB_BOOTSTRAP=1). پس از اولین موفقیت، دیگر هیچ کوئری‌ای نمی‌زند.
 */
export async function ensureDb(): Promise<void> {
  if (bootstrapped) return;
  try {
    if (process.env.FORCE_DB_BOOTSTRAP === "1" || !(await isBootstrapped())) {
      console.log("[bootstrap] schema not ready — running bootstrap");
      await runBootstrap();
    }
    bootstrapped = true;
  } catch (e) {
    console.error(
      "[bootstrap] failed:",
      e instanceof Error ? e.message : String(e)
    );
    throw e;
  }
}
