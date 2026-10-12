import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { baseProducts } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Shared base catalog (read-only for owners). The whole list is small
 * enough to cache as a whole; searching happens client-side for instant
 * live results, and the service worker caches it for offline use.
 */
export async function GET() {
  try {
    const ctx = await requireAuth();
    const data = await withTenant(ctx, async (tx) => {
      const rows = await tx
        .select({
          id: baseProducts.id,
          name: baseProducts.name,
          category: baseProducts.category,
        })
        .from(baseProducts)
        .orderBy(asc(baseProducts.name));
      return { products: rows };
    });
    return NextResponse.json(data);
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
