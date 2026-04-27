"use client"

import { useState, useRef, useEffect } from "react"
import { Bot, User, ChevronDown, ChevronUp, Copy, Check, AlertCircle, BarChart2, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/lib/chat"
import { DataTableResult } from "./data-table-result"
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LabelList,
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

function truncateLabel(label: string, max = 14) {
  return label.length > max ? label.slice(0, max) + "…" : label
}

function fmtAxis(v: number) {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })
}

function fmtFull(v: number) {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
}

function ChatChart({ message }: { message: ChatMessage }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(320)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setContainerWidth(w)
    })
    obs.observe(el)
    setContainerWidth(el.getBoundingClientRect().width || 320)
    return () => obs.disconnect()
  }, [])

  if (!message.data || message.data.rows.length === 0 || !message.chartType) return (
    <div ref={containerRef} style={{ width: "100%", minHeight: 1 }} />
  )

  const { data, valueName } = buildChartData(message.data.columns, message.data.rows)
  if (data.length === 0) return null

  const isWide = containerWidth >= 600
  const maxLabelLen = Math.max(...data.map((d) => String(d.label).length))
  const bottomMargin = maxLabelLen > 10 ? 70 : 45
  const labelMaxChars = isWide ? 26 : 14


  const pieRadius = isWide ? 140 : 95
  const barHeightPerItem = isWide ? 40 : 28
  const yLabelWidth = isWide
    ? Math.min(220, Math.max(120, maxLabelLen * 8))
    : Math.min(140, Math.max(80, maxLabelLen * 6))

  if (message.chartType === "pie") {
    const pieH = isWide ? 380 : 280
    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        <ResponsiveContainer width="100%" height={pieH}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%"
              outerRadius={pieRadius}
              label={({ name, percent }) => isWide ? `${truncateLabel(String(name), 20)} ${(percent * 100).toFixed(0)}%` : `${(percent * 100).toFixed(0)}%`}
              labelLine={true}
            >
              {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v: number) => [fmtFull(v), valueName]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (message.chartType === "line") {
    const lineH = isWide ? Math.max(300, data.length * 28) : Math.max(220, data.length * 22)
    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        <ResponsiveContainer width="100%" height={lineH}>
          <LineChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: isWide ? 60 : bottomMargin }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: isWide ? 11 : 10 }}
              tickFormatter={(v) => truncateLabel(String(v), labelMaxChars)}
              angle={-35} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: isWide ? 11 : 10 }} tickFormatter={fmtAxis} width={60} />
            <Tooltip formatter={(v: number) => [fmtFull(v), valueName]} labelFormatter={(l) => String(l)} />
            <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: isWide ? 4 : 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // Barras horizontais (sempre para múltiplos itens — melhor para nomes longos)
  if (data.length > 4) {
    const chartHeight = data.length * barHeightPerItem + (isWide ? 40 : 20)
    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart data={data} layout="vertical"
            margin={{ top: 4, right: isWide ? 64 : 48, left: 0, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: isWide ? 11 : 10 }} tickFormatter={fmtAxis} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: isWide ? 12 : 10 }}
              tickFormatter={(v) => truncateLabel(String(v), isWide ? 28 : 18)}
              width={yLabelWidth}
            />
            <Tooltip formatter={(v: number) => [fmtFull(v), valueName]} labelFormatter={(l) => String(l)} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={isWide ? 32 : 22}>
              {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              <LabelList dataKey="value" position="right" formatter={fmtAxis}
                style={{ fontSize: isWide ? 11 : 9, fill: "#64748b" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // Barras verticais para poucos itens
  const barV_H = isWide ? 320 : 240
  return (
    <div ref={containerRef} style={{ width: "100%" }}>
      <ResponsiveContainer width="100%" height={barV_H}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: isWide ? 60 : bottomMargin }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: isWide ? 12 : 10 }}
            tickFormatter={(v) => truncateLabel(String(v), labelMaxChars)}
            angle={-30} textAnchor="end" interval={0} />
          <YAxis tick={{ fontSize: isWide ? 11 : 10 }} tickFormatter={fmtAxis} width={60} />
          <Tooltip formatter={(v: number) => [fmtFull(v), valueName]} labelFormatter={(l) => String(l)} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={isWide ? 64 : 48}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
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
