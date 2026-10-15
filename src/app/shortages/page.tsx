"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useOfflineData } from "@/hooks/useOfflineData";
import { OfflineBadge } from "@/components/offline-badge";
import { PageHeader, Button, Badge, Spinner, EmptyState, RefreshButton } from "@/components/ui";
import { setShortageAction } from "@/actions/shortages";
import { createRequestAction } from "@/actions/priceRequests";
import { faDateTime, faNum } from "@/lib/format";
import { CATEGORIES, type CategoryKey } from "@/lib/config";
import type { Product } from "@/lib/types";

interface ShortagesData {
  products: Product[];
}

export default function ShortagesPage() {
  const router = useRouter();
  const { data, error, loading, stale, savedAt, reload } =
    useOfflineData<ShortagesData>("/api/shortages");
  const load = reload;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const products = data?.products ?? [];
  const allSelected =
    products.length > 0 && products.every((p) => selected.has(p.id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
  }

  /** رفع دستی کسری */
  async function clearShort(p: Product) {
    const res = await setShortageAction({ productId: p.id, short: false });
    if (res.ok) {
      toast.success(`کسری «${p.name}» رفع شد`);
      load();
    } else toast.error(res.error ?? "خطا");
  }

  /** ساخت درخواست قیمت از کالاهای انتخابشده (یا همه لیست) */
  async function makeRequest() {
    const ids =
      selected.size > 0 ? Array.from(selected) : products.map((p) => p.id);
    if (ids.length === 0) {
      toast.error("کالایی برای درخواست قیمت وجود ندارد");
      return;
    }
    setBusy(true);
    const res = await createRequestAction({ productIds: ids });
    setBusy(false);
    if (res.ok) {
      toast.success("درخواست قیمت ساخته شد");
      router.push(`/price-requests?open=${res.id}`);
    } else toast.error(res.error ?? "خطا");
  }

  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="کسری‌ها"
        subtitle="کالاهایی که «کسری دارم» علامت زده‌اید — مستقیم به درخواست قیمت بروید"
        action={
          <div className="flex gap-2">
            <RefreshButton onClick={() => load()} />
            <Button
              onClick={makeRequest}
              disabled={busy || products.length === 0}
              className="px-4 text-sm"
            >
              ساخت درخواست قیمت
            </Button>
          </div>
        }
      />

      {error && (
        <p className="rounded-xl bg-[color:var(--warning-soft)] px-3 py-2 text-xs font-medium text-[color:var(--warning-ink)]">
          {error}
        </p>
      )}

      <OfflineBadge stale={stale} savedAt={savedAt} />

      {products.length === 0 ? (
        <EmptyState
          title="کسرای ثبت نشده"
          desc="در صفحه کالاها روی «کسری دارم؟» کالاها بزنید تا اینجا فهرست شوند"
        />
      ) : (
        <>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-[color:var(--line)] px-3 py-2 text-xs font-medium text-[color:var(--ink-soft)]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={allSelected}
              onChange={toggleAll}
            />
            انتخاب همه ({faNum(products.length)} کالا)
            {selected.size > 0 && !allSelected && (
              <span className="text-[color:var(--primary-dark)]">({faNum(selected.size)} انتخاب شده)</span>
            )}
          </label>

          <div className="space-y-2.5">
            {products.map((p) => (
              <div key={p.id} className="card flex items-center gap-3 p-3.5">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-[var(--primary)]"
                  checked={selected.has(p.id)}
                  onChange={() => toggleSelect(p.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-bold text-[color:var(--ink)]">
                      {p.name}
                    </span>
                    {p.code && (
                      <span className="text-[11px] text-[color:var(--ink-soft)]" dir="ltr">
                        {p.code}
                      </span>
                    )}
                    <Badge color="violet">
                      {CATEGORIES[p.category as CategoryKey] ?? p.category}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-[10px] text-[color:var(--ink-soft)]">
                    علامت‌گذاری: {faDateTime(p.shortAt)}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  className="shrink-0 px-2.5 py-1.5 text-[11px]"
                  onClick={() => clearShort(p)}
                >
                  رفع کسری
                </Button>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-[color:var(--primary)] bg-[color:var(--primary-soft)] p-3 text-[11px] leading-5 text-[color:var(--primary-dark)]">
            با «ساخت درخواست قیمت»، کالاهای انتخاب‌شده (یا همه لیست) مستقیماً به
            فرم درخواست قیمت می‌روند؛ بعد از ثبت سفارش برای هر کالا، کسری آن به‌صورت
            خودکار رفع می‌شود.
          </div>
        </>
      )}
    </div>
  );
}
