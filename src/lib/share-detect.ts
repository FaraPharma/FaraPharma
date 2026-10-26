import { normalizeText, tokenize, matchToken } from "@/lib/product-search";

/**
 * ورود لیست از «اشتراک‌گذاری»: بررسی فایل و تشخیص خودکار ویزیتور از روی نام فایل.
 * توابع خالص‌اند (بدون دیتابیس/مرورگر) تا صفحه، سرویس‌ورکر (همان قواعد) و آزمون خودکار یکسان عمل کنند.
 */

/** سقف حجم فایل اشتراک‌گذاری‌شده (همان سقف فعلی آپلود بدون S3) */
export const SHARE_MAX_BYTES = 3 * 1024 * 1024;
export const SHARE_EXTS = ["pdf", "xlsx", "xls", "csv"] as const;
export type ShareExt = (typeof SHARE_EXTS)[number];
export type ShareProblem = "type" | "empty" | "big";

export const SHARE_MESSAGES: Record<ShareProblem, string> = {
  type: "نوع این فایل پشتیبانی نمی‌شود؛ فقط PDF، اکسل (xlsx / xls) یا csv قابل ورود است.",
  empty: "این فایل خالی است؛ فایل درست را دوباره بفرست.",
  big: "حجم فایل بیشتر از ۳ مگابایت است؛ فایل کوچک‌تر یا فشرده‌تر بفرست.",
};

const MIME_EXT: Record<string, ShareExt> = {
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
  "application/csv": "csv",
  "text/comma-separated-values": "csv",
};

export type ShareCheck =
  | { ok: true; ext: ShareExt; fileName: string }
  | { ok: false; problem: ShareProblem; message: string };

/** پیام‌رسان‌ها گاهی application/octet-stream می‌دهند؛ پسوند نام فایل در اولویت است */
export function classifyShareFile(name: string, mime: string, size: number): ShareCheck {
  if (!Number.isFinite(size) || size <= 0) return { ok: false, problem: "empty", message: SHARE_MESSAGES.empty };
  if (size > SHARE_MAX_BYTES) return { ok: false, problem: "big", message: SHARE_MESSAGES.big };
  const clean = String(name ?? "").trim() || "file";
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(clean);
  const extFromName = m ? m[1].toLowerCase() : "";
  let ext: ShareExt | null = (SHARE_EXTS as readonly string[]).includes(extFromName) ? (extFromName as ShareExt) : null;
  if (!ext) ext = MIME_EXT[String(mime ?? "").toLowerCase().split(";")[0].trim()] ?? null;
  if (!ext) return { ok: false, problem: "type", message: SHARE_MESSAGES.type };
  return { ok: true, ext, fileName: extFromName === ext ? clean : `${clean}.${ext}` };
}

/* ---------------------------------------------------------------- */
/* تشخیص ویزیتور از نام فایل                                          */
/* ---------------------------------------------------------------- */

export interface VisitorCand {
  id: string;
  name: string;
  company?: string | null;
  /** نام آخرین فایلی که برای این ویزیتور ذخیره/وارد شده */
  lastFileName?: string | null;
  /** زمان آخرین ورود لیست (ISO) */
  lastImportAt?: string | null;
}

export interface VisitorMatch {
  visitor: VisitorCand;
  score: number;
}

export type DetectStatus = "sure" | "ambiguous" | "none";

export interface Detection {
  status: DetectStatus;
  best?: VisitorMatch;
  /** نامزدهای مرتبط، بهترین اول (برای فهرست کوتاه انتخاب) */
  matches: VisitorMatch[];
}

/** واژه‌هایی که در نام فایل‌ها زیاد می‌آیند ولی نام ویزیتور را مشخص نمی‌کنند */
const STOP = new Set([
  "لیست", "قیمت", "قیمتها", "کالا", "کالاها", "محصولات", "فایل", "اکسل", "جدید", "پخش", "شرکت", "کاتالوگ", "ویزیتور", "خانم", "اقای", "دکتر",
  "price", "pricelist", "list", "excel", "file", "new", "final", "copy", "whatsapp", "image", "document", "telegram", "pdf", "xlsx", "xls", "csv", "at",
]);

const SURE_MIN = 0.78;
const SURE_GAP = 0.2;
const AMBIGUOUS_MIN = 0.35;

