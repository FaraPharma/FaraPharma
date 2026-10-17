"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  PageHeader,
  Button,
  Field,
  Input,
  Spinner,
  Badge,
} from "@/components/ui";
import { SubscriptionBanner } from "@/components/sub-banner";
import { InstallButton } from "@/components/install-button";
import { updateProfileAction, logoutAction } from "@/actions/auth";
import { setChequeWarningDaysAction } from "@/actions/cheques";
import { faDate, faNum, toNum } from "@/lib/format";
import { APP_NAME, TRIAL_DAYS } from "@/lib/config";

interface SettingsData {
  profile: {
    id: string;
    name: string;
    phone: string | null;
    status: string;
    trialEndsAt: string | null;
    subscriptionEndsAt: string | null;
    chequeWarningDays: number;
    createdAt: string;
  } | null;
  role: string;
  trialDays: number;
}

export default function SettingsPage() {
  const router = useRouter();
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [chequeDays, setChequeDays] = useState("7");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const j = await res.json();
      if (res.ok) {
        setData(j);
        setName(j.profile?.name ?? "");
        setPhone(j.profile?.phone ?? "");
        setChequeDays(String(j.profile?.chequeWarningDays ?? 7));
      }
    } catch {
      /* آفلاین */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await updateProfileAction({ name, phone });
    const resDays = await setChequeWarningDaysAction(toNum(chequeDays));
    setBusy(false);
    if (res.ok && resDays.ok) {
      toast.success("اطلاعات ذخیره شد");
      load();
    } else toast.error(res.error ?? resDays.error ?? "خطا در ذخیره");
  }

  async function downloadBackup() {
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) {
        toast.error("دریافت پشتیبان ناموفق بود");
        return;
      }
      const j = await res.json();
      const blob = new Blob([JSON.stringify(j, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pharma-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("فایل پشتیبان (JSON) دانلود شد");
    } catch {
      toast.error("اتصال برقرار نیست — بعداً دوباره تلاش کنید");
    }
  }

  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader title="حساب کاربری" subtitle="پروفایل داروخانه و وضعیت اشتراک" />

      <SubscriptionBanner profile={data?.profile ?? null} trialDays={data?.trialDays ?? TRIAL_DAYS} role={data?.role} />

      <form onSubmit={save} className="card space-y-3 p-4">
        <h2 className="text-sm font-bold text-[color:var(--ink)]">اطلاعات داروخانه</h2>
        <Field label="نام داروخانه">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="تلفن (اختیاری)">
          <Input dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="روزهای هشدار سررسید چک (۰ تا ۹۰)">
          <Input
            dir="ltr"
            inputMode="numeric"
            value={chequeDays}
            onChange={(e) => setChequeDays(e.target.value)}
          />
        </Field>
        <p className="text-[11px] leading-5 text-[color:var(--ink-soft)]">
          چک‌هایی که تا سررسیدشان این تعداد روز (یا کمتر) مانده، در صفحه چک‌ها با
          هشدار مشخص می‌شوند.
        </p>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "در حال ذخیره…" : "ذخیره اطلاعات"}
        </Button>
      </form>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-bold text-[color:var(--ink)]">وضعیت اشتراک</h2>
        <div className="space-y-2 text-xs text-[color:var(--ink-soft)]">
          <div className="flex justify-between">
            <span>وضعیت فعلی</span>
            <Badge
              color={
                data?.profile?.status === "active"
                  ? "green"
                  : data?.profile?.status === "trial"
                    ? "teal"
                    : "red"
              }
            >
              {data?.profile?.status === "active"
                ? "فعال"
                : data?.profile?.status === "trial"
                  ? "آزمایشی"
                  : "منقضی"}
            </Badge>
          </div>
          {data?.profile?.trialEndsAt && (
            <div className="flex justify-between">
              <span>پایان دوره آزمایشی</span>
              <span>{faDate(data.profile.trialEndsAt)}</span>
            </div>
          )}
          {data?.profile?.subscriptionEndsAt && (
            <div className="flex justify-between">
              <span>پایان اشتراک</span>
              <span>{faDate(data.profile.subscriptionEndsAt)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>مدت دوره آزمایشی</span>
            <span>{faNum(data?.trialDays ?? TRIAL_DAYS)} روز</span>
          </div>
        </div>
        <p className="mt-3 rounded-xl bg-[color:var(--line)] px-3 py-2 text-[11px] leading-5 text-[color:var(--ink-soft)]">
          تمدید اشتراک به‌صورت دستی توسط پشتیبانی انجام می‌شود. پس از پایان دوره آزمایشی یا
          اشتراک، ثبت و ویرایش داده‌ها متوقف و مشاهده و خروجی‌گیری فعال می‌ماند.
        </p>
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-bold text-[color:var(--ink)]">نصب اپلیکیشن</h2>
        <p className="mb-3 text-[11px] leading-5 text-[color:var(--ink-soft)]">
          {APP_NAME} یک PWA است: روی صفحه اصلی گوشی نصب می‌شود و جستجوی کالا و لیست
          ویزیتورها حتی بدون اینترنت هم کار می‌کنند (آخرین داده ذخیره می‌شود).
        </p>
        <InstallButton />
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-bold text-[color:var(--ink)]">پشتیبان‌گیری</h2>
        <p className="mb-3 text-[11px] leading-5 text-[color:var(--ink-soft)]">
          همه داده‌ها به‌صورت خودکار و امن روی سرور ابری (PostgreSQL) ذخیره و محافظت
          می‌شوند. برای اطمینان بیشتر می‌توانید یک نسخه کامل (JSON) از تمام اطلاعات
          داروخانه — کالاها، ویزیتورها، شرایط، درخواست‌های قیمت، سفارش‌ها، چک‌ها،
          یادداشت‌ها و جشنواره‌ها — دانلود کنید.
        </p>
        <Button variant="secondary" className="w-full" onClick={downloadBackup}>
          ⬇️ دانلود کامل اطلاعات من (JSON)
        </Button>
      </div>

      {data?.role === "admin" && (
        <Link href="/admin" className="card flex items-center justify-between p-4 transition active:scale-[0.99]">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-sm font-bold text-[color:var(--ink)]">پنل مدیریت</div>
              <div className="text-[11px] text-[color:var(--ink-soft)]">مدیریت اشتراک داروخانه‌ها</div>
            </div>
          </div>
          <span className="text-[color:var(--ink-soft)]">‹</span>
        </Link>
      )}

      <Button
        variant="danger"
        onClick={async () => {
          await logoutAction();
          // ناوبری سمت کلاینت — به redirect سمت سرور اتکا نمیکنیم
          router.push("/login");
          router.refresh();
        }}
        className="w-full"
      >
        خروج از حساب
      </Button>
    </div>
  );
}
