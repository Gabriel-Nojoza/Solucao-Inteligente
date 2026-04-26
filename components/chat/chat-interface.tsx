"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Send, Loader2, Trash2, Sparkles, History, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MessageBubble } from "./message-bubble"
import { createId } from "@/lib/id"
import { toast } from "sonner"
import type { ChatMessage, ChatApiResponse } from "@/lib/chat"
import { cn } from "@/lib/utils"

const MAX_HISTORY_MESSAGES = 50

function makeGreeting(): ChatMessage {
  return {
    id: "greeting",
    role: "assistant",
    content: "Olá! Eu sou a SIL.\nEstou aqui para ajudar você a consultar e entender seus dados no Power BI.\nComo posso ajudar hoje?",
    timestamp: new Date().toISOString(),
  }
}

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
    setMessages(saved.length > 0 ? saved : [makeGreeting()])
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

  function detectChartType(q: string): "bar" | "line" | "pie" | null {
    const lower = q.toLowerCase()
    if (/gr[aá]fico|chart|visualiz/.test(lower)) {
      if (/pizza|torta|pie/.test(lower)) return "pie"
      if (/linha|line|tend[eê]ncia|evolu/.test(lower)) return "line"
      return "bar"
    }
    return null
  }

  const sendMessage = useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (!trimmed || isLoading) return

      const chartType = detectChartType(trimmed)

      // Chart request: render locally if data exists, otherwise re-query forcing OpenAI
      if (chartType) {
        const lastWithData = messages.slice().reverse().find((m) => m.role === "assistant" && m.data && m.data.rows.length > 0)
        if (lastWithData) {
          const userMsg: ChatMessage = { id: createId("msg"), role: "user", content: trimmed, timestamp: new Date().toISOString() }
          const chartMsg: ChatMessage = { id: createId("msg"), role: "assistant", content: "Aqui está o gráfico dos dados da consulta anterior:", timestamp: new Date().toISOString(), data: lastWithData.data, chartType }
          setMessages((prev) => [...prev, userMsg, chartMsg])
          setInput("")
          textareaRef.current?.focus()
          return
        }
        const lastUserMsg = messages.slice().reverse().find((m) => m.role === "user")
        if (!lastUserMsg) {
          setMessages((prev) => [...prev,
            { id: createId("msg"), role: "user", content: trimmed, timestamp: new Date().toISOString() },
            { id: createId("msg"), role: "assistant", content: "Faça primeiro uma consulta que retorne dados.", timestamp: new Date().toISOString() },
          ])
          setInput("")
          textareaRef.current?.focus()
          return
        }
        const userMsg: ChatMessage = { id: createId("msg"), role: "user", content: trimmed, timestamp: new Date().toISOString() }
        const thinkingId = createId("msg")
        setMessages((prev) => [...prev, userMsg, { id: thinkingId, role: "assistant", content: "Gerando gráfico...", timestamp: new Date().toISOString() }])
        setInput("")
        setIsLoading(true)
        try {
          const resp = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: lastUserMsg.content, datasetId, workspaceId, conversationHistory: [], chartType }),
          })
          const data = (await resp.json()) as ChatApiResponse
          setMessages((prev) => prev.map((m) => m.id === thinkingId ? { id: thinkingId, role: "assistant" as const, content: data.data && data.data.rows.length > 0 ? "Aqui está o gráfico:" : data.answer, timestamp: new Date().toISOString(), data: data.data, chartType: data.chartType ?? chartType, confidence: data.confidence, error: data.error ?? null } : m))
        } catch {
          setMessages((prev) => prev.map((m) => m.id === thinkingId ? { ...m, content: "Erro ao gerar gráfico.", error: "Erro" } : m))
        } finally {
          setIsLoading(false)
          textareaRef.current?.focus()
        }
        return
      }

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
          warning: data.warning ?? null,
          chartType: data.chartType ?? null,
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
  const [showHistory, setShowHistory] = useState(false)

  const historyPairs = messages
    .filter((m) => m.id !== "greeting")
    .reduce<Array<{ question: ChatMessage; answer?: ChatMessage }>>((acc, msg, i, arr) => {
      if (msg.role === "user") {
        acc.push({ question: msg, answer: arr[i + 1]?.role === "assistant" ? arr[i + 1] : undefined })
      }
      return acc
    }, [])

  return (
    <div className={cn("relative flex h-full flex-col overflow-hidden", className)}>
      {/* Painel de histórico */}
      <div className={cn(
        "absolute inset-0 z-10 flex flex-col bg-card transition-transform duration-300",
        showHistory ? "translate-x-0" : "translate-x-full"
      )}>
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setShowHistory(false)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-xs font-medium">Histórico de conversa</span>
          {historyPairs.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => { handleClear(); setShowHistory(false) }}
            >
              <Trash2 className="size-3" />
              Limpar
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {historyPairs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Nenhuma conversa ainda.
            </div>
          ) : (
            historyPairs.map((pair, i) => (
              <div key={pair.question.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                <p className="text-[11px] font-medium text-foreground line-clamp-2">
                  {i + 1}. {pair.question.content}
                </p>
                {pair.answer && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2">
                    ↳ {pair.answer.content.replace(/\*\*/g, "").split("\n")[0]}
                  </p>
                )}
                {pair.question.timestamp && (
                  <p className="text-[10px] text-muted-foreground/50">
                    {new Date(pair.question.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Barra de contexto */}
      {datasetName && (
        <div
          className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2"
        >
          <Sparkles className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {datasetName}
            </span>
          </span>
          {hasHistory && (
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowHistory(true)}
              >
                <History className="size-3" />
                {messages.filter(m => m.id !== "greeting" && m.role === "user").length} msgs
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
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
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {isEmpty ? null : (
          <div className="flex flex-col gap-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 pl-10">
                <div className={cn("flex gap-1", compact && "")}>
                  <span className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                  <span className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                  <span className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
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
        className="border-t border-border bg-background px-4 py-3"
      >
        <div
          className="flex items-end gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
        >
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre seus dados..."
            className="min-h-[36px] max-h-[100px] flex-1 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
            rows={1}
            disabled={isLoading}
          />
          <Button
            size="sm"
            className="size-8 shrink-0 rounded-lg p-0"
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
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground/40">
          Resultados gerados por IA · Enter para enviar
        </p>
      </div>
    </div>
  )
}
