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

// شناسه‌ی build: با هر build عوض می‌شود. از commit SHA (در صورت وجود) یا زمان ساخته می‌شود
// و در process.env نگه داشته می‌شود تا هر بار بارگذاری config همان مقدار را بدهد.
if (!process.env.FARAPHARMA_BUILD_ID) {
  const sha =
    process.env.WORKERS_CI_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "";
  const clean = sha.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  process.env.FARAPHARMA_BUILD_ID = clean || Date.now().toString(36);
}
const BUILD_ID = process.env.FARAPHARMA_BUILD_ID as string;

const noCacheHeaders = [
  { key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" },
];

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
  generateBuildId: async () => BUILD_ID,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // فایل‌های public روی Cloudflare مستقیم از Assets می‌آیند و این هدر به آن‌ها نمی‌رسد؛
      // هدر اصلی در public/_headers است. این‌جا برای محیط‌هایی که از Next سرو می‌شوند.
      { source: "/sw.js", headers: noCacheHeaders },
      { source: "/manifest.json", headers: noCacheHeaders },
    ];
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
