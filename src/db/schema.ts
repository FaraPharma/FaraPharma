import {
  pgTable,
  uuid,
  text,
  integer,
  date,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Auth / tenant tables                                                */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("owner"), // owner | admin
  // قطع کامل و برگشت‌پذیر دسترسی ورود توسط ادمین (جدا از وضعیت اشتراک)
  disabled: boolean("disabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone"),
  // subscription: trial | active | expired
  status: text("status").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  subscriptionEndsAt: timestamp("subscription_ends_at", { withTimezone: true }),
  // روزهای هشدار نزدیکشدن سررسید چک (قابل تغییر از صفحه تنظیمات)
  chequeWarningDays: integer("cheque_warning_days").notNull().default(7),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Tenant-scoped business tables                                       */
/* ------------------------------------------------------------------ */

export const visitors = pgTable(
  "visitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    company: text("company"),
    phone: text("phone"),
    // آیدی پیامرسان (بدون @) — مشترک برای تلگرام/بله/روبیکا
    messengerUsername: text("messenger_username"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("visitors_tenant_idx").on(t.tenantId)]
);

export const visitorNotes = pgTable(
  "visitor_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("visitor_notes_idx").on(t.tenantId, t.visitorId)]
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    // cosmetic | hygiene | equipment
    category: text("category").notNull().default("cosmetic"),
    active: boolean("active").notNull().default(true),
    // کسری دارم؟ (لیست کسریهای ساده)
    isShort: boolean("is_short").notNull().default(false),
    shortAt: timestamp("short_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("products_tenant_idx").on(t.tenantId),
    index("products_name_idx").on(t.tenantId, t.name),
  ]
);

// شرایط هر ویزیتور روی هر کالا
export const visitorProducts = pgTable(
  "visitor_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    // in | low | out
    stock: text("stock").notNull().default("in"),
    cashDiscountPct: integer("cash_discount_pct").notNull().default(0),
    checkDays: integer("check_days").notNull().default(0),
    offer: text("offer"),
    validUntil: date("valid_until"),
    // قیمت لیست (تومان) — دادهی خود تنانت
    price: integer("price"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("visitor_products_tenant_idx").on(t.tenantId, t.visitorId),
    uniqueIndex("visitor_products_uq").on(t.tenantId, t.visitorId, t.productId),
  ]
);

export const priceRequests = pgTable(
  "price_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // open | closed
    status: text("status").notNull().default("open"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("price_requests_tenant_idx").on(t.tenantId)]
);

export const priceRequestItems = pgTable(
  "price_request_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => priceRequests.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [index("price_request_items_idx").on(t.tenantId, t.requestId)]
);

export const priceResponses = pgTable(
  "price_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => priceRequests.id, { onDelete: "cascade" }),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    price: integer("price"), // تومان
    // in | low | out
    stock: text("stock"),
    checkDays: integer("check_days"),
    cashDiscountPct: integer("cash_discount_pct"),
    offer: text("offer"),
    respondedAt: timestamp("responded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("price_responses_idx").on(t.tenantId, t.requestId),
    uniqueIndex("price_responses_uq").on(
      t.tenantId,
      t.requestId,
      t.visitorId,
      t.productId
    ),
  ]
);

/** کاتالوگ مشترک کالاهای پایه — بدون tenantId، فقط‌خواندنی برای کاربران */
export const baseProducts = pgTable(
  "base_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    category: text("category").notNull().default("cosmetic"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("base_products_name_uq").on(t.name)]
);

/** اشتراکهای Web Push کاربران (برای یادآوری چکها حتی با اپ بسته) */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("push_subs_tenant_idx").on(t.tenantId),
    uniqueIndex("push_subs_endpoint_uq").on(t.endpoint),
  ]
);

/** شمارش تلاشهای ناموفق ورود — دیتابیسمحور (مستقل از instance در serverless) */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    count: integer("count").notNull().default(0),
    windowStart: timestamp("window_start", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("login_attempts_email_idx").on(t.email)]
);

/** جشنواره — اطلاعات نمایشی ساده (بدون هیچ منطق فعال) */


/** کالاهای مرتبط با هر جشنواره (اختیاری) */


/** چک پرداختنی — ثبت کاملاً دستی (نام ویزیتور، مبلغ، تاریخ سررسید) */
export const cheques = pgTable(
  "cheques",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    visitorName: text("visitor_name").notNull(),
    amount: integer("amount").notNull(),
    dueDate: date("due_date").notNull(),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    settled: boolean("settled").notNull().default(false),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    // آخرین روزی که اعلان سررسید برای این چک ارسال شده (جلوگیری از تکرار روزانه)
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("cheques_tenant_idx").on(t.tenantId, t.dueDate)]
);

