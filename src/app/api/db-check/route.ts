import { Pool } from "pg";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  let user = "";
  try {
    const u = new URL(url);
    host = u.host;
    user = u.username;
  } catch {
    host = "URL-INVALID";
  }
  const pool = new Pool({
    connectionString: url,
    max: 1,
    ssl: url.includes("sslmode=no-verify")
      ? { rejectUnauthorized: false }
      : undefined,
  });
  try {
    await pool.query("select 1");
    return Response.json({ ok: true, host, user });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return Response.json({ ok: false, host, user, code: err.code, message: err.message });
  } finally {
    await pool.end().catch(() => {});
  }
}
