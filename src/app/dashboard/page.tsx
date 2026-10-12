"use client";

import Link from "next/link";
import { useOfflineData } from "@/hooks/useOfflineData";
import { OfflineBadge } from "@/components/offline-badge";
import {
  PageHeader,
  Spinner,
  EmptyState,
  Button,
} from "@/components/ui";
import { NavGrid, IconAlert, IconCard, IconNote, IconBox } from "@/components/nav-cards";
import { SubscriptionBanner } from "@/components/sub-banner";
import { TRIAL_DAYS } from "@/lib/config";
import { compactToman, faDate, faDateTime, faNum } from "@/lib/format";

interface DashboardData {
  profile: {
    id: string;
    name: string;
    phone: string | null;
    status: string;
    trialEndsAt: string | null;
    subscriptionEndsAt: string | null;
    createdAt: string;
  } | null;
  role: string;
  trialDays: number;
  counts: {
    products: number;
    visitors: number;
    openOrders: number;
    openRequests: number;
    shortages: number;
  };
  recentOrders: Array<{
    id: string;
    createdAt: string;
    status: string;
    visitorName: string | null;
    visitorCompany: string | null;
  }>;
  lowStockCount: number;
  expiringOffers: Array<{
    validUntil: string | null;
    offer: string | null;
    productName: string;
    visitorName: string;
  }>;
  cheques: {
    overdueCount: number;
    overdueTotal: number;
    upcomingCount: number;
    upcomingTotal: number;
    nearest: Array<{
      id: string;
      visitorName: string;
      amount: number;
      dueDate: string;
    }>;
  };
  quickNotes: Array<{
    id: string;
    body: string;
    createdAt: string;
  }>;
}

