"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GlobalSearch } from "@/components/global-search";
import { PriceHitRow, type PriceHit } from "@/components/price-hit-row";
import { addToBasketAction } from "@/actions/basket";

interface PriceResults {
  products: PriceHit[];
  terms: Record<string, string>;
}

/**
 * جستجوی یکپارچه‌ی قیمت (صفحه‌ی اصلی): با تایپ، نتیجه‌ی همه‌ی ویزیتورها با قیمت، موجودی و سن لیست.
 * جستجوی قدیمی (ویزیتورها، کالاها، یادداشت‌ها) زیرش با «جستجو در همه‌چیز» در دسترس است.
 */
export function PriceSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PriceResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        if (res.ok) {
          const j = (await res.json()) as PriceResults;
          setResults({ products: j.products ?? [], terms: j.terms ?? {} });
        }
        setLoading(false);
      } catch {
        // لغو شده (پرسش تازه‌تر) یا خطای شبکه: وضعیت را پرسش بعدی تعیین می‌کند
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [term]);

  async function add(conditionId: string, name: string) {
    const res = await addToBasketAction({ conditionId });
    if (res.ok) {
      setAdded((prev) => new Set(prev).add(conditionId));
      window.dispatchEvent(new Event("fara:basket"));
      toast.success(`«${name}» به لیست خرید افزوده شد`, {
        action: { label: "مشاهده", onClick: () => router.push("/basket") },
      });
    } else toast.error(res.error ?? "افزودن ممکن نشد");
  }

  return (
    <div className="space-y-2">
      <div className="field-input flex min-h-14 items-center gap-2" style={{ color: "var(--ink-soft)" }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M20 20l-4.5-4.5" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="نام کالا را بنویس تا قیمت همه‌ی ویزیتورها بیاید"
          aria-label="جستجوی قیمت کالا"
          className="min-w-0 flex-1 bg-transparent text-base outline-none"
          style={{ color: "var(--ink)" }}
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="پاک کردن"
            className="grid size-11 shrink-0 place-items-center text-lg"
            style={{ color: "var(--ink-soft)" }}
          >
            ×
          </button>
        )}
      </div>

      {term.length >= 2 && (
        <div className="card space-y-1 p-2">
          {loading && !results ? (
            <p className="py-5 text-center text-xs" style={{ color: "var(--ink-soft)" }}>
              در حال جستجو…
            </p>
          ) : !results || results.products.length === 0 ? (
            <p className="py-5 text-center text-xs" style={{ color: "var(--ink-soft)" }}>
              نتیجه‌ای پیدا نشد؛ نام کالا را کوتاه‌تر یا ساده‌تر بنویس
            </p>
          ) : (
            results.products.map((p) => (
              <PriceHitRow
                key={p.conditionId}
                p={p}
                terms={results.terms?.[p.visitorId]}
                added={added.has(p.conditionId)}
                onAdd={() => void add(p.conditionId, p.productName)}
              />
            ))
          )}
        </div>
      )}

      <div className="flex justify-end">
        <GlobalSearch variant="link" />
      </div>
    </div>
  );
}
