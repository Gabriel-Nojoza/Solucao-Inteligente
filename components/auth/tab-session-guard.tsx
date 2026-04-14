"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import {
  clearSupabaseAuthCookies,
  clearTabSessionMarker,
  getOrCreateTabSessionId,
  hasSupabaseAuthCookies,
  hasOtherActiveTabs,
  hasTabSessionMarker,
  markTabSessionActive,
  releaseTabSession,
  touchTabSession,
} from "@/lib/supabase/tab-session"

const TAB_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000

export function TabSessionGuard({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const hasCheckedRef = useRef(false)
  const isValidatingRef = useRef(false)
  const hiddenAtRef = useRef<number | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    if (hasCheckedRef.current) {
      return
    }

    hasCheckedRef.current = true
    let isMounted = true
    const tabId = getOrCreateTabSessionId()

    const redirectToLogin = () => {
      if (typeof window !== "undefined") {
        window.location.replace("/auth/login")
        return
      }

      router.replace("/auth/login")
      router.refresh()
    }

    const verifyTabSession = async ({
      forceValidate = false,
      refreshOnSuccess = false,
    }: {
      forceValidate?: boolean
      refreshOnSuccess?: boolean
    } = {}) => {
      if (isValidatingRef.current) {
        return
      }

      isValidatingRef.current = true

      try {
        if (!hasSupabaseAuthCookies()) {
          clearTabSessionMarker()
          if (tabId) {
            releaseTabSession(tabId)
          }

          if (isMounted) {
            setIsReady(true)
          }

          return
        }

        if (tabId) {
          touchTabSession(tabId)
        }

        const shouldValidateWithSupabase = forceValidate || !hasTabSessionMarker()

        if (!hasTabSessionMarker() && tabId && !hasOtherActiveTabs(tabId)) {
          throw new Error("Sessao encerrada ao fechar a ultima aba")
        }

        if (!shouldValidateWithSupabase) {
          if (isMounted) {
            setIsReady(true)
          }

          return
        }

        const supabase = createClient()
        const { data, error } = await supabase.auth.getUser()

        if (error || !data.user) {
          throw error ?? new Error("Sessao invalida")
        }

        markTabSessionActive()

        if (!isMounted) {
          return
        }

        setIsReady(true)

        if (refreshOnSuccess && typeof window !== "undefined") {
          window.location.reload()
        }
      } catch {
        const supabase = createClient()

        try {
          await supabase.auth.signOut()
        } catch {
          // The local cookie cleanup below is enough to force a fresh login.
        }

        clearSupabaseAuthCookies()
        clearTabSessionMarker()

        if (!isMounted) {
          return
        }

        redirectToLogin()
      } finally {
        isValidatingRef.current = false
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now()
        if (tabId) {
          touchTabSession(tabId)
        }
        return
      }

      const hiddenForLong =
        hiddenAtRef.current !== null &&
        Date.now() - hiddenAtRef.current >= TAB_REVALIDATE_INTERVAL_MS

      hiddenAtRef.current = null
      void verifyTabSession({
        forceValidate: true,
        refreshOnSuccess: hiddenForLong,
      })
    }

    const handleWindowFocus = () => {
      void verifyTabSession({ forceValidate: true })
    }

    const heartbeatInterval = window.setInterval(() => {
      if (tabId) {
        touchTabSession(tabId)
      }
    }, 10_000)

    const handlePageHide = () => {
      if (tabId) {
        releaseTabSession(tabId)
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("focus", handleWindowFocus)
    window.addEventListener("pagehide", handlePageHide)

    void verifyTabSession({ forceValidate: true })

    return () => {
      isMounted = false
      window.clearInterval(heartbeatInterval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleWindowFocus)
      window.removeEventListener("pagehide", handlePageHide)
    }
  }, [router])

  if (!isReady) {
    return null
  }

  return <>{children}</>
}
