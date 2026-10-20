import { recordError } from "@/lib/error-log";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/** هر خطای مدیریت‌نشده‌ی سرور (صفحه، اکشن، مسیر API) با نام مسیر در لاگ نوشته می‌شود */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind?: string; routePath?: string; routeType?: string }
) {
  await recordError(`${request.method} ${request.path} (${context.routeType ?? "?"}:${context.routePath ?? "?"})`, err);
}
