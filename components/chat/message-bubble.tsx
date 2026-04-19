"use client"

import { useState } from "react"
import { Bot, User, ChevronDown, ChevronUp, Copy, Check, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/lib/chat"
import { DataTableResult } from "./data-table-result"

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [showDax, setShowDax] = useState(false)
  const [copied, setCopied] = useState(false)
  const isUser = message.role === "user"

  const handleCopyDax = async () => {
    if (!message.daxQuery) return
    await navigator.clipboard.writeText(message.daxQuery)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const confidenceColor = {
    high: "text-emerald-500",
    medium: "text-amber-500",
    low: "text-rose-500",
  }

  const confidenceLabel = {
    high: "Alta confiança",
    medium: "Confiança média",
    low: "Baixa confiança",
  }

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "mt-1 flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground border border-border"
        )}
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>

      {/* Conteúdo */}
      <div className={cn("flex max-w-[85%] flex-col gap-2", isUser ? "items-end" : "items-start")}>
        {/* Bolha de texto */}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "rounded-tr-sm bg-[linear-gradient(135deg,#2563eb,#1d4ed8)] text-primary-foreground shadow-[0_10px_24px_rgba(37,99,235,0.2)]"
              : "rounded-tl-sm border border-slate-200 bg-white text-slate-700 shadow-sm"
          )}
        >
          {message.error ? (
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span className="whitespace-pre-wrap">{message.content}</span>
            </div>
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}
        </div>

        {/* Tabela de dados */}
        {!isUser && message.data && message.data.rows.length > 0 && (
          <div className="w-full max-w-2xl">
            <DataTableResult
              columns={message.data.columns}
              rows={message.data.rows}
            />
          </div>
        )}

        {/* Rodapé: confiança + DAX query */}
        {!isUser && (message.daxQuery || message.confidence) && (
          <div className="flex flex-wrap items-center gap-2">
            {message.confidence && (
              <span
                className={cn(
                  "text-xs font-medium",
                  confidenceColor[message.confidence]
                )}
              >
                {confidenceLabel[message.confidence]}
              </span>
            )}

            {message.daxQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowDax((prev) => !prev)}
              >
                {showDax ? (
                  <>
                    <ChevronUp className="size-3" />
                    Ocultar DAX
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3" />
                    Ver DAX
                  </>
                )}
              </Button>
            )}
          </div>
        )}

        {/* Bloco DAX expansível */}
        {!isUser && showDax && message.daxQuery && (
          <div className="w-full max-w-2xl rounded-lg border border-border bg-muted/50">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">Query DAX gerada</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={handleCopyDax}
              >
                {copied ? (
                  <>
                    <Check className="size-3 text-emerald-500" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    Copiar
                  </>
                )}
              </Button>
            </div>
            <pre className="overflow-x-auto p-3 text-xs text-foreground/80 font-mono leading-relaxed">
              {message.daxQuery}
            </pre>
          </div>
        )}

        {/* Timestamp */}
        <span className="text-[10px] text-muted-foreground/60">
          {new Date(message.timestamp).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  )
}
