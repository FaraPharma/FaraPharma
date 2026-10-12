"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { daysLeft } from "@/lib/format";

const HIDDEN_PREFIXES = ["/login", "/register", "/privacy"];

interface RemindableCheque {
  id: string;
  visitorName: string;
  amount: number;
  dueDate: string;
  settled: boolean;
}

/**
 * یادآوری چکهای نزدیک سررسید — دو لایه:
 *  ۱) Web Push واقعی: اشتراک push ثبت میشود و سرور میتواند حتی با
 *     بستهبودن اپ، اعلان ارسال کند (نیازمند VAPID keys در env).
 *  ۲) بررسی دروناپی (هر ۳۰ دقیقه): Notification محلی برای چکهای آستانه.
 */
export function ChequeReminders() {
  const pathname = usePathname();
  const [pushSupported] = useState<boolean>(
    typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window
  );

  // ثبت خودکار اشتراک push پس از load اپ (در صورت مجوز داشتن)
  useEffect(() => {
    if (!pushSupported) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      return;
    }
    registerSubscription().catch(() => undefined);
  }, [pushSupported]);

  async function registerSubscription() {
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const res = await fetch("/api/push/vapid-public");
        if (!res.ok) return; // VAPID ست نشده → push غیرفعال
        const { publicKey } = await res.json();
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
      }
      const j = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(j),
      });
    } catch {
      /* غیر بحرانی */
    }
  }

  // بررسی دروناپی هر ۳۰ دقیقه (لایه دوم — همان رفتار قبلی)
  useEffect(() => {
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    ) {
      return;
    }
    const lastFired = new Set<string>();
    async function check() {
      try {
        const res = await fetch("/api/cheques");
        if (res.status === 401) return;
        const j = (await res.json()) as {
          cheques?: RemindableCheque[];
          warningDays?: number;
        };
        const warningDays = j.warningDays ?? 7;
        for (const c of j.cheques ?? []) {
          const d = daysLeft(c.dueDate);
          if (d === null || d > warningDays || lastFired.has(c.id)) continue;
          lastFired.add(c.id);
          const body =
            d < 0
              ? `${c.visitorName} — ${c.amount.toLocaleString("fa-IR")} تومان، ${-d} روز از سررسید گذشته`
              : `${c.visitorName} — ${c.amount.toLocaleString("fa-IR")} تومان، ${d} روز تا سررسید`;
          try {
            new Notification("💳 چک نزدیک سررسید", {
              body,
              tag: `cheque-${c.id}`,
            });
          } catch {
            /* برخی مرورگرها محدود میکنند */
          }
        }
      } catch {
        /* آفلاین */
      }
    }
    check();
    const t = setInterval(check, 30 * 60_000);
    return () => clearInterval(t);
  }, []);

  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  return null;
}