/** یادداشت خام ثبت سریع (جایگزین کاغذ) */
export const quickNotes = pgTable(
  "quick_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    clientKey: text("client_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("quick_notes_tenant_idx").on(t.tenantId, t.createdAt)]
);

/** فایل مرجع (کاتالوگ PDF) هر ویزیتور — خود فایل در Storage جدا نگهداری میشود؛
 * بدون هیچ پردازش خودکار، فقط بهعنوان فایل قابل مشاهده/دانلود. */
export const catalogFiles = pgTable(
  "catalog_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileKey: text("file_key").notNull(),
    mimeType: text("mime_type").notNull().default("application/pdf"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    // stored
    status: text("status").notNull().default("stored"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("catalog_files_idx").on(t.tenantId, t.visitorId)]
);

/** تاریخچه‌ی شرایط هر کالا نزد هر ویزیتور (اسنپ‌شات قبل از هر تغییر) */
export const visitorProductHistory = pgTable(
  "visitor_product_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    stock: text("stock").notNull().default("in"),
    cashDiscountPct: integer("cash_discount_pct").notNull().default(0),
    checkDays: integer("check_days").notNull().default(0),
    offer: text("offer"),
    validUntil: date("valid_until"),
    price: integer("price"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("visitor_product_history_idx").on(
      t.tenantId,
      t.visitorId,
      t.productId
    ),
  ]
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    // registered | delivered | cancelled
    status: text("status").notNull().default("registered"),
    note: text("note"),
    // نحوه‌ی تسویه‌ی کل فاکتور (نه هر قلم جدا) — cash | cheque
    settlementType: text("settlement_type").notNull().default("cash"),
    settlementDays: integer("settlement_days").notNull().default(0),
    // شماره‌ی پشت‌سرهم برای هر داروخانه (از ۱) — از جدول order_counters می‌آید
    orderNo: integer("order_no").notNull(),
    // کلید یکتای کلاینت برای ثبت بدون تکرار (idempotent)
    clientKey: text("client_key"),
    // حذف نرم: پر بودن یعنی سفارش در سطل بازیافت است
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("orders_tenant_idx").on(t.tenantId, t.createdAt),
    uniqueIndex("orders_tenant_order_no_uq").on(t.tenantId, t.orderNo),
    uniqueIndex("orders_tenant_client_key_uq").on(t.tenantId, t.clientKey),
    index("orders_tenant_deleted_idx").on(t.tenantId, t.deletedAt),
  ]
);

/** شمارنده‌ی سفارش هر داروخانه؛ قفل ردیف آن ثبت همزمان را پشت‌سرهم می‌کند */
export const orderCounters = pgTable("order_counters", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  lastNo: integer("last_no").notNull().default(0),
});

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productName: text("product_name").notNull(),
    qty: integer("qty").notNull().default(1),
    unitPrice: integer("unit_price").notNull().default(0),
    discountPct: integer("discount_pct").notNull().default(0),
  },
  (t) => [index("order_items_idx").on(t.tenantId, t.orderId)]
);

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Visitor = typeof visitors.$inferSelect;
export type VisitorNote = typeof visitorNotes.$inferSelect;
export type Product = typeof products.$inferSelect;
export type VisitorProduct = typeof visitorProducts.$inferSelect;
export type PriceRequest = typeof priceRequests.$inferSelect;
export type PriceRequestItem = typeof priceRequestItems.$inferSelect;
export type PriceResponse = typeof priceResponses.$inferSelect;
export type BaseProduct = typeof baseProducts.$inferSelect;
export type CatalogFileRow = typeof catalogFiles.$inferSelect;
export type QuickNote = typeof quickNotes.$inferSelect;
export type Cheque = typeof cheques.$inferSelect;
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type VisitorProductHistory = typeof visitorProductHistory.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;

/* ------------------------------------------------------------------ */
/* امنیت: قفل تلاش بر اساس IP/ایمیل و سابقه‌ی عملیات مدیر              */
/* ------------------------------------------------------------------ */

/** کلید = HMAC(رازِ برنامه، «سطل:شناسه») ؛ IP یا ایمیل خام ذخیره نمی‌شود */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  bucket: text("bucket").notNull(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

/** فقط افزودنی: نقش app_runtime فقط SELECT و INSERT دارد (و تریگر UPDATE/DELETE را رد می‌کند) */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    detail: jsonb("detail"),
  },
  (t) => [index("audit_log_at_idx").on(t.at)]
);

/** خطاهای سرور/کلاینت برای مدیر؛ فقط پیام کوتاهِ پاک‌سازی‌شده (بدون رمز، کلید، آدرس اتصال) */
export const errorLog = pgTable(
  "error_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
    place: text("place").notNull(),
    code: text("code"),
    message: text("message").notNull(),
    tenantId: uuid("tenant_id"),
    userId: uuid("user_id"),
  },
  (t) => [index("error_log_at_idx").on(t.at)]
);
