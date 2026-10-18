import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { Client } from "pg";
import { BASE_PRODUCTS } from "./base-products";
import { reconcileSchema, type Queryable } from "./schema-check";

/**
 * مهاجرت‌های مرتب و تکرارپذیر دیتابیس.
 *  - هر مهاجرت داخل یک تراکنش اجرا می‌شود و نامش در schema_migrations ثبت می‌شود؛
 *    مهاجرت ثبت‌شده دوباره اجرا نمی‌شود (مگر force).
 *  - هیچ‌کدام روی مسیر درخواست‌های عادی اجرا نمی‌شوند؛ فقط از /api/admin/migrate
 *    (یا scripts/apply-bootstrap.ts) با اتصال ممتاز MIGRATE_DATABASE_URL (یا DATABASE_URL).
 *  - ensureDb فقط نبودن مهاجرت اجراشده را در لاگ هشدار می‌دهد و هیچ DDL اجرا نمی‌کند.
 *
 * RLS: کوئری‌های عادی با SET LOCAL app.tenant_id در تراکنش اجرا می‌شوند؛
 * app.role = 'admin' همه‌ی بررسی‌های tenant را دور می‌زند؛ بدون این تنظیم‌ها همه‌ی
 * ردیف‌ها پنهان است (default-deny). base_products مشترک و فقط‌خواندنی است.
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

const PRICE_RESPONSES_DDL = `
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

const COMPAT_PART_A = `
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
  -- (حذف شد) بازنویسی status از ستون قدیمی subscription_status؛ آن مرحله هر بار
  -- که بوت‌استرپ اجرا می‌شد وضعیت اشتراکِ تنظیم‌شده‌ی دستی (مثلاً مدیر) را برمی‌گرداند.
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

`;

const COMPAT_PART_ORDERS = `-- ===== orders: شماره‌ی سفارش، کلید ثبت یکتا، حذف نرم (امن و تکرارپذیر) =====
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

`;

const COMPAT_PART_C = `-- price_responses: کد stock/cash_discount_pct/check_days/responded_at میخواهد
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


type MigrationResult = void | Record<string, unknown>;
export interface Migration {
  name: string;
  up: (c: Queryable) => Promise<MigrationResult>;
}

const sqlMigration = (name: string, sql: string): Migration => ({
  name,
  up: async (c) => {
    await c.query(sql);
  },
});

/** RLS فقط برای جدول‌های واقعی اعمال می‌شود (در استقرارهای سفارشی ممکن است برخی نام‌ها view باشند) */
async function rlsPolicies(c: Queryable): Promise<MigrationResult> {
  const { rows } = await c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  const real = new Set(rows.map((r) => String(r.tablename)));
  const targets = TENANT_TABLES.filter((t) => real.has(t));
  await c.query(rlsDdl(targets));
  return { rlsTables: targets.length };
}

/** مدیر سیستم (فقط وقتی هیچ کاربری نیست و اسکیما متعارف است) + کاتالوگ مشترک base_products */
async function seedAdminAndCatalog(c: Queryable): Promise<MigrationResult> {
  const info: Record<string, unknown> = {};
  const { rows: cols } = await c.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles'
        AND column_name IN ('owner_user_id', 'name', 'trial_ends_at', 'status')`
  );
  const schemaOk = Number(cols[0]?.n ?? 0) >= 4;
  const { rows } = await c.query("SELECT count(*)::int AS n FROM users");
  const count = Number(rows[0]?.n ?? 0);
  if (count === 0 && schemaOk) {
    const userId = randomUUID();
    const profileId = randomUUID();
    // رمز یکبارمصرف تصادفی؛ هرگز رمز پیش‌فرض ثابت وجود ندارد
    const initialPassword = randomUUID().slice(0, 16).replace(/-/g, "A");
    const passwordHash = await bcrypt.hash(initialPassword, 10);
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@pharma.app";
    await c.query("INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'admin')", [
      userId,
      email,
      passwordHash,
    ]);
    await c.query(
      `INSERT INTO profiles (id, owner_user_id, name, status, subscription_ends_at)
       VALUES ($1, $2, $3, 'active', now() + interval '10 years')`,
      [profileId, userId, "مدیریت سیستم"]
    );
    info.seededAdmin = { email, initialPassword, note: "رمز را فوراً عوض کنید" };
    console.log(`[migrate] seeded admin account (change password immediately): ${email} / ${initialPassword}`);
  } else if (count === 0) {
    info.adminSeed = "skipped — custom auth schema detected";
  }

  const { rows: bp } = await c.query("SELECT count(*)::int AS n FROM base_products");
  if (Number(bp[0]?.n ?? 0) === 0 && BASE_PRODUCTS.length > 0) {
    const values: string[] = [];
    const params: string[] = [];
    BASE_PRODUCTS.forEach((p, i) => {
      params.push(p.name, p.category);
      values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
    });
    await c.query(
      `INSERT INTO base_products (name, category) VALUES ${values.join(",")} ON CONFLICT (name) DO NOTHING`,
      params
    );
    info.baseProducts = BASE_PRODUCTS.length;
  }
  return info;
}


/* ───────────── مرحله‌ی ۳ب: نقش app_runtime و RLS واقعی ───────────── */

export const APP_ROLE = "app_runtime";

/** جدول‌هایی که برنامه با نقش runtime روی آن‌ها خواندن/نوشتن کامل دارد */
const RUNTIME_RW_TABLES = [...TENANT_TABLES, "login_attempts"];
/** حداقل دسترسی: بدون DELETE (حذف کاربر/پروفایل فقط با اتصال ممتاز) */
const RUNTIME_RWNODEL_TABLES = ["users", "profiles"];
/** فقط خواندن */
const RUNTIME_RO_TABLES = ["base_products", "schema_migrations"];

async function realRelations(c: Queryable): Promise<Set<string>> {
  const { rows } = await c.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v')`
  );
  return new Set(rows.map((r) => String(r.relname)));
}

