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
    // ---- گزارش کندی واقعی روی گوشی کاربر (حداکثر ۵ مورد در هر بارگذاری) ----
    let perfSent = 0;
    const reportPerf = (msg: string) => {
      if (perfSent >= 5) return;
      perfSent++;
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place: `${location.pathname} [perf]`, message: msg.slice(0, 300) }),
        keepalive: true,
      }).catch(() => undefined);
    };
    const checkNav = () => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (n && n.loadEventEnd > 0 && n.duration > 4000) {
        reportPerf(`[perf] ttfb=${Math.round(n.responseStart)} dcl=${Math.round(n.domContentLoadedEventEnd)} load=${Math.round(n.duration)}ms`);
      }
    };
    if (document.readyState === "complete") window.setTimeout(checkNav, 0);
    else window.addEventListener("load", () => window.setTimeout(checkNav, 0), { once: true });
    let po: PerformanceObserver | null = null;
    try {
      po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration < 3000 || e.name.includes("/api/client-error")) continue;
          let path = e.name;
          try {
            path = new URL(e.name).pathname;
          } catch {
            /* ignore */
          }
          reportPerf(`[slow] ${path} ${Math.round(e.duration)}ms`);
        }
      });
      po.observe({ type: "resource", buffered: true });
    } catch {
      po = null;
    }
    const onErr = (e: ErrorEvent) => report(e.message || (e.error instanceof Error ? e.error.message : String(e.error ?? "")));
    const onRej = (e: PromiseRejectionEvent) => report(e.reason instanceof Error ? e.reason.message : String(e.reason ?? ""));
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      po?.disconnect();
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
  return null;
}
