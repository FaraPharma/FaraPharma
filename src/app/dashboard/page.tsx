"use client";

import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { useOfflineData } from "@/hooks/useOfflineData";
import { PageHeader, Spinner, Button } from "@/components/ui";
import {
  IconUsers,
  IconBox,
  IconBanknote,
  IconCard,
  IconAlert,
  IconNote,
  IconClock,
  IconGear,
} from "@/components/nav-cards";
import { GlobalSearch } from "@/components/global-search";
import {
  compactToman,
  daysLeft,
  effectiveStatus,
  faDate,
  faDateTime,
  faNum,
} from "@/lib/format";

type IconType = ComponentType<{ className?: string }>;

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

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--ink-soft)" }}
      aria-hidden="true"
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

/** کارت بزرگ: آیکون، عدد و عنوان */
function BigCard({
  href,
  title,
  value,
  Icon,
}: {
  href: string;
  title: string;
  value: number;
  Icon: IconType;
}) {
  return (
    <Link
      href={href}
      className="card flex min-h-28 flex-col justify-between p-4 transition active:scale-[0.98]"
    >
      <div className="flex items-start justify-between">
        <div
          className="grid size-11 place-items-center rounded-2xl"
          style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
        >
          <Icon className="size-6" />
        </div>
        <div className="tnum text-2xl font-extrabold" style={{ color: "var(--ink)" }}>
          {faNum(value)}
        </div>
      </div>
      <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
        {title}
      </div>
    </Link>
  );
}

