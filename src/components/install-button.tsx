"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { getStoredPrompt, setStoredPrompt, isIOS, isStandalone } from "@/components/pwa-install";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * دکمه‌ی نصب PWA در صفحه‌ی تنظیمات — از همان حافظه‌ی مشترک prompt استفاده
 * می‌کند (هماهنگ با register-install.tsx). اگر مرورگر رویداد خودکار نصب را
 * ندهد یا اصلاً پشتیبانی نکند (iOS/سافاری)، به‌جای مخفی‌شدن کامل، راهنمای
 * دستی نشان می‌دهد.
 */
export function InstallButton() {
  const [hasPrompt, setHasPrompt] = useState(() => getStoredPrompt() !== null);
  const [installed, setInstalled] = useState(isStandalone());
  const [ios, setIos] = useState(false);
  const [showManualGuide, setShowManualGuide] = useState(false);

  useEffect(() => {
    setIos(isIOS());
    const onBip = (e: Event) => {
      e.preventDefault();
      setStoredPrompt(e as BeforeInstallPromptEvent);
      setHasPrompt(true);
    };
    const onInstalled = () => {
      setStoredPrompt(null);
      setInstalled(true);
      setHasPrompt(false);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    const timer = window.setTimeout(() => {
      if (!getStoredPrompt()) setShowManualGuide(true);
    }, 2500);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      window.clearTimeout(timer);
    };
  }, []);

  async function install() {
    const p = getStoredPrompt() as BeforeInstallPromptEvent | null;
    if (!p) {
      toast.error("نصب خودکار فعلاً در دسترس نیست");
      return;
    }
    try {
      await p.prompt();
      const choice = await p.userChoice;
      if (choice.outcome === "accepted") toast.success("اپ نصب شد 🎉");
    } catch {
      /* کاربر منصرف شد */
    }
    setStoredPrompt(null);
    setHasPrompt(false);
  }

  if (installed) {
    return (
      <p className="text-xs font-medium" style={{ color: "var(--teal-2)" }}>
        ✓ اپ روی دستگاه نصب شده است
      </p>
    );
  }

  if (ios) {
    return (
      <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)", background: "var(--bg)" }}>
        <p className="text-[11px] leading-6" style={{ color: "var(--ink-soft)" }}>
          📲 در سافاری، از دکمه‌ی اشتراک‌گذاری، گزینه‌ی «افزودن به صفحه‌ی اصلی» را بزنید
        </p>
      </div>
    );
  }

  if (hasPrompt) {
    return (
      <Button onClick={install} className="w-full">
        📲 نصب روی صفحه اصلی گوشی
      </Button>
    );
  }

  if (showManualGuide) {
    return (
      <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)", background: "var(--bg)" }}>
        <p className="text-[11px] leading-6" style={{ color: "var(--ink-soft)" }}>
          📲 از منوی سه‌نقطه‌ی بالای مرورگر، گزینه‌ی «Install app» یا «افزودن به صفحه‌ی اصلی» را بزنید
        </p>
      </div>
    );
  }

  return null;
}
