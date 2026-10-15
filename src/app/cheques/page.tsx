"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useOfflineData } from "@/hooks/useOfflineData";
import { OfflineBadge } from "@/components/offline-badge";
import { SubscriptionBanner } from "@/components/sub-banner";
import { TRIAL_DAYS } from "@/lib/config";
import {
  PageHeader,
  Button,
  Badge,
  Modal,
  Field,
  Input,
  Spinner,
  EmptyState,
  AddButton,
  Segmented,
} from "@/components/ui";
import {
  addChequeAction,
  settleChequeAction,
  deleteChequeAction,
} from "@/actions/cheques";
import { JalaliDatePicker } from "@/lib/jalali";
import {
  cn,
  compactToman,
  daysLeft,
  faDate,
  faDateTime,
  faNum,
  toNum,
  toman,
} from "@/lib/format";
import type { Cheque, Visitor } from "@/lib/types";

interface ChequesData {
  cheques: Cheque[];
  history: Cheque[];
  warningDays: number;
  profile: {
    id: string;
    name: string;
    phone: string | null;
    status: string;
    trialEndsAt: string | null;
    subscriptionEndsAt: string | null;
    createdAt: string;
  } | null;
}

const WEEKDAYS = [
  "شنبه",
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
];

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function monthLabel(y: number, m: number): string {
  return new Intl.DateTimeFormat("fa-IR", {
    month: "long",
    year: "numeric",
  }).format(new Date(y, m, 1));
}

/** یک ردیف چک — تک‌خطی، بدون شلوغی */
function ChequeRow({
  c,
  warningDays,
  isOverdue,
  isWarn,
  onSettle,
}: {
  c: Cheque;
  warningDays: number;
  isOverdue: boolean;
  isWarn: boolean;
  onSettle: (c: Cheque) => void;
}) {
  const d = daysLeft(c.dueDate);
  const borderColor = isOverdue ? "var(--danger)" : isWarn ? "var(--warning)" : "var(--line)";
  return (
    <div className="card flex items-center gap-3 border-r-[3px] p-3.5" style={{ borderRightColor: borderColor }}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-bold" style={{ color: "var(--ink)" }}>
          {c.visitorName}
        </div>
        <div
          className="mt-0.5 flex items-center gap-1 text-[10.5px] font-semibold"
          style={{ color: isOverdue ? "var(--danger-ink)" : isWarn ? "var(--warning-ink)" : "var(--ink-soft)" }}
        >
          {d !== null && d < 0
            ? `${faNum(-d)} روز گذشته — ${faDate(c.dueDate)}`
            : `${d !== null ? faNum(d) + " روز مانده" : ""} — ${faDate(c.dueDate)}`}
        </div>
      </div>
      <div className="shrink-0 text-left">
        <div className="tnum text-[13.5px] font-extrabold" style={{ color: "var(--ink)" }}>
          {toman(c.amount)}
        </div>
        <button
          onClick={() => onSettle(c)}
          className="mt-1 rounded-full px-2.5 py-1 text-[10px] font-bold"
          style={{ background: "var(--primary-soft)", color: "var(--primary-dark)" }}
        >
          تسویه شد         </button>
      </div>
    </div>
  );
}

