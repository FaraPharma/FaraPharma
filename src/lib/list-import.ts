/* خواندن لیست ویزیتور از اکسل و PDF — بدون هوش مصنوعی و بدون هزینه؛ فقط قاعده و هندسه‌ی صفحه.
 * خروجی همیشه «پیش‌نمایش» است (کاربر تأیید می‌کند)؛ هیچ ستونی دور ریخته نمی‌شود (extra). */

export type Role = "code" | "name" | "warehouse" | "unit" | "qty" | "price" | "amount" | "offer" | "discount" | "checkDays";

export interface ParsedRow {
  code?: string;
  name: string;
  warehouse?: string;
  unit?: string;
  qty?: number;
  price?: number;
  amount?: number;
  offer?: string;
  discountPct?: number;
  checkDays?: number;
  extra: Record<string, string>;
  flags: string[]; // مثلاً «مبلغ نمی‌خواند»، «نام چندخطی»
}

export interface ColumnInfo {
  label: string;
  role: Role | "extra";
}

export interface ParseResult {
  format: "pdf" | "excel";
  rows: ParsedRow[];
  columns: ColumnInfo[];
  suspicious: number;
  confidence: number; // ۰ تا ۱
  duplicates: number;
  pages: number;
  /** «جمع» پایان لیست اگر پیدا شد (برای کنترل مجموع مبلغ‌ها) */
  reportedTotal?: number;
  /** مجموع مبلغ ردیف‌های خوانده‌شده */
  parsedTotal?: number;
}

export interface PdfItem {
  str: string;
  x: number; // چپِ آیتم
  y: number; // بالای آیتم (به سمت پایین زیاد می‌شود)
  w: number;
  h: number;
}

/* ───────────── نرمال‌سازی متن فارسی ───────────── */

const AR = "٠١٢٣٤٥٦٧٨٩";
const FA = "۰۱۲۳۴۵۶۷۸۹";
const LETTER = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const PRES = /[\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function digitsToAscii(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (c) => {
    const i = AR.indexOf(c);
    return String(i >= 0 ? i : FA.indexOf(c));
  });
}

export function normalizeFa(s: string): string {
  let t = s.replace(/[\uFEF5-\uFEFC]/g, (c) => [...c.normalize("NFKC")].reverse().join("")); // لام‌الف در ترتیب معکوس
  t = t.normalize("NFKC");
  t = t
    .replace(/[\u064B-\u065F\u0670\u0640\u200e\u200f]/g, "")
    .replace(/ك/g, "ک")
    .replace(/[يى]/g, "ی")
    .replace(/[ھہە]/g, "ه");
  return digitsToAscii(t).replace(/\s+/g, " ").trim();
}

/** رشته‌ی «ترتیب دیداری» (حروف هر کلمه برعکس) را به ترتیب منطقی برمی‌گرداند. */
export function visualToLogical(raw: string): string {
  const n = normalizeFa(raw);
  if (!LETTER.test(n)) return n;
  // فقط حروف را برعکس می‌کنیم؛ رقم‌ها و جداکننده‌ی هزارگان («،» «٬») سر جایشان می‌مانند
  const L = "\\u0621-\\u064A\\u0671-\\u06D3\\u06FA-\\u06FF";
  const runs = n.match(new RegExp(`[${L}]+|[0-9A-Za-z.,\u060C\u066B\u066C/%-]+|[^${L}0-9A-Za-z.,\u060C\u066B\u066C/%-]`, "g")) ?? [];
  return runs
    .map((r) => (new RegExp(`[${L}]`).test(r) ? [...r].reverse().join("") : r))
    .reverse()
    .join("");
}

export function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const s = digitsToAscii(String(v)).replace(/[,٬،\s]/g, "").replace(/[^\d.\-]/g, "");
  if (!s || s === "-" || s === ".") return undefined;
  // علامت منفی در ترتیب دیداری ممکن است بعد از عدد بیاید («2-» = منفی ۲)
  const n = Number(/^[\d.]+-$/.test(s) ? "-" + s.slice(0, -1) : s);
  return Number.isFinite(n) ? n : undefined;
}

/* ───────────── تشخیص نقش ستون از روی عنوان ───────────── */

