"use client";

import { useCallback, useEffect, useState } from "react";
import { offlineFetch, type OfflineResult } from "@/lib/offline";

/**
 * Fetches data with the offline-first layer (service worker + IndexedDB).
 * - 401 responses redirect to the login page.
 * - `stale: true` means the response came from the on-device cache.
 * - `reload` re-fetches and returns the full result (useful after mutations).
 */
export function useOfflineData<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<OfflineResult<T> | null> => {
    setLoading(true);
    const r = await offlineFetch<T>(url);
    if (r.status === 401) {
      window.location.href = "/login";
      setLoading(false);
      return null;
    }
    setData(r.data);
    setStale(r.stale);
    setError(r.error ?? "");
    setSavedAt(r.savedAt);
    setLoading(false);
    return r;
  }, [url]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, stale, error, savedAt, loading, reload };
}