/** یک ردیف هشدار کهربایی */
function AlertRow({
  href,
  Icon,
  title,
  desc,
}: {
  href?: string;
  Icon: IconType;
  title: string;
  desc?: ReactNode;
}) {
  const inner = (
    <>
      <div
        className="grid size-9 shrink-0 place-items-center rounded-xl"
        style={{ background: "var(--surface)", color: "var(--warning-ink)" }}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold" style={{ color: "var(--warning-ink)" }}>
          {title}
        </div>
        {desc ? (
          <div className="tnum truncate text-[11px]" style={{ color: "var(--warning-ink)" }}>
            {desc}
          </div>
        ) : null}
      </div>
      {href ? <Chevron /> : null}
    </>
  );
  const cls = "flex min-h-14 items-center gap-3 px-4 py-2.5";
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** پیام وضعیت (اشتراک / آفلاین) — فقط وقتی هشدار دارد */
function Notice({
  tone,
  children,
}: {
  tone: "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-2xl px-4 py-3 text-xs font-medium leading-5"
      style={{
        background: `var(--${tone}-soft)`,
        color: `var(--${tone === "warning" ? "warning" : "danger"}-ink)`,
      }}
    >
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const { data, error, loading, stale, savedAt, reload } =
    useOfflineData<DashboardData>("/api/dashboard");

  if (loading && !data) {
    return (
      <div className="py-10 text-center">
        <Spinner />
        <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
          در حال بارگذاری…
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card space-y-3 p-5 text-center">
        <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>
          دریافت اطلاعات ممکن نشد
        </p>
        <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
          {error ?? "اتصال را بررسی کنید و دوباره تلاش کنید."}
        </p>
        <Button variant="primary" onClick={() => reload()}>
          تلاش دوباره
        </Button>
      </div>
    );
  }

  const counts = data.counts;
  const overdue = data.cheques?.overdueCount ?? 0;
  const upcoming = data.cheques?.upcomingCount ?? 0;
  const lowStock = data.lowStockCount ?? 0;
  const offers = data.expiringOffers ?? [];
  const notesCount = data.quickNotes?.length ?? 0;
  const subStatus = data.profile ? effectiveStatus(data.profile) : "active";
  const trialLeft = data.profile ? daysLeft(data.profile.trialEndsAt) : null;

  const hasAlerts =
    overdue > 0 || upcoming > 0 || counts.shortages > 0 || lowStock > 0 || offers.length > 0;
  const isEmpty =
    counts.products === 0 &&
    counts.visitors === 0 &&
    counts.openOrders === 0 &&
    counts.openRequests === 0 &&
    counts.shortages === 0 &&
    overdue === 0 &&
    upcoming === 0 &&
    notesCount === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.profile?.name ?? "داشبورد"}
        subtitle={faDate(new Date())}
        action={
          <Button
            variant="secondary"
            onClick={() => reload()}
            aria-label="بروزرسانی"
            className="px-3 py-2 text-xs"
          >
            <IconRefresh className="size-4" />
            بروزرسانی
          </Button>
        }
      />

      <GlobalSearch variant="field" />

      {(subStatus !== "active" || error || stale) && (
        <div className="space-y-2">
          {subStatus === "expired" && (
            <Notice tone="danger">
              اشتراک منقضی شده است؛ مشاهده و خروجی‌گیری فعال است اما ثبت و ویرایش غیرفعال شده.
              برای تمدید با پشتیبانی تماس بگیرید.
            </Notice>
          )}
          {subStatus === "trial" && (
            <Notice tone="warning">
              دوره آزمایشی
              {trialLeft !== null && trialLeft > 0
                ? ` — ${faNum(trialLeft)} روز باقی مانده`
                : " در حال پایان است"}
            </Notice>
          )}
          {error && <Notice tone="warning">{error}</Notice>}
          {stale && (
            <Notice tone="warning">
              نمایش داده‌ی آفلاین
              {savedAt ? ` — آخرین بروزرسانی: ${faDateTime(new Date(savedAt))}` : ""}
            </Notice>
          )}
        </div>
      )}

      {isEmpty ? (
        <section className="card space-y-3 p-5 text-center">
          <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>
            هنوز اطلاعاتی ثبت نشده
          </p>
          <p className="text-xs leading-5" style={{ color: "var(--ink-soft)" }}>
            با افزودن اولین ویزیتور شروع کنید؛ بعد از آن کالاها و چک‌ها را اضافه کنید.
          </p>
          <Link href="/visitors" className="btn-primary w-full">
            افزودن ویزیتور
          </Link>
        </section>
      ) : hasAlerts ? (
        <section>
          <h2 className="mb-2 text-sm font-bold" style={{ color: "var(--ink-soft)" }}>
            نیاز به توجه
          </h2>
          <div
            className="overflow-hidden rounded-2xl"
            style={{ background: "var(--warning-soft)" }}
          >
            <div className="divide-y-2 divide-[color:var(--surface)]">
              {overdue > 0 && (
                <AlertRow
                  href="/cheques"
                  Icon={IconCard}
                  title={`${faNum(overdue)} چک سررسید گذشته`}
                  desc={`جمعاً ${compactToman(data.cheques.overdueTotal)} — نیاز به پیگیری`}
                />
              )}
              {upcoming > 0 && (
                <AlertRow
                  href="/cheques"
                  Icon={IconCard}
                  title={`${faNum(upcoming)} چک تا ۷ روز آینده سررسید دارد`}
                  desc={`جمعاً ${compactToman(data.cheques.upcomingTotal)}`}
                />
              )}
              {counts.shortages > 0 && (
                <AlertRow
                  href="/shortages"
                  Icon={IconAlert}
                  title={`${faNum(counts.shortages)} کالای کسری ثبت شده`}
                  desc="نیاز به پیگیری با ویزیتور"
                />
              )}
              {lowStock > 0 && (
                <AlertRow
                  href="/products"
                  Icon={IconBox}
                  title={`${faNum(lowStock)} مورد «کم‌موجود»`}
                  desc="مقایسه کنید تا جایگزین پیدا شود"
                />
              )}
              {offers.length > 0 && (
                <AlertRow
                  Icon={IconClock}
                  title={`${faNum(offers.length)} آفر رو به پایان`}
                  desc={`${offers[0].productName} — ${offers[0].visitorName}، تا ${faDate(offers[0].validUntil)}`}
                />
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="card flex items-center gap-3 p-4">
          <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>
            همه‌چیز مرتب است
          </p>
          <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
            مورد فوری وجود ندارد
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-bold" style={{ color: "var(--ink-soft)" }}>
          کارهای پرتکرار
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <BigCard href="/visitors" title="ویزیتورها" value={counts.visitors} Icon={IconUsers} />
          <BigCard href="/products" title="کالاها" value={counts.products} Icon={IconBox} />
          <BigCard
            href="/price-requests"
            title="درخواست قیمت"
            value={counts.openRequests}
            Icon={IconBanknote}
          />
          <BigCard href="/cheques" title="چک‌های نزدیک" value={overdue + upcoming} Icon={IconCard} />
          <BigCard href="/shortages" title="کسری‌ها" value={counts.shortages} Icon={IconAlert} />
          <BigCard href="/quick-notes" title="یادداشت‌ها" value={notesCount} Icon={IconNote} />
        </div>
      </section>

      <section className="card divide-y divide-[color:var(--line)] overflow-hidden">
        {[
          { href: "/orders", title: "سفارش فوری", Icon: IconAlert, extra: counts.openOrders > 0 ? `${faNum(counts.openOrders)} باز` : "" },
          { href: "/history", title: "تاریخچه", Icon: IconClock, extra: "" },
          { href: "/settings", title: "حساب و تنظیمات", Icon: IconGear, extra: "" },
        ].map(({ href, title, Icon, extra }) => (
          <Link key={href} href={href} className="flex min-h-14 items-center gap-3 px-4">
            <Icon className="size-5 shrink-0" />
            <span className="flex-1 text-sm font-medium" style={{ color: "var(--ink)" }}>
              {title}
            </span>
            {extra && (
              <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                {extra}
              </span>
            )}
            <Chevron />
          </Link>
        ))}
      </section>
    </div>
  );
}
