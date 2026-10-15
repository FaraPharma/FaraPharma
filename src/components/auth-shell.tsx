"use client";

import type { ReactNode } from "react";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/config";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center px-4 py-8"
      style={{ background: "var(--bg)" }}
    >
      <div className="mb-6 text-center">
        <img
          src="/icons/icon-512.png"
          alt={APP_NAME}
          className="mx-auto mb-4 size-20 rounded-2xl"
        />
        <h1 className="text-xl font-bold text-[color:var(--ink)]">{APP_NAME}</h1>
        <p className="mx-auto mt-1.5 max-w-xs text-xs leading-5 text-[color:var(--ink-soft)]">
          {APP_DESCRIPTION}
        </p>
      </div>
      <div className="card w-full max-w-md p-6">{children}</div>
      <p className="mt-5 text-[11px] text-[color:var(--ink-soft)]">
        قابل نصب روی صفحه اصلی گوشی (PWA) · کار آفلاین
      </p>
    </div>
  );
}
