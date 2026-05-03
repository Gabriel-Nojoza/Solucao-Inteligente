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

function isNumericDataType(dataType: string) {
  const normalized = dataType.toLowerCase()
  return (
    normalized.includes("int") ||
    normalized.includes("double") ||
    normalized.includes("decimal") ||
    normalized.includes("number") ||
    normalized.includes("currency") ||
    normalized.includes("float")
  )
}

function isTextDataType(dataType: string) {
  const normalized = dataType.toLowerCase()
  return (
    normalized.includes("string") ||
    normalized.includes("text") ||
    normalized.includes("char")
  )
}

function looksLikePercentageColumn(columnName: string) {
  const normalized = columnName.toLowerCase()
  return normalized.includes("%") || normalized.includes("percent")
}

function formatChartLabel(value: string) {
  const text = String(value ?? "").trim()
  if (!text) return ""

  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}$/i.test(text)) {
    const date = new Date(text)
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("pt-BR")
    }
  }

  return text
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function buildChartData(
  columns: Array<{ name: string; dataType: string }>,
  rows: Array<Record<string, unknown>>
) {
  const numericColumns = columns.filter((column) => isNumericDataType(column.dataType))
  const textColumns = columns.filter((column) => isTextDataType(column.dataType))

  if (rows.length === 1 && numericColumns.length === 1 && columns.length === 1) {
    const metric = numericColumns[0]
    return {
      data: [
        {
          label: metric.name,
          value: Number(rows[0][metric.name] ?? 0),
        },
      ],
      valueName: metric.name,
    }
  }

  if (rows.length === 1 && numericColumns.length >= 1) {
    const preferredNumericColumns = numericColumns.filter((column) => !looksLikePercentageColumn(column.name))
    const chartColumns =
      preferredNumericColumns.length > 0 && preferredNumericColumns.length < numericColumns.length
        ? preferredNumericColumns
        : numericColumns

    const data = chartColumns
      .slice(0, MAX_ITEMS)
      .map((column) => ({
        label: formatChartLabel(column.name),
        value: Number(rows[0][column.name] ?? 0),
      }))
      .filter((item) => Number.isFinite(item.value))

    return {
      data,
      valueName: chartColumns.length === 1 ? chartColumns[0].name : "Valor",
    }
  }

  const labelCol = textColumns[0] ?? columns[0]
  const valueCol = numericColumns.find((column) => column !== labelCol) ?? columns.find((column) => column !== labelCol)

  if (!labelCol || !valueCol) return { data: [], valueName: "" }

  const data = rows
    .slice(0, MAX_ITEMS)
    .map((row) => ({
      label: formatChartLabel(String(row[labelCol.name] ?? "")),
      value: Number(row[valueCol.name] ?? 0),
    }))
    .filter((item) => item.label.trim().length > 0 && Number.isFinite(item.value))
    .sort((a, b) => b.value - a.value)

  return { data, valueName: valueCol.name }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "..." : s
}