/**
 * نقش app_runtime: LOGIN، بدون SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE و بدون هیچ دسترسی DDL.
 * رمز در این مهاجرت تنظیم نمی‌شود (syncRuntimeRolePassword در هر اجرا انجام می‌دهد)؛
 * نقش بدون رمز نمی‌تواند با رمز وارد شود.
 */
async function appRuntimeRole(c: Queryable): Promise<MigrationResult> {
  // نقش با ویژگی‌های پیش‌فرض امن ساخته می‌شود (بدون SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE/REPLICATION).
  // ALTER ROLE فقط وقتی لازم باشد اجرا می‌شود: در Supabase/PostgreSQL 16 نقش postgres اجازه‌ی
  // «ALTER ROLE ... NOREPLICATION/NOBYPASSRLS» را حتی برای نقش تازه‌ساخته ندارد.
  await c.query(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
         CREATE ROLE ${APP_ROLE} LOGIN;
       END IF;
     END $$;`
  );
  const { rows: attrs } = await c.query(
    "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin FROM pg_roles WHERE rolname = $1",
    [APP_ROLE]
  );
  const a = attrs[0];
  if (a && (a.rolsuper || a.rolbypassrls || a.rolcreatedb || a.rolcreaterole || a.rolreplication || !a.rolcanlogin)) {
    await c.query(`ALTER ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
  }
  const real = await realRelations(c);
  const stmts: string[] = [
    `GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`,
    `REVOKE CREATE ON SCHEMA public FROM ${APP_ROLE}`,
    // PUBLIC در PostgreSQL ≤ 14 اجازه‌ی CREATE دارد؛ اگر اجازه‌ی تغییر نبود نادیده گرفته می‌شود (آزمون ۲۰ بررسی می‌کند)
    `DO $$ BEGIN REVOKE CREATE ON SCHEMA public FROM PUBLIC; EXCEPTION WHEN insufficient_privilege THEN NULL; END $$`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${APP_ROLE}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${APP_ROLE}`,
  ];
  for (const t of RUNTIME_RW_TABLES) if (real.has(t)) stmts.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${t} TO ${APP_ROLE}`);
  for (const t of RUNTIME_RWNODEL_TABLES) if (real.has(t)) stmts.push(`GRANT SELECT, INSERT, UPDATE ON public.${t} TO ${APP_ROLE}`);
  for (const t of RUNTIME_RO_TABLES) if (real.has(t)) stmts.push(`GRANT SELECT ON public.${t} TO ${APP_ROLE}`);
  stmts.push(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
    // جدول‌های آینده (ساخته‌شده توسط همین نقش مهاجرت)
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`
  );
  for (const q of stmts) await c.query(q);
  return { role: APP_ROLE, grantedTables: RUNTIME_RW_TABLES.concat(RUNTIME_RWNODEL_TABLES, RUNTIME_RO_TABLES).filter((t) => real.has(t)).length };
}

const GUC_TENANT = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;
const GUC_USER = `NULLIF(current_setting('app.user_id', true), '')::uuid`;
const GUC_EMAIL = `NULLIF(current_setting('app.login_email', true), '')`;
const IS_ADMIN = `current_setting('app.role', true) = 'admin'`;

/**
 * RLS واقعی با FORCE.
 *  - بدون app.tenant_id (یا خالی) هیچ ردیفی دیده نمی‌شود (NULLIF: رشته‌ی خالی هم صفر ردیف، نه خطا).
 *  - users/profiles/login_attempts قبل از شناخت tenant استفاده می‌شوند؛ فقط با GUC باریک:
 *      app.login_email (ردیف همان ایمیل)، app.user_id (ردیف همان کاربر و پروفایل‌اش).
 *  - base_products مشترک: همه فقط می‌خوانند؛ نوشتن فقط مدیر.
 */
async function rlsForcePolicies(c: Queryable): Promise<MigrationResult> {
  const real = await realRelations(c);
  const { rows } = await c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  const tables = new Set(rows.map((r) => String(r.tablename)));
  const parts: string[] = [];
  const enable = (t: string) => {
    parts.push(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
  };
  const policy = (t: string, name: string, cmd: string, using?: string, check?: string) => {
    parts.push(
      `DROP POLICY IF EXISTS ${name} ON ${t};`,
      `CREATE POLICY ${name} ON ${t} FOR ${cmd}${using ? ` USING (${using})` : ""}${check ? ` WITH CHECK (${check})` : ""};`
    );
  };
  const tenantTables = TENANT_TABLES.filter((t) => tables.has(t) && real.has(t));
  for (const t of tenantTables) {
    enable(t);
    policy(t, `${t}_tenant_policy`, "ALL", `tenant_id = ${GUC_TENANT}`, `tenant_id = ${GUC_TENANT}`);
    policy(t, `${t}_admin_policy`, "ALL", IS_ADMIN, IS_ADMIN);
  }
  if (tables.has("profiles")) {
    enable("profiles");
    policy("profiles", "profiles_owner_policy", "ALL", `id = ${GUC_TENANT} OR ${IS_ADMIN}`, `id = ${GUC_TENANT} OR ${IS_ADMIN}`);
    // ورود: پیدا کردن پروفایل با شناسه‌ی کاربرِ همان درخواست (فقط خواندن)
    policy("profiles", "profiles_login_select", "SELECT", `owner_user_id = ${GUC_USER}`);
  }
  if (tables.has("users")) {
    enable("users");
    policy("users", "users_self_select", "SELECT", `id = ${GUC_USER} OR email = ${GUC_EMAIL}`);
    policy("users", "users_register_insert", "INSERT", undefined, `id = ${GUC_USER}`);
    policy("users", "users_admin_policy", "ALL", IS_ADMIN, IS_ADMIN);
  }
  if (tables.has("login_attempts")) {
    enable("login_attempts");
    policy("login_attempts", "login_attempts_email_policy", "ALL", `email = ${GUC_EMAIL}`, `email = ${GUC_EMAIL}`);
    policy("login_attempts", "login_attempts_admin_policy", "ALL", IS_ADMIN, IS_ADMIN);
  }
  if (tables.has("base_products")) {
    enable("base_products");
    policy("base_products", "base_products_select_policy", "SELECT", "true");
    policy("base_products", "base_products_admin_policy", "ALL", IS_ADMIN, IS_ADMIN);
  }
  await c.query(parts.join("\n"));
  return { rlsForcedTables: tenantTables.length + ["profiles", "users", "login_attempts", "base_products"].filter((t) => tables.has(t)).length };
}

/* ───── رمز نقش runtime: به‌صورت verifier از نوع SCRAM-SHA-256 (رمز خام هرگز در SQL/لاگ/JSON نمی‌آید) ───── */

const te = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

async function hmacSha256(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, te.encode(msg)));
}

/** verifier سازگار با PostgreSQL (RFC 5802/7677) */
export async function scramVerifier(password: string, salt?: Uint8Array, iterations = 4096): Promise<string> {
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const pk = await crypto.subtle.importKey("raw", te.encode(password) as BufferSource, "PBKDF2", false, ["deriveBits"]);
  const salted = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: s as BufferSource, iterations }, pk, 256)
  );
  const clientKey = await hmacSha256(salted, "Client Key");
  const storedKey = new Uint8Array(await crypto.subtle.digest("SHA-256", clientKey as BufferSource));
  const serverKey = await hmacSha256(salted, "Server Key");
  return `SCRAM-SHA-256$${iterations}:${b64(s)}$${b64(storedKey)}:${b64(serverKey)}`;
}

export interface RuntimeRoleStatus {
  exists: boolean;
  passwordSet: boolean;
  note?: string;
}

/**
 * در هر اجرای مهاجرت: اگر APP_RUNTIME_PASSWORD تنظیم باشد رمز نقش app_runtime هم‌گام می‌شود،
 * وگرنه فقط همین بخش رد می‌شود (خطای کلی نیست). مقدار رمز هرگز چاپ نمی‌شود.
 */
async function syncRuntimeRolePassword(c: Queryable): Promise<RuntimeRoleStatus> {
  const { rows } = await c.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_ROLE]);
  if (rows.length === 0) return { exists: false, passwordSet: false, note: "نقش app_runtime هنوز ساخته نشده (مهاجرت ۰۰۹ اجرا نشده)" };
  const pw = process.env.APP_RUNTIME_PASSWORD;
  if (!pw) return { exists: true, passwordSet: false, note: "APP_RUNTIME_PASSWORD تنظیم نشده" };
  if (pw.length < 16 || !/^[\x21-\x7e]+$/.test(pw)) {
    return { exists: true, passwordSet: false, note: "APP_RUNTIME_PASSWORD معتبر نیست (حداقل ۱۶ کاراکتر، فقط حروف انگلیسی/عدد/نماد، بدون فاصله)" };
  }
  // salt ثابت (مشتق از خود رمز): هر اجرا دقیقاً همان verifier را می‌سازد. salt تصادفی در هر اجرا باعث می‌شد
  // کش احراز هویت Supavisor با دیتابیس ناهماهنگ شود و ورود با «password authentication failed» رد شود.
  const salt = (await hmacSha256(te.encode(pw), `salt:${APP_ROLE}`)).slice(0, 16);
  const verifier = await scramVerifier(pw, salt);
  if (!/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier)) {
    return { exists: true, passwordSet: false, note: "ساخت verifier ناموفق بود" };
  }
  await c.query(`ALTER ROLE ${APP_ROLE} PASSWORD '${verifier}'`);
  return { exists: true, passwordSet: true };
}


/**
 * هر جدول واقعیِ دیگر در public که ستون tenant_id دارد (مثلاً جدول‌های قدیمی خارج از schema.ts) هم
 * RLS فعال + FORCE می‌گیرد. سیاستی اضافه نمی‌شود، پس برای نقش runtime پیش‌فرض «هیچ ردیفی» است
 * (و دسترسی GRANT هم ندارد). نقش ممتاز مهاجرت (BYPASSRLS) تأثیری نمی‌بیند.
 */
async function forceRlsRemainingTenantTables(c: Queryable): Promise<MigrationResult> {
  const { rows } = await c.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND EXISTS (SELECT 1 FROM information_schema.columns k
                     WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'tenant_id')
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`
  );
  const names = rows.map((r) => String(r.relname));
  for (const t of names) {
    const q = `"${t.replace(/"/g, '""')}"`;
    await c.query(`ALTER TABLE public.${q} ENABLE ROW LEVEL SECURITY`);
    await c.query(`ALTER TABLE public.${q} FORCE ROW LEVEL SECURITY`);
  }
  return { forcedExtraTables: names.length, tables: names.join(",") };
}

