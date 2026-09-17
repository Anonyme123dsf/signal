import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-seitiger Supabase-Client mit Service-Role-Key. Nur in Server-Komponenten
 * und Server Actions verwenden, nie im Browser: Der Key umgeht RLS.
 */
export function getServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
