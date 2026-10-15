import Link from "next/link";
import { APP_NAME } from "@/lib/config";

export const metadata = { title: `قوانین و حریم خصوصی — ${APP_NAME}` };

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="card space-y-6 p-6">
        <div>
          <h1 className="text-lg font-bold text-[color:var(--ink)]">
            قوانین و حریم خصوصی
          </h1>
          <p className="mt-1 text-xs text-[color:var(--ink-soft)]">
            آخرین به‌روزرسانی: نسخه ۱ — {APP_NAME}
          </p>
        </div>

        <section>
          <h2 className="mb-2 text-sm font-bold text-[color:var(--ink)]">
            ۱) داده‌های شما
          </h2>
          <p className="text-xs leading-6 text-[color:var(--ink-soft)]">
            همه‌ی اطلاعاتی که در اپ وارد می‌کنید (کالاها، ویزیتورها، شرایط خرید،
            سفارش‌ها، چک‌ها و یادداشت‌ها) فقط متعلق به حساب خود شماست و به‌صورت
            ایزوله (چندمستأجری) روی پایگاه داده ابری ذخیره می‌شود. هیچ داروخانه‌ای
            به داده‌ی داروخانه‌ی دیگر دسترسی ندارد.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-[color:var(--ink)]">
            ۲) دسترسی و پشتیبان‌گیری
          </h2>
          <p className="text-xs leading-6 text-[color:var(--ink-soft)]">
            داده‌ها روی زیرساخت ابری (PostgreSQL) نگه‌داری و به‌صورت خودکار محافظت
            می‌شوند. شما هر زمان می‌توانید از صفحه «حساب و تنظیمات» یک نسخه‌ی کامل
            از تمام اطلاعات خود را دانلود کنید. با حذف حساب، داده‌های شما از سرور
            حذف می‌شود.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-[color:var(--ink)]">
            ۳) حریم خصوصی و عدم اشتراک‌گذاری
          </h2>
          <p className="text-xs leading-6 text-[color:var(--ink-soft)]">
            ما داده‌های شما را نمی‌فروشیم و در اختیار هیچ شخص ثالثی قرار نمی‌دهیم.
            استفاده از داده محدود به ارائه‌ی همین سرویس است.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-[color:var(--ink)]">
            ۴) دوره آزمایشی و اشتراک
          </h2>
          <p className="text-xs leading-6 text-[color:var(--ink-soft)]">
            ثبت‌نام شامل یک دوره آزمایشی رایگان کوتاه است. پس از پایان آن، ادامه‌ی
            استفاده نیازمند اشتراک است که به‌صورت دستی توسط پشتیبانی فعال می‌شود.
            در حالت منقضی، مشاهده و خروجی‌گیری از داده‌ها همیشه فعال می‌ماند و هیچ
            داده‌ای حذف نمی‌شود.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-[color:var(--ink)]">
            ۵) مسئولیت استفاده
          </h2>
          <p className="text-xs leading-6 text-[color:var(--ink-soft)]">
            این اپ یک ابزار کمکی برای تصمیم‌گیری خرید است؛ تصمیم نهایی و صحت
            اطلاعات ثبت‌شده بر عهده‌ی کاربر است. ارائه‌دهنده هیچ مسئولیتی در قبال
            نتایج تجاری ناشی از استفاده از اپ ندارد.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-[color:var(--ink)]">۶) تماس</h2>
          <p className="text-xs leading-6 text-[color:var(--ink-soft)]">
            برای سؤال درباره این قوانین یا درخواست حذف داده‌ها، از پشتیبانی
            درخواست کنید.
          </p>
        </section>

        <Link
          href="/register"
          className="btn-primary w-full text-sm"
        >
          بازگشت به ثبت‌نام
        </Link>
      </div>
    </div>
  );
}
