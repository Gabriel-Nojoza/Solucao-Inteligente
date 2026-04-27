"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import Image from "next/image"
import useSWR from "swr"
import { Send, Loader2, Trash2, X, Building2, Maximize2, Minimize2 } from "lucide-react"
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
import { cn } from "@/lib/utils"
import type { ChatMessage, ChatApiResponse } from "@/lib/chat"
import type { CompanyStatItem } from "@/app/api/admin/company-stats/route"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface WorkspaceOption { id: string; name: string; pbi_workspace_id: string }
interface DatasetOption { id: string; name: string; datasetId: string }
interface CompanyDatasetsResponse {
  workspaces: WorkspaceOption[]
  datasetsByWorkspace: Record<string, DatasetOption[]>
  defaultWorkspaceId: string | null
  defaultDatasetId: string | null
}

function makeGreeting(companyName: string): ChatMessage {
  return {
    id: "greeting",
    role: "assistant",
    content: `Olá! Consultando dados de **${companyName}**.\nComo posso ajudar?`,
    timestamp: new Date().toISOString(),
  }
}

export function AdminFloatingChat(_props: { companies?: CompanyStatItem[] }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const { data: companiesData } = useSWR<{ companies: CompanyStatItem[] }>(
    "/api/admin/company-stats",
    fetcher
  )
  const companies: CompanyStatItem[] = companiesData?.companies ?? []
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
    selectedCompanyId && isOpen ? `/api/admin/company-datasets?companyId=${selectedCompanyId}` : null,
    fetcher
  )

  const workspaces: WorkspaceOption[] = datasetsData?.workspaces ?? []
  const datasetsByWorkspace: Record<string, DatasetOption[]> = datasetsData?.datasetsByWorkspace ?? {}
  const datasets: DatasetOption[] = selectedWorkspaceId ? (datasetsByWorkspace[selectedWorkspaceId] ?? []) : []
  const selectedCompany = companies.find((c) => c.companyId === selectedCompanyId)

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
        setMessages([makeGreeting(companyName)])
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
        setMessages([makeGreeting(companyName)])
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
    setSelectedDatasetId(value)
    const companyName = selectedCompany?.companyName ?? "empresa"
    setMessages([makeGreeting(companyName)])
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
      const lastUserMsg = messages.slice().reverse().find((m) => m.role === "user")
      if (!lastUserMsg) {
        setMessages((prev) => [...prev,
          { id: createId("msg"), role: "user", content: trimmed, timestamp: new Date().toISOString() },
          { id: createId("msg"), role: "assistant", content: "Faça primeiro uma consulta que retorne dados.", timestamp: new Date().toISOString() },
        ])
        setInput("")
        return
      }
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
      id: thinkingId, role: "assistant",
      content: "Analisando...", timestamp: new Date().toISOString(),
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
        m.id === thinkingId ? {
          id: thinkingId, role: "assistant" as const,
          content: data.answer, timestamp: new Date().toISOString(),
          data: data.data, daxQuery: data.daxQuery,
          confidence: data.confidence, error: data.error ?? null,
        } : m
      ))
    } catch {
      setMessages((prev) => prev.map((m) =>
        m.id === thinkingId ? { ...m, content: "Erro ao processar. Tente novamente.", error: "Erro" } : m
      ))
    } finally {
      setIsLoading(false)
      textareaRef.current?.focus()
    }
  }, [isLoading, messages, selectedCompanyId, selectedDatasetId, selectedPbiWorkspaceId])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(input) }
  }

  const isReady = !!selectedCompanyId && !!selectedDatasetId && !!selectedPbiWorkspaceId

  return (
    <>
      {/* Botao flutuante */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? "Fechar chat admin" : "Abrir chat admin"}
        className={cn(
          "fixed bottom-5 right-5 z-50 flex h-20 w-20 items-center justify-center bg-transparent transition-all duration-300 hover:scale-105",
          "sm:bottom-6 sm:right-6",
          isOpen && "scale-95 opacity-80"
        )}
      >
        <div className="relative flex h-16 w-16 items-center justify-center">
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
          <span className="absolute -top-1 -right-1 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground leading-none ring-2 ring-background">
            ADMIN
          </span>
        </div>
      </button>

      {/* Painel */}
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
        <div className={cn("flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground overflow-hidden", !isFullscreen && "rounded-t-2xl")}>
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/10 p-2">
            <Image
              src="/brand/logo-sil.png"
              alt="SIL"
              width={52}
              height={52}
              priority
              className="h-auto w-full object-contain"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Chat IA — Admin</p>
            <p className="truncate text-[11px] text-primary-foreground/70">
              {selectedCompany ? selectedCompany.companyName : "Selecione uma empresa"}
            </p>
          </div>
          <Button
            type="button" variant="ghost" size="icon"
            className="h-7 w-7 shrink-0 rounded-full text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground"
            onClick={() => setIsFullscreen((prev) => !prev)}
            aria-label={isFullscreen ? "Minimizar" : "Ampliar"}
          >
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
          <Button
            type="button" variant="ghost" size="icon"
            className="h-7 w-7 shrink-0 rounded-full text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground"
            onClick={() => { setIsOpen(false); setIsFullscreen(false) }}
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Seletores */}
        <div className="flex flex-col gap-2 border-b border-border bg-muted/50 px-4 py-3">
          <Select value={selectedCompanyId} onValueChange={handleCompanyChange}>
            <SelectTrigger className="h-8 text-xs bg-white">
              <SelectValue placeholder={companies.length === 0 ? "Carregando..." : "Selecionar empresa"} />
            </SelectTrigger>
            <SelectContent className="z-[9999]">
              {companies.map((c) => (
                <SelectItem key={c.companyId} value={c.companyId} className="text-xs">{c.companyName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedCompanyId && workspaces.length > 0 && (
            <Select value={selectedWorkspaceId} onValueChange={handleWorkspaceChange}>
              <SelectTrigger className="h-8 text-xs bg-white">
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent className="z-[9999]">
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {selectedWorkspaceId && datasets.length > 0 && (
            <Select value={selectedDatasetId} onValueChange={handleDatasetChange}>
              <SelectTrigger className="h-8 text-xs bg-white">
                <SelectValue placeholder="Dataset" />
              </SelectTrigger>
              <SelectContent className="z-[9999]">
                {datasets.map((d) => (
                  <SelectItem key={d.datasetId} value={d.datasetId} className="text-xs">{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Mensagens */}
        <div className={cn("overflow-y-auto bg-card px-4 py-4 space-y-4", isFullscreen ? "flex-1" : "h-[380px]")}>
          {!isReady ? (
            <div className="flex h-full items-center justify-center text-center">
              <div className="space-y-2">
                <Building2 className="mx-auto size-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">Selecione empresa, workspace e dataset</p>
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
                    <span className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                    <span className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                    <span className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div className={cn("border-t border-border bg-muted/50 px-4 py-3", !isFullscreen && "rounded-b-2xl")}>
          {isReady && messages.filter((m) => m.id !== "greeting").length > 0 && (
            <div className="mb-2 flex justify-end">
              <Button
                variant="ghost" size="sm"
                className="h-6 gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => setMessages([makeGreeting(selectedCompany?.companyName ?? "empresa")])}
              >
                <Trash2 className="size-3" /> Limpar
              </Button>
            </div>
          )}
          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isReady ? "Pergunte sobre os dados..." : "Selecione uma empresa..."}
              disabled={!isReady || isLoading}
              rows={1}
              className="min-h-[36px] max-h-20 resize-none text-sm bg-background border-border"
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
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
            Resultados gerados por IA · Enter para enviar
          </p>
        </div>
      </div>
    </>
  )
}
