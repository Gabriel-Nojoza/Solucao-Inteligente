"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Send, Loader2, Trash2, Bot, Sparkles, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MessageBubble } from "./message-bubble"
import { createId } from "@/lib/id"
import { toast } from "sonner"
import type { ChatMessage, ChatApiResponse } from "@/lib/chat"
import { cn } from "@/lib/utils"

const SUGGESTED_QUESTIONS = [
  "Qual o total de vendas hoje?",
  "Quais os 10 produtos mais vendidos este mes?",
  "Como estao as vendas comparadas ao mes passado?",
  "Qual a receita por regiao neste ano?",
  "Quais clientes geraram mais faturamento?",
]

const MAX_HISTORY_MESSAGES = 50

function getStorageKey(datasetId: string) {
  return `chat_history_${datasetId}`
}

function loadHistory(datasetId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(getStorageKey(datasetId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatMessage[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(datasetId: string, messages: ChatMessage[]) {
  try {
    const trimmed = messages.slice(-MAX_HISTORY_MESSAGES)
    localStorage.setItem(getStorageKey(datasetId), JSON.stringify(trimmed))
  } catch {
    // localStorage indisponível
  }
}

function clearHistory(datasetId: string) {
  try {
    localStorage.removeItem(getStorageKey(datasetId))
  } catch {
    // ignore
  }
}

interface ChatInterfaceProps {
  datasetId: string
  workspaceId: string
  datasetName?: string
  compact?: boolean
  className?: string
}

export function ChatInterface({
  datasetId,
  workspaceId,
  datasetName,
  compact = false,
  className,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Carrega histórico do localStorage ao montar ou trocar dataset
  useEffect(() => {
    const saved = loadHistory(datasetId)
    setMessages(saved)
    setHistoryLoaded(true)
  }, [datasetId])

  // Salva histórico sempre que mensagens mudam (após carregamento inicial)
  useEffect(() => {
    if (!historyLoaded) return
    saveHistory(datasetId, messages)
  }, [messages, datasetId, historyLoaded])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const buildConversationHistory = useCallback(() => {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }))
  }, [messages])

  const sendMessage = useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (!trimmed || isLoading) return

      const userMessage: ChatMessage = {
        id: createId("msg"),
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      }

      setMessages((prev) => [...prev, userMessage])
      setInput("")
      setIsLoading(true)

      const thinkingId = createId("msg")
      const thinkingMessage: ChatMessage = {
        id: thinkingId,
        role: "assistant",
        content: "Analisando sua pergunta...",
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, thinkingMessage])

      try {
        const history = buildConversationHistory()

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: trimmed,
            datasetId,
            workspaceId,
            conversationHistory: history,
          }),
        })

        const data = (await response.json()) as ChatApiResponse

        const assistantMessage: ChatMessage = {
          id: thinkingId,
          role: "assistant",
          content: data.answer,
          timestamp: new Date().toISOString(),
          data: data.data,
          daxQuery: data.daxQuery,
          confidence: data.confidence,
          error: data.error ?? null,
        }

        setMessages((prev) =>
          prev.map((msg) => (msg.id === thinkingId ? assistantMessage : msg))
        )
      } catch (err) {
        const errorMessage: ChatMessage = {
          id: thinkingId,
          role: "assistant",
          content: "Ocorreu um erro ao processar sua pergunta. Tente novamente.",
          timestamp: new Date().toISOString(),
          error: err instanceof Error ? err.message : "Erro desconhecido",
        }

        setMessages((prev) =>
          prev.map((msg) => (msg.id === thinkingId ? errorMessage : msg))
        )

        toast.error("Erro ao enviar mensagem")
      } finally {
        setIsLoading(false)
        textareaRef.current?.focus()
      }
    },
    [datasetId, workspaceId, isLoading, buildConversationHistory]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(input)
    }
  }

  const handleClear = () => {
    setMessages([])
    clearHistory(datasetId)
    setInput("")
    textareaRef.current?.focus()
  }

  const isEmpty = messages.length === 0
  const hasHistory = messages.length > 0

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Barra de contexto */}
      {datasetName && (
        <div
          className={cn(
            "flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2",
            compact && "border-slate-100 bg-slate-50/80 px-4 py-2"
          )}
        >
          <Sparkles className={cn("size-3.5 shrink-0 text-primary", compact && "text-sky-500")} />
          <span className={cn("min-w-0 truncate text-xs text-muted-foreground", compact && "text-slate-500")}>
            <span className={cn("font-medium text-foreground", compact && "text-slate-700")}>
              {datasetName}
            </span>
          </span>
          {hasHistory && (
            <div className="ml-auto flex items-center gap-1">
              <span className={cn("text-[10px] text-muted-foreground/60", compact && "text-slate-400")}>
                <History className="inline size-3 mr-0.5" />
                {messages.length} msgs
              </span>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 gap-1 px-2 text-xs text-muted-foreground",
                  compact && "rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                )}
                onClick={handleClear}
              >
                <Trash2 className="size-3" />
                Limpar
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Area de mensagens */}
      <div
        className={cn(
          "flex-1 overflow-y-auto px-4 py-4",
          compact && "bg-white px-3 py-3"
        )}
      >
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div className="flex flex-col items-center gap-3">
              <div
                className={cn(
                  "flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary",
                  compact && "size-12 rounded-[18px] bg-gradient-to-br from-sky-50 to-blue-100 text-sky-600 shadow-sm ring-1 ring-sky-100"
                )}
              >
                <Bot className={cn("size-7", compact && "size-6")} />
              </div>
              <div>
                <h3 className={cn("text-base font-semibold", compact && "text-sm text-slate-800")}>
                  Analista de Dados IA
                </h3>
                <p className={cn("mt-1 max-w-xs text-sm text-muted-foreground", compact && "max-w-[260px] text-xs leading-5 text-slate-500")}>
                  Faca perguntas em linguagem natural sobre o dataset selecionado.
                </p>
              </div>
            </div>

            <div className={cn("w-full max-w-md space-y-1.5", compact && "max-w-none")}>
              <p className={cn("text-xs font-medium text-muted-foreground", compact && "text-[10px] font-semibold uppercase tracking-widest text-slate-400")}>
                Sugestoes
              </p>
              <div className="flex flex-col gap-1.5">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className={cn(
                      "rounded-lg border border-border bg-background px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-muted/60",
                      compact && "rounded-xl border-slate-200 bg-white px-3 py-2.5 text-[12px] font-medium text-slate-600 shadow-sm hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 active:scale-[0.98]"
                    )}
                    onClick={() => void sendMessage(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 pl-10">
                <div className={cn("flex gap-1", compact && "")}>
                  <span className="size-1.5 rounded-full bg-slate-300 animate-bounce [animation-delay:0ms]" />
                  <span className="size-1.5 rounded-full bg-slate-300 animate-bounce [animation-delay:150ms]" />
                  <span className="size-1.5 rounded-full bg-slate-300 animate-bounce [animation-delay:300ms]" />
                </div>
                <span className="text-xs text-muted-foreground">Gerando consulta DAX...</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div
        className={cn(
          "border-t border-border bg-background px-4 py-3",
          compact && "border-slate-100 bg-white px-3 py-3"
        )}
      >
        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20",
            compact && "rounded-2xl border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-sky-300 focus-within:ring-1 focus-within:ring-sky-100"
          )}
        >
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre seus dados..."
            className={cn(
              "min-h-[36px] max-h-[100px] flex-1 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60",
              compact && "text-[13px] text-slate-700 placeholder:text-slate-400"
            )}
            rows={1}
            disabled={isLoading}
          />
          <Button
            size="sm"
            className={cn(
              "size-8 shrink-0 rounded-lg p-0",
              compact && "size-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-sm hover:opacity-90"
            )}
            onClick={() => void sendMessage(input)}
            disabled={!input.trim() || isLoading}
          >
            {isLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </div>
        <p className={cn("mt-1.5 text-center text-[10px] text-muted-foreground/40", compact && "mt-1.5 text-[10px] text-slate-300")}>
          Resultados gerados por IA · Enter para enviar
        </p>
      </div>
    </div>
  )
}
