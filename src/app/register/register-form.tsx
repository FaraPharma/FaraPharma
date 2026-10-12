"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Field, Input, Button } from "@/components/ui";
import { RegisterInstall } from "@/components/register-install";
import { registerAction } from "@/actions/auth";
import { TRIAL_DAYS } from "@/lib/config";
import { faNum } from "@/lib/format";

export function RegisterForm() {
  const router = useRouter();
  const [pharmacyName, setPharmacyName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await registerAction({ pharmacyName, phone, email, password });
    setBusy(false);
    if (res && res.ok) {
      // ناوبری سمت کلاینت — به redirect سمت سرور اتکا نمیکنیم
      router.push("/dashboard");
      router.refresh();
      return;
    }
    setError(res?.error ?? "خطا در ثبتنام");
  }

  return (
    <AuthShell>
      <h2 className="mb-1 text-base font-bold text-slate-900">ساخت حساب داروخانه</h2>
      <p className="mb-4 text-xs text-slate-500">
        ثبتنام رایگان — {faNum(TRIAL_DAYS)} روز استفاده آزمایشی کامل
      </p>
      <form onSubmit={submit} className="space-y-3">
        <Field label="نام داروخانه">
          <Input
            placeholder="مثلاً: داروخانه دکتر سلامت"
            value={pharmacyName}
            onChange={(e) => setPharmacyName(e.target.value)}
            required
          />
        </Field>
        <Field label="تلفن (اختیاری)">
          <Input
            dir="ltr"
            inputMode="tel"
            placeholder="0912…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label="ایمیل">
          <Input
            type="email"
            dir="ltr"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="رمز عبور (حداقل ۸ کاراکتر)">
          <Input
            type="password"
            dir="ltr"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">
            {error}
          </p>
        )}
        <Button type="submit" variant="accent" disabled={busy} className="w-full">
          {busy ? "در حال ساخت حساب…" : "شروع دوره آزمایشی"}
        </Button>
        <p className="mt-2 text-center text-[10px] leading-4 text-slate-400">
          با ثبت‌نام، <Link href="/privacy" className="text-teal-600 underline">قوانین و حریم خصوصی</Link> را می‌پذیرید
        </p>
      </form>

      {/* نصب اپ: هنگام ورود به این صفحه نمایش داده می‌شود. اگر مرورگر پرامپت
          خودکار نصب را ندهد (اندروید) یا اصلاً پشتیبانی نکند (iOS/سافاری)،
          به‌جای اینکه چیزی نمایش داده نشود، راهنمای نصب دستی نشان داده می‌شود. */}
      <div className="mt-4">
        <RegisterInstall trigger={false} />
      </div>

      <p className="mt-4 text-center text-xs text-slate-500">
        قبلاً ثبتنام کرده‌اید؟{" "}
        <Link href="/login" className="font-bold text-teal-600">
          ورود
        </Link>
      </p>
    </AuthShell>
  );
}