export default function DashboardPage() {
  const { data, error, loading, stale, savedAt, reload } =
    useOfflineData<DashboardData>("/api/dashboard");

  if (loading && !data) return <Spinner />;

  const overdue = data?.cheques?.overdueCount ?? 0;
  const upcoming = data?.cheques?.upcomingCount ?? 0;
  const shortages = data?.counts.shortages ?? 0;
  const lowStock = data?.lowStockCount ?? 0;
  const notesCount = data?.quickNotes?.length ?? 0;
  const nothingUrgent =
    overdue === 0 && upcoming === 0 && shortages === 0 && lowStock === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={data?.profile?.name ?? "داشبورد"}
        subtitle="خلاصه‌ی امروز"
        action={
          <Button variant="secondary" onClick={() => reload()} className="px-3 py-2 text-xs">
            ⟳ بروزرسانی
          </Button>
        }
      />

      <SubscriptionBanner profile={data?.profile ?? null} trialDays={data?.trialDays ?? TRIAL_DAYS} />

      {error && (
        <p className="rounded-xl bg-[color:var(--amber-soft)] px-3 py-2 text-xs font-medium text-[color:#8A5A0E]">
          ⚠️ {error}
        </p>
      )}

      <OfflineBadge stale={stale} savedAt={savedAt} />

      {/* ===== نیاز به توجه — اولویت واقعی امروز، نه آمار خشک ===== */}
      <section>
        <h2 className="mb-2.5 text-sm font-bold" style={{ color: "var(--ink-soft)" }}>
          نیاز به توجه
        </h2>

        <div className="space-y-2">
          {overdue > 0 && (
            <Link
              href="/cheques"
              className="card flex items-center gap-3 border-r-[3px] p-3.5"
              style={{ borderRightColor: "var(--coral-2, #F0562F)" }}
            >
              <div
                className="grid size-9 shrink-0 place-items-center rounded-xl"
                style={{ background: "var(--coral-soft)", color: "#C43F1D" }}
              >
                <IconCard className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>
                  {faNum(overdue)} چک سررسید گذشته
                </div>
                <div className="tnum text-[11px]" style={{ color: "var(--ink-soft)" }}>
                  جمعاً {compactToman(data?.cheques.overdueTotal ?? 0)} — نیاز به پیگیری فوری
                </div>
              </div>
              <span style={{ color: "var(--ink-soft)" }}>‹</span>
            </Link>
          )}

          {upcoming > 0 && (
            <Link
              href="/cheques"
              className="card flex items-center gap-3 border-r-[3px] p-3.5"
              style={{ borderRightColor: "var(--amber-2, #E08A1E)" }}
            >
              <div
                className="grid size-9 shrink-0 place-items-center rounded-xl"
                style={{ background: "var(--amber-soft)", color: "#8A5A0E" }}
              >
                <IconCard className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>
                  {faNum(upcoming)} چک تا ۷ روز آینده سررسید دارد
                </div>
                <div className="tnum text-[11px]" style={{ color: "var(--ink-soft)" }}>
                  جمعاً {compactToman(data?.cheques.upcomingTotal ?? 0)}
                </div>
              </div>
              <span style={{ color: "var(--ink-soft)" }}>‹</span>
            </Link>
          )}

          {shortages > 0 && (
            <Link
              href="/shortages"
              className="card flex items-center gap-3 border-r-[3px] p-3.5"
              style={{ borderRightColor: "var(--violet-2, #5E4BC7)" }}
            >
              <div
                className="grid size-9 shrink-0 place-items-center rounded-xl"
                style={{ background: "var(--violet-soft)", color: "#5E4BC7" }}
              >
                <IconAlert className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>
                  {faNum(shortages)} کالای کسری ثبت شده
                </div>
                <div className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
                  نیاز به پیگیری با ویزیتور
                </div>
              </div>
              <span style={{ color: "var(--ink-soft)" }}>‹</span>
            </Link>
          )}

          {lowStock > 0 && (
            <Link
              href="/products"
              className="card flex items-center gap-3 border-r-[3px] p-3.5"
              style={{ borderRightColor: "var(--teal-1, #12AC93)" }}
            >
              <div
                className="grid size-9 shrink-0 place-items-center rounded-xl"
                style={{ background: "var(--mint-soft)", color: "#0A7C6B" }}
              >
                <IconBox className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>
                  {faNum(lowStock)} مورد با شرایط «کم‌موجود» ثبت شده
                </div>
                <div className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
                  مقایسه کنید تا جایگزین پیدا شود
                </div>
              </div>
              <span style={{ color: "var(--ink-soft)" }}>‹</span>
            </Link>
          )}

          {notesCount > 0 && (
            <Link
              href="/quick-notes"
              className="card flex items-center gap-3 border-r-[3px] p-3.5"
              style={{ borderRightColor: "var(--line)" }}
            >
              <div
                className="grid size-9 shrink-0 place-items-center rounded-xl"
                style={{ background: "var(--amber-soft)", color: "#8A5A0E" }}
              >
                <IconNote className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>
                  {faNum(notesCount)} یادداشت نیمه‌کاره
                </div>
                <div className="text-[11px] truncate" style={{ color: "var(--ink-soft)" }}>
                  {data?.quickNotes[0]?.body ?? "برای تکمیل، بازش کن"}
                </div>
              </div>
              <span style={{ color: "var(--ink-soft)" }}>‹</span>
            </Link>
          )}

          {nothingUrgent && (
            <div
              className="card flex items-center gap-3 p-3.5"
              style={{ borderRight: "3px solid var(--teal-1)" }}
            >
              <div
                className="grid size-9 shrink-0 place-items-center rounded-xl"
                style={{ background: "var(--mint-soft)", color: "#0A7C6B" }}
              >
                ✓
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>
                  همه‌چیز مرتب است
                </div>
                <div className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
                  {faNum(data?.counts.products ?? 0)} محصول، {faNum(data?.counts.visitors ?? 0)} ویزیتور فعال
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ===== دسترسی سریع ===== */}
      <section>
        <h2 className="mb-2.5 text-sm font-bold" style={{ color: "var(--ink-soft)" }}>
          دسترسی سریع
        </h2>
        <NavGrid />
      </section>

      {/* ===== آخرین سفارش‌های فوری ===== */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold" style={{ color: "var(--ink-soft)" }}>
            آخرین سفارش‌های فوری
          </h2>
          <Link href="/orders" className="text-xs font-medium" style={{ color: "var(--teal-2)" }}>
            همه ←
          </Link>
        </div>
        {(data?.recentOrders?.length ?? 0) === 0 ? (
          <EmptyState
            icon="🧾"
            title="هنوز سفارش فوری ثبت نشده"
            desc="این مسیر فقط برای مواقعی است که ویزیتور در دسترس نیست"
          />
        ) : (
          <div className="space-y-2">
            {data?.recentOrders.map((o) => (
              <Link
                key={o.id}
                href="/orders"
                className="card flex items-center justify-between gap-2 px-4 py-3 transition active:scale-[0.99]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" style={{ color: "var(--ink)" }}>
                    {o.visitorName ?? "ویزیتور"}
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
                    {faDateTime(o.createdAt)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {(data?.expiringOffers?.length ?? 0) > 0 && (
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-bold" style={{ color: "var(--ink)" }}>
            ⏳ آفرهای رو به پایان
          </h2>
          <div className="space-y-2">
            {data?.expiringOffers.map((o, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
                style={{ background: "var(--amber-soft)" }}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium" style={{ color: "var(--ink)" }}>
                    {o.productName} — {o.visitorName}
                  </div>
                  <div className="truncate text-[11px]" style={{ color: "var(--ink-soft)" }}>
                    {o.offer}
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
                  style={{ background: "#fff", color: "#8A5A0E" }}
                >
                  تا {faDate(o.validUntil)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
