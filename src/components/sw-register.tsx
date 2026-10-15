"use client";

import { useEffect, useState } from "react";

export function SwRegister() {
  const [offline, setOffline] = useState<boolean>(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* non-critical */
      });
    }
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      className="fixed inset-x-0 top-0 z-50 px-4 py-2 text-center text-xs font-bold"
      style={{ background: "var(--warning)", color: "var(--on-primary)" }}
    >
      حالت آفلاین — داده‌های ذخیره‌شده نمایش داده می‌شود؛ ثبت تغییرات نیاز به اینترنت دارد
    </div>
  );
}
