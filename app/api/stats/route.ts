import { NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"
import {
  getScheduleAccessMaps,
  isScheduleAccessible,
} from "@/lib/schedule-access"
import { readWhatsAppBotRuntimeState } from "@/lib/whatsapp-bot"
import {
  getWorkspaceAccessScope,
} from "@/lib/workspace-access"
import {
  isMissingWhatsAppBotInstancesTableError,
  listCompanyWhatsAppBotInstances,
} from "@/lib/whatsapp-bot-instances"
import {
  countDispatchLogOutcomes,
  getDispatchLogEffectiveDate,
  getDispatchLogOutcome,
} from "@/lib/dispatch-log"
import {
  canAccessDispatchLog,
  getCompanyScheduleIdSet,
} from "@/lib/dispatch-log-visibility"
import { describeCronValue, getNextCronOccurrence, matchesCronValue } from "@/lib/schedule-cron"
import { resolveScheduleReportConfigs } from "@/lib/schedule-report-configs"

type DispatchLogStatsRecord = {
  schedule_id?: string | null
  status?: string | null
  error_message?: string | null
  created_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}

type ActiveScheduleStatsRecord = {
  id: string
  name: string
  report_id?: string | null
  report_configs?: unknown
  pbi_page_name?: string | null
  pbi_page_names?: string[] | null
  cron_expression?: string | null
  export_format?: string | null
  is_active?: boolean | null
  last_run_at?: string | null
}

type ScheduleWindowSummary = {
  start: string
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

const OPERATION_START_HOUR = 6
const OPERATION_END_HOUR = 19

function formatNextRunLabel(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(date)
}

function formatHalfHourWindowLabel(start: Date) {
  const end = new Date(start.getTime() + 30 * 60 * 1000)
  const formatTime = (date: Date) =>
    date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    })

  return `${formatTime(start)} - ${formatTime(end)}`
}

function formatTimeLabel(date: Date) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  })
}

function floorToHalfHour(date: Date) {
  const copy = new Date(date)
  copy.setMinutes(copy.getMinutes() < 30 ? 0 : 30, 0, 0)
  return copy
}

function ceilToHalfHour(date: Date) {
  const floored = floorToHalfHour(date)
  if (floored.getTime() === date.getTime()) {
    return floored
  }

  return new Date(floored.getTime() + 30 * 60 * 1000)
}

function buildOperationalWindows(start: Date, end: Date) {
  const windows: ScheduleWindowSummary[] = []

  for (let cursor = new Date(start); cursor < end; cursor = new Date(cursor.getTime() + 30 * 60 * 1000)) {
    const windowStart = new Date(cursor)

    windows.push({
      start: windowStart.toISOString(),
      label: formatHalfHourWindowLabel(windowStart),
      scheduled: 0,
      pending: 0,
      ongoing: 0,
      delivered: 0,
      failed: 0,
    })
  }

  return windows
}

function getScheduleReportLabel(
  schedule: ActiveScheduleStatsRecord,
  accessMaps: Awaited<ReturnType<typeof getScheduleAccessMaps>>
) {
  const reportNames = resolveScheduleReportConfigs(schedule)
    .map((reportConfig) => {
      return (
        accessMaps.reportNames.get(reportConfig.report_id) ??
        accessMaps.automationNames.get(reportConfig.report_id) ??
        "Desconhecido"
      )
    })
    .filter(Boolean)
  const uniqueNames = [...new Set(reportNames)]
  const primaryReportName = uniqueNames[0] ?? "Desconhecido"

  return uniqueNames.length > 1
    ? `${primaryReportName} +${uniqueNames.length - 1}`
    : primaryReportName
}

// Brazil is UTC-3 (America/Sao_Paulo — no DST since 2019)
const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000

// Cache de ocorrências de cron por dia — evita 1440 iterações × N rotinas a cada refresh
const _cronOccurrenceCache = new Map<string, { result: Date[]; expiresAt: number }>()

function getBrazilDayStart(date: Date): Date {
  const brazilTime = new Date(date.getTime() - BRAZIL_OFFSET_MS)
  const midnight = new Date(Date.UTC(
    brazilTime.getUTCFullYear(),
    brazilTime.getUTCMonth(),
    brazilTime.getUTCDate()
  ))
  return new Date(midnight.getTime() + BRAZIL_OFFSET_MS)
}

