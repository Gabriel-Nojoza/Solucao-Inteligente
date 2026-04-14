const TAB_SESSION_KEY = "solucao-inteligente.active-tab-session"
const TAB_INSTANCE_ID_KEY = "solucao-inteligente.tab-instance-id"
const ACTIVE_TABS_STORAGE_KEY = "solucao-inteligente.active-tabs"
const TAB_STALE_AFTER_MS = 30_000

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

function readActiveTabs() {
  if (typeof window === "undefined") {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(ACTIVE_TABS_STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as Record<string, number>
    if (!parsed || typeof parsed !== "object") {
      return {}
    }

    return parsed
  } catch {
    return {}
  }
}

function writeActiveTabs(activeTabs: Record<string, number>) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(ACTIVE_TABS_STORAGE_KEY, JSON.stringify(activeTabs))
}

function pruneActiveTabs(activeTabs: Record<string, number>) {
  const now = Date.now()
  return Object.fromEntries(
    Object.entries(activeTabs).filter(([, timestamp]) => now - timestamp < TAB_STALE_AFTER_MS)
  )
}

export function getOrCreateTabSessionId() {
  if (typeof window === "undefined") {
    return null
  }

  const existing = sessionStorage.getItem(TAB_INSTANCE_ID_KEY)
  if (existing) {
    return existing
  }

  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  sessionStorage.setItem(TAB_INSTANCE_ID_KEY, generated)
  return generated
}

export function touchTabSession(tabId: string) {
  if (typeof window === "undefined") {
    return
  }

  const activeTabs = pruneActiveTabs(readActiveTabs())
  activeTabs[tabId] = Date.now()
  writeActiveTabs(activeTabs)
}

export function releaseTabSession(tabId: string) {
  if (typeof window === "undefined") {
    return
  }

  const activeTabs = pruneActiveTabs(readActiveTabs())
  delete activeTabs[tabId]
  writeActiveTabs(activeTabs)
}

export function hasOtherActiveTabs(tabId: string) {
  const activeTabs = pruneActiveTabs(readActiveTabs())
  writeActiveTabs(activeTabs)

  return Object.keys(activeTabs).some((activeTabId) => activeTabId !== tabId)
}
