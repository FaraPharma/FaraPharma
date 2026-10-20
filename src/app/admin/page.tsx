"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  PageHeader,
  Button,
  Badge,
  Spinner,
  Field,
  Input,
  Select,
  EmptyState,
} from "@/components/ui";
import { adminSetSubscriptionAction, adminToggleAccountAction } from "@/actions/admin";
import { effectiveStatus, faDate, faNum } from "@/lib/format";
import { AdminAudit } from "@/components/admin-audit";

interface AdminProfile {
  id: string;
  name: string;
  phone: string | null;
  userId: string | null;
  email: string | null;
  disabled: boolean;
  status: string;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  createdAt: string;
  visitorCount: number;
  productCount: number;
  orderCount: number;
}

interface AdminData {
  profiles: AdminProfile[];
  trialDays: number;
}

type FilterKey = "all" | "active" | "trial" | "expired" | "disabled";

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/profiles");
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/dashboard";
        return;
      }
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const list = data?.profiles ?? [];
    return {
      total: list.length,
      active: list.filter((p) => !p.disabled && effectiveStatus(p) === "active").length,
      trial: list.filter((p) => !p.disabled && effectiveStatus(p) === "trial").length,
      expired: list.filter((p) => !p.disabled && effectiveStatus(p) === "expired").length,
      disabled: list.filter((p) => p.disabled).length,
    };
  }, [data]);

  const filtered = useMemo(() => {
    const list = data?.profiles ?? [];
    const query = q.trim();
    return list.filter((p) => {
      if (filter === "disabled" && !p.disabled) return false;
      if (filter !== "all" && filter !== "disabled") {
        if (p.disabled) return false;
        if (effectiveStatus(p) !== filter) return false;
      }
      if (!query) return true;
      const hay = `${p.name} ${p.email ?? ""} ${p.phone ?? ""}`.toLowerCase();
      return hay.includes(query.toLowerCase());
    });
  }, [data, q, filter]);

  async function setSub(profile: AdminProfile, status: "active" | "trial" | "expired", endDate?: string) {
    const res = await adminSetSubscriptionAction({ profileId: profile.id, status, endDate });
    if (res.ok) {
      toast.success("وضعیت به‌روزرسانی شد");
      load();
    } else toast.error(res.error ?? "خطا");
  }

  async function toggleAccount(profile: AdminProfile) {
    if (!profile.userId) return;
    const next = !profile.disabled;
    if (next && !confirm(`دسترسی ورود «${profile.name}» کاملاً قطع شود؟`)) return;
    const res = await adminToggleAccountAction({ userId: profile.userId, disabled: next });
    if (res.ok) {
      toast.success(next ? "دسترسی قطع شد" : "دسترسی وصل شد");
      load();
    } else toast.error(res.error ?? "خطا");
  }

  if (loading && !data) return <Spinner />;

  const filterTabs: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "all", label: "همه", count: counts.total },
    { key: "active", label: "فعال", count: counts.active },
    { key: "trial", label: "آزمایشی", count: counts.trial },
    { key: "expired", label: "منقضی", count: counts.expired },
    { key: "disabled", label: "قطع‌شده", count: counts.disabled },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="پنل مدیریت" subtitle="مدیریت اشتراک و دسترسی داروخانه‌ها" />

      {/* خلاصه‌ی آماری */}
      <div className="grid grid-cols-4 gap-2">
        <div className="card p-3 text-center">
          <div className="tnum text-lg font-extrabold" style={{ color: "var(--ink)" }}>{faNum(counts.total)}</div>
          <div className="mt-0.5 text-[10px] font-semibold" style={{ color: "var(--ink-soft)" }}>کل داروخانه‌ها</div>
        </div>
        <div className="card p-3 text-center">
          <div className="tnum text-lg font-extrabold" style={{ color: "#0A7C6B" }}>{faNum(counts.active)}</div>
          <div className="mt-0.5 text-[10px] font-semibold" style={{ color: "var(--ink-soft)" }}>فعال</div>
        </div>
        <div className="card p-3 text-center">
          <div className="tnum text-lg font-extrabold" style={{ color: "#8A5A0E" }}>{faNum(counts.trial)}</div>
          <div className="mt-0.5 text-[10px] font-semibold" style={{ color: "var(--ink-soft)" }}>آزمایشی</div>
        </div>
        <div className="card p-3 text-center">
          <div className="tnum text-lg font-extrabold" style={{ color: "#C43F1D" }}>{faNum(counts.expired + counts.disabled)}</div>
          <div className="mt-0.5 text-[10px] font-semibold" style={{ color: "var(--ink-soft)" }}>منقضی/قطع</div>
        </div>
      </div>

      {/* جستجو */}
      <div className="card flex items-center gap-2 p-2">
        <span className="ps-1">🔎</span>
        <input
          className="w-full bg-transparent text-sm outline-none"
          style={{ color: "var(--ink)" }}
          placeholder="جستجو بر اساس نام، ایمیل یا تلفن…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* تب‌های فیلتر */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {filterTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition"
            style={
              filter === t.key
                ? { background: "var(--teal-1)", color: "#fff" }
                : { background: "var(--surface)", color: "var(--ink-soft)", border: "1px solid var(--line)" }
            }
          >
            {t.label} ({faNum(t.count)})
          </button>
        ))}
      </div>

      {/* لیست داروخانه‌ها */}
      {filtered.length === 0 ? (
        <EmptyState icon="🔍" title="نتیجه‌ای پیدا نشد" desc="جستجو یا فیلتر را تغییر بده" />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((p) => {
            const st = effectiveStatus(p);
            return (
              <div key={p.id} className="card p-3.5" style={p.disabled ? { opacity: 0.6 } : undefined}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>{p.name}</span>
                      {p.disabled && <Badge color="red">قطع‌شده</Badge>}
                      {!p.disabled && st === "active" && <Badge color="teal">فعال</Badge>}
                      {!p.disabled && st === "trial" && <Badge color="amber">آزمایشی</Badge>}
                      {!p.disabled && st === "expired" && <Badge color="red">منقضی</Badge>}
                    </div>
                    <div className="mt-1 text-[11px]" style={{ color: "var(--ink-soft)" }}>
                      {p.email}
                      {p.phone && <> · {faNum(p.phone)}</>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[10.5px]" style={{ color: "var(--ink-soft)" }}>
                      <span>عضویت: {faDate(p.createdAt)}</span>
                      {p.trialEndsAt && <span>پایان آزمایشی: {faDate(p.trialEndsAt)}</span>}
                      {p.subscriptionEndsAt && <span>پایان اشتراک: {faDate(p.subscriptionEndsAt)}</span>}
                    </div>
                    <div className="mt-1.5 flex gap-3 text-[10.5px] font-medium" style={{ color: "var(--teal-2)" }}>
                      <span>👤 {faNum(p.visitorCount)} ویزیتور</span>
                      <span>📦 {faNum(p.productCount)} محصول</span>
                      <span>🧾 {faNum(p.orderCount)} سفارش</span>
                    </div>
                  </div>
                  <Button
                    variant={p.disabled ? "secondary" : "danger"}
                    className="shrink-0 px-2.5 py-1.5 text-[10.5px]"
                    onClick={() => toggleAccount(p)}
                  >
                    {p.disabled ? "وصل کردن" : "قطع دسترسی"}
                  </Button>
                </div>

                <form
                  className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"
                  style={{ borderColor: "var(--line)" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const status = String(fd.get("status")) as "active" | "trial" | "expired";
                    const date = String(fd.get("date") || "");
                    setSub(p, status, date || undefined);
                  }}
                >
                  <Select name="status" defaultValue={p.status} className="py-2 text-xs">
                    <option value="trial">آزمایشی</option>
                    <option value="active">فعال</option>
                    <option value="expired">منقضی (فوری)</option>
                  </Select>
                  <Input type="date" name="date" className="w-auto py-2 text-xs" />
                  <Button type="submit" variant="secondary" className="px-3 py-2 text-xs">
                    اعمال
                  </Button>
                </form>
              </div>
            );
          })}
        </div>
      )}

      <AdminAudit />
    </div>
  );
}
