import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// CSP فقط در حالت Report-Only است تا چیزی نشکند؛ پس از بررسی گزارش‌ها می‌شود
// آن را به Content-Security-Policy واقعی تبدیل کرد.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.ingest.sentry.io https://*.sentry.io",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self)" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Make sure @opentelemetry/api is fully copied into the traced output
  // (OpenNext/Cloudflare bundling fails to resolve it otherwise).
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@opentelemetry/api/**/*",
      "./node_modules/pg-cloudflare/**/*",
    ],
  },
};

// Sentry: در صورت نبود DSN، به‌طور خودکار غیرفعال می‌ماند (بدون خطا)
export default process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
    })
  : nextConfig;
