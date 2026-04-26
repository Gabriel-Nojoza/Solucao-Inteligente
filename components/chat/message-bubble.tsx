"use client"

import { useState } from "react"
import { Bot, User, ChevronDown, ChevronUp, Copy, Check, AlertCircle, BarChart2, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/lib/chat"
import { DataTableResult } from "./data-table-result"
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"

const CHART_COLORS = ["#2563eb", "#f97316", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"]

function buildChartData(
  columns: Array<{ name: string; dataType: string }>,
  rows: Array<Record<string, unknown>>
) {
  const labelCol = columns.find((c) => c.dataType === "String" || c.dataType === "Text") ?? columns[0]
  const valueCol = columns.find((c) => c !== labelCol && (c.dataType === "Int64" || c.dataType === "Double" || c.dataType === "Decimal"))
    ?? columns.find((c) => c !== labelCol)

  if (!labelCol || !valueCol) return { data: [], labelKey: "", valueKey: "" }

  const data = rows.slice(0, 20).map((row) => ({
    label: String(row[labelCol.name] ?? ""),
    value: Number(row[valueCol.name] ?? 0),
  }))

  return { data, labelKey: "label", valueKey: "value", labelName: labelCol.name, valueName: valueCol.name }
}

function ChatChart({ message }: { message: ChatMessage }) {
  if (!message.data || message.data.rows.length === 0 || !message.chartType) return null

  const { data, valueName } = buildChartData(message.data.columns, message.data.rows)
  if (data.length === 0) return null

  const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })

  if (message.chartType === "pie") {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={90} label={({ label, percent }) => `${label} (${(percent * 100).toFixed(0)}%)`} labelLine={false}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v: number) => fmt(v)} />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  if (message.chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={fmt} width={60} />
          <Tooltip formatter={(v: number) => [fmt(v), valueName]} />
          <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={fmt} width={60} />
        <Tooltip formatter={(v: number) => [fmt(v), valueName]} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [showDax, setShowDax] = useState(false)
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart")
  const isUser = message.role === "user"
  const hasChart = !isUser && !!message.chartType && !!message.data && message.data.rows.length > 0

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

        {/* Gráfico ou Tabela de dados */}
        {!isUser && message.data && message.data.rows.length > 0 && (
          <div className="w-full max-w-2xl">
            {hasChart && (
              <div className="mb-2 flex justify-end gap-1">
                <Button
                  variant={viewMode === "chart" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => setViewMode("chart")}
                >
                  <BarChart2 className="size-3" />
                  Gráfico
                </Button>
                <Button
                  variant={viewMode === "table" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => setViewMode("table")}
                >
                  <Table2 className="size-3" />
                  Tabela
                </Button>
              </div>
            )}
            {hasChart && viewMode === "chart" ? (
              <div className="rounded-lg border border-border bg-white p-3">
                <ChatChart message={message} />
              </div>
            ) : (
              <DataTableResult
                columns={message.data.columns}
                rows={message.data.rows}
              />
            )}
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

        {/* Aviso de limite */}
        {!isUser && message.warning && (
          <div className="flex items-start gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400 max-w-sm">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{message.warning}</span>
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