const ROLE_RULES: Array<[Role, RegExp]> = [
  ["amount", /مبلغ|جمع|ارزش|total|amount/i],
  ["price", /قیمت|نرخ|فی$|^فی |price|rate|mrp/i],
  ["offer", /آفر|افر|هدیه|بونوس|offer|bonus/i],
  ["discount", /تخفیف|discount/i],
  ["checkDays", /روز.*چک|چک|مهلت|checkdays/i],
  ["qty", /مانده|موجودی|تعداد|qty|quantity|stock|مقدار/i],
  ["warehouse", /انبار|warehouse|store/i],
  ["unit", /واحد|unit|بسته|بسته‌بندی/i],
  ["code", /(^|\s)کد(\s|$)|^کد|code|sku|شناسه/i],
  ["name", /نام|شرح|کالا|محصول|دارو|name|description|product|item/i],
];

export function roleOf(label: string): Role | null {
  const t = normalizeFa(label).toLowerCase();
  if (!t) return null;
  for (const [role, re] of ROLE_RULES) if (re.test(t)) return role;
  return null;
}

/* ───────────── اکسل / ردیف‌های جدولی ───────────── */

const ROWNUM_RE = /^(ردیف|شماره|row|no\.?|#)$/i;
const TOTAL_RE = /^(جمع|مجموع|total|جمع کل)/i;

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return normalizeFa(String(v));
}