/** سه‌بخشی: سررسید گذشته / سررسید نزدیک / بقیه — هرکدام با عنوان بخش */
function ChequeGroups({
  cheques,
  warningDays,
  overdue,
  warn,
  onSettle,
}: {
  cheques: Cheque[];
  warningDays: number;
  overdue: (c: Cheque) => boolean;
  warn: (c: Cheque) => boolean;
  onSettle: (c: Cheque) => void;
}) {
  const overdueList = cheques.filter(overdue);
  const upcomingList = cheques.filter((c) => warn(c) && !overdue(c));
  const restList = cheques.filter((c) => !warn(c) && !overdue(c));

  return (
    <div className="space-y-5">
      {overdueList.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-bold" style={{ color: "var(--danger-ink)" }}>
            سررسید گذشته
          </h3>
          <div className="space-y-2">
            {overdueList.map((c) => (
              <ChequeRow key={c.id} c={c} warningDays={warningDays} isOverdue isWarn={false} onSettle={onSettle} />
            ))}
          </div>
        </div>
      )}
      {upcomingList.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-bold" style={{ color: "var(--warning-ink)" }}>
            سررسید نزدیک
          </h3>
          <div className="space-y-2">
            {upcomingList.map((c) => (
              <ChequeRow key={c.id} c={c} warningDays={warningDays} isOverdue={false} isWarn onSettle={onSettle} />
            ))}
          </div>
        </div>
      )}
      {restList.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-bold" style={{ color: "var(--ink-soft)" }}>
            بقیه‌ی چک‌های باز
          </h3>
          <div className="space-y-2">
            {restList.map((c) => (
              <ChequeRow key={c.id} c={c} warningDays={warningDays} isOverdue={false} isWarn={false} onSettle={onSettle} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


export default function ChequesPage() {
  const { data, error, loading, stale, savedAt, reload } =
    useOfflineData<ChequesData>("/api/cheques");
  const load = reload;
  const visitorsData = useOfflineData<{ visitors: Visitor[] }>("/api/visitors");
  const visitors = visitorsData.data?.visitors ?? [];

  const [view, setView] = useState<"list" | "calendar">("list");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    visitorName: "",
    visitorCompany: "",
    amount: "",
    dueDate: "",
  });
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // هنگام انتخاب ویزیتور از لیست، نام شرکت او بهصورت خودکار پر میشود
  function pickVisitor(name: string) {
    const v = visitors.find((x) => x.name === name);
    setForm((f) => ({
      ...f,
      visitorName: name,
      visitorCompany: v?.company ?? f.visitorCompany,
    }));
  }

  // تقویم ماهانه
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const warningDays = data?.warningDays ?? 7;

  const warn = (c: Cheque) => {
    const d = daysLeft(c.dueDate);
    return d !== null && d <= warningDays;
  };
  const overdue = (c: Cheque) => (daysLeft(c.dueDate) ?? 0) < 0;

  const calendarCells = useMemo(() => {
    const { y, m } = month;
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 1) % 7; // شنبه = 0
    const days = new Date(y, m + 1, 0).getDate();
    const cells: Array<{ date: Date | null; key: string }> = [];
    for (let i = 0; i < offset; i++) cells.push({ date: null, key: `e${i}` });
    for (let d = 1; d <= days; d++)
      cells.push({ date: new Date(y, m, d), key: ymd(new Date(y, m, d)) });
    return cells;
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, Cheque[]>();
    for (const c of data?.cheques ?? []) {
      const arr = map.get(c.dueDate) ?? [];
      arr.push(c);
      map.set(c.dueDate, arr);
    }
    return map;
  }, [data]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await addChequeAction({
      visitorName: form.visitorName,
      visitorCompany: form.visitorCompany || undefined,
      amount: toNum(form.amount),
      dueDate: form.dueDate,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("چک ثبت شد");
      setAddOpen(false);
      setForm({ visitorName: "", visitorCompany: "", amount: "", dueDate: "" });
      load();
    } else toast.error(res.error ?? "خطا در ثبت چک");
  }

  async function settle(c: Cheque) {
    const res = await settleChequeAction(c.id);
    if (res.ok) {
      toast.success("تسویه شد — به تاریخچه منتقل شد");
      load();
    } else toast.error(res.error ?? "خطا");
  }

  async function remove(c: Cheque) {
    if (!confirm("این چک حذف شود؟")) return;
    const res = await deleteChequeAction(c.id);
    if (res.ok) load();
    else toast.error(res.error ?? "خطا");
  }

  function shiftMonth(delta: number) {
    setMonth(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  const nearCount = (data?.cheques ?? []).filter(
    (c) => warn(c) && !overdue(c)
  ).length;
  const overdueCount = (data?.cheques ?? []).filter(overdue).length;
  const overdueTotal = (data?.cheques ?? [])
    .filter(overdue)
    .reduce((s, c) => s + c.amount, 0);
  const totalOpenAmount = (data?.cheques ?? []).reduce((s, c) => s + c.amount, 0);

  /** فعال‌سازی یادآوری فعال (Notification) برای چک‌های نزدیک سررسید */
  const [notifGranted, setNotifGranted] = useState<boolean>(
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );

  async function enableReminders() {
    if (typeof Notification === "undefined") {
      toast.error("این مرورگر از یادآوری پشتیبانی نمی‌کند");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      toast.error("مجوز یادآوری داده نشد");
      return;
    }
    // ثبت اشتراک Web Push تا اعلان حتی با اپ بسته برسد
    try {
      const reg = await navigator.serviceWorker.ready;
      const res = await fetch("/api/push/vapid-public");
      if (res.ok) {
        const { publicKey } = await res.json();
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        setNotifGranted(true);
        toast.success("یادآوری فعال شد — حتی با بسته‌بودن اپ اطلاع می‌گیرید");
      } else {
        // VAPID ست نشده → فقط یادآوری درون‌اپی فعال است
        setNotifGranted(true);
        toast.success("یادآوری درون‌اپی فعال شد (push سرور هنوز تنظیم نشده)");
      }
    } catch {
      setNotifGranted(true);
      toast.success("یادآوری درون‌اپی فعال شد");
    }
  }

  if (loading && !data) return <Spinner />;

  const selectedDayCheques = selectedDay
    ? data?.cheques.filter((c) => c.dueDate === selectedDay) ?? []
    : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="چک‌ها"
        subtitle="ثبت دستی چک + هشدار سررسید و نمای تقویمی"
        action={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "list", label: "لیست" },
                { value: "calendar", label: "تقویم" },
              ]}
            />
            <AddButton onClick={() => setAddOpen(true)}>چک</AddButton>
          </>
        }
      />

      <SubscriptionBanner profile={data?.profile ?? null} trialDays={TRIAL_DAYS} compact />

      {error && (
        <p className="rounded-xl bg-[color:var(--warning-soft)] px-3 py-2 text-xs font-medium text-[color:var(--warning-ink)]">
          {error}
        </p>
      )}

      <OfflineBadge stale={stale} savedAt={savedAt} />

      {(overdueCount > 0 || nearCount > 0) && (
        <div className="grid grid-cols-3 gap-2">
          <div className="card p-3 text-center">
            <div className="tnum text-base font-extrabold" style={{ color: overdueCount > 0 ? "var(--danger-ink)" : "var(--ink)" }}>
              {faNum(overdueCount)}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold" style={{ color: "var(--ink-soft)" }}>سررسید گذشته</div>
          </div>
          <div className="card p-3 text-center">
            <div className="tnum text-base font-extrabold" style={{ color: nearCount > 0 ? "var(--warning-ink)" : "var(--ink)" }}>
              {faNum(nearCount)}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold" style={{ color: "var(--ink-soft)" }}>
              تا {faNum(warningDays)} روز آینده
            </div>
          </div>
          <div className="card p-3 text-center">
            <div className="tnum text-base font-extrabold" style={{ color: "var(--primary-dark)" }}>
              {compactToman(totalOpenAmount)}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold" style={{ color: "var(--ink-soft)" }}>جمع کل باز (تومان)</div>
          </div>
        </div>
      )}

      {!notifGranted && (
        <div className="card flex items-center justify-between gap-2 p-3">
          <p className="text-[11px] leading-5 text-[color:var(--ink-soft)]">
            یادآوری فعال: با فعال‌سازی، نزدیک سررسید هر چک، اعلان دریافت
            می‌کنید (حتی وقتی در اپ نیستید)
          </p>
          <button
            onClick={enableReminders}
            className="shrink-0 rounded-2xl bg-[color:var(--warning)] px-3 py-2 text-[11px] font-bold text-[color:var(--warning-ink)] transition active:scale-95"
          >
            فعال‌سازی
          </button>
        </div>
      )}

      {(data?.cheques.length ?? 0) === 0 ? (
        <EmptyState
          title="چکی ثبت نشده"
          desc="با دکمه «+ چک» نام ویزیتور، مبلغ و تاریخ سررسید را دستی وارد کنید"
        />
      ) : view === "list" ? (
        <ChequeGroups
          cheques={data?.cheques ?? []}
          warningDays={warningDays}
          overdue={overdue}
          warn={warn}
          onSettle={settle}
        />
      ) : (
        <div className="card p-3">
          {/* هدر ماه */}
          <div className="mb-3 flex items-center justify-between">
            <button
              onClick={() => shiftMonth(-1)}
              className="grid size-8 place-items-center rounded-lg bg-[color:var(--line)] text-sm"
              aria-label="ماه قبل"
            >
              ‹
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[color:var(--ink)]">
                {monthLabel(month.y, month.m)}
              </span>
              <button
                onClick={() =>
                  setMonth({ y: now.getFullYear(), m: now.getMonth() })
                }
                className="rounded-full bg-[color:var(--primary-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--primary-dark)]"
              >
                امروز
              </button>
            </div>
            <button
              onClick={() => shiftMonth(1)}
              className="grid size-8 place-items-center rounded-lg bg-[color:var(--line)] text-sm"
              aria-label="ماه بعد"
            >
              ›
            </button>
          </div>

          {/* ستون روزهای هفته */}
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="py-1 text-center text-[10px] font-medium text-[color:var(--ink-soft)]"
              >
                {w}
              </div>
            ))}
          </div>

          {/* خانه‌های ماه */}
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((cell) => {
              if (!cell.date)
                return (
                  <div
                    key={cell.key}
                    className="min-h-14 rounded-lg bg-[color:var(--line)]/60"
                  />
                );
              const key = cell.key;
              const dayCheques = byDay.get(key) ?? [];
              const total = dayCheques.reduce((s, x) => s + x.amount, 0);
              const isToday = key === ymd(now);
              const hasWarn = dayCheques.some(warn);
              const hasOverdue = dayCheques.some(overdue);
              return (
                <button
                  key={key}
                  onClick={() => setSelectedDay(selectedDay === key ? null : key)}
                  className={cn(
                    "min-h-14 rounded-lg border p-1 text-right transition",
                    selectedDay === key
                      ? "border-[color:var(--primary)] bg-[color:var(--primary-soft)]/70"
                      : hasOverdue
                        ? "border-[color:var(--danger)]/40 bg-[color:var(--danger-soft)]/50"
                        : hasWarn
                          ? "border-[color:var(--warning)] bg-[color:var(--warning-soft)]/50"
                          : isToday
                            ? "border-[color:var(--primary)] bg-[color:var(--surface)]"
                            : "border-[color:var(--line)] bg-[color:var(--surface)]"
                  )}
                >
                  <div
                    className={cn(
                      "text-[11px] font-medium",
                      isToday ? "text-[color:var(--primary-dark)]" : "text-[color:var(--ink-soft)]"
                    )}
                  >
                    {faNum(cell.date.getDate())}
                  </div>
                  {dayCheques.length > 0 && (
                    <div className="mt-0.5">
                      <div className="tnum text-[9px] font-bold text-[color:var(--ink)]">
                        {faNum(dayCheques.length)} چک
                      </div>
                      <div className="tnum text-[9px] text-[color:var(--primary-dark)]">
                        {compactToman(total)}
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* چک‌های روز انتخابی */}
          {selectedDay && (
            <div className="mt-3 border-t border-[color:var(--line)] pt-3">
              <p className="mb-2 text-xs font-bold text-[color:var(--ink)]">
                چک‌های {faDate(selectedDay)} — مجموع:{" "}
                <span className="tnum text-[color:var(--primary-dark)]">
                  {toman(
                    selectedDayCheques.reduce((s, c) => s + c.amount, 0)
                  )}
                </span>
              </p>
              <div className="space-y-2">
                {selectedDayCheques.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[color:var(--line)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[color:var(--ink)]">
                        {c.visitorName}
                      </div>
                      <div className="tnum text-[11px] text-[color:var(--primary-dark)]">
                        {toman(c.amount)}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      className="shrink-0 px-2.5 py-1 text-[11px]"
                      onClick={() => settle(c)}
                    >
                      تسویه
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* تاریخچه تسویه‌شده */}
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <button
          onClick={() => setHistoryOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[color:var(--ink-soft)]"
        >
          <span>تاریخچه تسویه‌شده ({faNum(data?.history.length ?? 0)})</span>
          <span className={cn("transition-transform", historyOpen && "rotate-180")}>▼</span>
        </button>
        {historyOpen && (
          <div className="space-y-2 border-t border-[color:var(--line)] p-4">
            {(data?.history.length ?? 0) === 0 ? (
              <p className="text-center text-xs text-[color:var(--ink-soft)]">
                هنوز چکی تسویه نشده
              </p>
            ) : (
              data?.history.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-[color:var(--line)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-[color:var(--ink)]">
                        {c.visitorName}
                      </span>
                      <span className="tnum text-[11px] text-[color:var(--ink-soft)]">
                        {toman(c.amount)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-[color:var(--ink-soft)]">
                      سررسید {faDate(c.dueDate)} · تسویه {faDateTime(c.settledAt)}
                    </div>
                  </div>
                  <button
                    onClick={() => remove(c)}
                    className="shrink-0 text-[10px] text-[var(--danger-ink)]"
                  >
                                      </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ---------- افزودن چک ---------- */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="ثبت چک جدید">
        <form onSubmit={save} className="space-y-3">
          <Field label="شرکت (گیرنده‌ی چک)">
            <Input
              placeholder="شرکت/پخش مربوطه"
              value={form.visitorCompany}
              onChange={(e) => setForm({ ...form, visitorCompany: e.target.value })}
            />
          </Field>
          <Field label="ویزیتور (واسطه — اختیاری برای پرکردن خودکار)">
            <Input
              list="cheque-visitors"
              placeholder="نام ویزیتور"
              value={form.visitorName}
              onChange={(e) => pickVisitor(e.target.value)}
              required
            />
          </Field>
          <datalist id="cheque-visitors">
            {visitors.map((v) => (
              <option key={v.id} value={v.name}>
                {v.company ? ` — ${v.company}` : ""}
              </option>
            ))}
          </datalist>
          <div className="grid grid-cols-2 gap-2">
            <Field label="مبلغ (تومان)">
              <Input
                inputMode="numeric"
                placeholder="مثلاً ۵٬۰۰۰٬۰۰۰"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </Field>
            <Field label="تاریخ سررسید (شمسی)">
              <JalaliDatePicker
                value={form.dueDate}
                onChange={(iso) => setForm({ ...form, dueDate: iso })}
              />
            </Field>
          </div>
          <p className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
            همه‌ی مقادیر دستی وارد می‌شوند؛ هیچ محاسبه‌ی خودکاری انجام نمی‌شود.
          </p>
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy ? "در حال ثبت…" : "ثبت چک"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
