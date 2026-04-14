"use client"

import { useEffect, useRef } from "react"

const CHECK_INTERVAL_MS = 30 * 60 * 1000 // 30 minutos

export function PowerBIAutoSyncWatcher() {
  const lastCheckRef = useRef<number>(0)

  async function checkAndSync() {
    try {
      await fetch("/api/powerbi/auto-sync", { method: "POST" })
    } catch {
      // falha silenciosa — nao interrompe o usuario
    }
  }

  useEffect(() => {
    const now = Date.now()
    if (now - lastCheckRef.current >= CHECK_INTERVAL_MS) {
      lastCheckRef.current = now
      void checkAndSync()
    }

    const interval = setInterval(() => {
      lastCheckRef.current = Date.now()
      void checkAndSync()
    }, CHECK_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [])

  return null
}
