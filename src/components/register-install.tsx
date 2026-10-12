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
 * دکمه/راهنمای نصب در صفحه ثبت‌نام و ورود:
 *  - اگر مرورگر رویداد نصب خودکار را بفرستد (اندروید/کروم): دکمه‌ی نصب مستقیم
 *  - iOS/سافاری: رویداد خودکار اصلاً وجود ندارد → راهنمای متنی همیشگی
 *  - اگر بعد از چند ثانیه هیچ رویدادی نیامد (خیلی از مرورگرها این‌طورند
 *    یا قبلاً رد شده): به‌جای هیچ‌چیز، راهنمای متنی عمومی نشان داده می‌شود
 *  - نصب‌شده/standalone: هیچ نمایشی ندارد
 */
export function RegisterInstall({ trigger }: { trigger: boolean }) {
  const [hasPrompt, setHasPrompt] = useState<boolean>(
    () => getStoredPrompt() !== null
  );
  const [installed, setInstalled] = useState(isStandalone());
  const [ios, setIos] = useState(false);
  // اگر مرورگر تا چند ثانیه بعد از لود صفحه رویداد خودکار نصب را ارسال نکرد
  // (کروم گاهی این رویداد را دیر یا اصلاً ارسال نمی‌کند)، به‌جای عدم نمایش
  // هیچ‌چیز، یک راهنمای متنی دستی همیشگی نشان می‌دهیم.
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

  // نصب‌شده یا standalone → هیچ نمایشی
  if (installed) return null;

  // iOS/سافاری → راهنمای متنی
  if (ios) {
    return (
      <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface,#F8F4EC)] p-4 text-center">
        <p className="text-xs leading-6 text-[color:var(--ink-soft,#6b6157)]">
          📲 <b className="text-[color:var(--ink,#241D17)]">نصب روی آیفون/آی‌پد:</b> در سافاری، از دکمه‌ی
          اشتراک‌گذاری، گزینه‌ی «افزودن به صفحه‌ی اصلی» را بزنید
        </p>
      </div>
    );
  }

  if (hasPrompt) {
    return (
      <Button onClick={install} variant="secondary" className="w-full">
        📲 نصب اپلیکیشن روی گوشی
      </Button>
    );
  }

  // راهنمای دستی همیشگی — وقتی مرورگر رویداد خودکار نصب را ارسال نکرده باشد
  if (showManualGuide) {
    return (
      <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface,#F8F4EC)] p-4 text-center">
        <p className="text-xs leading-6 text-[color:var(--ink-soft,#6b6157)]">
          📲 <b className="text-[color:var(--ink,#241D17)]">نصب روی گوشی:</b> از منوی سه‌نقطه‌ی بالای
          مرورگر، گزینه‌ی «Install app» یا «افزودن به صفحه‌ی اصلی» را بزنید
        </p>
      </div>
    );
  }

  return null;
}
