"use client";

import { PageHeader } from "@/components/ui";
import { NAV_ITEMS, NavCard } from "@/components/nav-cards";

/** «بیشتر»: بقیه‌ی بخش‌ها (کالاها، درخواست قیمت و کسری‌ها در اولویت)؛ همان کارت‌های قبلیِ صفحه‌ی اصلی */
const ORDER = ["/products", "/price-requests", "/shortages", "/quick-notes", "/orders", "/history", "/settings"];

export default function MorePage() {
  const items = ORDER.map((href) => NAV_ITEMS.find((n) => n.href === href)).filter(
    (n): n is (typeof NAV_ITEMS)[number] => Boolean(n)
  );
  return (
    <div className="space-y-4">
      <PageHeader title="بیشتر" />
      <div className="grid grid-cols-2 gap-3">
        {items.map((n) => (
          <NavCard key={n.href} {...n} />
        ))}
      </div>
    </div>
  );
}
