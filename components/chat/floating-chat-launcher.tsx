"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import useSWR from "swr"
import { AlertCircle, Bot, Loader2, X, Maximize2, Minimize2 } from "lucide-react"
import { usePathname } from "next/navigation"
import { ChatInterface } from "@/components/chat/chat-interface"
import { Button } from "@/components/ui/button"
import { BRAND_CHAT_LOGO_PATH } from "@/lib/branding"
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
  const [isFullscreen, setIsFullscreen] = useState(false)

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
        <div className="flex h-16 w-16 items-center justify-center">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-14 w-14 drop-shadow-lg">
            <rect x="4" y="14" width="10" height="28" rx="3" fill="#FACC15">
              <animate attributeName="height" values="28;20;28" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="y" values="14;22;14" dur="1.6s" repeatCount="indefinite" />
            </rect>
            <rect x="19" y="24" width="10" height="18" rx="3" fill="#F97316">
              <animate attributeName="height" values="18;28;18" dur="1.4s" repeatCount="indefinite" />
              <animate attributeName="y" values="24;14;24" dur="1.4s" repeatCount="indefinite" />
            </rect>
            <rect x="34" y="8" width="10" height="34" rx="3" fill="#38BDF8">
              <animate attributeName="height" values="34;22;34" dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="y" values="8;20;8" dur="1.8s" repeatCount="indefinite" />
            </rect>
          </svg>
        </div>
      </button>

      {/* Painel do chat */}
      <div
        className={cn(
          "fixed z-[60] flex flex-col bg-card shadow-[0_20px_60px_rgba(0,0,0,0.4)] ring-1 ring-border transition-all duration-300",
          isFullscreen
            ? "inset-0 rounded-none"
            : "bottom-[100px] right-5 w-[min(calc(100vw-1.5rem),400px)] rounded-2xl sm:bottom-[108px] sm:right-6",
          isOpen
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-y-3 scale-[0.97] opacity-0"
        )}
      >
        {/* Header */}
        <div className={cn("flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground", !isFullscreen && "rounded-t-2xl")}>
          <div className="relative -my-3 h-20 w-20 shrink-0">
            <Image
              src={BRAND_CHAT_LOGO_PATH}
              alt="SIL"
              fill
              sizes="80px"
              className="object-contain"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Chat IA</p>
            <p className="truncate text-[11px] text-primary-foreground/70">{statusMessage.title}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 rounded-full text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground"
            onClick={() => setIsFullscreen((prev) => !prev)}
            aria-label={isFullscreen ? "Minimizar" : "Ampliar"}
          >
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 rounded-full text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground"
            onClick={() => { setIsOpen(false); setIsFullscreen(false) }}
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Corpo */}
        <div className={cn("bg-card", isFullscreen ? "flex-1 overflow-hidden" : "h-[540px]")}>
          {isReady ? (
            <ChatInterface
              datasetId={config!.datasetId}
              workspaceId={config!.workspaceId}
              datasetName={config!.datasetName}
              compact
              className="h-full bg-card"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <statusMessage.icon
                  className={cn("size-7", configLoading && "animate-spin")}
                />
              </div>
              <p className="text-sm font-medium text-foreground">{statusMessage.title}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
