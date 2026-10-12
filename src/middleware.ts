import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { AUTH_COOKIE, AUTH_SECRET } from "@/lib/config";

const secret = new TextEncoder().encode(AUTH_SECRET);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(AUTH_COOKIE)?.value;

  const toLogin = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  };

  if (!token) return toLogin();

  try {
    const { payload } = await jwtVerify(token, secret);
    if (pathname.startsWith("/admin") && payload.role !== "admin") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
  } catch {
    return toLogin();
  }

  return NextResponse.next();
}

export const runtime = "edge";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/products/:path*",
    "/visitors/:path*",
    "/price-requests/:path*",
    "/orders/:path*",
    "/shortages/:path*",
    "/quick-notes/:path*",
    "/cheques/:path*",
    "/history/:path*",
    "/admin/:path*",
    "/settings/:path*",
  ],
};
