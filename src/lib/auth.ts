import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { AUTH_COOKIE, getAuthSecret } from "@/lib/config";
import { AppError, isUserDisabled, type AuthCtx } from "@/db";

export interface SessionPayload {
  sub: string;
  tid: string;
  role: "owner" | "admin";
  email: string;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  const key = getAuthSecret();
  return new SignJWT({ tid: payload.tid, role: payload.role, email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(key);
}

export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  const key = getAuthSecret(); // خطای صریح در نبود کلید؛ داخل try نیست
  try {
    const { payload } = await jwtVerify(token, key);
    return {
      sub: payload.sub as string,
      tid: payload.tid as string,
      role: (payload.role as "owner" | "admin") ?? "owner",
      email: (payload.email as string) ?? "",
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload) {
  const store = await cookies();
  const token = await signSession(payload);
  const opts = {
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
  store.set(AUTH_COOKIE, token, { ...opts, httpOnly: true });
  // Second cookie with the tenant id only (NOT an auth token): httpOnly is
  // explicitly false so the service worker can read it and isolate the
  // offline cache per tenant even on shared browsers.
  store.set("pharma_tid", payload.tid, { ...opts, httpOnly: false });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  store.delete("pharma_tid");
}

export async function getAuth(): Promise<AuthCtx | null> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  return { userId: payload.sub, tenantId: payload.tid, role: payload.role };
}

export async function requireAuth(): Promise<AuthCtx> {
  const ctx = await getAuth();
  if (!ctx) throw new AppError("ابتدا وارد حساب خود شوید", 401);
  // بررسی زنده‌ی وضعیت غیرفعال‌سازی — برخلاف وضعیت اشتراک (که فقط نوشتن را
  // می‌بندد)، غیرفعال‌سازی توسط ادمین باید فوری و کامل باشد، حتی برای
  // نشست‌های از قبل معتبر.
  const disabled = await isUserDisabled(ctx.userId);
  if (disabled) {
    await clearSession();
    throw new AppError("دسترسی این حساب توسط مدیر قطع شده است", 403);
  }
  return ctx;
}

export async function requireAdmin(): Promise<AuthCtx> {
  const ctx = await requireAuth();
  if (ctx.role !== "admin") throw new AppError("دسترسی غیرمجاز", 403);
  return ctx;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) =>
  bcrypt.compare(pw, hash);
