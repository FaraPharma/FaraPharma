"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { probeOnline } from "@/lib/connectivity";

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

function isEditing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function SwRegister() {
  // فقط وقتی «واقعاً» به سرور نرسیم آفلاین است (navigator.onLine تنها کافی نیست)
  const [offline, setOffline] = useState<boolean>(false);
  const [updateReady, setUpdateReady] = useState(false);
  const dirtyRef = useRef(false); // کاربر چیزی در فرم تایپ کرده و هنوز ثبت نکرده
  const pathname = usePathname();

  // با تغییر صفحه، «در حال پر کردن فرم» بودن صفر می‌شود
  useEffect(() => {
    dirtyRef.current = false;
  }, [pathname]);

  useEffect(() => {
    let alive = true;
    const verify = async () => {
      if (navigator.onLine) {
        setOffline(false);
        return;
      }
      const ok = await probeOnline();
      if (alive) setOffline(!ok);
    };
    const on = () => setOffline(false);
    const off = () => void verify();
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    void verify(); // مرورگر ممکن است از ابتدا اشتباه «آفلاین» بگوید
    const poll = window.setInterval(() => void verify(), 15_000);

    const markDirty = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
        dirtyRef.current = true;
      }
    };
    const clearDirty = () => {
      dirtyRef.current = false;
    };
    document.addEventListener("input", markDirty, true);
    document.addEventListener("submit", clearDirty, true);

    let cleanupSw: (() => void) | null = null;
    if ("serviceWorker" in navigator) {
      const sw = navigator.serviceWorker;
      const hadController = !!sw.controller; // نصب اولِ برنامه reload نمی‌خواهد
      let reloading = false;

      const onControllerChange = () => {
        if (!hadController || reloading) return;
        if (dirtyRef.current || isEditing()) {
          setUpdateReady(true); // وسط پر کردن فرم: فقط نوار نشان بده
          return;
        }
        reloading = true;
        window.location.reload();
      };
      sw.addEventListener("controllerchange", onControllerChange);

      let reg: ServiceWorkerRegistration | null = null;
      const update = () => {
        if (reg) reg.update().catch(() => undefined);
      };
      const onVisible = () => {
        if (document.visibilityState === "visible") update();
      };

      sw
        .register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`, { updateViaCache: "none" })
        .then((r) => {
          reg = r;
          update(); // هنگام باز شدن برنامه
        })
        .catch(() => {
          /* non-critical */
        });
      document.addEventListener("visibilitychange", onVisible);

      cleanupSw = () => {
        sw.removeEventListener("controllerchange", onControllerChange);
        document.removeEventListener("visibilitychange", onVisible);
      };
    }

    return () => {
      alive = false;
      window.clearInterval(poll);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("submit", clearDirty, true);
      cleanupSw?.();
    };
  }, []);

  if (!offline && !updateReady) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50">
      {updateReady && (
        <div
          className="flex items-center justify-center gap-3 px-4 py-2 text-xs font-bold"
          style={{ background: "var(--primary)", color: "var(--on-primary)" }}
        >
          <span>نسخه‌ی جدید آماده است</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg px-3 py-1 text-xs font-bold"
            style={{ background: "var(--on-primary)", color: "var(--primary-dark)" }}
          >
            تازه‌سازی
          </button>
        </div>
      )}
      {offline && (
        <div
          className="px-4 py-2 text-center text-xs font-bold"
          style={{ background: "var(--warning)", color: "var(--on-primary)" }}
        >
          حالت آفلاین — داده‌های ذخیره‌شده نمایش داده می‌شود؛ ثبت تغییرات نیاز به اینترنت دارد
        </div>
      )}
    </div>
  );
}
