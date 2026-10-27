/* Shared client-side types for API responses. */

export interface ProfileInfo {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  createdAt: string;
}

export interface Visitor {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  messengerUsername: string | null;
  /** آفر و شرایط پرداخت (متن آزاد) */
  noteTerms: string | null;
  createdAt: string;
}

export interface VisitorNote {
  id: string;
  visitorId: string;
  body: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  code: string | null;
  category: string;
  active: boolean;
  isShort: boolean;
  shortAt: string | null;
  createdAt: string;
}

export interface Condition {
  id: string;
  visitorId: string;
  productId: string;
  stock: string;
  cashDiscountPct: number;
  checkDays: number;
  offer: string | null;
  validUntil: string | null;
  price: number | null;
  updatedAt?: string;
  visitorName?: string;
  visitorCompany?: string | null;
  visitorPhone?: string | null;
  productName?: string;
  productCode?: string | null;
  code?: string | null;
  warehouse?: string | null;
  unit?: string | null;
  qty?: string | null;
  amount?: number | null;
  rawName?: string | null;
  extra?: Record<string, string> | null;
}

export interface QuickNote {
  id: string;
  body: string;
  createdAt: string;
}

/** چک پرداختنی — ثبت کاملاً دستی */
export interface Cheque {
  id: string;
  visitorName: string;
  visitorCompany?: string | null;
  amount: number;
  dueDate: string; // yyyy-mm-dd
  orderId: string | null;
  settled: boolean;
  settledAt: string | null;
  createdAt: string;
}

export interface PriceRequest {
  id: string;
  status: string;
  note: string | null;
  createdAt: string;
  productNames?: string[];
  responseCount?: number;
}

export interface PriceResponse {
  id: string;
  requestId: string;
  visitorId: string;
  productId: string;
  price: number | null;
  stock: string | null;
  checkDays: number | null;
  cashDiscountPct: number | null;
  offer: string | null;
  respondedAt: string;
  visitorName?: string;
  visitorCompany?: string | null;
  productName?: string;
}

/** Snapshot of a condition saved right before each overwrite. */
export interface ConditionHistory {
  id: string;
  visitorId: string;
  productId: string;
  stock: string;
  cashDiscountPct: number;
  checkDays: number;
  offer: string | null;
  validUntil: string | null;
  recordedAt: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  discountPct: number;
}

export interface Order {
  id: string;
  orderNo: number;
  deletedAt?: string | null;
  visitorId: string;
  visitorName?: string;
  visitorCompany?: string | null;
  status: string;
  note: string | null;
  settlementType: "cash" | "cheque";
  settlementDays: number;
  createdAt: string;
  items?: OrderItem[];
}

export interface ApiResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** متادیتای فایل مرجع (PDF) ویزیتور — بدون هیچ پردازش خودکار */
export interface CatalogFile {
  id: string;
  visitorId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string; // stored
  createdAt: string;
}
