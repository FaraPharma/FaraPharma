"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/config";
import { GlobalSearch } from "@/components/global-search";

/**
 * نوار بالای برند — گرادیان فیروزه‌ای به لاجوردی، با یک نوار نازک کاشی‌مانند
 * زیرش (الهام از کاشی‌کاری ایرانی، به‌اندازه نه پررنگ). دسترسی همیشگی به داشبورد.
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
    <header className="sticky top-0 z-40">
      <div
        className="flex h-12 items-center justify-between px-4"
        style={{
          background:
            "linear-gradient(120deg, var(--teal-1) 0%, var(--teal-2) 45%, var(--cobalt-2) 100%)",
        }}
      >
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src="/icons/icon-512.png"
              alt=""
              className="size-6 rounded-lg shadow-sm"
            />
            <span className="text-xs font-bold text-white">{APP_NAME}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <GlobalSearch />
            {!isHome && (
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition active:scale-[0.98]"
                style={{
                  background: "linear-gradient(135deg,#F6C15E,#E08A1E)",
                  color: "#2E1A02",
                  boxShadow: "0 6px 14px rgba(90,55,20,.25)",
                }}
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
      {/* نوار نازک کاشی‌مانند — امضای بصری، نه دکور اضافه */}
      <div
        className="h-[3px] w-full"
        style={{
          background:
            "repeating-linear-gradient(90deg, var(--teal-1) 0 14px, var(--gold) 14px 16px, var(--cobalt-1) 16px 30px, var(--gold) 30px 32px)",
          opacity: 0.8,
        }}
      />
    </header>
  );
}
