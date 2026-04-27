"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import useSWR from "swr"
import { Send, Loader2, Trash2, Bot, Building2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MessageBubble } from "@/components/chat/message-bubble"
import { createId } from "@/lib/id"
import type { ChatMessage, ChatApiResponse } from "@/lib/chat"
import type { CompanyStatItem } from "@/app/api/admin/company-stats/route"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface AdminChatPanelProps {
  companies: CompanyStatItem[]
}

interface WorkspaceOption {
  id: string
  name: string
  pbi_workspace_id: string
}

interface DatasetOption {
  id: string
  name: string
  datasetId: string
}

interface CompanyDatasetsResponse {
  workspaces: WorkspaceOption[]
  datasetsByWorkspace: Record<string, DatasetOption[]>
  defaultWorkspaceId: string | null
  defaultDatasetId: string | null
}

function makeGreeting(companyName: string, datasetName?: string): ChatMessage {
  const label = datasetName || companyName
  return {
    id: "greeting",
    role: "assistant",
    content: `Olá! Consultando dados de **${label}**.\nFaça perguntas sobre os dados desta empresa.`,
    timestamp: new Date().toISOString(),
  }
}

export function AdminChatPanel({ companies }: AdminChatPanelProps) {
  const [selectedCompanyId, setSelectedCompanyId] = useState("")
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("")
  const [selectedDatasetId, setSelectedDatasetId] = useState("")
  const [selectedPbiWorkspaceId, setSelectedPbiWorkspaceId] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { data: datasetsData } = useSWR<CompanyDatasetsResponse>(
    selectedCompanyId ? `/api/admin/company-datasets?companyId=${selectedCompanyId}` : null,
    fetcher
  )

  const workspaces: WorkspaceOption[] = datasetsData?.workspaces ?? []
  const datasetsByWorkspace: Record<string, DatasetOption[]> = datasetsData?.datasetsByWorkspace ?? {}
  const datasets: DatasetOption[] = selectedWorkspaceId ? (datasetsByWorkspace[selectedWorkspaceId] ?? []) : []

  const selectedCompany = companies.find((c) => c.companyId === selectedCompanyId)
  const selectedDatasetName = datasets.find((d) => d.datasetId === selectedDatasetId)?.name

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (!selectedCompanyId || !datasetsData) {
      return
    }

    const nextWorkspaces = datasetsData.workspaces ?? []
    const nextDatasetsByWorkspace = datasetsData.datasetsByWorkspace ?? {}
    const hasSelectedWorkspace = nextWorkspaces.some((workspace) => workspace.id === selectedWorkspaceId)

    if (!hasSelectedWorkspace) {
      const defaultWorkspaceId = datasetsData.defaultWorkspaceId
      const fallbackWorkspaceId = nextWorkspaces[0]?.id ?? ""
      const nextWorkspaceId = defaultWorkspaceId || fallbackWorkspaceId
      const nextWorkspace = nextWorkspaces.find((workspace) => workspace.id === nextWorkspaceId)

      setSelectedWorkspaceId(nextWorkspaceId)
      setSelectedPbiWorkspaceId(nextWorkspace?.pbi_workspace_id ?? "")

      const workspaceDatasets = nextWorkspaceId
        ? nextDatasetsByWorkspace[nextWorkspaceId] ?? []
        : []
      const defaultDatasetId =
        datasetsData.defaultDatasetId &&
        workspaceDatasets.some((dataset) => dataset.datasetId === datasetsData.defaultDatasetId)
          ? datasetsData.defaultDatasetId
          : workspaceDatasets[0]?.datasetId ?? ""

      setSelectedDatasetId(defaultDatasetId)

      if (defaultDatasetId) {
        const companyName = selectedCompany?.companyName ?? "empresa"
        const dsName = workspaceDatasets.find((d) => d.datasetId === defaultDatasetId)?.name
        setMessages([makeGreeting(companyName, dsName)])
      }

      return
    }

    const nextDatasets = nextDatasetsByWorkspace[selectedWorkspaceId] ?? []
    if (!nextDatasets.some((dataset) => dataset.datasetId === selectedDatasetId)) {
      const defaultDatasetId =
        datasetsData.defaultDatasetId &&
        nextDatasets.some((dataset) => dataset.datasetId === datasetsData.defaultDatasetId)
          ? datasetsData.defaultDatasetId
          : nextDatasets[0]?.datasetId ?? ""

      setSelectedDatasetId(defaultDatasetId)

      if (defaultDatasetId) {
        const companyName = selectedCompany?.companyName ?? "empresa"
        const dsName = nextDatasets.find((d) => d.datasetId === defaultDatasetId)?.name
        setMessages([makeGreeting(companyName, dsName)])
      }
    }
  }, [datasetsData, selectedCompany, selectedCompanyId, selectedDatasetId, selectedWorkspaceId])

  function handleCompanyChange(value: string) {
    setSelectedCompanyId(value)
    setSelectedWorkspaceId("")
    setSelectedDatasetId("")
    setSelectedPbiWorkspaceId("")
    setMessages([])
  }

  function handleWorkspaceChange(value: string) {
    const ws = workspaces.find((w) => w.id === value)
    setSelectedWorkspaceId(value)
    setSelectedPbiWorkspaceId(ws?.pbi_workspace_id ?? "")
    setSelectedDatasetId("")
  }

  function handleDatasetChange(value: string) {
    const ds = datasets.find((d) => d.datasetId === value)
    setSelectedDatasetId(value)
    const companyName = selectedCompany?.companyName ?? "empresa"
    setMessages([makeGreeting(companyName, ds?.name)])
  }

  function detectChartType(q: string): "bar" | "line" | "pie" | null {
    const lower = q.toLowerCase()
    if (/gr[aá]fico|chart|visualiz/.test(lower)) {
      if (/pizza|torta|pie/.test(lower)) return "pie"
      if (/linha|line|tend[eê]ncia|evolu/.test(lower)) return "line"
      return "bar"
    }
    return null
  }

  const sendMessage = useCallback(async (question: string) => {
    const trimmed = question.trim()
    if (!trimmed || isLoading) return

    const chartType = detectChartType(trimmed)
    if (chartType) {
      const lastWithData = messages.slice().reverse().find((m) => m.role === "assistant" && m.data && m.data.rows.length > 0)
      if (lastWithData) {
        const userMsg: ChatMessage = { id: createId("msg"), role: "user", content: trimmed, timestamp: new Date().toISOString() }
        const chartMsg: ChatMessage = { id: createId("msg"), role: "assistant", content: "Aqui está o gráfico dos dados da consulta anterior:", timestamp: new Date().toISOString(), data: lastWithData.data, chartType }
        setMessages((prev) => [...prev, userMsg, chartMsg])
        setInput("")
        return
      }
      // Sem dados anteriores: busca a última pergunta do usuário e reexecuta via OpenAI
      const lastUserMsg = messages.slice().reverse().find((m) => m.role === "user")
      if (!lastUserMsg) {
        setMessages((prev) => [...prev,
          { id: createId("msg"), role: "user", content: trimmed, timestamp: new Date().toISOString() },
          { id: createId("msg"), role: "assistant", content: "Faça primeiro uma consulta que retorne dados.", timestamp: new Date().toISOString() },
        ])
        setInput("")
        return
      }
      // Reexecuta a pergunta original forçando fluxo OpenAI com chartType
      const userMsg: ChatMessage = { id: createId("msg"), role: "user", content: trimmed, timestamp: new Date().toISOString() }
      const thinkingId = createId("msg")
      setMessages((prev) => [...prev, userMsg, { id: thinkingId, role: "assistant", content: "Gerando gráfico...", timestamp: new Date().toISOString() }])
      setInput("")
      setIsLoading(true)
      try {
        const resp = await fetch("/api/admin/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: selectedCompanyId, question: lastUserMsg.content, datasetId: selectedDatasetId, workspaceId: selectedPbiWorkspaceId, conversationHistory: [], chartType }),
        })
        const data = (await resp.json()) as ChatApiResponse
        setMessages((prev) => prev.map((m) => m.id === thinkingId ? { id: thinkingId, role: "assistant" as const, content: data.data && data.data.rows.length > 0 ? "Aqui está o gráfico:" : data.answer, timestamp: new Date().toISOString(), data: data.data, chartType: data.chartType ?? chartType, confidence: data.confidence, error: data.error ?? null } : m))
      } catch {
        setMessages((prev) => prev.map((m) => m.id === thinkingId ? { ...m, content: "Erro ao gerar gráfico.", error: "Erro" } : m))
      } finally {
        setIsLoading(false)
      }
      return
    }

    const userMsg: ChatMessage = {
      id: createId("msg"),
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setIsLoading(true)

    const thinkingId = createId("msg")
    setMessages((prev) => [...prev, {
      id: thinkingId,
      role: "assistant",
      content: "Analisando...",
      timestamp: new Date().toISOString(),
    }])

    try {
      const history = messages
        .filter((m) => m.id !== "greeting")
        .map((m) => ({ role: m.role, content: m.content }))

      const response = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          question: trimmed,
          datasetId: selectedDatasetId,
          workspaceId: selectedPbiWorkspaceId,
          conversationHistory: history,
        }),
      })

      const data = (await response.json()) as ChatApiResponse

      setMessages((prev) => prev.map((m) =>
        m.id === thinkingId
          ? {
              id: thinkingId,
              role: "assistant" as const,
              content: data.answer,
              timestamp: new Date().toISOString(),
              data: data.data,
              daxQuery: data.daxQuery,
              confidence: data.confidence,
              error: data.error ?? null,
            }
          : m
      ))
    } catch {
      setMessages((prev) => prev.map((m) =>
        m.id === thinkingId
          ? { ...m, content: "Erro ao processar sua pergunta. Tente novamente.", error: "Erro" }
          : m
      ))
    } finally {
      setIsLoading(false)
      textareaRef.current?.focus()
    }
  }, [isLoading, messages, selectedCompanyId, selectedDatasetId, selectedPbiWorkspaceId])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(input)
    }
  }

  const isReady = !!selectedCompanyId && !!selectedDatasetId && !!selectedPbiWorkspaceId

  return (
    <div className="flex h-[600px] flex-col rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 bg-muted/30">
        <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="size-4" />
        </div>
        <div>
          <p className="text-sm font-semibold">Chat SIL — Visão Admin</p>
          <p className="text-xs text-muted-foreground">Consulte dados de qualquer empresa</p>
        </div>
        {messages.filter((m) => m.id !== "greeting").length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1 text-xs text-muted-foreground"
            onClick={() => setMessages(selectedCompany ? [makeGreeting(selectedCompany.companyName, selectedDatasetName)] : [])}
          >
            <Trash2 className="size-3" />
            Limpar
          </Button>
        )}
      </div>

      {/* Seletores */}
      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3 bg-muted/10">
        <div className="flex items-center gap-1.5">
          <Building2 className="size-3.5 text-muted-foreground" />
          <Select value={selectedCompanyId} onValueChange={handleCompanyChange}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Selecionar empresa" />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.companyId} value={c.companyId} className="text-xs">
                  {c.companyName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedCompanyId && (
          <Select value={selectedWorkspaceId} onValueChange={handleWorkspaceChange} disabled={workspaces.length === 0}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Workspace" />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id} className="text-xs">
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {selectedWorkspaceId && (
          <Select value={selectedDatasetId} onValueChange={handleDatasetChange} disabled={datasets.length === 0}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="Dataset" />
            </SelectTrigger>
            <SelectContent>
              {datasets.map((d) => (
                <SelectItem key={d.datasetId} value={d.datasetId} className="text-xs">
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {!isReady ? (
          <div className="flex h-full items-center justify-center text-center">
            <div className="space-y-2">
              <Building2 className="mx-auto size-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Selecione uma empresa, workspace e dataset para começar</p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 pl-10">
                <div className="flex gap-1">
                  <span className="size-1.5 rounded-full bg-slate-300 animate-bounce [animation-delay:0ms]" />
                  <span className="size-1.5 rounded-full bg-slate-300 animate-bounce [animation-delay:150ms]" />
                  <span className="size-1.5 rounded-full bg-slate-300 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border px-4 py-3 bg-muted/10">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isReady ? "Pergunte sobre os dados da empresa..." : "Selecione uma empresa primeiro..."}
            disabled={!isReady || isLoading}
            rows={1}
            className="min-h-[36px] max-h-24 resize-none text-sm"
          />
          <Button
            size="sm"
            onClick={() => void sendMessage(input)}
            disabled={!isReady || !input.trim() || isLoading}
            className="h-9 w-9 p-0 shrink-0"
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground/60">
          Resultados gerados por IA · Enter para enviar
        </p>
      </div>
    </div>
  )
}
