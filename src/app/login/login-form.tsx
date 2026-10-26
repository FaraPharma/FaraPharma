"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Field, Input, Button } from "@/components/ui";
import { RegisterInstall } from "@/components/register-install";
import { loginAction } from "@/actions/auth";

/** بعد از ورود به صفحه‌ای که کاربر می‌خواست برگردد (فقط مسیر داخلیِ ساده؛ هرچیز دیگر = داشبورد) */
function safeNext(): string {
  try {
    const n = new URLSearchParams(window.location.search).get("next") ?? "";
    return /^\/[A-Za-z0-9_\-/]*$/.test(n) && !n.startsWith("//") ? n : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

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
      router.push(safeNext());
      router.refresh();
      return;
    }
    setError(res?.error ?? "خطا در ورود");
  }

  return (
    <AuthShell>
      <h2 className="mb-4 text-base font-bold text-[color:var(--ink)]">ورود به حساب</h2>
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
        <Field label="رمز عبور" error={error}>
          <Input
            type="password"
            dir="ltr"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" disabled={busy} className="w-full">
          {busy ? "در حال ورود…" : "ورود"}
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-[color:var(--ink-soft)]">
        حساب ندارید؟{" "}
        <Link href="/register" className="font-bold text-[color:var(--primary-dark)]">
          ثبت‌نام و شروع دوره آزمایشی رایگان
        </Link>
      </p>

      {/* نصب اپ: تشخیص iOS/اندروید، مخفی اگر قبلاً نصب شده */}
      <div className="mt-4">
        <RegisterInstall trigger={false} />
      </div>

      <p className="mt-4 text-center">
        <Link href="/privacy" className="text-[10px] text-[color:var(--ink-soft)] underline">
          قوانین و حریم خصوصی
        </Link>
      </p>
    </AuthShell>
  );
}
