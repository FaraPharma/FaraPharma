# دیپلوی روی Netlify — نسخه نهایی (فقط با موبایل، بدون ترمینال)

این پروژه Next.js 16 (App Router) + PostgreSQL (Supabase) است. روش
drag & drop زیپ کار نمی‌کند؛ از مسیر Git → Netlify استفاده کنید.
خبر خوب: **همه‌ی مراحل زیر بدون کامپیوتر و بدون ترمینال، فقط با مرورگر
موبایل انجام می‌شود.**

---

## گام ۱ — آپلود کد به گیت‌هاب (بدون ترمینال)

ساده‌ترین راه با موبایل:

1. پوشه‌ی پروژه (همین پوشه‌ای که این فایل در آن است) را دانلود کنید.
2. در مرورگر موبایل به `github.com` بروید و وارد شوید.
3. **New repository** → نام مثلاً `pharma-purchasing-saas` → Private →
   بدون README/.gitignore → **Create repository**.
4. در همان صفحه‌ی ریپازیتوری که تازه ساخته شده، لینک
   **«uploading an existing file»** را بزنید.
5. فایل‌های پروژه را انتخاب کنید (همه را یکجا بکشید داخل صفحه — آپلود
   چندفایلی و شامل پوشه‌ها در اپ موبایل گیت‌هاب پشتیبانی می‌شود) و
   **Commit changes** را بزنید.

اگر حجم دانلود پروژه از این محیط میسر نبود، از گزینه‌ی جایگزین استفاده
کنید: یک فایل `package.json` خالی با همین محتوا روی گیت‌هاب نسازید —
به‌جایش از صاحب پروژه بخواهید کد را در اختیارتان بگذارد؛ یا کد را از
همان محیط توسعه قبلی export کنید.

> مهم: فایل `.env` هرگز آپلود نشود (`.gitignore` آن را رد می‌کند؛ اگر
> دستی آپلود می‌کنید، `.env` را انتخاب نکنید — رمز دیتابیس نباید روی
> گیت‌هاب برود).

---

## گام ۲ — اتصال به Netlify

1. `netlify.app` → **Add new site → Import an existing project** →
   GitHub → انتخاب ریپازیتوری `pharma-purchasing-saas`.
2. Netlify فریم‌ورک Next.js را خودکار تشخیص می‌دهد؛ فایل `netlify.toml`
   در پروژه هم مقادیر را قطعی می‌کند:
   - Build command: `npm run build`
   - Publish directory: `.next`
3. **قبل از Deploy** متغیرهای محیطی را وارد کنید (گام ۳).
4. **Deploy site** را بزنید.
5. تست نهایی: `https://SITE.netlify.app/api/health` باید `{"ok":true}` بدهد.

---

## گام ۳ — متغیرهای محیطی Netlify (دقیقاً همین مقادیر)

### DATABASE_URL — **الزامی — حتماً Session Pooler**

```
postgresql://postgres.qnntjlkgfrxcgkgtowvu:parali3211233@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=no-verify
```

⚠️ از **Direct Connection** استفاده نکنید:
`db.qnntjlkgfrxcgkgtowvu.supabase.co` فقط به IPv6 resolve می‌شود و Netlify
(شبکه IPv4-only) به آن وصل نمی‌شود — دیپلوی قبلی دقیقاً به همین دلیل خطا
داد. آدرس بالا Session Pooler رسمی Supabase است (IPv4، همان دیتابیس،
همان کاربر و رمز).

### AUTH_SECRET — **الزامی — مقدار جدید (قدیمی افشا شده، استفاده نکنید)**

```
eed4485445998596bc0a0732cf4787bac031ad7d03f289388335c3679bc2ebbb8f983349b500a2a784da739b50126847
```

این کلید تازه تولید شده و با هیچ‌جا به‌اشتراک گذاشته نشده است. دقت کنید
دقیقاً همین ۹۶ کاراکتر را وارد کنید (بدون فاصله یا خط جدید). چون مقدار
قبلی تغییر کرده، ورودهای قدیمی در حالت مرورگر کاربران نامعتبر می‌شوند —
برای راه‌اندازی اولیه طبیعی است (کاربران دوباره login می‌کنند).

### سایر متغیرها

