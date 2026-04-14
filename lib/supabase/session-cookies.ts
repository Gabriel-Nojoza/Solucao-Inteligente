type CookieSameSite = boolean | "lax" | "strict" | "none" | "Lax" | "Strict" | "None"

type CookieOptions = {
  domain?: string
  expires?: Date | string
  httpOnly?: boolean
  maxAge?: number
  partitioned?: boolean
  path?: string
  priority?: "low" | "medium" | "high" | "Low" | "Medium" | "High"
  sameSite?: CookieSameSite
  secure?: boolean
}

type SupabaseCookie = {
  name: string
  value: string
  options?: CookieOptions | Record<string, unknown>
}

function isRemovalCookie(cookie: SupabaseCookie) {
  const rawMaxAge = (cookie.options as CookieOptions | undefined)?.maxAge
  const parsedMaxAge =
    typeof rawMaxAge === "number"
      ? rawMaxAge
      : typeof rawMaxAge === "string"
        ? Number(rawMaxAge)
        : NaN

  return cookie.value === "" || parsedMaxAge === 0
}

function toSessionCookieOptions(cookie: SupabaseCookie) {
  const options = { ...(cookie.options ?? {}) } as CookieOptions & Record<string, unknown>

  if (!isRemovalCookie(cookie)) {
    delete options.maxAge
    delete options.expires
  }

  return options
}

function normalizeSameSite(value: CookieSameSite | undefined) {
  if (value === true) return "Strict"
  if (typeof value !== "string") return null

  const normalized = value.toLowerCase()
  if (normalized === "lax") return "Lax"
  if (normalized === "strict") return "Strict"
  if (normalized === "none") return "None"

  return null
}

function normalizePriority(value: CookieOptions["priority"]) {
  if (typeof value !== "string") return null

  const normalized = value.toLowerCase()
  if (normalized === "low") return "Low"
  if (normalized === "medium") return "Medium"
  if (normalized === "high") return "High"

  return null
}

function serializeBrowserCookie(cookie: SupabaseCookie) {
  const options = toSessionCookieOptions(cookie)
  const parts = [`${cookie.name}=${cookie.value}`]

  if (typeof options.maxAge === "number" && Number.isFinite(options.maxAge)) {
    parts.push(`Max-Age=${Math.trunc(options.maxAge)}`)
  }

  if (options.expires) {
    const expiresValue =
      options.expires instanceof Date
        ? options.expires.toUTCString()
        : String(options.expires)
    parts.push(`Expires=${expiresValue}`)
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`)
  }

  if (options.path) {
    parts.push(`Path=${options.path}`)
  }

  const sameSite = normalizeSameSite(options.sameSite)
  if (sameSite) {
    parts.push(`SameSite=${sameSite}`)
  }

  const priority = normalizePriority(options.priority)
  if (priority) {
    parts.push(`Priority=${priority}`)
  }

  if (options.secure) {
    parts.push("Secure")
  }

  if (options.httpOnly) {
    parts.push("HttpOnly")
  }

  if (options.partitioned) {
    parts.push("Partitioned")
  }

  return parts.join("; ")
}

function readBrowserCookies() {
  if (typeof document === "undefined" || !document.cookie.trim()) {
    return []
  }

  return document.cookie
    .split(/;\s*/)
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=")

      if (separatorIndex === -1) {
        return { name: entry, value: "" }
      }

      return {
        name: entry.slice(0, separatorIndex),
        value: entry.slice(separatorIndex + 1),
      }
    })
}

export function createBrowserSessionCookieMethods() {
  return {
    getAll() {
      return readBrowserCookies()
    },
    setAll(cookies: SupabaseCookie[]) {
      cookies.forEach((cookie) => {
        document.cookie = serializeBrowserCookie(cookie)
      })
    },
  }
}

export function applySessionCookieWrites(
  cookies: SupabaseCookie[],
  writeCookie: (name: string, value: string, options?: Record<string, unknown>) => void
) {
  cookies.forEach((cookie) => {
    writeCookie(cookie.name, cookie.value, toSessionCookieOptions(cookie))
  })
}