/** به ترتیب اجرا می‌شوند؛ نام‌ها پس از ثبت نباید عوض شوند. مهاجرت جدید را فقط به انتها اضافه کنید. */
export const MIGRATIONS: Migration[] = [
  sqlMigration("001_base_tables", TABLES_DDL),
  sqlMigration("002_price_responses_product", PRICE_RESPONSES_DDL),
  sqlMigration("003_compat_profiles_and_columns", COMPAT_PART_A),
  sqlMigration("004_orders_numbering_soft_delete", COMPAT_PART_ORDERS),
  sqlMigration("005_compat_price_responses_and_history", COMPAT_PART_C),
  { name: "006_rls_policies", up: rlsPolicies },
  { name: "007_seed_admin_and_catalog", up: seedAdminAndCatalog },
  // هماهنگ‌سازی نهایی با schema.ts: ستون گم‌شده اضافه می‌شود، ستون‌های اجباریِ بی‌استفاده اختیاری می‌شوند
  { name: "008_reconcile_schema_with_code", up: reconcileSchema },
  // مرحله‌ی ۳ب
  { name: "009_app_runtime_role_and_grants", up: appRuntimeRole },
  { name: "010_rls_force_and_auth_policies", up: rlsForcePolicies },
  { name: "011_force_rls_remaining_tenant_tables", up: forceRlsRemainingTenantTables },
];

