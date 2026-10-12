export const APP_NAME = "دستیار خرید داروخانه";
export const APP_DESCRIPTION =
  "مقایسه شرایط ویزیتورها، درخواست قیمت و مدیریت سفارش برای مسئولین خرید داروخانه";

export const TRIAL_DAYS = Math.max(
  1,
  Number(process.env.TRIAL_DAYS ?? 21)
);

export const AUTH_COOKIE = "pharma_session";

export const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "pharma-dev-secret-change-me-0123456789";

/** DSN سرویس پایش خطا (Sentry) — خالی = غیرفعال */
export const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN ?? "";

export const CATEGORIES = {
  cosmetic: "آرایشی",
  hygiene: "بهداشتی",
  equipment: "تجهیزات",
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

export const STOCKS = {
  in: "دارد",
  low: "کم",
  out: "ندارد",
} as const;

export type StockKey = keyof typeof STOCKS;

export const ORDER_STATUS = {
  registered: "ثبت‌شده",
  delivered: "تحویل‌شده",
  cancelled: "لغو شده",
} as const;

export type OrderStatusKey = keyof typeof ORDER_STATUS;

export const SUB_STATUS = {
  trial: "آزمایشی",
  active: "فعال",
  expired: "منقضی",
} as const;

export type SubStatusKey = keyof typeof SUB_STATUS;
