export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.DATABASE_URL ?? "";
  return Response.json({
    DATABASE_URL: url ? `ok (${url.length} chars)` : "MISSING",
    DATABASE_URL_starts: url.slice(0, 11),
    AUTH_SECRET: process.env.AUTH_SECRET
      ? `ok (${process.env.AUTH_SECRET.length} chars)`
      : "MISSING",
  });
}
