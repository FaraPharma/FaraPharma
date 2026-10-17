import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * مقایسه و هماهنگ‌سازی اسکیمای واقعی دیتابیس با schema.ts (Drizzle).
 *  - ستون‌هایی که کد دارد و دیتابیس ندارد → اضافه می‌شوند (خالی‌پذیر، با DEFAULT کد اگر باشد)
 *  - ستونی که کد خالی‌پذیر می‌داند ولی دیتابیس NOT NULL است → اختیاری می‌شود
 *  - ستون قدیمیِ ناشناس برای کد که NOT NULL و بدون پیش‌فرض است → اختیاری می‌شود (حذف نمی‌شود)
 * هیچ ستون یا داده‌ای حذف نمی‌شود.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Queryable = { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> };

interface CodeCol {
  name: string;
  type: string;
  notNull: boolean;
  primary: boolean;
  defaultSql: string | null;
}
interface CodeTable {
  name: string;
  columns: CodeCol[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defaultSql(col: any): string | null {
  if (!col.hasDefault) return null;
  const d = col.default;
  if (d === undefined || d === null) return null; // $defaultFn سمت JS است
  if (typeof d === "string") return `'${d.replace(/'/g, "''")}'`;
  if (typeof d === "number" || typeof d === "boolean") return String(d);
  if (d instanceof Date) return `'${d.toISOString()}'`;
  if (typeof d === "object" && Array.isArray((d as { queryChunks?: unknown[] }).queryChunks)) {
    const chunks = (d as { queryChunks: unknown[] }).queryChunks;
    const text = chunks
      .map((c) => {
        const v = (c as { value?: unknown }).value;
        return Array.isArray(v) ? v.join("") : typeof c === "string" ? c : "";
      })
      .join("")
      .trim();
    return text || null;
  }
  if (typeof d === "object") return `'${JSON.stringify(d).replace(/'/g, "''")}'`;
  return null;
}

export function codeTables(): CodeTable[] {
  const out: CodeTable[] = [];
  for (const v of Object.values(schema)) {
    if (!is(v, PgTable)) continue;
    const cfg = getTableConfig(v);
    out.push({
      name: cfg.name,
      columns: cfg.columns.map((c) => ({
        name: c.name,
        type: c.getSQLType(),
        notNull: !!c.notNull,
        primary: !!c.primary,
        defaultSql: defaultSql(c),
      })),
    });
  }
  return out;
}

interface DbCol {
  nullable: boolean;
  hasDefault: boolean;
  identity: boolean;
  generated: boolean;
  primary: boolean;
}
interface DbModel {
  tables: Map<string, { isView: boolean; cols: Map<string, DbCol> }>;
}

async function introspectDb(q: Queryable): Promise<DbModel> {
  const t = await q.query(
    "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const c = await q.query(
    "SELECT table_name, column_name, is_nullable, column_default, is_identity, is_generated FROM information_schema.columns WHERE table_schema = 'public'"
  );
  const p = await q.query(
    `SELECT tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
        AND kcu.table_name = tc.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'`
  );
  const pk = new Set<string>(p.rows.map((r) => `${r.table_name}.${r.column_name}`));
  const tables: DbModel["tables"] = new Map();
  for (const r of t.rows) {
    tables.set(String(r.table_name), { isView: r.table_type !== "BASE TABLE", cols: new Map() });
  }
  for (const r of c.rows) {
    const tbl = tables.get(String(r.table_name));
    if (!tbl) continue;
    tbl.cols.set(String(r.column_name), {
      nullable: r.is_nullable === "YES",
      hasDefault: r.column_default !== null && r.column_default !== undefined,
      identity: r.is_identity === "YES",
      generated: r.is_generated === "ALWAYS",
      primary: pk.has(`${r.table_name}.${r.column_name}`),
    });
  }
  return { tables };
}

export interface SchemaDiff {
  tablesChecked: number;
  columnsChecked: number;
  missingTables: string[];
  /** ستون‌های گم‌شده در دیتابیس */
  missingColumns: { table: string; column: string; type: string; defaultSql: string | null }[];
  /** کد خالی‌پذیر می‌داند، دیتابیس NOT NULL است */
  nullabilityMismatch: { table: string; column: string }[];
  /** ستون قدیمیِ اجباری بدون مقدار پیش‌فرض که کد پرش نمی‌کند */
  legacyRequired: { table: string; column: string }[];
  /** جدول‌هایی که در دیتابیس view هستند (فقط وجودشان بررسی می‌شود) */
  skippedViews: string[];
}

export async function diffSchema(q: Queryable): Promise<SchemaDiff> {
  const db = await introspectDb(q);
  const diff: SchemaDiff = {
    tablesChecked: 0,
    columnsChecked: 0,
    missingTables: [],
    missingColumns: [],
    nullabilityMismatch: [],
    legacyRequired: [],
    skippedViews: [],
  };
  for (const ct of codeTables()) {
    const dt = db.tables.get(ct.name);
    if (!dt) {
      diff.missingTables.push(ct.name);
      continue;
    }
    diff.tablesChecked++;
    if (dt.isView) {
      diff.skippedViews.push(ct.name);
      continue;
    }
    const known = new Set<string>();
    for (const col of ct.columns) {
      known.add(col.name);
      diff.columnsChecked++;
      const dc = dt.cols.get(col.name);
      if (!dc) {
        diff.missingColumns.push({ table: ct.name, column: col.name, type: col.type, defaultSql: col.defaultSql });
      } else if (!col.notNull && !col.primary && !dc.nullable && !dc.identity && !dc.primary) {
        diff.nullabilityMismatch.push({ table: ct.name, column: col.name });
      }
    }
    for (const [name, dc] of dt.cols) {
      if (known.has(name)) continue;
      if (!dc.nullable && !dc.hasDefault && !dc.identity && !dc.generated && !dc.primary) {
        diff.legacyRequired.push({ table: ct.name, column: name });
      }
    }
  }
  return diff;
}

export function isClean(d: SchemaDiff): boolean {
  return (
    d.missingTables.length === 0 &&
    d.missingColumns.length === 0 &&
    d.nullabilityMismatch.length === 0 &&
    d.legacyRequired.length === 0
  );
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** مغایرت‌ها را می‌بندد (فقط additive / اختیاری‌کردن)؛ خلاصه‌ی کارها را برمی‌گرداند */
export async function reconcileSchema(client: Queryable): Promise<Record<string, unknown>> {
  const diff = await diffSchema(client);
  for (const m of diff.missingColumns) {
    await client.query(
      `ALTER TABLE ${q(m.table)} ADD COLUMN IF NOT EXISTS ${q(m.column)} ${m.type}${m.defaultSql ? ` DEFAULT ${m.defaultSql}` : ""}`
    );
  }
  for (const m of [...diff.nullabilityMismatch, ...diff.legacyRequired]) {
    await client.query(`ALTER TABLE ${q(m.table)} ALTER COLUMN ${q(m.column)} DROP NOT NULL`);
  }
  return {
    addedColumns: diff.missingColumns.map((m) => `${m.table}.${m.column}`),
    madeOptional: [...diff.nullabilityMismatch, ...diff.legacyRequired].map((m) => `${m.table}.${m.column}`),
    missingTables: diff.missingTables,
    skippedViews: diff.skippedViews,
  };
}
