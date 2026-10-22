"use client";

import { useEffect } from "react";

// خطاهای «نسخه‌ی قدیمی صفحه بعد از انتشار نسخه‌ی جدید»: با یک بار بارگذاری مجدد درست می‌شوند
const RECOVER = /ChunkLoadError|Loading chunk|Failed to find Server Action|dynamically imported module|Importing a module script failed/i;
const IGNORE = /ResizeObserver|^Script error\.?$/i;

/**
 * خطاهای جاوااسکریپت مرورگر (که دکمه‌ها را بی‌اثر می‌کنند) را به /api/client-error می‌فرستد تا در
 * «خطاهای اخیر» مدیر دیده شود. برای خطای نسخه‌ی قدیمی، حداکثر دقیقه‌ای یک بار خودکار رفرش می‌کند
 * (اگر کاربر وسط تایپ باشد رفرش نمی‌کند).
 */
export function ClientErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const report = (msg: string) => {
      if (!msg || IGNORE.test(msg) || sent >= 5) return;
      sent++;
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place: `${location.pathname} [js]`, message: msg.slice(0, 300) }),
        keepalive: true,
      }).catch(() => undefined);
      if (RECOVER.test(msg)) {
        const a = document.activeElement;
        const typing = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
        try {
          const last = Number(sessionStorage.getItem("pharma_recover") || 0);
          if (!typing && Date.now() - last > 60_000) {
            sessionStorage.setItem("pharma_recover", String(Date.now()));
            window.setTimeout(() => location.reload(), 300);
          }
        } catch {
          /* ignore */
        }
      }
    };
    const onErr = (e: ErrorEvent) => report(e.message || (e.error instanceof Error ? e.error.message : String(e.error ?? "")));
    const onRej = (e: PromiseRejectionEvent) => report(e.reason instanceof Error ? e.reason.message : String(e.reason ?? ""));
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
  return null;
}