function listScheduleOccurrencesToday(
  cronExpression: string,
  dayStart: Date,
  dayEnd: Date,
  timeZone: string
) {
  const cacheKey = `${cronExpression}|${dayStart.toISOString()}|${timeZone}`
  const cached = _cronOccurrenceCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result
  }

  const occurrences: Date[] = []

  for (let minuteOffset = 0; minuteOffset < 24 * 60; minuteOffset += 1) {
    const candidate = new Date(dayStart.getTime() + minuteOffset * 60 * 1000)

    if (candidate >= dayEnd) {
      break
    }

    if (matchesCronValue(cronExpression, candidate, timeZone)) {
      occurrences.push(candidate)
    }
  }

  _cronOccurrenceCache.set(cacheKey, { result: occurrences, expiresAt: Date.now() + 5 * 60 * 1000 })
  return occurrences
}

function buildScheduleDispatchSummary(
  schedules: ActiveScheduleStatsRecord[],
  logs: DispatchLogStatsRecord[],
  dayStart: Date,
  dayEnd: Date,
  timeZone: string
): ScheduleDispatchSummary {
  const defaultOperationStart = new Date(dayStart.getTime() + OPERATION_START_HOUR * 60 * 60 * 1000)
  const defaultOperationEnd = new Date(dayStart.getTime() + OPERATION_END_HOUR * 60 * 60 * 1000)
  const activityMoments: Date[] = []
  const todayLogs = logs.flatMap((log) => {
    const effectiveDate = getDispatchLogEffectiveDate(log)
    if (!effectiveDate || effectiveDate < dayStart || effectiveDate >= dayEnd) {
      return []
    }

    const outcome = getDispatchLogOutcome(log)
    activityMoments.push(effectiveDate)
    return [{ effectiveDate, outcome }]
  })
  const scheduledOccurrences: Date[] = []

  for (const schedule of schedules) {
    const cronExpression = schedule.cron_expression?.trim()
    if (!cronExpression) {
      continue
    }

    const occurrences = listScheduleOccurrencesToday(
      cronExpression,
      dayStart,
      dayEnd,
      timeZone
    )

    for (const occurrence of occurrences) {
      scheduledOccurrences.push(occurrence)
      activityMoments.push(occurrence)
    }
  }

  const earliestActivity =
    activityMoments.length > 0
      ? new Date(Math.min(...activityMoments.map((date) => date.getTime())))
      : defaultOperationStart
  const latestActivity =
    activityMoments.length > 0
      ? new Date(Math.max(...activityMoments.map((date) => date.getTime())))
      : defaultOperationEnd

  const operationStartDate =
    earliestActivity < defaultOperationStart
      ? floorToHalfHour(earliestActivity)
      : defaultOperationStart
  const operationEndDate =
    latestActivity > defaultOperationEnd
      ? new Date(ceilToHalfHour(latestActivity).getTime() + 30 * 60 * 1000)
      : defaultOperationEnd

  const operationStart = operationStartDate.getTime()
  const operationEnd = operationEndDate.getTime()
  const buckets = new Map<number, ScheduleWindowSummary>(
    buildOperationalWindows(operationStartDate, operationEndDate).map((window) => [
      new Date(window.start).getTime(),
      window,
    ])
  )
  const totals = {
    scheduled: 0,
    pending: 0,
    ongoing: 0,
    delivered: 0,
    failed: 0,
  }

  for (const scheduledAt of scheduledOccurrences) {
    const bucketStart = floorToHalfHour(scheduledAt)
    const bucketKey = bucketStart.getTime()

    if (bucketKey < operationStart || bucketKey >= operationEnd) {
      continue
    }

    const bucket =
      buckets.get(bucketKey) ??
      {
        start: bucketStart.toISOString(),
        label: formatHalfHourWindowLabel(bucketStart),
        scheduled: 0,
        pending: 0,
        ongoing: 0,
        delivered: 0,
        failed: 0,
      }

    bucket.scheduled += 1
    buckets.set(bucketKey, bucket)
  }

  for (const log of todayLogs) {
    const bucketStart = floorToHalfHour(log.effectiveDate)
    const bucketKey = bucketStart.getTime()

    if (bucketKey < operationStart || bucketKey >= operationEnd) {
      continue
    }

    const bucket =
      buckets.get(bucketKey) ??
      {
        start: bucketStart.toISOString(),
        label: formatHalfHourWindowLabel(bucketStart),
        scheduled: 0,
        pending: 0,
        ongoing: 0,
        delivered: 0,
        failed: 0,
      }

    bucket[log.outcome] += 1
    buckets.set(bucketKey, bucket)
  }

  const windows = [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, window]) => {
      const actualCount = window.ongoing + window.delivered + window.failed
      const pending = Math.max(0, window.scheduled - actualCount)

      return {
        ...window,
        pending,
      }
    })

  totals.scheduled = windows.reduce((sum, window) => sum + window.scheduled, 0)
  totals.ongoing = windows.reduce((sum, window) => sum + window.ongoing, 0)
  totals.delivered = windows.reduce((sum, window) => sum + window.delivered, 0)
  totals.failed = windows.reduce((sum, window) => sum + window.failed, 0)
  totals.pending = windows.reduce((sum, window) => sum + window.pending, 0)

  return {
    range: {
      start: formatTimeLabel(operationStartDate),
      end: formatTimeLabel(operationEndDate),
    },
    totals,
    windows,
  }
}

