"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { updateVisitorTermsAction } from "@/actions/visitors";
import { faNum } from "@/lib/format";

const MAX = 500;

/** شرایط تسویه و آفر ویزیتور (مثل «۶+۱، ۱۰٪ نقد، چک ۲ ماهه»): یک‌بار برای کل ویزیتور، بدون انتخاب محصول؛ فقط متن و بدون هیچ محاسبه‌ای. بعد از خروج از کادر خودکار ذخیره می‌شود. */
export function VisitorTermsField({
  visitorId,
  initial,
  onSaved,
}: {
  visitorId: string;
  initial: string | null;
  onSaved: (note: string | null) => void;
}) {
  const [text, setText] = useState(initial ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const saved = useRef((initial ?? "").trim());
  const count = [...text].length;
  const dirty = text.trim() !== saved.current;

  async function save() {
    const v = text.trim();
    if (v === saved.current || state === "saving") return;
    if ([...v].length > MAX) {
      toast.error(`یادداشت حداکثر ${faNum(MAX)} نویسه می‌تواند باشد`);
      return;
    }
    setState("saving");
    const res = await updateVisitorTermsAction({ id: visitorId, note: v });
    if (!res.ok) {
      setState("idle");
      toast.error(res.error ?? "ذخیره نشد");
      return;
    }
    saved.current = v;
    setState("saved");
    onSaved(v === "" ? null : v);
  }

  return (
    <section className="space-y-1.5 rounded-2xl border p-3" style={{ borderColor: "var(--primary)", background: "var(--primary-soft)" }}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold" style={{ color: "var(--ink)" }}>
          شرایط تسویه و آفر
        </h3>
        <span className="text-[11px]" style={{ color: count > MAX ? "var(--danger-ink)" : "var(--ink-soft)" }}>
          {faNum(count)} / {faNum(MAX)}
        </span>
      </div>
      <textarea
        className="field-input min-h-[88px] w-full resize-y leading-6"
        placeholder="مثلاً: ۶+۱، ۱۰٪ نقد، چک ۲ ماهه"
        value={text}
        onChange={(e) => {
          setState("idle");
          setText([...e.target.value].slice(0, MAX).join(""));
        }}
        onBlur={() => void save()}
        aria-label="شرایط تسویه و آفر"
      />
      <div className="flex items-center gap-2">
        {dirty && (
          <button type="button" className="btn-primary px-4 text-xs" onClick={() => void save()} disabled={state === "saving"}>
            {state === "saving" ? "در حال ذخیره…" : "ذخیره"}
          </button>
        )}
        {!dirty && state === "saved" && (
          <span className="text-[11px] font-medium" style={{ color: "var(--success-ink)" }}>
            ذخیره شد
          </span>
        )}
        <span className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
          یک‌بار برای کل ویزیتور؛ در جستجو و لیست خرید نشان داده می‌شود. محاسبه‌ای روی آن انجام نمی‌شود.
        </span>
      </div>
    </section>
  );
}
