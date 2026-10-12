import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
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
