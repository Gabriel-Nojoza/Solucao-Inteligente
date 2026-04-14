import { createBrowserClient } from "@supabase/ssr"
import { createBrowserSessionCookieMethods } from "@/lib/supabase/session-cookies"

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: createBrowserSessionCookieMethods(),
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )
}
