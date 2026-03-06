import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

function getAuthToken(req: NextRequest): string | undefined {
  const directToken =
    req.cookies.get("token")?.value ||
    req.cookies.get("auth-token")?.value ||
    req.cookies.get("access_token")?.value ||
    req.cookies.get("session")?.value

  if (directToken) return directToken

  // Supabase: sb-<project-ref>-auth-token (ou variações em chunks)
  const supabaseCookie = req.cookies
    .getAll()
    .find(
      (cookie) =>
        cookie.name.startsWith("sb-") && cookie.name.includes("auth-token")
    )

  return supabaseCookie?.value
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = getAuthToken(req)

  const isAuthRoute = pathname.startsWith("/auth")
  const isApiRoute = pathname.startsWith("/api")
  const isNextRoute = pathname.startsWith("/_next")
  const isPublicFile =
    pathname === "/favicon.ico" ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".gif") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".map")

  if (isApiRoute || isNextRoute || isPublicFile) {
    return NextResponse.next()
  }

  if (!token && !isAuthRoute) {
    return NextResponse.redirect(new URL("/auth/login", req.url))
  }

  if (token && isAuthRoute) {
    return NextResponse.redirect(new URL("/", req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/:path*"],
}
