"use client";

import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/format";

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
            : "inline-flex items-center justify-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-medium text-[color:var(--ink-soft)] transition active:scale-[0.98] disabled:opacity-50";
  return <button className={cn(cls, className)} {...props} />;
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

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-5 shadow-2xl sm:rounded-3xl"
        style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-[color:var(--ink)]">{title}</h2>
          <button
            onClick={onClose}
            aria-label="بستن"
            className="grid size-8 place-items-center rounded-full text-[color:var(--ink-soft)] transition hover:opacity-80"
            style={{ background: "var(--line)" }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const badgeColors: Record<string, string> = {
  teal: "border-[color:rgba(18,172,147,.3)] bg-[rgba(18,172,147,.1)] text-[#0A7C6B]",
  green: "border-[color:rgba(18,172,147,.3)] bg-[rgba(18,172,147,.1)] text-[#0A7C6B]",
  amber: "border-[color:rgba(224,138,30,.3)] bg-[rgba(246,193,94,.16)] text-[#8A5A0E]",
  red: "border-[color:rgba(240,86,47,.3)] bg-[rgba(240,86,47,.1)] text-[#C43F1D]",
  slate: "border-[color:var(--line)] bg-[color:var(--line)] text-[color:var(--ink-soft)]",
  blue: "border-[color:rgba(140,124,246,.3)] bg-[rgba(140,124,246,.1)] text-[#5E4BC7]",
  violet: "border-[color:rgba(140,124,246,.3)] bg-[rgba(140,124,246,.1)] text-[#5E4BC7]",
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
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        badgeColors[color],
        className
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  desc,
}: {
  icon: string;
  title: string;
  desc?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center"
      style={{ borderColor: "var(--line)", background: "rgba(90,55,20,0.015)" }}
    >
      <div className="mb-2 text-3xl">{icon}</div>
      <p className="text-sm font-bold text-[color:var(--ink)]">{title}</p>
      {desc && <p className="mt-1 text-xs text-[color:var(--ink-soft)]">{desc}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-10">
      <div
        className="size-8 animate-spin rounded-full border-[3px] border-t-transparent"
        style={{ borderColor: "#12AC93", borderTopColor: "transparent" }}
      />
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
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-[color:var(--ink)]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-[color:var(--ink-soft)]">{subtitle}</p>}
      </div>
      {action}
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
    teal: "bg-[rgba(18,172,147,.12)] text-[#0A7C6B]",
    amber: "bg-[rgba(246,193,94,.2)] text-[#8A5A0E]",
    blue: "bg-[rgba(140,124,246,.12)] text-[#5E4BC7]",
    violet: "bg-[rgba(140,124,246,.12)] text-[#5E4BC7]",
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
