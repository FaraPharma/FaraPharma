"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place: location.pathname, message: error.message }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);
  return (
    <div className="card p-4 text-center">
      <div className="mb-2 text-sm font-extrabold" style={{ color: "var(--ink)" }}>مشکلی در بارگذاری این صفحه پیش آمد</div>
      <div className="mb-3 text-xs" style={{ color: "var(--ink-soft)" }}>اطلاعات شما سالم است. دوباره تلاش کنید.</div>
      <button type="button" className="btn-primary" onClick={() => reset()}>تلاش دوباره</button>
    </div>
  );
}