function stripExt(name: string): string {
  return String(name ?? "").replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

/** توکن‌های معنادار نام (بدون عدد/تاریخ، بدون واژه‌های عمومی)؛ اگر چیزی نماند، توکن‌های خام */
export function nameTokens(s: string): string[] {
  const all = tokenize(normalizeText(stripExt(s))).filter((t) => t.length > 1 && !/^\d+$/.test(t));
  const kept = all.filter((t) => !STOP.has(t));
  return kept.length > 0 ? kept : all;
}

/** اعتبار تطبیق دو توکن (۰ تا ۱) */
function tokenCredit(a: string, b: string): number {
  const c = matchToken(a, b);
  if (c === 4) return 1;
  if (c === 3) return a.length >= 3 ? 0.9 : 0;
  if (c === 2) return 0.8;
  if (c === 1) return a.length >= 4 ? 0.5 : 0;
  // پیشوندِ برعکس (نام فایل کوتاه‌تر از نام ویزیتور)
  const r = matchToken(b, a);
  if (r === 3 && b.length >= 4) return 0.7;
  return 0;
}

function coverScore(vTokens: string[], fTokens: string[]): number {
  if (vTokens.length === 0 || fTokens.length === 0) return 0;
  const best = (x: string, ys: string[]) => ys.reduce((m, y) => Math.max(m, tokenCredit(x, y)), 0);
  const vCover = vTokens.reduce((s, v) => s + best(v, fTokens), 0) / vTokens.length;
  const fCover = fTokens.reduce((s, f) => s + best(f, vTokens), 0) / fTokens.length;
  return vCover * 0.7 + fCover * 0.3;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** امتیاز یک ویزیتور برای نام فایل: شباهت به نام/شرکت + شباهت به آخرین فایلِ وارد‌شده‌ی او */
export function scoreVisitor(fileName: string, v: VisitorCand): number {
  const f = nameTokens(fileName);
  const nameScore = coverScore(nameTokens(v.name), f);
  const companyScore = v.company ? coverScore(nameTokens(v.company), f) * 0.9 : 0;
  let score = Math.max(nameScore, companyScore);
  if (v.lastFileName) {
    const same = normalizeText(stripExt(v.lastFileName)) === normalizeText(stripExt(fileName));
    if (same) return 1;
    score = Math.min(1, score + 0.4 * jaccard(nameTokens(v.lastFileName), f));
  }
  return score;
}

const byRecent = (a: VisitorCand, b: VisitorCand) =>
  (b.lastImportAt ? new Date(b.lastImportAt).getTime() : 0) - (a.lastImportAt ? new Date(a.lastImportAt).getTime() : 0);

/**
 * تشخیص ویزیتور: «sure» وقتی یک نامزد با اطمینان بالا و فاصله‌ی روشن از بعدی باشد (فقط تأیید)،
 * «ambiguous» برای فهرست کوتاه انتخاب (هم‌امتیاز: آخرین استفاده‌شده اول)، «none» وقتی هیچ شباهتی نیست.
 */
export function detectVisitor(fileName: string, cands: VisitorCand[]): Detection {
  const matches = cands
    .map((visitor) => ({ visitor, score: scoreVisitor(fileName, visitor) }))
    .filter((m) => m.score >= AMBIGUOUS_MIN)
    .sort((a, b) => (Math.abs(b.score - a.score) < 1e-9 ? byRecent(a.visitor, b.visitor) : b.score - a.score));
  if (matches.length === 0) return { status: "none", matches: [] };
  const [first, second] = matches;
  if (first.score >= SURE_MIN && (!second || first.score - second.score >= SURE_GAP)) {
    return { status: "sure", best: first, matches };
  }
  return { status: "ambiguous", best: first, matches };
}

/** ترتیب نمایش همه‌ی ویزیتورها در انتخاب دستی: نامزدهای مرتبط، بعد بقیه با آخرین استفاده اول */
export function orderChoices(cands: VisitorCand[], det: Detection): VisitorCand[] {
  const first = det.matches.map((m) => m.visitor);
  const ids = new Set(first.map((v) => v.id));
  return [...first, ...cands.filter((c) => !ids.has(c.id)).sort(byRecent)];
}
