"use client";

import { IconClose } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { addQuickNoteAction } from "@/actions/quickNotes";
import { enqueueQuickNote, flushQuickNotes } from "@/lib/offline-queue";
import { MicButton } from "@/components/mic-button";

const HIDDEN_PREFIXES = ["/login", "/register", "/privacy"];

/**
 * دکمه‌ی شناور گرد (FAB) «ثبت سریع» — سبک دفتر انبار:
 * دایره‌ی یکدست در گوشه پایین، با آیکون قلم خطی.
 * کلیک → فقط یک جعبه متن آزاد؛ کل ثبت در چند ثانیه.
 */
export function QuickNoteFab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setBody("");
      setTimeout(() => ref.current?.focus(), 60);
    }
  }, [open]);

  // با وصلشدن اینترنت، صف آفلاین خودکار همگام میشود
  useEffect(() => {
    const onOnline = () => {
      flushQuickNotes()
        .then((r) => {
          if (r.sent > 0)
            toast.success(`${r.sent} یادداشت آفلاین همگامسازی شد`);
        })
        .catch(() => undefined);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  async function save() {
    if (!body.trim()) {
      toast.error("متن یادداشت خالی است");
      return;
    }
    setBusy(true);
    if (navigator.onLine) {
      // آنلاین: مسیر مستقیم (رفتار قبلی)
      const res = await addQuickNoteAction({ body });
      setBusy(false);
      if (res.ok) {
        toast.success("یادداشت ثبت شد");
        setOpen(false);
        setBody("");
      } else {
        toast.error(res.error ?? "خطا در ثبت");
      }
      return;
    }
    // آفلاین: در صف محلی بماند تا با وصلشدن اینترنت همگام شود
    const q = await enqueueQuickNote(body);
    setBusy(false);
    if (q.synced) {
      toast.success("یادداشت ثبت و همگامسازی شد");
    } else {
      toast.success("یادداشت در حافظه گوشی ذخیره شد — با اینترنت خودکار همگام میشود", {
        duration: 6000,
      });
    }
    setOpen(false);
    setBody("");
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="یادداشت سریع"
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 z-40 grid size-14 place-items-center rounded-full text-[color:var(--on-primary)] shadow-lg transition active:scale-95"
        style={{
          background: "var(--primary)",
          boxShadow: "var(--shadow-raised)",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[color:var(--scrim)] backdrop-blur-[2px] sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl p-5 shadow-2xl sm:rounded-3xl"
            style={{ background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold" style={{ color: "var(--ink)" }}>یادداشت سریع</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="بستن"
                className="grid size-8 place-items-center rounded-full"
                style={{ background: "var(--line)", color: "var(--ink-soft)" }}
              >
                <IconClose className="size-5" />
              </button>
            </div>
            <div className="relative">
              <textarea
                ref={ref}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="هرچه می‌خواهید بنویسید — نام ویزیتور، کالای کسری، قیمت جدید، کارهای امروز…"
                className="field-input min-h-36 resize-none pl-10"
                autoFocus
              />
              <div className="absolute bottom-2.5 left-2.5">
                <MicButton onText={(t) => setBody((prev) => (prev ? `${prev} ${t}` : t))} />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <Link
                href="/quick-notes"
                onClick={() => setOpen(false)}
                className="text-[11px] font-medium underline"
                style={{ color: "var(--ink-soft)" }}
              >
                یادداشت‌های قبلی ←
              </Link>
              <button
                onClick={save}
                disabled={busy}
                className="btn-accent px-6 py-2.5 text-sm"
              >
                {busy ? "…" : "ذخیره"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