export const MIGRATION_NAMES = MIGRATIONS.map((m) => m.name);

const MIGRATE_LOCK_ID = 7270002;

/** مهاجرت‌های ثبت‌نشده (اگر جدول schema_migrations نباشد، همه) */
export async function listPendingMigrations(q: Queryable): Promise<string[]> {
  try {
    const { rows } = await q.query("SELECT name FROM schema_migrations");
    const done = new Set(rows.map((r) => String(r.name)));
    return MIGRATION_NAMES.filter((n) => !done.has(n));
  } catch (e) {
    if ((e as { code?: string }).code === "42P01") return [...MIGRATION_NAMES]; // undefined_table
    throw e;
  }
}

export interface MigrationReport {
  ok: boolean;
  connection: "MIGRATE_DATABASE_URL" | "DATABASE_URL";
  applied: { name: string; ms: number; info?: Record<string, unknown> }[];
  skipped: string[];
  pending: string[];
  failed?: { name: string; error: string };
  error?: string;
  /** وضعیت نقش app_runtime و رمز آن (بدون خطای کلی؛ رمز هرگز چاپ نمی‌شود) */
  runtimeRole?: RuntimeRoleStatus & { error?: string };
}

function errText(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as { cause?: unknown }).cause;
    const detail = (e as { detail?: string }).detail;
    const base = cause instanceof Error ? `${e.message} | علت: ${cause.message}` : e.message;
    return detail ? `${base} | جزئیات: ${detail}` : base;
  }
  return String(e);
}

