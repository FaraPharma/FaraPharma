"use client";

import Link from "next/link";
import type { ComponentType } from "react";

/**
 * کارت‌های ناوبری اصلی — کارت سفید، آیکون خطی تک‌رنگ داخل مربع کم‌رنگ،
 * عنوان تیره و توضیح کم‌رنگ. کارت «سفارش فوری» به‌عمد کم‌رنگ‌تر و
 * خط‌چین است چون مسیر استثناست، نه گردش‌کار روزمره.
 */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type IconProps = { className?: string };

export function IconUsers({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18.5 15.4c1.7.9 2.8 2.5 3 4.6" />
    </svg>
  );
}
export function IconBox({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke}>
      <path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z" />
      <path d="M3.3 8.6 12 13.4l8.7-4.8" />
      <path d="M12 13.4V21" />
    </svg>
  );
}
export function IconBasket({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke}>
      <path d="M3 4h2.2l2 11h10.4l1.9-8H6.2" />
      <circle cx="9" cy="19.5" r="1.4" />
      <circle cx="17" cy="19.5" r="1.4" />
    </svg>
  );
}
export function IconReceipt({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke}>
      <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}
export function IconAlert({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke}>
      <path d="M10.3 4.6 2.7 18a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4.5" />
      <path d="M12 17h.01" />
    </svg>
  );
}
export function IconBanknote({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}
export function IconCard({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M7 15h4" />
    </svg>
  );
}
export function IconNote({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
export function IconGear({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}
export function IconHome({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}
export function IconClock({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

/**
 * همه‌ی کارت‌ها تک‌رنگ‌اند (رنگ اصلی). تن «urgent» تنها استثنای معنایی است:
 * قرمز کم‌رنگ و خط‌چین، چون مسیر سفارش فوری باید عمداً کمتر دعوت‌کننده باشد.
 * کلیدهای تن برای سازگاری با صفحه‌ها نگه داشته شده‌اند.
 */
const PRIMARY_TONE = "bg-[color:var(--primary-soft)] text-[color:var(--primary-dark)]";
const TONES = {
  violet: PRIMARY_TONE,
  emerald: PRIMARY_TONE,
  amber: PRIMARY_TONE,
  pink: PRIMARY_TONE,
  cobalt: PRIMARY_TONE,
  muted: PRIMARY_TONE,
  urgent: "bg-[color:var(--danger-soft)] text-[color:var(--danger-ink)]",
} as const;

export type NavTone = keyof typeof TONES;

export interface NavCardDef {
  href: string;
  title: string;
  desc: string;
  tone: NavTone;
  Icon: ComponentType<IconProps>;
}

export const NAV_ITEMS: NavCardDef[] = [
  { href: "/visitors", title: "ویزیتورها", desc: "پرونده و کاتالوگ هرکدوم", tone: "emerald", Icon: IconUsers },
  { href: "/products", title: "جستجوی کالا", desc: "مقایسه شرایط ویزیتورها", tone: "violet", Icon: IconBox },
  { href: "/price-requests", title: "درخواست قیمت", desc: "مقایسه زنده پاسخ‌ها", tone: "amber", Icon: IconBanknote },
  { href: "/cheques", title: "چک‌ها", desc: "سررسید و یادآوری", tone: "cobalt", Icon: IconCard },
  { href: "/basket", title: "لیست خرید", desc: "متن سفارش آماده برای هر ویزیتور", tone: "emerald", Icon: IconBasket },
  { href: "/shortages", title: "کسری‌ها", desc: "لیست کالاهای کسری", tone: "pink", Icon: IconAlert },
  { href: "/quick-notes", title: "یادداشت‌ها", desc: "ثبت سریع و پردازش بعداً", tone: "amber", Icon: IconNote },
  { href: "/history", title: "تاریخچه", desc: "تغییرات قیمت و چک‌ها", tone: "muted", Icon: IconClock },
  {
    href: "/orders",
    title: "سفارش فوری",
    desc: "فقط برای مواقع ضروری — وقتی ویزیتور در دسترس نیست",
    tone: "urgent",
    Icon: IconAlert,
  },
  { href: "/settings", title: "حساب و تنظیمات", desc: "واحد قیمت، پشتیبان‌گیری", tone: "muted", Icon: IconGear },
];

export function NavCard({ href, title, desc, tone, Icon }: NavCardDef) {
  if (tone === "urgent") {
    return (
      <Link
        href={href}
        className="flex min-h-11 flex-col gap-3 rounded-2xl border-[1.5px] border-dashed p-4 transition active:scale-[0.98]"
        style={{ borderColor: "var(--danger)", background: "var(--danger-soft)" }}
      >
        <div className={`grid size-11 place-items-center rounded-2xl ${TONES.urgent}`}>
          <Icon className="size-6" />
        </div>
        <div>
          <div className="text-sm font-bold text-[color:var(--danger-ink)]">{title}</div>
          <div className="mt-0.5 text-[11px] leading-4 text-[color:var(--danger-ink)]">{desc}</div>
        </div>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className="card flex min-h-11 flex-col gap-3 p-4 transition active:scale-[0.98]"
    >
      <div className={`grid size-11 place-items-center rounded-2xl ${TONES[tone]}`}>
        <Icon className="size-6" />
      </div>
      <div>
        <div className="text-sm font-bold text-[color:var(--ink)]">{title}</div>
        <div className="mt-0.5 text-[11px] leading-4 text-[color:var(--ink-soft)]">{desc}</div>
      </div>
    </Link>
  );
}

/** شبکه دوستونه یکسان برای مقصدهای اصلی */
export function NavGrid() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {NAV_ITEMS.map((n) => (
        <NavCard key={n.href} {...n} />
      ))}
    </div>
  );
}
