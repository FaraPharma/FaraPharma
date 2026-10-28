"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { IconUsers, IconBasket, IconCard } from "@/components/nav-cards";
import { faNum } from "@/lib/format";

function IconSearch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.5-4.5" />
    </svg>
  );
}

function IconMore({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="18.5" cy="12" r="1.8" />
    </svg>
  );
}

/** بخش‌هایی که زیر «بیشتر» هستند؛ با باز بودنشان «بیشتر» فعال نشان داده می‌شود */
const MORE_PATHS = ["/more", "/products", "/price-requests", "/shortages", "/quick-notes", "/orders", "/history", "/settings"];

const inPaths = (pathname: string, paths: string[]) => paths.some((p) => pathname === p || pathname.startsWith(p + "/"));

/**
 * ناوبری پایین — ۵ مقصد: جستجو (صفحه‌ی اصلی)، ویزیتورها، لیست خرید (با نشان تعداد)، چک‌ها، بیشتر.
 * مورد فعال با رنگ اصلی؛ بدون شیشه‌ای و بدون دکمه‌ی برجسته.
 */
const ITEMS: {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  match: string[];
  badge?: boolean;
}[] = [
  { href: "/dashboard", label: "جستجو", Icon: IconSearch, match: ["/dashboard"] },
  { href: "/visitors", label: "ویزیتورها", Icon: IconUsers, match: ["/visitors"] },
  { href: "/basket", label: "لیست خرید", Icon: IconBasket, match: ["/basket"], badge: true },
  { href: "/cheques", label: "چک‌ها", Icon: IconCard, match: ["/cheques"] },
  { href: "/more", label: "بیشتر", Icon: IconMore, match: MORE_PATHS },
];

export function BottomNav() {
  const pathname = usePathname();
  const [basketCount, setBasketCount] = useState(0);

  const hidden =
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/privacy");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/basket/count", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { count?: number };
      setBasketCount(Number(j.count ?? 0));
    } catch {
      /* آفلاین: نشانِ آخرین مقدار می‌ماند */
    }
  }, []);

  // تعداد را با هر تغییر صفحه، برگشت به اپ و هر افزودن/حذف در لیست خرید تازه می‌کنیم
  useEffect(() => {
    if (hidden) return;
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener("fara:basket", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      window.removeEventListener("fara:basket", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [hidden, pathname, refresh]);

  if (hidden) return null;

  return (
    <nav
      aria-label="ناوبری اصلی"
      className="fixed inset-x-0 bottom-0 z-40 border-t"
      style={{
        background: "var(--surface)",
        borderColor: "var(--line)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <ul className="mx-auto grid max-w-3xl grid-cols-5">
        {ITEMS.map(({ href, label, Icon, match, badge }) => {
          const active = inPaths(pathname, match);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 transition active:opacity-70"
                style={{ color: active ? "var(--primary)" : "var(--ink-soft)" }}
              >
                <span className="relative">
                  <Icon className="size-6" />
                  {badge && basketCount > 0 && (
                    <span
                      className="tnum absolute -top-1.5 -end-2.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold leading-4"
                      style={{ background: "var(--primary)", color: "#fff" }}
                      aria-label={`${faNum(basketCount)} ردیف در لیست خرید`}
                    >
                      {basketCount > 99 ? `${faNum(99)}+` : faNum(basketCount)}
                    </span>
                  )}
                </span>
                <span className={`text-[11px] leading-4 ${active ? "font-bold" : "font-medium"}`}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