/**
 * مهاجرت‌های اجراشده‌نشده را با اتصال ممتاز اجرا می‌کند.
 * force: همه‌ی مهاجرت‌ها (که تکرارپذیرند) را دوباره اجرا می‌کند؛ ثبت تکراری نمی‌شود.
 */
export async function runMigrations(opts: { force?: boolean } = {}): Promise<MigrationReport> {
  const privileged = process.env.MIGRATE_DATABASE_URL;
  const url = privileged || process.env.DATABASE_URL;
  const report: MigrationReport = {
    ok: false,
    connection: privileged ? "MIGRATE_DATABASE_URL" : "DATABASE_URL",
    applied: [],
    skipped: [],
    pending: [],
  };
  if (!url) {
    report.error = "نه MIGRATE_DATABASE_URL و نه DATABASE_URL تنظیم نشده است";
    return report;
  }
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 20_000 });
  try {
    await client.connect();
  } catch (e) {
    report.error = `اتصال ناموفق: ${errText(e)}`;
    return report;
  }
  let locked = false;
  try {
    const who = await client.query("SELECT current_user AS u");
    if (who.rows[0]?.u === APP_ROLE) {
      report.error = "اتصال مهاجرت با نقش app_runtime است؛ MIGRATE_DATABASE_URL (ممتاز) را تنظیم کنید";
      return report;
    }
    const g = await client.query("SELECT pg_try_advisory_lock($1) AS got", [MIGRATE_LOCK_ID]);
    locked = g.rows[0]?.got === true;
    if (!locked) {
      report.error = "مهاجرت دیگری همین حالا در حال اجراست؛ چند دقیقه بعد دوباره امتحان کنید";
      return report;
    }
    await client.query("SET statement_timeout = '60s'");
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`
    );
    const done = new Set(
      (await client.query("SELECT name FROM schema_migrations")).rows.map((r) => String(r.name))
    );
    for (const m of MIGRATIONS) {
      if (done.has(m.name) && !opts.force) {
        report.skipped.push(m.name);
        continue;
      }
      const t0 = Date.now();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.role', 'admin', true)");
        const info = (await m.up(client)) as Record<string, unknown> | undefined;
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [m.name]);
        await client.query("COMMIT");
        report.applied.push({ name: m.name, ms: Date.now() - t0, ...(info && Object.keys(info).length ? { info } : {}) });
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        report.failed = { name: m.name, error: errText(e) };
        break;
      }
    }
    const appliedNames = new Set([...done, ...report.applied.map((a) => a.name)]);
    report.pending = MIGRATION_NAMES.filter((n) => !appliedNames.has(n));
    report.ok = !report.failed && report.pending.length === 0;
    // رمز نقش runtime (خارج از مهاجرت‌های ثبت‌شده تا با تنظیم متغیر در هر زمان قابل اجرا باشد)
    if (!report.failed) {
      try {
        await client.query("BEGIN");
        report.runtimeRole = await syncRuntimeRolePassword(client);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        report.runtimeRole = { exists: true, passwordSet: false, error: errText(e) };
      }
    }
  } catch (e) {
    report.error = errText(e);
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK_ID]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
  return report;
}
