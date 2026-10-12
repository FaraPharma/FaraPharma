import { Pool } from "pg";

export const dynamic = "force-dynamic";

async function attempt(
  label: string,
  cs: string,
  ssl: false | { rejectUnauthorized: boolean } | undefined
) {
  const pool = new Pool({
    connectionString: cs,
    max: 1,
    connectionTimeoutMillis: 8000,
    ssl,
  });
  try {
    await pool.query("select 1");
    return { label, ok: true };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { label, ok: false, code: err.code, message: err.message };
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function GET() {
  const raw = process.env.DATABASE_URL ?? "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return Response.json({ ok: false, message: "URL-INVALID" });
  }
  const base = (port: string) => {
    const x = new URL(raw);
    x.port = port;
    x.search = "";
    return x.toString();
  };
  const results = [];
  results.push(await attempt("5432 ssl-noverify", base("5432"), { rejectUnauthorized: false }));
  results.push(await attempt("6543 ssl-noverify", base("6543"), { rejectUnauthorized: false }));
  results.push(await attempt("5432 ssl-default", base("5432"), undefined));
  return Response.json({
    host: u.host,
    user: u.username,
    pwLen: decodeURIComponent(u.password).length,
    results,
  });
}
