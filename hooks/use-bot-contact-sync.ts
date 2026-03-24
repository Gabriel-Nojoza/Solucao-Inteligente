"use client"

import { useEffect, useRef, useState } from "react"
import { mutate } from "swr"

type BotRuntimeStatus =
  | "starting"
  | "awaiting_qr"
  | "connected"
  | "reconnecting"
  | "offline"
  | "error"

type BotContactSyncState = {
  status?: BotRuntimeStatus
  jid?: string | null
  phone_number?: string | null
  connected_at?: string | null
}

type BotContactSyncResponse = {
  error?: string
  inserted?: number
  updated?: number
  total_found?: number
  total_synced?: number
  failed?: number
}

export function useBotContactSync(botState: BotContactSyncState | null | undefined) {
  const [syncingBotContacts, setSyncingBotContacts] = useState(false)
  const isMountedRef = useRef(false)
  const autoSyncedSessionRef = useRef<string | null>(null)
  const syncPromiseRef = useRef<Promise<BotContactSyncResponse> | null>(null)

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  async function syncContactsFromBot(_silent = false) {
    if (syncPromiseRef.current) {
      return syncPromiseRef.current
    }

    const syncPromise = (async () => {
      if (isMountedRef.current) {
        setSyncingBotContacts(true)
      }

      try {
        const response = await fetch("/api/contacts/sync-bot", {
          method: "POST",
        })
        const data = (await response.json().catch(() => null)) as BotContactSyncResponse | null

        if (!response.ok) {
          throw new Error(data?.error || "Erro ao sincronizar contatos do bot")
        }

        await mutate("/api/contacts")
        return data ?? {}
      } finally {
        if (isMountedRef.current) {
          setSyncingBotContacts(false)
        }
        syncPromiseRef.current = null
      }
    })()

    syncPromiseRef.current = syncPromise
    return syncPromise
  }

  useEffect(() => {
    if (botState?.status !== "connected") {
      autoSyncedSessionRef.current = null
      return
    }

    const sessionKey = [
      botState.jid ?? botState.phone_number ?? "bot",
      botState.connected_at ?? "connected",
    ].join(":")

    if (autoSyncedSessionRef.current === sessionKey) {
      return
    }

    autoSyncedSessionRef.current = sessionKey

    void syncContactsFromBot().catch(() => {
      autoSyncedSessionRef.current = null
    })
  }, [botState?.connected_at, botState?.jid, botState?.phone_number, botState?.status])

  return {
    syncingBotContacts,
    syncContactsFromBot,
  }
}
