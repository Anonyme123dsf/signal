"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Lädt die Server-Komponenten der Seite in festem Takt neu, damit Preise und Gelegenheiten live wirken. */
export function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
