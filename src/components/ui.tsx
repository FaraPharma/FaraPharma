"use client";

import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/format";

export function IconClose({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconPlus({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconRefresh({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "accent";
}) {
  const cls =
    variant === "primary"
      ? "btn-primary"
      : variant === "accent"
        ? "btn-accent"
        : variant === "secondary"
          ? "btn-secondary"
          : variant === "danger"
            ? "btn-danger"
            : "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-medium text-[color:var(--ink-soft)] transition active:scale-[0.98] disabled:opacity-50";
  return <button className={cn(cls, className)} {...props} />;
}

/** دکمه‌ی اصلیِ هر صفحه — شکل ثابت: رنگ اصلی، آیکون + و برچسب کوتاه */
export function AddButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cn("btn-primary shrink-0", className)} {...props}>
      <IconPlus className="size-4" />
      {children}
    </button>
  );
}

/** دکمه‌ی آیکونی بروزرسانی (۴۴ پیکسل) */
export function RefreshButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label="بروزرسانی"
      className="btn-secondary shrink-0 !px-0"
      style={{ minWidth: 44 }}
      {...props}
    >
      <IconRefresh className="size-5" />
    </button>
  );
}

/** کنترل دوحالته (مثلاً لیست / تقویم) */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-2xl border"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
      role="tablist"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className="min-h-11 px-4 text-xs font-bold transition"
          style={
            value === o.value
              ? { background: "var(--primary)", color: "var(--on-primary)" }
              : { color: "var(--ink-soft)" }
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input className={cn("field-input", className)} {...rest} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return <textarea className={cn("field-input min-h-20", className)} {...rest} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props;
  return (
    <select className={cn("field-input", className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[color:var(--scrim)] sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl p-5 shadow-2xl sm:rounded-2xl"
        style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-[color:var(--ink)]">{title}</h2>
          <button
            onClick={onClose}
            aria-label="بستن"
            className="grid size-11 place-items-center rounded-full text-[color:var(--ink-soft)] transition hover:opacity-80"
            style={{ background: "var(--line)" }}
          >
            <IconClose className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const badgeColors: Record<string, string> = {
  teal: "bg-[color:var(--primary-soft)] text-[color:var(--primary-dark)]",
  green: "bg-[color:var(--success-soft)] text-[color:var(--success-ink)]",
  amber: "bg-[color:var(--warning-soft)] text-[color:var(--warning-ink)]",
  red: "bg-[color:var(--danger-soft)] text-[color:var(--danger-ink)]",
  slate: "bg-[color:var(--line)] text-[color:var(--ink-soft)]",
  blue: "bg-[color:var(--primary-soft)] text-[color:var(--primary-dark)]",
  violet: "bg-[color:var(--primary-soft)] text-[color:var(--primary-dark)]",
};

export function Badge({
  color = "slate",
  children,
  className,
}: {
  color?: keyof typeof badgeColors;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        badgeColors[color],
        className
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  desc,
  action,
}: {
  icon?: string; // سازگاری قدیمی؛ نادیده گرفته می‌شود
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-dashed px-6 py-10 text-center"
      style={{ borderColor: "var(--line)" }}
    >
      <p className="text-sm font-bold text-[color:var(--ink)]">{title}</p>
      {desc && <p className="text-xs leading-5 text-[color:var(--ink-soft)]">{desc}</p>}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label = "در حال بارگذاری…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <div
        className="size-8 animate-spin rounded-full border-[3px] border-t-transparent"
        style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }}
      />
      <p className="text-xs text-[color:var(--ink-soft)]">{label}</p>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-44">
        <h1 className="text-xl font-bold text-[color:var(--ink)]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs leading-5 text-[color:var(--ink-soft)]">{subtitle}</p>}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  icon,
  label,
  value,
  href,
  color = "teal",
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  href?: string;
  color?: "teal" | "amber" | "blue" | "violet";
}) {
  const bg: Record<string, string> = {
    teal: "bg-[color:var(--primary-soft)] text-[color:var(--primary-dark)]",
    amber: "bg-[color:var(--warning-soft)] text-[color:var(--warning-ink)]",
    blue: "bg-[color:var(--primary-soft)] text-[color:var(--primary-dark)]",
    violet: "bg-[color:var(--primary-soft)] text-[color:var(--primary-dark)]",
  };
  const inner = (
    <div className="card flex items-center gap-3 p-4">
      <div className={cn("grid size-11 shrink-0 place-items-center rounded-xl", bg[color])}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="tnum text-lg font-bold leading-6 text-[color:var(--ink)]">{value}</div>
        <div className="truncate text-xs text-[color:var(--ink-soft)]">{label}</div>
      </div>
    </div>
  );
  return href ? (
    <a href={href} className="block transition active:scale-[0.98]">
      {inner}
    </a>
  ) : (
    inner
  );
}
