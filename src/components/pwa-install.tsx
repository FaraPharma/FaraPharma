"use client";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** ذخیره‌سازی سراسری رویداد beforeinstallprompt — قابل استفاده از هر صفحه‌ای */
let deferredPrompt: BeforeInstallPromptEvent | null = null;

/** دریافت prompt ذخیره‌شده از هرجای اپ */
export function getStoredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

/** ثبت prompt در حافظه‌ی مشترک — برای استفاده‌ی کامپوننت‌هایی که خودشان گوش‌می‌دهند */
export function setStoredPrompt(e: BeforeInstallPromptEvent | null): void {
  deferredPrompt = e;
}

/** آیا اپ در حالت نصب‌شده (standalone) اجرا می‌شود؟ */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/** تشخیص iOS با user agent */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !/Android/i.test(ua);
}