function fmtShort(v: number) {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mi`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
}

function fmtFull(v: number) {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
}

const TooltipStyle = {
  backgroundColor: "rgba(15, 23, 42, 0.96)",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 14,
  color: "#f8fafc",
  fontSize: 12,
  padding: "10px 12px",
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.22)",
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

  if (!message.data || message.data.rows.length === 0 || !message.chartType) {
    return <div ref={containerRef} style={{ width: "100%", minHeight: 1 }} />
  }

  const { data, valueName } = buildChartData(message.data.columns, message.data.rows)
  if (data.length === 0) return null

  const maxLabelLen = Math.max(...data.map((d) => d.label.length))
  const labelWidth = Math.min(200, Math.max(96, maxLabelLen * 7))
  const BAR_H = 44
  const totalRows = message.data.rows.length
  const hiddenCount = totalRows > MAX_ITEMS ? totalRows - MAX_ITEMS : 0
  const sortedData = [...data].sort((a, b) => b.value - a.value)
  const totalValue = data.reduce((sum, item) => sum + item.value, 0)
  const maxValue = sortedData[0]?.value ?? 0
  const minPositiveValue = sortedData
    .map((item) => item.value)
    .filter((value) => value > 0)
    .sort((a, b) => a - b)[0] ?? 0
  const spreadRatio = minPositiveValue > 0 ? maxValue / minPositiveValue : 0
  const preferHorizontalBars =
    message.chartType === "bar" && (data.length > 4 || (data.length > 1 && spreadRatio >= 18))

  const summaryCards = [
    {
      label: "Maior destaque",
      value: fmtShort(sortedData[0]?.value ?? 0),
      helper: sortedData[0]?.label ?? "Sem dados",
    },
    {
      label: "Volume exibido",
      value: fmtShort(totalValue),
      helper: `${data.length} item(ns) no visual`,
    },
    {
      label: "Escala",
      value: spreadRatio > 1 ? `${spreadRatio.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}x` : "Estavel",
      helper: spreadRatio > 1 ? "entre maior e menor valor" : "distribuicao uniforme",
    },
  ]

  const renderShell = (chartContent: any, footer?: any) => (
    <div ref={containerRef} className="w-full">
      <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
        <div className="border-b border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(255,255,255,0.96))] px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Visual analitico
              </div>
              <h4 className="mt-1 text-base font-semibold text-slate-900">
                {valueName === "Valor" ? "Comparativo das metricas retornadas" : formatChartLabel(valueName)}
              </h4>
              <p className="mt-1 text-sm text-slate-500">
                {hiddenCount > 0 ? `Top ${MAX_ITEMS} itens de ${totalRows} retornados` : `${data.length} item(ns) exibidos neste grafico`}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {summaryCards.map((card) => (
                <div
                  key={card.label}
                  className="min-w-[160px] rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                >
                  <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                    {card.label}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{card.value}</div>
                  <div className="mt-1 text-xs text-slate-500">{truncate(card.helper, 28)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 pb-4 pt-3">
          {chartContent}
          {footer}
        </div>
      </div>
    </div>
  )

  if (message.chartType === "pie") {
    return renderShell(
      <ResponsiveContainer width="100%" height={340}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            outerRadius={116}
            innerRadius={62}
            paddingAngle={3}
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
    )
  }

  if (message.chartType === "line") {
    const lineH = Math.max(280, data.length * 26)
    return renderShell(
      <ResponsiveContainer width="100%" height={lineH}>
        <LineChart data={data} margin={{ top: 12, right: 28, left: 8, bottom: 48 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(v) => truncate(String(v), 18)}
            angle={data.length > 6 ? -28 : 0}
            textAnchor={data.length > 6 ? "end" : "middle"}
            interval={0}
            tickMargin={12}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={fmtShort}
            width={64}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={TooltipStyle}
            formatter={(v: number) => [fmtFull(v), valueName]}
            labelFormatter={(l) => String(l)}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={BAR_COLOR}
            strokeWidth={3}
            dot={{ r: 4, fill: BAR_COLOR, strokeWidth: 0 }}
            activeDot={{ r: 6, fill: BAR_COLOR }}
          />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (preferHorizontalBars) {
    const chartH = data.length * BAR_H + 48
    return renderShell(
      <ResponsiveContainer width="100%" height={chartH}>
        <BarChart data={sortedData} layout="vertical" margin={{ top: 8, right: 82, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="chatBarGradientHorizontal" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#1d4ed8" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="#edf2f7" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickFormatter={fmtShort}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 12, fill: "#334155" }}
            tickFormatter={(v) => truncate(String(v), width > 480 ? 28 : 18)}
            width={labelWidth}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={TooltipStyle}
            formatter={(v: number) => [fmtFull(v), valueName]}
            labelFormatter={(l) => String(l)}
          />
          <Bar
            dataKey="value"
            radius={[0, 8, 8, 0]}
            maxBarSize={28}
            fill="url(#chatBarGradientHorizontal)"
            background={{ fill: "#eff6ff", radius: 8 }}
          >
            <LabelList
              dataKey="value"
              position="right"
              formatter={fmtShort}
              style={{ fontSize: 11, fill: "#475569", fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>,
      hiddenCount > 0 ? (
        <p className="mt-2 text-center text-[11px] text-slate-500">
          Mostrando top {MAX_ITEMS} de {totalRows} itens retornados
        </p>
      ) : null,
    )
  }

  return renderShell(
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 18, right: 22, left: 8, bottom: 52 }} barCategoryGap="28%">
        <defs>
          <linearGradient id="chatBarGradientVertical" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#1d4ed8" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 4" stroke="#edf2f7" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12, fill: "#334155" }}
          tickFormatter={(v) => truncate(String(v), 20)}
          angle={data.length > 3 ? -18 : 0}
          textAnchor={data.length > 3 ? "end" : "middle"}
          interval={0}
          tickMargin={12}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          tickFormatter={fmtShort}
          width={64}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={TooltipStyle}
          formatter={(v: number) => [fmtFull(v), valueName]}
          labelFormatter={(l) => String(l)}
        />
        <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={82} fill="url(#chatBarGradientVertical)">
          <LabelList
            dataKey="value"
            position="top"
            formatter={fmtShort}
            style={{ fontSize: 12, fill: "#1d4ed8", fontWeight: 700 }}
          />
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
  const hasDataResult = !isUser && !!message.data && message.data.rows.length > 0
  const hasChart = hasDataResult && !!message.chartType

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
    high: "Alta confianÃ§a",
    medium: "ConfianÃ§a mÃ©dia",
    low: "Baixa confianÃ§a",
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

      {/* ConteÃºdo */}
      <div
        className={cn(
          "min-w-0 flex flex-col gap-2",
          isUser
            ? "max-w-[85%] items-end"
            : hasDataResult
              ? "flex-1 items-start"
              : "max-w-[85%] items-start"
        )}
      >
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

        {/* GrÃ¡fico ou Tabela de dados */}
        {hasDataResult && (
          <div className="w-full max-w-5xl self-stretch">
            {hasChart && (
              <div className="mb-3 flex justify-end">
                <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1 shadow-sm backdrop-blur">
                  <Button
                    variant={viewMode === "chart" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 gap-1 rounded-full px-3 text-xs font-medium"
                    onClick={() => setViewMode("chart")}
                  >
                    <BarChart2 className="size-3" />
                    GrÃ¡fico
                  </Button>
                  <Button
                    variant={viewMode === "table" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 gap-1 rounded-full px-3 text-xs font-medium"
                    onClick={() => setViewMode("table")}
                  >
                    <Table2 className="size-3" />
                    Tabela
                  </Button>
                </div>
              </div>
            )}
            {hasChart && viewMode === "chart" ? (
              <div className="w-full">
                <ChatChart message={message} />
              </div>
            ) : (
              <DataTableResult
                columns={message.data!.columns}
                rows={message.data!.rows}
              />
            )}
          </div>
        )}

        {/* RodapÃ©: confianÃ§a + DAX query */}
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

        {/* Bloco DAX expansÃ­vel */}
        {!isUser && showDax && message.daxQuery && (
          <div className="w-full max-w-5xl rounded-lg border border-border bg-muted/50">
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

