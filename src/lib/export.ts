import type { Order } from "@/lib/types";
import { buildOrderText, orderTotal } from "@/lib/domain";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

function pdfInnerHtml(order: Order, pharmacyName?: string): string {
  const items = order.items ?? [];
  const rows = items
    .map(
      (it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${it.productName}</td>
        <td>${it.qty}</td>
        <td>${it.unitPrice.toLocaleString("en-US")}</td>
        <td>${it.discountPct || 0}%</td>
        <td>${Math.round(it.qty * it.unitPrice * (1 - it.discountPct / 100)).toLocaleString("en-US")}</td>
      </tr>`
    )
    .join("");
  const total = orderTotal(order).toLocaleString("en-US");
  const date = new Date(order.createdAt).toLocaleString("fa-IR");
  const settlementLabel = `${order.settlementType === "cheque" ? "چک" : "نقدی"}${
    order.settlementDays ? ` ${order.settlementDays} روزه` : ""
  }`;
  return `
    <div style="direction:rtl;font-family:Vazirmatn,Tahoma,sans-serif;color:var(--ink);">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid var(--primary-dark);padding-bottom:12px;">
        <div>
          <div style="font-size:22px;font-weight:700;">فرم سفارش خرید</div>
          <div style="font-size:13px;color:var(--ink-soft);margin-top:4px;">${pharmacyName ?? "دستیار خرید داروخانه"}</div>
        </div>
        <div style="text-align:left;font-size:12px;color:var(--ink-soft);">
          <div>تاریخ: ${date}</div>
          <div>شماره سفارش: ${order.orderNo ? order.orderNo.toLocaleString("fa-IR", { useGrouping: false }) : order.id.slice(0, 8)}</div>
        </div>
      </div>
      <div style="display:flex;gap:24px;margin:14px 0;font-size:14px;">
        <div><b>ویزیتور:</b> ${order.visitorName ?? "—"}</div>
        <div><b>شرکت:</b> ${order.visitorCompany ?? "—"}</div>
        <div><b>تسویه:</b> ${settlementLabel}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:var(--primary-dark);color:var(--on-primary);">
            <th style="padding:8px;border:1px solid var(--primary-dark);">ردیف</th>
            <th style="padding:8px;border:1px solid var(--primary-dark);">نام کالا</th>
            <th style="padding:8px;border:1px solid var(--primary-dark);">تعداد</th>
            <th style="padding:8px;border:1px solid var(--primary-dark);">قیمت واحد (تومان)</th>
            <th style="padding:8px;border:1px solid var(--primary-dark);">تخفیف</th>
            <th style="padding:8px;border:1px solid var(--primary-dark);">مبلغ (تومان)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="background:var(--primary-soft);font-weight:700;">
            <td colspan="5" style="padding:10px;border:1px solid var(--primary);text-align:left;">جمع کل</td>
            <td style="padding:10px;border:1px solid var(--primary);">${total}</td>
          </tr>
        </tfoot>
      </table>
      ${order.note ? `<div style="margin-top:14px;font-size:13px;"><b>توضیحات:</b> ${order.note}</div>` : ""}
      <div style="margin-top:40px;font-size:12px;color:var(--ink-soft);display:flex;justify-content:space-between;">
        <span>مهر و امضا فروشنده</span>
        <span>مهر و امضا خریدار</span>
      </div>
    </div>`;
}

/** Renders the order form to canvas (keeps Persian shaping) and saves it as PDF. */
export async function exportOrderPdf(order: Order, pharmacyName?: string): Promise<void> {
  const [{ default: JsPDF }, html2canvas] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);
  const el = document.createElement("div");
  el.setAttribute("dir", "rtl");
  el.style.cssText =
    "position:fixed;top:-10000px;left:0;width:794px;background:var(--surface);padding:36px;z-index:-1;";
  el.innerHTML = pdfInnerHtml(order, pharmacyName);
  document.body.appendChild(el);
  try {
    await document.fonts.ready;
    const canvas = await html2canvas.default(el, {
      scale: 2,
    });
    const img = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageHeight = 297;
    const imgHeight = (210 * canvas.height) / canvas.width;
    let position = 0;
    pdf.addImage(img, "JPEG", 0, position, 210, imgHeight);
    let remaining = imgHeight;
    while (remaining > pageHeight) {
      position -= pageHeight;
      remaining -= pageHeight;
      pdf.addPage();
      pdf.addImage(img, "JPEG", 0, position, 210, imgHeight);
    }
    pdf.save(`safaresh-${order.orderNo ?? order.id.slice(0, 8)}.pdf`);
  } finally {
    el.remove();
  }
}

export async function exportOrderExcel(order: Order): Promise<void> {
  const XLSX = await import("xlsx");
  const items = order.items ?? [];
  const total = orderTotal(order);
  const aoa: Array<Array<string | number>> = [
    ["فرم سفارش خرید"],
    ["شماره سفارش", order.orderNo ?? order.id.slice(0, 8)],
    ["ویزیتور", order.visitorName ?? "—"],
    ["شرکت", order.visitorCompany ?? "—"],
    ["تاریخ", new Date(order.createdAt).toLocaleString("fa-IR")],
    [],
    ["ردیف", "نام کالا", "تعداد", "قیمت واحد (تومان)", "تخفیف (%)", "مبلغ (تومان)"],
    ...items.map((it, i) => [
      i + 1,
      it.productName,
      it.qty,
      it.unitPrice,
      it.discountPct || 0,
      Math.round(it.qty * it.unitPrice * (1 - it.discountPct / 100)),
    ]),
    [],
    ["جمع کل", "", "", "", "", total],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 8 }, { wch: 34 }, { wch: 8 }, { wch: 18 }, { wch: 10 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "سفارش");
  XLSX.writeFile(wb, `safaresh-${order.orderNo ?? order.id.slice(0, 8)}.xlsx`);
}

export function orderPlainText(order: Order, pharmacyName?: string): string {
  return buildOrderText(order, pharmacyName);
}
