"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Field, Input, Button } from "@/components/ui";
import { RegisterInstall } from "@/components/register-install";
import { loginAction } from "@/actions/auth";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await loginAction({ email, password });
    setBusy(false);
    if (res && res.ok) {
      // ناوبری سمت کلاینت — به redirect سمت سرور اتکا نمیکنیم
      router.push("/dashboard");
      router.refresh();
      return;
    }
    setError(res?.error ?? "خطا در ورود");
  }

  return (
    <AuthShell>
      <h2 className="mb-4 text-base font-bold text-slate-900">ورود به حساب</h2>
      <form onSubmit={submit} className="space-y-3">
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
        <Field label="رمز عبور">
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
          {busy ? "در حال ورود…" : "ورود"}
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-slate-500">
        حساب ندارید؟{" "}
        <Link href="/register" className="font-bold text-teal-600">
          ثبت‌نام و شروع دوره آزمایشی رایگان
        </Link>
      </p>

      {/* نصب اپ: تشخیص iOS/اندروید، مخفی اگر قبلاً نصب شده */}
      <div className="mt-4">
        <RegisterInstall trigger={false} />
      </div>

      <p className="mt-4 text-center">
        <Link href="/privacy" className="text-[10px] text-slate-400 underline">
          قوانین و حریم خصوصی
        </Link>
      </p>
    </AuthShell>
  );
}
