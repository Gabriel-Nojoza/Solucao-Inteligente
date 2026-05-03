 "use client"

import { useMounted } from "@/hooks/use-mounted"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { DispatchLog } from "@/lib/types"
import {
  getDispatchLogDisplayStatus,
  getDispatchLogEffectiveDate,
  getDispatchLogOutcome,
} from "@/lib/dispatch-log"

type DispatchLogWithCompany = DispatchLog & {
  company_name?: string | null
}

type ScheduleWindowSummary = {
  start: string | Date
  label: string
  scheduled: number
  pending: number
  ongoing: number
  delivered: number
  failed: number
}

type ScheduleDispatchSummary = {
  range: {
    start: string
    end: string
  }
  totals: {
    scheduled: number
    pending: number
    ongoing: number
    delivered: number
    failed: number
  }
  windows: ScheduleWindowSummary[]
}

function formatLogAge(log: DispatchLog, mounted = false) {
  if (!mounted) {
    return "-"
  }

  const parsed = getDispatchLogEffectiveDate(log)
  if (!parsed) {
    return "-"
  }

  return formatDistanceToNow(parsed, {
    addSuffix: true,
    locale: ptBR,
  })
}

function toWindowDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value)
}

function formatHalfHourBucketLabel(bucketStart: string | Date) {
  const startDate = toWindowDate(bucketStart)
  if (Number.isNaN(startDate.getTime())) {
    return "-"
  }

  const bucketEnd = new Date(startDate.getTime() + 30 * 60 * 1000)

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    })

  return `${formatTime(startDate)} - ${formatTime(bucketEnd)}`
}

function buildDispatchSummary(logs: DispatchLog[]) {
  const totals = logs.reduce(
    (acc, log) => {
      const outcome = getDispatchLogOutcome(log)
      acc[outcome] += 1
      return acc
    },
    { scheduled: 0, pending: 0, delivered: 0, failed: 0, ongoing: 0 }
  )

  const buckets = new Map<
    number,
    {
      start: string | Date
      label: string
      scheduled: number
      pending: number
      ongoing: number
      delivered: number
      failed: number
    }
  >()

  for (const log of logs) {
    const effectiveDate = getDispatchLogEffectiveDate(log)
    if (!effectiveDate) continue

    const bucketStart = new Date(effectiveDate)
    bucketStart.setMinutes(bucketStart.getMinutes() < 30 ? 0 : 30, 0, 0)
    const bucketKey = bucketStart.getTime()
    const current =
      buckets.get(bucketKey) ??
      {
        start: bucketStart,
        label: formatHalfHourBucketLabel(bucketStart),
        scheduled: 0,
        pending: 0,
        ongoing: 0,
        delivered: 0,
        failed: 0,
      }

    const outcome = getDispatchLogOutcome(log)
    current[outcome] += 1
    current.scheduled += 1
    buckets.set(bucketKey, current)
  }

  totals.scheduled = totals.ongoing + totals.delivered + totals.failed

  const windows = [...buckets.values()]
    .sort((a, b) => toWindowDate(b.start).getTime() - toWindowDate(a.start).getTime())
    .slice(0, 8)

  return { totals, windows }
}

