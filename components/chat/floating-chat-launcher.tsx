"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import useSWR from "swr"
import { AlertCircle, Bot, Loader2, X } from "lucide-react"
import { usePathname } from "next/navigation"
import { ChatInterface } from "@/components/chat/chat-interface"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ChatIAConfig } from "@/app/api/chat/config/route"

const HIDDEN_ROUTES = ["/chat", "/auth/login"]

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || "Falha ao carregar")
  return data
}

export function FloatingChatLauncher() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  const { data: config, isLoading: configLoading } = useSWR<ChatIAConfig>(
    "/api/chat/config",
    fetcher
  )

  const isReady = !configLoading && config?.enabled && !!config.datasetId && !!config.workspaceId

  const statusMessage = useMemo(() => {
    if (configLoading) {
      return { title: "Carregando...", icon: Loader2 }
    }
    if (!config?.enabled || !config.datasetId) {
      return { title: "Chat nao disponivel", icon: AlertCircle }
    }
    return { title: config.datasetName || "Analista IA", icon: Bot }
  }, [config, configLoading])

  if (HIDDEN_ROUTES.some((route) => pathname.startsWith(route))) {
    return null
  }

  if (!configLoading && !config?.enabled) {
    return null
  }

  return (
    <>
      {/* Botao flutuante */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? "Fechar chat" : "Abrir chat"}
        className={cn(
          "fixed bottom-5 right-5 z-50 flex h-[200px] w-[200px] items-center justify-center bg-transparent transition-all duration-300 hover:scale-105",
          "sm:bottom-6 sm:right-6",
          isOpen && "scale-95 opacity-80"
        )}
      >
        <div className="relative h-[156px] w-[156px]">
          <Image
            src="/brand/icone-logo.png"
            alt="SIL Chat IA"
            fill
            sizes="186px"
            className="object-contain"
            priority
          />
        </div>
      </button>

      {/* Painel do chat */}
      <div
        className={cn(
          "fixed bottom-[100px] right-5 z-[60] flex w-[min(calc(100vw-1.5rem),400px)] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_20px_60px_rgba(15,23,42,0.2)] ring-1 ring-slate-900/8 transition-all duration-300 sm:bottom-[108px] sm:right-6",
          isOpen
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-y-3 scale-[0.97] opacity-0"
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 bg-gradient-to-r from-[#0f172a] to-[#1e40af] px-4 py-3 text-white">
          <div className="relative -my-3 h-20 w-20 shrink-0">
            <Image
              src="/brand/logo-sil.png"
              alt="SIL"
              fill
              sizes="80px"
              className="object-contain"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Chat IA</p>
            <p className="truncate text-[11px] text-blue-200/80">{statusMessage.title}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 rounded-full text-white/70 hover:bg-white/15 hover:text-white"
            onClick={() => setIsOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Corpo */}
        <div className="h-[540px] bg-white">
          {isReady ? (
            <ChatInterface
              datasetId={config!.datasetId}
              workspaceId={config!.workspaceId}
              datasetName={config!.datasetName}
              compact
              className="bg-white"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <statusMessage.icon
                  className={cn("size-7", configLoading && "animate-spin")}
                />
              </div>
              <p className="text-sm font-medium text-slate-600">{statusMessage.title}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
