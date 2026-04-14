import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
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

  return updateSession(request)
}

export const config = {
  matcher: ["/:path*"],
}
