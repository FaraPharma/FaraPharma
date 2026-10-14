"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  IconHome,
  IconUsers,
  IconBox,
  IconBanknote,
  IconCard,
} from "@/components/nav-cards";

/**
 * ناوبری پایین — ۵ مقصد اصلی، آیکون تک‌رنگ و برچسب کوتاه.
 * مورد فعال با رنگ اصلی؛ بدون شیشه‌ای و بدون دکمه‌ی برجسته.
 */
const ITEMS: {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { href: "/dashboard", label: "خانه", Icon: IconHome },
  { href: "/visitors", label: "ویزیتورها", Icon: IconUsers },
  { href: "/products", label: "کالاها", Icon: IconBox },
  { href: "/price-requests", label: "قیمت", Icon: IconBanknote },
  { href: "/cheques", label: "چک‌ها", Icon: IconCard },
];

export function BottomNav() {
  const pathname = usePathname();
  if (
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/privacy")
  ) {
    return null;
  }

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
        {ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 transition active:opacity-70"
                style={{ color: active ? "var(--primary)" : "var(--ink-soft)" }}
              >
                <Icon className="size-6" />
                <span className={`text-[11px] leading-4 ${active ? "font-bold" : "font-medium"}`}>
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
