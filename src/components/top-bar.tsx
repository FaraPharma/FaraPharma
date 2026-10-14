"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/config";
import { GlobalSearch } from "@/components/global-search";

/**
 * نوار بالای ساده — سطح سفید با خط نازک زیرش؛ دسترسی همیشگی به داشبورد.
 */
export function TopBar() {
  const pathname = usePathname();
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/privacy")
  ) {
    return null;
  }
  const isHome = pathname === "/dashboard";

  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{ background: "var(--surface)", borderColor: "var(--line)" }}
    >
      <div className="flex min-h-14 items-center px-4">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/icons/icon-512.png" alt="" className="size-7 rounded-lg" />
            <span className="text-sm font-bold text-[color:var(--ink)]">{APP_NAME}</span>
          </div>
          <div className="flex items-center gap-2">
            {!isHome && <GlobalSearch />}
            {!isHome && (
              <Link
                href="/dashboard"
                className="flex min-h-11 items-center gap-1.5 rounded-full px-4 text-xs font-bold transition active:scale-[0.98]"
                style={{ background: "var(--primary-soft)", color: "var(--primary-dark)" }}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 10.5 12 3l9 7.5" />
                  <path d="M5 9.5V21h14V9.5" />
                  <path d="M9.5 21v-6h5v6" />
                </svg>
                داشبورد
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
