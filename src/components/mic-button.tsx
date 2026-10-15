"use client";

import { useVoiceInput } from "@/hooks/useVoiceInput";

/**
 * دکمه‌ی میکروفون — فقط جایگزین کیبورد است. متن تشخیص‌داده‌شده مستقیم
 * در فیلد می‌نشیند تا کاربر قبل از ثبت آن را ببیند و در صورت نیاز اصلاح کند.
 */
export function MicButton({
  onText,
  className,
}: {
  onText: (text: string) => void;
  className?: string;
}) {
  const { listening, supported, start, stop } = useVoiceInput(onText);
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      aria-label="ورودی صوتی"
      className={className ?? "grid size-11 shrink-0 place-items-center rounded-full transition"}
      style={{
        background: listening ? "var(--danger-soft)" : "var(--line)",
        color: listening ? "var(--danger-ink)" : "var(--ink-soft)",
      }}
    >
      {listening ? (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
          <circle cx="12" cy="12" r="6" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
        </svg>
      )}
    </button>
  );
}
