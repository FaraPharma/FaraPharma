import { sendDueChequeNotifications } from "../../../src/lib/cheque-scheduler";

/**
 * Netlify Scheduled Function — یادآوری چکهای نزدیک سررسید.
 * schedule در netlify.toml تنظیم شده (هر روز ساعت ۰۹:۰۰).
 * بدون import از @netlify/functions تا هیچ وابستگی بیلدی اضافه نشود؛
 * خروجی استاندارد Response برای Netlify Functions کافی است.
 */
export default async (_request: Request) => {
  try {
    const result = await sendDueChequeNotifications();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : "خطای ناشناخته",
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};
