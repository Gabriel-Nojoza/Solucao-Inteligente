const TAB_SESSION_KEY = "solucao-inteligente.active-tab-session"

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

export function hasTabSessionMarker() {
  if (typeof window === "undefined") {
    return false
  }

  return sessionStorage.getItem(TAB_SESSION_KEY) === "active"
}

export function markTabSessionActive() {
  if (typeof window === "undefined") {
    return
  }

  sessionStorage.setItem(TAB_SESSION_KEY, "active")
}

export function clearTabSessionMarker() {
  if (typeof window === "undefined") {
    return
  }

  sessionStorage.removeItem(TAB_SESSION_KEY)
}

export function hasSupabaseAuthCookies() {
  return readBrowserCookies().some((cookie) => cookie.name.startsWith("sb-"))
}

export function clearSupabaseAuthCookies() {
  readBrowserCookies()
    .filter((cookie) => cookie.name.startsWith("sb-"))
    .forEach((cookie) => {
      document.cookie = `${cookie.name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
    })
}
