"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place: location.pathname, message: error.message }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);
  return (
    <html lang="fa" dir="rtl">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, textAlign: "center" }}>
        <p>مشکلی پیش آمد. اطلاعات شما سالم است.</p>
        <button type="button" onClick={() => reset()} style={{ padding: "10px 18px" }}>تلاش دوباره</button>
      </body>
    </html>
  );
}
