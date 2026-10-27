import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import type { Tx } from "@/db";
import { orderItems, orders, visitors } from "@/db/schema";
import { buildLastPurchases, type LastPurchase } from "@/lib/purchase-history";

/**
 * آخرین خرید همه‌ی کالاهای یک داروخانه را «یک‌جا» می‌خواند (نه یکی‌یکی برای هر نتیجه): برای هر نامِ ثبت‌شده در
 * سفارش‌ها فقط تازه‌ترین ردیف (DISTINCT ON)، بدون سفارش حذف‌شده (سطل) و لغوشده و بدون قیمت صفر.
 * تطبیق املای متفاوت در کد انجام می‌شود (buildLastPurchases). کش کوتاه‌مدت تا هر تایپ دیتابیس را نزند.
 */
const TTL_MS = 10_000;
const MAX_TENANTS = 20;
const cache = new Map<string, { at: number; map: Map<string, LastPurchase> }>();

export function clearHistoryCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

export async function loadLastPurchases(tx: Tx, tenantId: string): Promise<Map<string, LastPurchase>> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;

  const rows = await tx
    .selectDistinctOn([orderItems.productName], {
      productName: orderItems.productName,
      unitPrice: orderItems.unitPrice,
      at: orders.createdAt,
      visitorId: orders.visitorId,
      visitorName: visitors.name,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(visitors, eq(orders.visitorId, visitors.id))
    .where(
      and(
        eq(orderItems.tenantId, tenantId),
        isNull(orders.deletedAt),
        ne(orders.status, "cancelled"),
        gt(orderItems.unitPrice, 0)
      )
    )
    .orderBy(orderItems.productName, desc(orders.createdAt));

  const map = buildLastPurchases(rows);
  if (cache.size >= MAX_TENANTS) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(tenantId, { at: Date.now(), map });
  return map;
}
