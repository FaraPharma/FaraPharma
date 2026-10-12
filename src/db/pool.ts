import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __pharmaPool?: Pool;
};

export const pool =
  globalForDb.__pharmaPool ??
  new Pool({
    connectionString: databaseUrl,
    max: 10,
    // Supabase pooler serves a private CA chain; `sslmode=no-verify` keeps
    // full TLS encryption while skipping CA verification (standard practice
    // for Supabase pooler endpoints).
    ssl: databaseUrl.includes("sslmode=no-verify")
      ? { rejectUnauthorized: false }
      : undefined,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__pharmaPool = pool;
}