export async function GET(request: Request) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()

    const { searchParams } = new URL(request.url)
    const dateParam = searchParams.get("date")?.trim() ?? ""
    const now = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? new Date(`${dateParam}T12:00:00-03:00`)
      : new Date()
    const todayStart = getBrazilDayStart(now)
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
    const chartStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)

    // Inicio do mes atual no fuso Brasil (UTC-3)
    const brazilNow = new Date(now.getTime() - BRAZIL_OFFSET_MS)
    const startOfMonthUTC = new Date(Date.UTC(brazilNow.getUTCFullYear(), brazilNow.getUTCMonth(), 1))
    const thirtyDaysAgo = new Date(startOfMonthUTC.getTime() + BRAZIL_OFFSET_MS)

    // Inicia workspace scope em paralelo com as queries
    const workspaceScopePromise = getWorkspaceAccessScope(supabase, context)

    // Query leve: apenas logs de HOJE para analise de janelas
    const todayLogsQuery = supabase
      .from("dispatch_logs")
      .select("schedule_id, status, error_message, created_at, started_at, completed_at")
      .eq("company_id", companyId)
      .gte("created_at", todayStart.toISOString())
      .lt("created_at", tomorrowStart.toISOString())
      .order("created_at", { ascending: false })

    // Query leve: logs dos ultimos 6 dias para o grafico (excluindo hoje)
    const chartLogsQuery = supabase
      .from("dispatch_logs")
      .select("status, created_at, started_at, completed_at")
      .eq("company_id", companyId)
      .gte("created_at", chartStart.toISOString())
      .lt("created_at", todayStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(500)

    // Contagens do mes usando COUNT (sem buscar linhas)
    const monthDeliveredQuery = supabase
      .from("dispatch_logs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("created_at", thirtyDaysAgo.toISOString())
      .eq("status", "delivered")

    const monthFailedQuery = supabase
      .from("dispatch_logs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("created_at", thirtyDaysAgo.toISOString())
      .eq("status", "failed")

    const monthOngoingQuery = supabase
      .from("dispatch_logs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("created_at", thirtyDaysAgo.toISOString())
      .eq("status", "ongoing")

    const schedulesQuery = supabase
      .from("schedules")
      .select("id, name, report_id, report_configs, pbi_page_name, pbi_page_names, cron_expression, export_format, is_active, last_run_at")
      .eq("company_id", companyId)
      .eq("is_active", true)

    const workspaceScope = await workspaceScopePromise
    const hasRestrictedScope = workspaceScope.workspaceRestricted || workspaceScope.datasetRestricted

    const reportsQuery =
      workspaceScope.workspaceRestricted && workspaceScope.workspaceIds.length === 0
        ? Promise.resolve({ count: 0, error: null } as const)
        : workspaceScope.datasetRestricted && workspaceScope.datasetIds.length === 0
        ? Promise.resolve({ count: 0, error: null } as const)
        : (() => {
            let query = supabase
              .from("reports")
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyId)
              .eq("is_active", true)

            if (workspaceScope.workspaceRestricted) {
              query = query.in("workspace_id", workspaceScope.workspaceIds)
            }

            if (workspaceScope.datasetRestricted) {
              query = query.in("dataset_id", workspaceScope.datasetIds)
            }

            return query
          })()

    const [
      reportsRes, contactsRes, todayLogsRes, chartLogsRes,
      monthDeliveredRes, monthFailedRes, monthOngoingRes,
      settingsRes, botInstancesRes, schedulesRes,
    ] = await Promise.all([
      reportsQuery,
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("is_active", true),
      todayLogsQuery,
      chartLogsQuery,
      monthDeliveredQuery,
      monthFailedQuery,
      monthOngoingQuery,
      supabase
        .from("company_settings")
        .select("key, value")
        .eq("company_id", companyId)
        .in("key", ["powerbi", "n8n", "general"]),
      listCompanyWhatsAppBotInstances(supabase, companyId).catch((error) => {
        if (isMissingWhatsAppBotInstancesTableError(error)) {
          return null
        }
        throw error
      }),
      schedulesQuery,
    ])

    const queryError =
      reportsRes.error ??
      contactsRes.error ??
      todayLogsRes.error ??
      chartLogsRes.error ??
      monthDeliveredRes.error ??
      monthFailedRes.error ??
      monthOngoingRes.error ??
      settingsRes.error ??
      schedulesRes.error

    if (queryError) {
      throw new Error(queryError.message)
    }

    const botInstances = Array.isArray(botInstancesRes) ? botInstancesRes : null
    let todayLogs = (todayLogsRes.data ?? []) as DispatchLogStatsRecord[]
    const activeSchedules = (schedulesRes.data ?? []) as ActiveScheduleStatsRecord[]

    // Roda em paralelo: check do bot (max 1.5s) + busca de accessMaps
    const [botState, accessMaps] = await Promise.all([
      botInstances
        ? Promise.resolve(null)
        : Promise.race([
            readWhatsAppBotRuntimeState(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
          ]),
      activeSchedules.length > 0
        ? getScheduleAccessMaps(supabase, companyId, workspaceScope)
        : Promise.resolve({
            visibleTargetIds: new Set<string>(),
            reportNames: new Map<string, string>(),
            automationNames: new Map<string, string>(),
          }),
    ])

    const connectedWhatsAppInstances = botInstances
      ? botInstances.filter((instance) => instance.status === "connected").length
      : botState?.status === "connected"
        ? 1
        : 0
    const totalWhatsAppInstances = botInstances?.length ?? (botState ? 1 : 0)
    const whatsappConnected = connectedWhatsAppInstances > 0
    const whatsappBotStatus: string = botInstances
      ? (["connected", "reconnecting", "starting", "awaiting_qr"].find((s) =>
          botInstances.some((i) => i.status === s)
        ) ?? botInstances[0]?.status ?? "offline")
      : (botState?.status ?? "offline")
    const whatsappConnectedAt: string | null = botInstances
      ? (botInstances.find((i) => i.status === "connected")?.connected_at ?? null)
      : (botState?.connected_at ?? null)

    const totalReports = reportsRes.count ?? 0
    const activeContacts = contactsRes.count ?? 0
    const visibleSchedules = activeSchedules.filter((schedule) =>
      isScheduleAccessible(schedule, accessMaps)
    )

    if (hasRestrictedScope) {
      const currentScheduleIds = await getCompanyScheduleIdSet(supabase, companyId)
      const accessibleScheduleIdSet = new Set(visibleSchedules.map((schedule) => schedule.id))
      todayLogs = todayLogs.filter((log) =>
        canAccessDispatchLog(log.schedule_id, accessibleScheduleIdSet, currentScheduleIds)
      )
    }

    // Contagens do mes a partir das queries de COUNT
    const deliveredCount = monthDeliveredRes.count ?? 0
    const failedCount = monthFailedRes.count ?? 0
    const ongoingCount = monthOngoingRes.count ?? 0
    const completedMonthCount = deliveredCount + failedCount
    const successRate =
      completedMonthCount > 0
        ? Math.round((deliveredCount / completedMonthCount) * 100)
        : null

    const dispatchesToday = todayLogs.length

    // Configuration status
    const settingsMap = new Map(
      (settingsRes.data ?? []).map((s) => [s.key, s.value])
    )
    const powerbi = settingsMap.get("powerbi") as Record<string, unknown> | undefined
    const n8n = settingsMap.get("n8n") as Record<string, unknown> | undefined
    const general = settingsMap.get("general") as Record<string, unknown> | undefined
    const timeZone =
      typeof general?.timezone === "string" && general.timezone.trim()
        ? general.timezone.trim()
        : "America/Sao_Paulo"
    const pbiConfigured = !!(powerbi?.client_id || process.env.PBI_CLIENT_ID)
    const n8nConfigured = !!(
      typeof n8n?.webhook_url === "string" &&
      n8n.webhook_url.trim() &&
      typeof n8n?.callback_secret === "string" &&
      n8n.callback_secret.trim()
    )

    // Grafico: 6 dias anteriores + hoje
    const chartRawLogs = (chartLogsRes.data ?? []) as DispatchLogStatsRecord[]
    const allChartLogs = [...todayLogs, ...chartRawLogs]
    const chartLogsWithDates = allChartLogs.flatMap((log) => {
      const effectiveDate = getDispatchLogEffectiveDate(log)
      if (!effectiveDate) return []
      return [{ effectiveDate, outcome: getDispatchLogOutcome(log) }]
    })

    const chartData = []
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(chartStart.getTime() + i * 24 * 60 * 60 * 1000)
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
      const brazilDay = new Date(dayStart.getTime() - BRAZIL_OFFSET_MS)
      const dayStr = `${String(brazilDay.getUTCDate()).padStart(2, "0")}/${String(brazilDay.getUTCMonth() + 1).padStart(2, "0")}`
      const dayItems = chartLogsWithDates.filter(
        (log) => log.effectiveDate >= dayStart && log.effectiveDate < dayEnd
      )
      chartData.push({
        date: dayStr,
        delivered: dayItems.filter((log) => log.outcome === "delivered").length,
        failed: dayItems.filter((log) => log.outcome === "failed").length,
      })
    }

    const scheduleDispatchSummary = buildScheduleDispatchSummary(
      visibleSchedules,
      todayLogs,
      todayStart,
      tomorrowStart,
      timeZone
    )

    const nextDispatches = visibleSchedules
      .flatMap((schedule) => {
        const cronExpression = schedule.cron_expression?.trim()
        if (!cronExpression) {
          return []
        }

        const nextRun = getNextCronOccurrence(cronExpression, now, timeZone)
        if (!nextRun) {
          return []
        }

        return [
          {
            id: schedule.id,
            scheduleName: schedule.name,
            reportName: getScheduleReportLabel(schedule, accessMaps),
            exportFormat: schedule.export_format ?? "-",
            recurrence: describeCronValue(cronExpression).join(" • ") || cronExpression,
            nextRunAt: nextRun.toISOString(),
            nextRunLabel: formatNextRunLabel(nextRun, timeZone),
          },
        ]
      })
      .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt))
      .slice(0, 10)

    return NextResponse.json({
      totalReports,
      activeContacts,
      whatsappConnected,
      whatsappBotStatus,
      whatsappConnectedAt,
      connectedWhatsAppInstances,
      totalWhatsAppInstances,
      dispatchesToday,
      successRate,
      completed30d: completedMonthCount,
      delivered30d: deliveredCount,
      failed30d: failedCount,
      ongoing30d: ongoingCount,
      pbiConfigured,
      n8nConfigured,
      chartData,
      statusBreakdown30d: [
        { key: "delivered", label: "Enviados", value: deliveredCount },
        { key: "failed", label: "Erro", value: failedCount },
        { key: "ongoing", label: "Em andamento", value: ongoingCount },
      ],
      timeZone,
      scheduleDispatchSummary,
      nextDispatches,
      canSyncAllPowerBi:
        !workspaceScope.workspaceRestricted && !workspaceScope.datasetRestricted,
      canImportWorkspaceCatalogInBulk: !workspaceScope.datasetRestricted,
    }, {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" },
    })
  } catch (error) {
    if (isAuthContextError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Nao autenticado" },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro" },
      { status: 500 }
    )
  }
}
