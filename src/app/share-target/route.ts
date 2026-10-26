import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * مسیر سروری جایگزین برای «اشتراک‌گذاری ← اپ». وقتی سرویس‌ورکر فعال است، POST اینجا نمی‌رسد
 * (public/sw.js فایل را می‌گیرد و به /import-share می‌برد). اگر سرویس‌ورکر فعال نبود، به‌جای خطای ۴۰۵/۵۰۰
 * یک پیام فارسی ساده می‌دهیم. بدنه‌ی درخواست (فایل) عمداً خوانده یا ذخیره نمی‌شود.
 */
const PAGE = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ورود لیست از اشتراک‌گذاری</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2f4f8;color:#1c2330;font-family:Vazirmatn,Tahoma,sans-serif;padding:20px}
  main{max-width:420px;background:#fff;border-radius:20px;padding:22px;box-shadow:0 2px 12px rgba(0,0,0,.08);line-height:2}
  h1{font-size:17px;margin:0 0 8px}
  p{font-size:14px;margin:0 0 10px;color:#4a5568}
  a{display:flex;min-height:44px;align-items:center;justify-content:center;border-radius:16px;background:#0d9488;color:#fff;text-decoration:none;font-weight:700;font-size:14px;margin-top:8px}
</style>
</head>
<body>
<main>
  <h1>فایل دریافت نشد</h1>
  <p>اشتراک‌گذاری مستقیم الان فعال نیست (اپ را یک بار باز کن و دوباره امتحان کن).</p>
  <p>از دکمه‌ی آپلود استفاده کنید: در صفحه‌ی «ویزیتورها»، ویزیتور را باز کن و «ورود لیست از فایل» را بزن.</p>
  <a href="/visitors">رفتن به ویزیتورها</a>
</main>
</body>
</html>`;

export async function POST(_request?: Request) {
  void _request;
  return new NextResponse(PAGE, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** باز کردن مستقیم آدرس (بدون فایل): به صفحه‌ی ورود فایل برو */
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/import-share", request.url), 303);
}
