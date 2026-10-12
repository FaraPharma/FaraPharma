"use client";

import type { ReactNode } from "react";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/config";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-b from-teal-600 via-teal-700 to-cyan-800 px-4 py-8">
      <div className="mb-6 text-center">
        <img
          src="/icons/icon-512.png"
          alt={APP_NAME}
          className="mx-auto mb-4 size-20 rounded-3xl shadow-lg"
        />
        <h1 className="text-xl font-bold text-white">{APP_NAME}</h1>
        <p className="mt-1.5 max-w-xs text-xs leading-5 text-teal-100">
          {APP_DESCRIPTION}
        </p>
      </div>
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        {children}
      </div>
      <p className="mt-5 text-[11px] text-teal-200">
        قابل نصب روی صفحه اصلی گوشی (PWA) · کار آفلاین
      </p>
    </div>
  );
}
