import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";

/**
 * Web Push (سرور): VAPID keys از متغیرهای محیطی خوانده میشوند.
 * اگر ست نشده باشند، هیچ اعلانی ارسال نمیشود (بدون خطای بیصدا).
 */

let configured = false;
try {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      "mailto:support@pharma.app",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    configured = true;
  }
} catch {
  configured = false;
}

/** ارسال اعلان به یک اشتراک push (با پاکسازی خودکار اشتراکهای منقضی) */
export async function sendPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: { title: string; body: string; tag: string; url: string }
): Promise<boolean> {
  if (!configured) return false;
  try {
    await webpush.sendNotification(subscription as webpush.PushSubscription, JSON.stringify(payload));
    return true;
  } catch (e: unknown) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      // اشتراک منقضی → حذف از دیتابیس
      try {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
      } catch {
        /* ignore */
      }
    }
    return false;
  }
}
