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

const BAR_COLOR = "#2563eb"
const PIE_COLORS = ["#2563eb", "#f97316", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"]
const MAX_ITEMS = 12

function buildChartData(
  columns: Array<{ name: string; dataType: string }>,
  rows: Array<Record<string, unknown>>
) {
  const labelCol = columns.find((c) => c.dataType === "String" || c.dataType === "Text") ?? columns[0]
  const valueCol = columns.find((c) => c !== labelCol && (c.dataType === "Int64" || c.dataType === "Double" || c.dataType === "Decimal"))
    ?? columns.find((c) => c !== labelCol)

  if (!labelCol || !valueCol) return { data: [], valueName: "" }

  const data = rows
    .slice(0, MAX_ITEMS)
    .map((row) => ({
      label: String(row[labelCol.name] ?? ""),
      value: Number(row[valueCol.name] ?? 0),
    }))
    .sort((a, b) => b.value - a.value)

  return { data, valueName: valueCol.name }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s
}

function fmtShort(v: number) {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
}

function fmtFull(v: number) {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
}

const TooltipStyle = {
  backgroundColor: "#1e293b",
  border: "none",
  borderRadius: 8,
  color: "#f8fafc",
  fontSize: 12,
  padding: "6px 12px",
}

function ChatChart({ message }: { message: ChatMessage }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(w)
    })
    obs.observe(el)
    setWidth(el.getBoundingClientRect().width || 320)
    return () => obs.disconnect()
  }, [])

  if (!message.data || message.data.rows.length === 0 || !message.chartType) return (
    <div ref={containerRef} style={{ width: "100%", minHeight: 1 }} />
  )

  const { data, valueName } = buildChartData(message.data.columns, message.data.rows)
  if (data.length === 0) return null

  const maxLabelLen = Math.max(...data.map((d) => d.label.length))
  const labelWidth = Math.min(180, Math.max(80, maxLabelLen * 7))
  const BAR_H = 40
  const totalRows = message.data.rows.length
  const hiddenCount = totalRows > MAX_ITEMS ? totalRows - MAX_ITEMS : 0

  // ── PIE ──────────────────────────────────────────────────────────────────────
  if (message.chartType === "pie") {
    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data} dataKey="value" nameKey="label"
              cx="50%" cy="50%" outerRadius={110} innerRadius={50}
              paddingAngle={2}
              label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <Tooltip
              contentStyle={TooltipStyle}
              formatter={(v: number) => [fmtFull(v), valueName]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // ── LINE ─────────────────────────────────────────────────────────────────────
  if (message.chartType === "line") {
    const lineH = Math.max(240, data.length * 24)
    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        <ResponsiveContainer width="100%" height={lineH}>
          <LineChart data={data} margin={{ top: 8, right: 32, left: 0, bottom: 48 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }}
              tickFormatter={(v) => truncate(String(v), 14)}
              angle={-30} textAnchor="end" interval={0}
              axisLine={false} tickLine={false}
            />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={fmtShort} width={52} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TooltipStyle} formatter={(v: number) => [fmtFull(v), valueName]} labelFormatter={(l) => String(l)} />
            <Line type="monotone" dataKey="value" stroke={BAR_COLOR} strokeWidth={2.5}
              dot={{ r: 4, fill: BAR_COLOR, strokeWidth: 0 }}
              activeDot={{ r: 6, fill: BAR_COLOR }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // ── BAR HORIZONTAL (> 4 itens) ───────────────────────────────────────────────
  if (data.length > 4) {
    const chartH = data.length * BAR_H + 32
    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        <ResponsiveContainer width="100%" height={chartH}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 72, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={fmtShort} axisLine={false} tickLine={false} />
            <YAxis
              type="category" dataKey="label"
              tick={{ fontSize: 12, fill: "#334155" }}
              tickFormatter={(v) => truncate(String(v), width > 400 ? 24 : 16)}
              width={labelWidth} axisLine={false} tickLine={false}
            />
            <Tooltip contentStyle={TooltipStyle} formatter={(v: number) => [fmtFull(v), valueName]} labelFormatter={(l) => String(l)} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28} fill={BAR_COLOR} background={{ fill: "#f8fafc", radius: 6 }}>
              <LabelList dataKey="value" position="right" formatter={fmtShort}
                style={{ fontSize: 11, fill: "#64748b", fontWeight: 500 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {hiddenCount > 0 && (
          <p className="mt-1 text-center text-[11px] text-muted-foreground">
            Mostrando top {MAX_ITEMS} de {totalRows} itens
          </p>
        )}
      </div>
    )
  }

  // ── BAR VERTICAL (≤ 4 itens) ─────────────────────────────────────────────────
  return (
    <div ref={containerRef} style={{ width: "100%" }}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="label" tick={{ fontSize: 12, fill: "#334155" }}
            tickFormatter={(v) => truncate(String(v), 18)}
            angle={-20} textAnchor="end" interval={0}
            axisLine={false} tickLine={false}
          />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={fmtShort} width={52} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TooltipStyle} formatter={(v: number) => [fmtFull(v), valueName]} labelFormatter={(l) => String(l)} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={72} fill={BAR_COLOR}>
            <LabelList dataKey="value" position="top" formatter={fmtShort}
              style={{ fontSize: 12, fill: "#2563eb", fontWeight: 600 }} />
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