export function RecentDispatches({
  logs,
  scheduleSummary,
  mode = "full",
  showReportColumn = true,
  showCompanyColumn = false,
  embedded = false,
}: {
  logs: DispatchLogWithCompany[]
  scheduleSummary?: ScheduleDispatchSummary | null
  mode?: "full" | "table"
  showReportColumn?: boolean
  showCompanyColumn?: boolean
  embedded?: boolean
}) {
  const mounted = useMounted()
  const fallbackSummary = buildDispatchSummary(logs)
  const summary = scheduleSummary ?? fallbackSummary
  const usingScheduleSummary = Boolean(scheduleSummary)
  const shouldShowCompanyColumn = showCompanyColumn
  const hasOperationalSummary =
    (summary.totals.scheduled ?? 0) > 0 || logs.length > 0
  const operationalRangeLabel = scheduleSummary
    ? `${scheduleSummary.range.start} - ${scheduleSummary.range.end}`
    : "07:00 - 19:00"
  const summaryHeaderGridClass = embedded
    ? "grid gap-4"
    : "grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1.85fr)]"
  const summaryCardsGridClass = embedded
    ? "grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-5"
    : "grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
  const dayLineGridClass = embedded
    ? "grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6"
    : "flex min-w-0 gap-3 overflow-x-auto pb-2"
  const halfHourWindowsGridClass = embedded
    ? "grid gap-2 xl:grid-cols-2"
    : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
  const summaryCardBoxClass = embedded
    ? "min-w-0 rounded-md border px-2 py-2"
    : "rounded-2xl border px-4 py-4"
  const summaryCardTitleClass = embedded
    ? "truncate text-[9px] font-medium uppercase tracking-[0.08em]"
    : "text-[11px] font-medium uppercase tracking-[0.18em]"
  const summaryCardValueClass = embedded
    ? "mt-1 text-xl font-semibold tracking-tight text-foreground"
    : "mt-3 text-3xl font-semibold tracking-tight text-foreground"
  const summaryCardCaptionClass = embedded
    ? "mt-0.5 text-[9px]"
    : "mt-2 text-xs"
  const dayLineCardClass = embedded
    ? "min-w-0 rounded-xl border px-2.5 py-2"
    : "min-w-[136px] rounded-2xl border px-3 py-3"
  const dayLineValueClass = embedded
    ? "mt-1.5 text-lg font-semibold tracking-tight text-foreground"
    : "mt-3 text-2xl font-semibold tracking-tight text-foreground"
  const dayLineMetaClass = embedded
    ? "text-[10px] text-muted-foreground"
    : "text-xs text-muted-foreground"
  const thirtyMinuteCardClass = embedded
    ? "min-w-0 rounded-xl border border-border/70 bg-background px-3 py-3 shadow-sm transition-colors hover:border-border"
    : "rounded-2xl border border-border/70 bg-background px-4 py-4 shadow-sm transition-colors hover:border-border"
  const thirtyMinuteTitleClass = embedded
    ? "text-xs font-semibold tracking-tight text-foreground"
    : "text-sm font-semibold tracking-tight text-foreground"
  const thirtyMinuteDescriptionClass = embedded
    ? "mt-1 text-[10px] text-muted-foreground"
    : "mt-1 text-xs text-muted-foreground"
  const thirtyMinuteStatusGridClass = embedded
    ? "mt-3 grid grid-cols-2 gap-1.5 text-[10px]"
    : "mt-4 grid grid-cols-2 gap-2 text-xs"
  const thirtyMinuteBadgeClass = embedded
    ? "rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
    : "rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground"
  const summaryCards = [
    {
      title: "Agendados",
      value: summary.totals.scheduled ?? 0,
      caption: "Hoje",
      className: "border-border/70 bg-background text-foreground",
      labelClassName: "text-muted-foreground",
      captionClassName: "text-muted-foreground",
    },
    {
      title: "Para enviar",
      value: summary.totals.pending ?? 0,
      caption: "Na fila",
      className: "border-sky-500/25 bg-sky-500/5 text-foreground",
      labelClassName: "text-sky-600 dark:text-sky-400",
      captionClassName: "text-sky-700/80 dark:text-sky-300/80",
    },
    {
      title: "Em andamento",
      value: summary.totals.ongoing,
      caption: "Processando",
      className: "border-amber-500/25 bg-amber-500/5 text-foreground",
      labelClassName: "text-amber-600 dark:text-amber-400",
      captionClassName: "text-amber-700/80 dark:text-amber-300/80",
    },
    {
      title: "Enviados",
      value: summary.totals.delivered,
      caption: "Concluidos",
      className: "border-emerald-500/25 bg-emerald-500/5 text-foreground",
      labelClassName: "text-emerald-600 dark:text-emerald-400",
      captionClassName: "text-emerald-700/80 dark:text-emerald-300/80",
    },
    {
      title: "Com erro",
      value: summary.totals.failed,
      caption: "Revisar",
      className: "border-rose-500/25 bg-rose-500/5 text-foreground",
      labelClassName: "text-rose-600 dark:text-rose-400",
      captionClassName: "text-rose-700/80 dark:text-rose-300/80",
    },
  ]

  const content = mode === "table" ? (
          logs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  {shouldShowCompanyColumn ? <TableHead>Empresa</TableHead> : null}
                  {showReportColumn ? <TableHead>Relatorio</TableHead> : null}
                  <TableHead>Contato</TableHead>
                  <TableHead>Formato</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Quando</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const status = getDispatchLogDisplayStatus(log)
                  return (
                    <TableRow key={log.id}>
                      {shouldShowCompanyColumn ? (
                        <TableCell className="max-w-[180px] font-medium">
                          <span className="line-clamp-2">
                            {log.company_name ?? "-"}
                          </span>
                        </TableCell>
                      ) : null}
                      {showReportColumn ? (
                        <TableCell className="font-medium">
                          {log.report_name}
                        </TableCell>
                      ) : null}
                      <TableCell>{log.contact_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{log.export_format ?? "-"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant} className={status.className}>
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatLogAge(log, mounted)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum disparo realizado ainda.
            </p>
          )
        ) : !hasOperationalSummary ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum disparo realizado ainda.
          </p>
        ) : (
          <div className={`min-w-0 space-y-${embedded ? "3" : "4"}`}>
            <div className={`min-w-0 border border-border/70 bg-gradient-to-br from-muted/15 via-background to-background shadow-sm ${embedded ? "rounded-2xl p-4 sm:p-5" : "rounded-3xl p-5 sm:p-6"}`}>
              <div className="space-y-6">
                <div className={summaryHeaderGridClass}>
                  <div className={`border border-border/70 bg-background/80 ${embedded ? "rounded-xl px-4 py-4" : "rounded-2xl px-5 py-5"}`}>
                    <div className="flex h-full flex-col justify-between gap-4">
                      <div>
                        <p className={`${embedded ? "text-[10px] tracking-[0.16em]" : "text-xs tracking-[0.18em]"} font-semibold uppercase text-muted-foreground`}>
                          Resumo operacional
                        </p>
                        <p className={`${embedded ? "mt-2 text-sm" : "mt-3 text-base"} font-semibold tracking-tight text-foreground`}>
                          Agenda do dia monitorada de ponta a ponta
                        </p>
                        <p className={`${embedded ? "mt-2 text-xs leading-5" : "mt-2 text-sm leading-6"} text-muted-foreground`}>
                          {usingScheduleSummary
                            ? `Leitura conectada aos horarios programados dos relatorios entre ${operationalRangeLabel}, com distribuicao por janelas de 30 minutos.`
                            : "Visao consolidada dos disparos recentes, organizada por janelas operacionais de 30 minutos."}
                        </p>
                      </div>

                      <div className={`flex flex-wrap gap-2 ${embedded ? "text-[10px]" : "text-xs"} text-muted-foreground`}>
                        <span className={`rounded-full border border-border/70 bg-background ${embedded ? "px-2.5 py-1" : "px-3 py-1.5"}`}>
                          Jornada monitorada: {operationalRangeLabel}
                        </span>
                        <span className={`rounded-full border border-border/70 bg-background ${embedded ? "px-2.5 py-1" : "px-3 py-1.5"}`}>
                          Leitura a cada 30 minutos
                        </span>
                        <span className={`rounded-full border border-border/70 bg-background ${embedded ? "px-2.5 py-1" : "px-3 py-1.5"}`}>
                          Atualizacao em tempo real
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className={summaryCardsGridClass}>
                    {summaryCards.map((item) => (
                      <div
                        key={item.title}
                        className={`${summaryCardBoxClass} ${item.className}`}
                      >
                        <p className={`${summaryCardTitleClass} ${item.labelClassName}`}>
                          {item.title}
                        </p>
                        <p className={summaryCardValueClass}>
                          {item.value}
                        </p>
                        {!embedded ? (
                          <p className={`${summaryCardCaptionClass} ${item.captionClassName}`}>
                            {item.caption}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`min-w-0 border border-border/70 bg-background/60 ${embedded ? "rounded-xl px-3 py-3" : "rounded-2xl px-4 py-4"}`}>
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className={`${embedded ? "text-[10px]" : "text-xs"} font-medium uppercase tracking-[0.14em] text-muted-foreground`}>
                        Linha do dia
                      </p>
                      <p className={`${embedded ? "mt-1 text-xs" : "mt-1 text-sm"} text-muted-foreground`}>
                        Todas as faixas operacionais entre {operationalRangeLabel}.
                      </p>
                    </div>
                    <p className={`${embedded ? "text-[10px]" : "text-xs"} text-muted-foreground`}>
                      {usingScheduleSummary
                        ? "Baseado nos horarios agendados do dia"
                        : "Baseado no historico recente de execucao"}
                    </p>
                  </div>

                  <div className={dayLineGridClass}>
                    {summary.windows.length > 0 ? (
                      summary.windows.map((window) => {
                        const total =
                          window.scheduled ??
                          ((window.pending ?? 0) +
                            window.ongoing +
                            window.delivered +
                            window.failed)
                        const hasActivity = total > 0

                        return (
                          <div
                            key={
                              window.start instanceof Date
                                ? window.start.toISOString()
                                : window.start
                            }
                            className={`${dayLineCardClass} ${
                              hasActivity
                                ? "border-border/70 bg-background shadow-sm"
                                : "border-border/50 bg-muted/20"
                            }`}
                          >
                            <p className={`${embedded ? "text-[11px]" : "text-sm"} font-semibold text-foreground`}>
                              {window.label || formatHalfHourBucketLabel(window.start)}
                            </p>
                            <p className={dayLineValueClass}>
                              {total}
                            </p>
                            <p className={dayLineMetaClass}>
                              agendado(s)
                            </p>
                            <div className={`${embedded ? "mt-2" : "mt-3"} flex items-center gap-1.5`}>
                              <span className="h-2 w-2 rounded-full bg-sky-400" />
                              <span className={`${embedded ? "text-[10px]" : "text-[11px]"} text-muted-foreground`}>
                                {window.pending ?? 0} fila
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-amber-400" />
                              <span className={`${embedded ? "text-[10px]" : "text-[11px]"} text-muted-foreground`}>
                                {window.ongoing} em andamento
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-emerald-400" />
                              <span className={`${embedded ? "text-[10px]" : "text-[11px]"} text-muted-foreground`}>
                                {window.delivered} enviados
                              </span>
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-4 text-sm text-muted-foreground">
                        Assim que houver rotinas agendadas no horario operacional, a linha do dia aparecera aqui.
                      </div>
                    )}
                  </div>
                </div>

                <div className={`border-t border-border/70 ${embedded ? "pt-4" : "pt-6"}`}>
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className={`${embedded ? "text-[10px]" : "text-xs"} font-medium uppercase tracking-[0.14em] text-muted-foreground`}>
                        Faixas de 30 minutos
                      </p>
                      <p className={`${embedded ? "mt-1 text-xs" : "mt-1 text-sm"} text-muted-foreground`}>
                        Detalhamento operacional completo da jornada.
                      </p>
                    </div>
                    <p className={`${embedded ? "text-[10px]" : "text-xs"} text-muted-foreground`}>
                      {summary.windows.length > 0
                        ? usingScheduleSummary
                          ? "Cobertura completa do dia operacional"
                          : "Janelas agrupadas a partir dos disparos recentes"
                        : usingScheduleSummary
                          ? "Nao ha horarios agendados para este dia"
                          : "Sem horarios suficientes para agrupar"}
                    </p>
                  </div>

                  <div className={halfHourWindowsGridClass}>
                    {summary.windows.length > 0 ? (
                      summary.windows.map((window) => (
                        <div
                          key={
                            window.start instanceof Date
                              ? window.start.toISOString()
                              : window.start
                          }
                          className={thirtyMinuteCardClass}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className={thirtyMinuteTitleClass}>
                                {window.label || formatHalfHourBucketLabel(window.start)}
                              </p>
                              <p className={thirtyMinuteDescriptionClass}>
                                Janela operacional de 30 minutos
                              </p>
                            </div>
                            <span className={`${thirtyMinuteBadgeClass} shrink-0`}>
                              {window.scheduled ?? window.ongoing + window.delivered + window.failed} agendado(s)
                            </span>
                          </div>

                          <div className={thirtyMinuteStatusGridClass}>
                            <span className={`rounded-xl border border-sky-500/20 bg-sky-500/10 ${embedded ? "px-2 py-1.5" : "px-3 py-2"} text-sky-600 dark:text-sky-400`}>
                              <strong className={`block ${embedded ? "text-xs" : "text-sm"}`}>{window.pending ?? 0}</strong>
                              para enviar
                            </span>
                            <span className={`rounded-xl border border-amber-500/20 bg-amber-500/10 ${embedded ? "px-2 py-1.5" : "px-3 py-2"} text-amber-600 dark:text-amber-400`}>
                              <strong className={`block ${embedded ? "text-xs" : "text-sm"}`}>{window.ongoing}</strong>
                              em andamento
                            </span>
                            <span className={`rounded-xl border border-emerald-500/20 bg-emerald-500/10 ${embedded ? "px-2 py-1.5" : "px-3 py-2"} text-emerald-600 dark:text-emerald-400`}>
                              <strong className={`block ${embedded ? "text-xs" : "text-sm"}`}>{window.delivered}</strong>
                              enviados
                            </span>
                            <span className={`rounded-xl border border-rose-500/20 bg-rose-500/10 ${embedded ? "px-2 py-1.5" : "px-3 py-2"} text-rose-600 dark:text-rose-400`}>
                              <strong className={`block ${embedded ? "text-xs" : "text-sm"}`}>{window.failed}</strong>
                              com erro
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-4 text-sm text-muted-foreground">
                        Assim que houver rotinas agendadas no horario operacional, as janelas de 30 minutos aparecerao aqui.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {logs.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    {shouldShowCompanyColumn ? <TableHead>Empresa</TableHead> : null}
                    {showReportColumn ? <TableHead>Relatorio</TableHead> : null}
                    <TableHead>Contato</TableHead>
                    <TableHead>Formato</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Quando</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => {
                    const status = getDispatchLogDisplayStatus(log)
                    return (
                      <TableRow key={log.id}>
                        {shouldShowCompanyColumn ? (
                          <TableCell className="max-w-[180px] font-medium">
                            <span className="line-clamp-2">
                              {log.company_name ?? "-"}
                            </span>
                          </TableCell>
                        ) : null}
                        {showReportColumn ? (
                          <TableCell className="font-medium">
                            {log.report_name}
                          </TableCell>
                        ) : null}
                        <TableCell>{log.contact_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{log.export_format ?? "-"}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={status.variant} className={status.className}>
                            {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatLogAge(log, mounted)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            ) : null}
          </div>
        )

  if (embedded) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Ultimos Disparos</h3>
        </div>
        {content}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ultimos Disparos</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