| متغیر | وضعیت | مقدار |
|---|---|---|
| `TRIAL_DAYS` | اختیاری | `7` (مدت دوره آزمایشی) |
| `SENTRY_DSN` | اختیاری (توصیهشده) | DSN پروژه Sentry (پلن رایگان) — خطاهای سمت سرور را گزارش میدهد |
| `NEXT_PUBLIC_SENTRY_DSN` | اختیاری | همان DSN برای خطاهای سمت کلاینت (در Sentry بگویید «I'll set it up later» تا کلید عمومی بدهد) |
| `SENTRY_ORG` / `SENTRY_PROJECT` | اختیاری | فقط برای upload source maps در CI لازم است؛ برای شروع لازم نیست |
| `VAPID_PUBLIC_KEY` | اختیاری (برای یادآوری push) | `BKfY47GwxyamEz0sBkDF_cS_P8RzPlSq6L8QEQj1y3dXtLhZZlIrNgltmlQfGj_0nYUvbYX3NZ6Up9dM3vrZGl0` |
| `VAPID_PRIVATE_KEY` | اختیاری (برای یادآوری push) | `p_kGDLc9nWUz97qKWPp6dhY6FhDfBFRFOqfmqZKtxiU` |

با ست شدن این دو کلید، «یادآوری چک‌ها» به Web Push واقعی ارتقا می‌یابد:
کاربر در صفحه چک‌ها مجوز می‌دهد → اشتراک push در دیتابیس ذخیره می‌شود →
سرور می‌تواند حتی وقتی اپ کاملاً بسته است اعلان سررسید بفرستد.
بدون کلیدها، فقط یادآوری درون‌اپی فعال است.

### محرک خودکار یادآوری چک‌ها (Scheduled Function)

در `netlify.toml` یک Scheduled Function با نام `cheque-reminders` ثبت شده
که **هر روز ساعت ۰۹:۰۰** اجرا میشود و:
- همه‌ی تنانت‌ها را بررسی میکند
- چکهای تسویهنشده با فاصله ≤ `cheque_warning_days` هر تنانت را مییابد
- به اشتراکهای push همان تنانت اعلان میفرستد
- با ستون `last_notified_at` روی هر چک، از تکرار روزانه جلوگیری میکند

نکته: Netlify Scheduled Functions نیاز به نسخه‌ی Next Runtime نصب‌شده ندارند؛
فایل `netlify/functions/cheque-reminders/cheque-reminders.ts` پس از deploy
خودکار در دسترس است. برای تست دستی، به مسیر
`https://SITE.netlify.app/.netlify/functions/cheque-reminders` درخواست بزنید.
| `S3_ENDPOINT` | اختیاری | `https://qnntjlkgfrxcgkgtowvu.supabase.co/storage/v1/s3` |
| `S3_BUCKET` | اختیاری | نام باکت در Supabase Storage |
| `S3_ACCESS_KEY` | اختیاری | ref پروژه (`qnntjlkgfrxcgkgtowvu`) |
| `S3_SECRET_KEY` | اختیاری | service_role key از Supabase → Settings → API |

بدون S3، بخش «کاتالوگ PDF» روی Netlify فایل‌ها را بعد از مدتی از دست
می‌دهد (دیسک سرورلس ماندگار نیست) — بقیه‌ی اپ بدون S3 کامل کار می‌کند.

### اتصال Sentry (پایش خطا — رایگان)

1. در `sentry.io` ثبتنام کنید → **New Project** → پلتفرم **Next.js**.
2. در مرحله‌ی بعد «I'll set it up later» را بزنید و فقط **DSN** را بردارید.
3. همان مقدار را برای `SENTRY_DSN` و `NEXT_PUBLIC_SENTRY_DSN` در Netlify
   ست کنید.
4. بعد از دیپلوی، برای تست اتصال:
   `https://SITE.netlify.app/api/sentry-test` را باز کنید → خطای 500 باید
   در صفحه‌ی Issues در Sentry ظاهر شود. (بدون DSN، Sentry بهطور خودکار
   غیرفعال میماند و هیچ درخواستی ارسال نمیشود.)

بدون S3، بخش «کاتالوگ PDF» روی Netlify فایل‌ها را بعد از مدتی از دست
می‌دهد (دیسک سرورلس ماندگار نیست) — بقیه‌ی اپ بدون S3 کامل کار می‌کند.

---

## نکته‌های فنی

- **زمان build به دیتابیس نیاز ندارد** (تست شده): اتصال فقط در runtime
  انجام می‌شود؛ بوت‌استرپ idempotent جداول/RLS قبلاً روی دیتابیس شما
  اعمال شده و در اولین درخواست فقط no-op است.
- `sslmode=no-verify`: رمزگذاری TLS کامل حفظ می‌شود؛ فقط راستی‌آزمایی
  گواهی CA پولر Supabase رد می‌شود (رویه استاندارد پولر Supabase).
- PWA (manifest + service worker) روی دامنه HTTPS Netlify بدون تنظیم اضافه
  کار می‌کند.
- ⚠️ رمز دیتابیس در گفتگوهای قبلی آمده است؛ بعد از دیپلوی موفق، از
  داشبورد Supabase آن را بچرخانید و فقط در Netlify به‌روز کنید.
