import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { applySessionCookieWrites } from "@/lib/supabase/session-cookies"

function clearSupabaseAuthCookies(request: NextRequest, response: NextResponse) {
  const authCookieNames = request.cookies
    .getAll()
    .map((cookie) => cookie.name)
    .filter((name) => name.startsWith("sb-"))

  for (const cookieName of authCookieNames) {
    response.cookies.delete(cookieName)
  }
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          applySessionCookieWrites(cookiesToSet, (name, value) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          applySessionCookieWrites(cookiesToSet, (name, value, options) =>
            supabaseResponse.cookies.set(
              name,
              value,
              options as Parameters<typeof supabaseResponse.cookies.set>[2]
            )
          )
        },
      },
    }
  )

  // Always validate the cookie-backed session with getUser().
  let user = null

  try {
    const { data } = await supabase.auth.getUser()
    user = data?.user ?? null
  } catch {
    // Invalid or stale auth cookies should not break page rendering.
    clearSupabaseAuthCookies(request, supabaseResponse)
    user = null
  }

  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    !request.nextUrl.pathname.startsWith("/api")
  ) {
    const url = request.nextUrl.clone()
    url.pathname = "/auth/login"

    const response = NextResponse.redirect(url)
    clearSupabaseAuthCookies(request, response)
    return response
  }

  if (user && request.nextUrl.pathname.startsWith("/auth")) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    return NextResponse.redirect(url)
  }

  if (user && request.nextUrl.pathname.startsWith("/admin")) {
    const role = user.app_metadata?.role || user.user_metadata?.role

    if (role !== "admin") {
      const url = request.nextUrl.clone()
      url.pathname = "/"
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
