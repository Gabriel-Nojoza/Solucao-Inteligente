"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import {
  clearSupabaseAuthCookies,
  clearTabSessionMarker,
  hasSupabaseAuthCookies,
  hasTabSessionMarker,
} from "@/lib/supabase/tab-session"

export function TabSessionGuard({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const hasCheckedRef = useRef(false)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    if (hasCheckedRef.current) {
      return
    }

    hasCheckedRef.current = true
    let isMounted = true

    const verifyTabSession = async () => {
      if (!hasSupabaseAuthCookies()) {
        clearTabSessionMarker()

        if (isMounted) {
          setIsReady(true)
        }

        return
      }

      if (hasTabSessionMarker()) {
        if (isMounted) {
          setIsReady(true)
        }

        return
      }

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

      router.replace("/auth/login")
      router.refresh()
    }

    void verifyTabSession()

    return () => {
      isMounted = false
    }
  }, [router])

  if (!isReady) {
    return null
  }

  return <>{children}</>
}
