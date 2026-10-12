import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { PriceRequestsInner } from "./inner";

export default function PriceRequestsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <PriceRequestsInner />
    </Suspense>
  );
}
