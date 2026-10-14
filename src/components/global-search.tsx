"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toman } from "@/lib/format";

interface SearchResults {
  visitors: Array<{ id: string; name: string; company: string | null }>;
  products: Array<{
    conditionId: string;
    productName: string;
    visitorId: string;
    visitorName: string;
    price: number | null;
  }>;
  notes: Array<{ id: string; body: string }>;
}

/**
 * جستجوی سراسری — از هر صفحه‌ای در دسترس است. فقط بازیابی اطلاعات؛
 * هیچ تحلیلی انجام نمی‌شود، فقط نتیجه نشان داده می‌شود.
 */
export function GlobalSearch({ variant = "icon" }: { variant?: "icon" | "field" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        if (res.ok) setResults(await res.json());
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, open]);

  function go(path: string) {
    setOpen(false);
    setQ("");
    router.push(path);
  }

  const hasResults =
    results &&
    (results.visitors.length > 0 || results.products.length > 0 || results.notes.length > 0);

  return (
    <>
      {variant === "field" ? (
        <button
          onClick={() => setOpen(true)}
          aria-label="جستجوی سراسری"
          className="field-input flex w-full items-center gap-2 text-start"
          style={{ color: "var(--ink-soft)" }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M20 20l-4.5-4.5" />
          </svg>
          <span className="text-sm">جستجو در ویزیتورها، کالاها، یادداشت‌ها…</span>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="جستجوی سراسری"
          className="grid size-11 place-items-center rounded-full transition active:scale-95"
          style={{ background: "var(--primary-soft)", color: "var(--primary-dark)" }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M20 20l-4.5-4.5" />
          </svg>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-3xl shadow-2xl"
            style={{ background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b p-3" style={{ borderColor: "var(--line)" }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--ink-soft)" strokeWidth="2" strokeLinecap="round">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="M20 20l-4.5-4.5" />
              </svg>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="جستجو در ویزیتورها، محصولات، یادداشت‌ها…"
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: "var(--ink)" }}
              />
              <button onClick={() => setOpen(false)} style={{ color: "var(--ink-soft)" }}>✕</button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-3">
              {q.trim().length < 2 ? (
                <p className="py-6 text-center text-xs" style={{ color: "var(--ink-soft)" }}>
                  حداقل ۲ حرف بنویس
                </p>
              ) : loading ? (
                <p className="py-6 text-center text-xs" style={{ color: "var(--ink-soft)" }}>در حال جستجو…</p>
              ) : !hasResults ? (
                <p className="py-6 text-center text-xs" style={{ color: "var(--ink-soft)" }}>
                  نتیجه‌ای پیدا نشد
                </p>
              ) : (
                <div className="space-y-4">
                  {results!.visitors.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[10px] font-bold" style={{ color: "var(--ink-soft)" }}>ویزیتورها</div>
                      {results!.visitors.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => go("/visitors")}
                          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-right transition hover:bg-[color:var(--line)]"
                        >
                          <span className="text-xs font-bold" style={{ color: "var(--ink)" }}>{v.name}</span>
                          {v.company && (
                            <span className="text-[11px]" style={{ color: "var(--ink-soft)" }}>{v.company}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {results!.products.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[10px] font-bold" style={{ color: "var(--ink-soft)" }}>محصولات</div>
                      {results!.products.map((p) => (
                        <button
                          key={p.conditionId}
                          onClick={() => go("/products")}
                          className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-right transition hover:bg-[color:var(--line)]"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: "var(--ink)" }}>
                            {p.productName} <span style={{ color: "var(--ink-soft)" }}>— {p.visitorName}</span>
                          </span>
                          {p.price != null && (
                            <span className="tnum shrink-0 text-[11px] font-bold" style={{ color: "#0A7C6B" }}>
                              {toman(p.price)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {results!.notes.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[10px] font-bold" style={{ color: "var(--ink-soft)" }}>یادداشت‌ها</div>
                      {results!.notes.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => go("/quick-notes")}
                          className="block w-full truncate rounded-xl px-2.5 py-2 text-right text-xs transition hover:bg-[color:var(--line)]"
                          style={{ color: "var(--ink)" }}
                        >
                          {n.body}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