export function parseTable(rows: unknown[][]): ParseResult {
  // ردیف عنوان: اولین ردیفِ ۲۰ ردیف اول که حداقل ۲ نقش متفاوت (از جمله نام یا قیمت) دارد
  let headerIdx = -1;
  let colRoles: Array<Role | null> = [];
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const roles = (rows[i] ?? []).map((c) => roleOf(cellStr(c)));
    const set = new Set(roles.filter(Boolean));
    if (set.size >= 2 && (set.has("name") || set.has("price"))) {
      headerIdx = i;
      colRoles = roles;
      break;
    }
  }
  const legacy = headerIdx < 0;
  if (legacy) colRoles = ["name", "price", "discount", "checkDays", "offer"]; // ترتیب قدیمی برنامه

  // هر نقش فقط به اولین ستونش وصل می‌شود؛ بقیه extra
  const used = new Set<Role>();
  const roleByCol: Array<Role | null> = colRoles.map((r) => {
    if (!r || used.has(r)) return null;
    used.add(r);
    return r;
  });
  const headerCells = legacy ? [] : (rows[headerIdx] ?? []).map(cellStr);
  const width = Math.max(roleByCol.length, ...rows.slice(headerIdx + 1).map((r) => (r ?? []).length));
  const columns: ColumnInfo[] = [];
  for (let c = 0; c < width; c++) {
    const role = roleByCol[c];
    const label = headerCells[c] || (role ? role : `ستون ${c + 1}`);
    columns.push({ label, role: role ?? "extra" });
  }

  const out: ParsedRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const get = (role: Role) => {
      const c = roleByCol.indexOf(role);
      return c >= 0 ? r[c] : undefined;
    };
    const name = cellStr(get("name"));
    if (name.length < 2 || TOTAL_RE.test(name)) continue;
    const row: ParsedRow = { name, extra: {}, flags: [] };
    const code = cellStr(get("code"));
    if (code) row.code = code;
    const wh = cellStr(get("warehouse"));
    if (wh) row.warehouse = wh;
    const un = cellStr(get("unit"));
    if (un) row.unit = un;
    row.qty = toNumber(get("qty"));
    row.price = toNumber(get("price"));
    row.amount = toNumber(get("amount"));
    const of = cellStr(get("offer"));
    if (of) row.offer = of;
    const d = toNumber(get("discount"));
    if (d !== undefined) row.discountPct = d;
    const cd = toNumber(get("checkDays"));
    if (cd !== undefined) row.checkDays = cd;
    columns.forEach((col, c) => {
      if (col.role !== "extra" || ROWNUM_RE.test(col.label)) return;
      const v = cellStr(r[c]);
      if (v) row.extra[col.label] = v;
    });
    checkAmount(row, roleByCol.includes("price"));
    const key = `${row.code ?? ""}|${row.name}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return finish("excel", out, columns, duplicates, 1);
}

function checkAmount(row: ParsedRow, hasPriceCol: boolean) {
  if (row.qty !== undefined && row.price !== undefined && row.amount !== undefined) {
    const calc = row.qty * row.price;
    if (Math.abs(calc - row.amount) > Math.max(2, row.amount * 0.0005)) row.flags.push("مبلغ با مانده×قیمت نمی‌خواند");
  }
  if (hasPriceCol && row.price === undefined) row.flags.push("قیمت پیدا نشد");
}

function finish(format: "pdf" | "excel", rows: ParsedRow[], columns: ColumnInfo[], duplicates: number, pages: number): ParseResult {
  const suspicious = rows.filter((r) => r.flags.length > 0).length;
  return {
    format,
    rows,
    columns,
    suspicious,
    confidence: rows.length ? Math.round(((rows.length - suspicious) / rows.length) * 100) / 100 : 0,
    duplicates,
    pages,
  };
}

/* ───────────── PDF: بازسازی ردیف و ستون از موقعیت کلمه‌ها ───────────── */

interface Tok {
  s: string; // متن منطقی
  x0: number;
  x1: number;
  y: number;
  h: number;
}

function toTokens(items: PdfItem[], reversed: boolean): Tok[] {
  const out: Tok[] = [];
  for (const it of items) {
    const raw = it.str;
    if (!raw || !raw.trim()) continue;
    const parts = raw.split(/\s+/).filter(Boolean);
    const total = raw.length || 1;
    let off = 0;
    for (const p of parts) {
      const idx = raw.indexOf(p, off);
      const a = it.x + (it.w * idx) / total;
      const b = it.x + (it.w * (idx + p.length)) / total;
      off = idx + p.length;
      const s = reversed ? visualToLogical(p) : normalizeFa(p);
      if (s) out.push({ s, x0: a, x1: b, y: it.y, h: it.h || 10 });
    }
  }
  return out;
}

function groupLines(toks: Tok[]): Tok[][] {
  const sorted = [...toks].sort((a, b) => a.y - b.y || b.x1 - a.x1);
  const lines: Tok[][] = [];
  for (const t of sorted) {
    const last = lines[lines.length - 1];
    const lastY = last ? last.reduce((s, x) => s + x.y, 0) / last.length : -1e9;
    if (last && Math.abs(t.y - lastY) <= Math.max(2.5, t.h * 0.45)) last.push(t);
    else lines.push([t]);
  }
  return lines.map((l) => l.sort((a, b) => b.x1 - a.x1)); // راست به چپ
}

interface HeaderCell {
  label: string;
  role: Role | null;
  x0: number;
  x1: number;
}

function headerCells(line: Tok[]): HeaderCell[] {
  const cells: HeaderCell[] = [];
  for (const t of line) {
    const last = cells[cells.length - 1];
    const gap = last ? last.x0 - t.x1 : 1e9;
    if (last && gap < Math.max(8, t.h * 0.9)) {
      last.label += " " + t.s;
      last.x0 = Math.min(last.x0, t.x0);
    } else cells.push({ label: t.s, role: null, x0: t.x0, x1: t.x1 });
  }
  const used = new Set<Role>();
  for (const c of cells) {
    const r = roleOf(c.label);
    if (r && !used.has(r)) {
      c.role = r;
      used.add(r);
    }
  }
  return cells;
}

function isHeaderLine(cells: HeaderCell[]): boolean {
  const roles = new Set(cells.map((c) => c.role).filter(Boolean));
  return roles.size >= 3 && (roles.has("name") || roles.has("price"));
}

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9\-_/.]{1,}$/;

export function parsePdfPages(pages: PdfItem[][]): ParseResult {
  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let cols: HeaderCell[] = [];
  let columnsInfo: ColumnInfo[] = [];
  let reportedTotal: number | undefined;

  for (const items of pages) {
    const letterItems = items.filter((i) => LETTER.test(i.str));
    const presItems = letterItems.filter((i) => PRES.test(i.str));
    // ترتیب حروف را از روی «عنوان ستون‌ها» تشخیص می‌دهیم، نه فقط حدس: کتابخانه‌ی خواندن PDF ممکن است
    // متن را دیداری (برعکس) یا منطقی بدهد. اول حالتی که حدس می‌زنیم، بعد حالت مقابل.
    const guess = letterItems.length > 0 && presItems.length / letterItems.length > 0.1;
    let lines: Tok[][] = [];
    let headerAt = -1;
    for (const mode of [guess, !guess]) {
      const ls = groupLines(toTokens(items, mode));
      for (let i = 0; i < ls.length; i++) {
        const cells = headerCells(ls[i]);
        if (isHeaderLine(cells)) {
          cols = cells;
          headerAt = i;
          columnsInfo = cells.map((c) => ({ label: c.label, role: c.role ?? "extra" }));
          break;
        }
      }
      lines = ls;
      if (headerAt >= 0) break;
    }
    if (cols.length === 0) continue;
    const dataLines = lines.slice(headerAt >= 0 ? headerAt + 1 : 0);

    const numericRoles = cols.filter((c) => c.role && c.role !== "name");
    const colOf = (t: Tok): HeaderCell | null => {
      // اعداد و متن‌های جدول راست‌چین‌اند: لبه‌ی راست، یا مرکز (برای جدول‌های وسط‌چین/چپ‌چین)
      const cx = (t.x0 + t.x1) / 2;
      let best: HeaderCell | null = null;
      let bestD = 1e9;
      for (const c of numericRoles) {
        const dRight = Math.abs(t.x1 - c.x1);
        const dCenter = Math.abs(cx - (c.x0 + c.x1) / 2);
        const d = Math.min(dRight, dCenter);
        if (d <= 14 && d < bestD) {
          best = c;
          bestD = d;
        }
      }
      return best;
    };

    interface Anchor {
      y: number;
      cells: Map<Role, Tok[]>;
      names: Tok[][];
    }
    const anchors: Anchor[] = [];
    const orphanNames: Array<{ y: number; toks: Tok[] }> = [];

    for (const line of dataLines) {
      const cells = new Map<Role, Tok[]>();
      const nameToks: Tok[] = [];
      for (const t of line) {
        const c = colOf(t);
        // در ستون کد فقط توکنِ شبیه کد، کد است؛ تکه‌ی نام که زیر همان ستون افتاده نام می‌ماند
        if (c && c.role === "code" && !CODE_RE.test(t.s)) nameToks.push(t);
        else if (c && c.role) {
          const arr = cells.get(c.role) ?? [];
          arr.push(t);
          cells.set(c.role, arr);
        } else nameToks.push(t);
      }
      const codeTxt = (cells.get("code") ?? []).map((t) => t.s).join("");
      if (!CODE_RE.test(codeTxt) && line.some((t) => /^(جمع|مجموع)$/.test(t.s))) {
        // ردیف «جمع کل» (بدون کد): ردیف کالا نیست؛ فقط برای کنترل مجموع نگه داشته می‌شود
        const nums = line.map((t) => toNumber(t.s)).filter((n): n is number => n !== undefined && n > 1000);
        if (nums.length) reportedTotal = Math.max(...nums);
        continue;
      }
      const hasNum = cells.has("price") || cells.has("qty") || cells.has("amount");
      const y = line.reduce((s, t) => s + t.y, 0) / line.length;
      if (CODE_RE.test(codeTxt) || (hasNum && codeTxt)) anchors.push({ y, cells, names: nameToks.length ? [nameToks] : [] });
      else if (nameToks.length && !hasNum) orphanNames.push({ y, toks: nameToks });
      // خط‌های «جمع» و تیتر صفحه نادیده می‌مانند
    }

    // تکه‌های نامِ بدون کد را به نزدیک‌ترین ردیف وصل می‌کنیم
    for (const o of orphanNames) {
      let best: Anchor | null = null;
      let bd = 1e9;
      for (const a of anchors) {
        const d = Math.abs(a.y - o.y);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      if (best && bd < 22) best.names.push(o.toks);
    }

    anchors.sort((a, b) => a.y - b.y);
    for (const a of anchors) {
      const txt = (r: Role) => (a.cells.get(r) ?? []).map((t) => t.s).join(" ");
      const frags = [...a.names].sort((p, q) => p[0].y - q[0].y);
      const name = frags.map((f) => f.map((t) => t.s).join(" ")).join(" ").replace(/\s+/g, " ").trim();
      if (name.length < 2) continue;
      const row: ParsedRow = { name, extra: {}, flags: [] };
      const code = txt("code").replace(/\s+/g, "");
      if (code) row.code = code;
      if (txt("warehouse")) row.warehouse = txt("warehouse");
      if (txt("unit")) row.unit = txt("unit");
      row.qty = toNumber(txt("qty"));
      row.price = toNumber(txt("price"));
      row.amount = toNumber(txt("amount"));
      if (txt("offer")) row.offer = txt("offer");
      const d = toNumber(txt("discount"));
      if (d !== undefined) row.discountPct = d;
      for (const c of cols) if (!c.role) {
        // ستون با عنوان ناشناخته: هر توکنی که زیرش افتاده
        const own = [...a.names.flat()].filter((t) => (t.x0 + t.x1) / 2 >= c.x0 - 10 && (t.x0 + t.x1) / 2 <= c.x1 + 10);
        if (own.length) row.extra[c.label] = own.map((t) => t.s).join(" ");
      }
      if (frags.length > 1) row.flags.push("نام چندخطی (بررسی شود)");
      checkAmount(row, cols.some((c) => c.role === "price"));
      const key = `${row.code ?? ""}|${row.name}`;
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      rows.push(row);
    }
  }
  const res = finish("pdf", rows, columnsInfo, duplicates, pages.length);
  res.parsedTotal = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  if (reportedTotal !== undefined) res.reportedTotal = reportedTotal;
  return res;
}
