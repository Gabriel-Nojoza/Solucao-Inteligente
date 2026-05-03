import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { isAuthContextError, requireAdminContext } from "@/lib/tenant"
import {
  isMissingAutomationRelationError,
  loadStoredAutomations,
} from "@/lib/automation-storage"
import {
  describeCronValue,
  getNextCronOccurrence,
  matchesCronValue,
} from "@/lib/schedule-cron"
import { resolveScheduleReportConfigs } from "@/lib/schedule-report-configs"
import {
  getDispatchLogEffectiveDate,
  getDispatchLogOutcome,
} from "@/lib/dispatch-log"
import type { DispatchLog } from "@/lib/types"

type CompanyRecord = {
  id: string
  name: string | null
}

type DispatchLogSummaryRecord = {
  company_id?: string | null
  schedule_id?: string | null
  status?: string | null
  error_message?: string | null
  created_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}

type RecentDispatchLogRecord = DispatchLog & {
  company_id: string | null
}

type ActiveScheduleAdminRecord = {
  id: string
  company_id: string
  name: string
  report_id?: string | null
  report_configs?: unknown
  pbi_page_name?: string | null
  pbi_page_names?: string[] | null
  cron_expression?: string | null
  export_format?: string | null
  is_active?: boolean | null
  last_run_at?: string | null
  schedule_contacts?: Array<{ contact_id: string }> | null
  company_name: string
  time_zone: string
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

export type AdminScheduleDispatchSummary = {
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

export type AdminOperationalDispatchLog = DispatchLog & {
  company_id?: string | null
  company_name: string | null
}

export type AdminUpcomingDispatchItem = {
  id: string
  companyName: string | null
  scheduleName: string
  reportName: string
  exportFormat: string
  recurrence: string
  nextRunAt: string
  nextRunLabel: string
}

export type AdminOperationalSummaryResponse = {
  recentLogs: AdminOperationalDispatchLog[]
  nextDispatches: AdminUpcomingDispatchItem[]
  scheduleDispatchSummary: AdminScheduleDispatchSummary | null
  companyCount: number
  companies: AdminOperationalCompanySummary[]
}

export type AdminOperationalCompanySummary = {
  companyId: string
  companyName: string
  recentLogs: AdminOperationalDispatchLog[]
  nextDispatches: AdminUpcomingDispatchItem[]
  scheduleDispatchSummary: AdminScheduleDispatchSummary | null
}

const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000
const DEFAULT_TIME_ZONE = "America/Sao_Paulo"
const NEXT_DISPATCH_LIMIT = 10
const RECENT_LOG_LIMIT = 20
const RECENT_LOG_LIMIT_PER_COMPANY = 20
const RECENT_LOG_TOTAL_CAP = 500
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
    })

  return `${formatTime(start)} - ${formatTime(end)}`
}

function formatTimeLabel(date: Date) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
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

  for (
    let cursor = new Date(start);
    cursor < end;
    cursor = new Date(cursor.getTime() + 30 * 60 * 1000)
  ) {
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

function getBrazilDayStart(date: Date): Date {
  const brazilTime = new Date(date.getTime() - BRAZIL_OFFSET_MS)
  const midnight = new Date(
    Date.UTC(
      brazilTime.getUTCFullYear(),
      brazilTime.getUTCMonth(),
      brazilTime.getUTCDate()
    )
  )

  return new Date(midnight.getTime() + BRAZIL_OFFSET_MS)
}

function listScheduleOccurrencesToday(
  cronExpression: string,
  dayStart: Date,
  dayEnd: Date,
  timeZone: string
) {
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

  return occurrences
}

function buildScheduleOccurrenceCacheKey(
  cronExpression: string,
  dayStart: Date,
  timeZone: string
) {
  return `${cronExpression}__${dayStart.toISOString()}__${timeZone}`
}

function getConfiguredTimeZone(value: unknown) {
  if (!value || typeof value !== "object") {
    return DEFAULT_TIME_ZONE
  }

  const record = value as Record<string, unknown>
  const timeZone = typeof record.timezone === "string" ? record.timezone.trim() : ""
  return timeZone || DEFAULT_TIME_ZONE
}

function getScheduleReportLabel(
  schedule: ActiveScheduleAdminRecord,
  reportNames: Map<string, string>,
  automationNames: Map<string, string>
) {
  const reportLabels = resolveScheduleReportConfigs(schedule)
    .map((reportConfig) => {
      return (
        reportNames.get(reportConfig.report_id) ??
        automationNames.get(reportConfig.report_id) ??
        "Desconhecido"
      )
    })
    .filter(Boolean)

  const uniqueLabels = [...new Set(reportLabels)]
  const primaryReportName = uniqueLabels[0] ?? "Desconhecido"

  return uniqueLabels.length > 1
    ? `${primaryReportName} +${uniqueLabels.length - 1}`
    : primaryReportName
}

async function getAutomationNames(
  supabase: ReturnType<typeof createServiceClient>,
  companyIds: string[]
) {
  const automationNames = new Map<string, string>()
  const { data, error } = await supabase
    .from("automations")
    .select("id, name, company_id")
    .in("company_id", companyIds)

  if (error) {
    if (!isMissingAutomationRelationError(error)) {
      throw new Error(error.message)
    }

    const storedAutomationSets = await Promise.all(
      companyIds.map(async (companyId) => ({
        companyId,
        items: await loadStoredAutomations(supabase, companyId),
      }))
    )

    for (const item of storedAutomationSets) {
      for (const automation of item.items) {
        automationNames.set(automation.id, automation.name)
      }
    }

    return automationNames
  }

  for (const automation of data ?? []) {
    automationNames.set(automation.id, automation.name ?? "Desconhecido")
  }

  return automationNames
}

async function fetchRecentLogsForScope({
  supabase,
  companyId,
  companyIds,
  limit,
  companyNameMap,
  dayStart,
  dayEnd,
}: {
  supabase: ReturnType<typeof createServiceClient>
  companyId?: string
  companyIds?: string[]
  limit: number
  companyNameMap: Map<string, string>
  dayStart: Date
  dayEnd: Date
}) {
  const buildQuery = (orderColumn: "created_at" | "id") => {
    let query = supabase
      .from("dispatch_logs")
      .select(
        "id, company_id, schedule_id, report_name, contact_name, contact_phone, status, export_format, error_message, n8n_execution_id, started_at, completed_at, created_at"
      )
      .gte("created_at", dayStart.toISOString())
      .lt("created_at", dayEnd.toISOString())
      .order(orderColumn, { ascending: false })
      .limit(limit)

    if (companyId) {
      query = query.eq("company_id", companyId)
    } else if (companyIds && companyIds.length > 0) {
      query = query.in("company_id", companyIds)
    }

    return query
  }

  let recentLogsData: RecentDispatchLogRecord[] | null = null
  let recentLogsError: { code?: string; message?: string } | null = null

  {
    const { data, error } = await buildQuery("created_at")
    recentLogsData = (data ?? null) as RecentDispatchLogRecord[] | null
    recentLogsError = error
  }

  if (recentLogsError?.code === "42703") {
    const { data, error } = await buildQuery("id")
    recentLogsData = (data ?? null) as RecentDispatchLogRecord[] | null
    recentLogsError = error
  }

  if (recentLogsError) {
    throw new Error(recentLogsError.message ?? "Erro ao buscar logs recentes")
  }

  return (recentLogsData ?? []).map((log) => ({
    ...log,
    company_name: log.company_id ? companyNameMap.get(log.company_id) ?? null : null,
  })) satisfies AdminOperationalDispatchLog[]
}

function groupRecentLogsByCompany(
  logs: AdminOperationalDispatchLog[],
  companyId: string,
  limit: number
) {
  return logs.filter((log) => log.company_id === companyId).slice(0, limit)
}

function buildScheduleDispatchSummary(
  schedules: ActiveScheduleAdminRecord[],
  logs: DispatchLogSummaryRecord[],
  dayStart: Date,
  dayEnd: Date
): AdminScheduleDispatchSummary {
  const defaultOperationStart = new Date(
    dayStart.getTime() + OPERATION_START_HOUR * 60 * 60 * 1000
  )
  const defaultOperationEnd = new Date(
    dayStart.getTime() + OPERATION_END_HOUR * 60 * 60 * 1000
  )
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
  const scheduleOccurrenceCache = new Map<string, Date[]>()

  for (const schedule of schedules) {
    const cronExpression = schedule.cron_expression?.trim()
    if (!cronExpression) {
      continue
    }

    const cacheKey = buildScheduleOccurrenceCacheKey(
      cronExpression,
      dayStart,
      schedule.time_zone
    )
    let occurrences = scheduleOccurrenceCache.get(cacheKey)
    if (!occurrences) {
      occurrences = listScheduleOccurrencesToday(
        cronExpression,
        dayStart,
        dayEnd,
        schedule.time_zone
      )
      scheduleOccurrenceCache.set(cacheKey, occurrences)
    }

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

export async function GET(request: NextRequest) {
  try {
    const context = await requireAdminContext()
    const supabase = createServiceClient()
    const { searchParams } = new URL(request.url)
    const requestedCompanyId = searchParams.get("companyId")?.trim() ?? ""
    const panelMode = searchParams.get("panel") === "1"
    const dateParam = searchParams.get("date")?.trim() ?? ""
    const companiesQuery = supabase
      .from("companies")
      .select("id, name")
      .order("name")

    if (requestedCompanyId) {
      if (!context.isPlatformAdmin && requestedCompanyId !== context.companyId) {
        return NextResponse.json(
          { error: "Acesso negado para a empresa solicitada" },
          { status: 403 }
        )
      }

      companiesQuery.eq("id", requestedCompanyId)
    } else if (!context.isPlatformAdmin) {
      companiesQuery.eq("id", context.companyId)
    }

    const { data: companyRows, error: companiesError } = await companiesQuery

    if (companiesError) {
      throw new Error(companiesError.message)
    }

    const companyList = (companyRows ?? []) as CompanyRecord[]
    if (companyList.length === 0) {
      return NextResponse.json({
        recentLogs: [],
        nextDispatches: [],
        scheduleDispatchSummary: null,
        companyCount: 0,
        companies: [],
      } satisfies AdminOperationalSummaryResponse)
    }

    const companyIds = companyList.map((company) => company.id)
    const companyNameMap = new Map(
      companyList.map((company) => [company.id, company.name ?? "Empresa sem nome"])
    )
    const now = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? new Date(`${dateParam}T12:00:00-03:00`)
      : new Date()
    const todayStart = getBrazilDayStart(now)
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

    const [
      generalSettingsResult,
      schedulesResult,
      summaryLogsResult,
      reportsResult,
    ] = await Promise.all([
      supabase
        .from("company_settings")
        .select("company_id, value")
        .in("company_id", companyIds)
        .eq("key", "general"),
      supabase
        .from("schedules")
        .select(
          "id, company_id, name, report_id, report_configs, pbi_page_name, pbi_page_names, cron_expression, export_format, is_active, last_run_at, schedule_contacts!inner(contact_id)"
        )
        .in("company_id", companyIds)
        .eq("is_active", true),
      supabase
        .from("dispatch_logs")
        .select(
          "company_id, schedule_id, status, error_message, created_at, started_at, completed_at"
        )
        .in("company_id", companyIds)
        .gte("created_at", todayStart.toISOString())
        .order("created_at", { ascending: false })
        .limit(500),
      panelMode
        ? Promise.resolve({ data: [] as Array<{ id: string; name: string | null }>, error: null })
        : supabase
            .from("reports")
            .select("id, name")
            .in("company_id", companyIds),
    ])

    const queryError =
      generalSettingsResult.error ??
      schedulesResult.error ??
      summaryLogsResult.error

    const reportsError = reportsResult.error

    if (queryError ?? reportsError) {
      throw new Error((queryError ?? reportsError)?.message)
    }

    const reportNames = new Map<string, string>(
      (reportsResult.data ?? []).map((report) => [report.id, report.name ?? "Desconhecido"])
    )
    const automationNames = panelMode
      ? new Map<string, string>()
      : await getAutomationNames(supabase, companyIds)
    const companyTimeZoneMap = new Map<string, string>()

    for (const item of companyList) {
      companyTimeZoneMap.set(item.id, DEFAULT_TIME_ZONE)
    }

    for (const setting of generalSettingsResult.data ?? []) {
      if (!setting.company_id) {
        continue
      }

      companyTimeZoneMap.set(setting.company_id, getConfiguredTimeZone(setting.value))
    }

    const schedules = ((schedulesResult.data ?? []) as Array<
      Omit<ActiveScheduleAdminRecord, "company_name" | "time_zone">
    >).map((schedule) => ({
      ...schedule,
      company_name: companyNameMap.get(schedule.company_id) ?? "Empresa sem nome",
      time_zone: companyTimeZoneMap.get(schedule.company_id) ?? DEFAULT_TIME_ZONE,
    }))

    const scheduleDispatchSummary = panelMode ? null : buildScheduleDispatchSummary(
      schedules,
      (summaryLogsResult.data ?? []) as DispatchLogSummaryRecord[],
      todayStart,
      tomorrowStart
    )

    const nextDispatchCandidates = panelMode
      ? []
      : schedules
          .flatMap((schedule) => {
            const cronExpression = schedule.cron_expression?.trim()
            if (!cronExpression) {
              return []
            }

            const nextRun = getNextCronOccurrence(cronExpression, now, schedule.time_zone)
            if (!nextRun) {
              return []
            }

            return [
              {
                companyId: schedule.company_id,
                id: schedule.id,
                companyName: schedule.company_name,
                scheduleName: schedule.name,
                reportName: getScheduleReportLabel(schedule, reportNames, automationNames),
                exportFormat: schedule.export_format ?? "-",
                recurrence: describeCronValue(cronExpression).join(" / ") || cronExpression,
                nextRunAt: nextRun.toISOString(),
                nextRunLabel: formatNextRunLabel(nextRun, schedule.time_zone),
              },
            ]
          })
          .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt))
    const nextDispatches: AdminUpcomingDispatchItem[] = nextDispatchCandidates
      .slice(0, NEXT_DISPATCH_LIMIT)
      .map(({ companyId: _companyId, ...item }) => item)

    const recentLogsPool = await fetchRecentLogsForScope({
      supabase,
      companyId: requestedCompanyId || undefined,
      companyIds: requestedCompanyId ? undefined : companyIds,
      limit: Math.min(
        Math.max(companyList.length * RECENT_LOG_LIMIT_PER_COMPANY, RECENT_LOG_LIMIT),
        RECENT_LOG_TOTAL_CAP
      ),
      companyNameMap,
      dayStart: todayStart,
      dayEnd: tomorrowStart,
    })
    const recentLogs = panelMode ? [] : recentLogsPool.slice(0, RECENT_LOG_LIMIT)
    const companySummaries = companyList.map((company) => {
      const companySchedules = schedules.filter(
        (schedule) => schedule.company_id === company.id
      )
      const companyLogs = ((summaryLogsResult.data ?? []) as DispatchLogSummaryRecord[]).filter(
        (log) => log.company_id === company.id
      )
      const companyNextDispatches = nextDispatchCandidates
        .filter((item) => item.companyId === company.id)
        .slice(0, NEXT_DISPATCH_LIMIT)
        .map(({ companyId: _companyId, ...item }) => item)

      return {
        companyId: company.id,
        companyName: companyNameMap.get(company.id) ?? "Empresa sem nome",
        recentLogs: groupRecentLogsByCompany(
          recentLogsPool,
          company.id,
          RECENT_LOG_LIMIT_PER_COMPANY
        ),
        nextDispatches: companyNextDispatches,
        scheduleDispatchSummary: buildScheduleDispatchSummary(
          companySchedules,
          companyLogs,
          todayStart,
          tomorrowStart
        ),
      } satisfies AdminOperationalCompanySummary
    })

    return NextResponse.json({
      recentLogs,
      nextDispatches: panelMode ? [] : nextDispatches,
      scheduleDispatchSummary: panelMode ? null : scheduleDispatchSummary,
      companyCount: companyList.length,
      companies: companySummaries,
    } satisfies AdminOperationalSummaryResponse)
  } catch (error) {
    if (isAuthContextError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Nao autenticado" },
        { status: 401 }
      )
    }

    console.error("GET /api/admin/operational-summary error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao buscar resumo operacional" },
      { status: 500 }
    )
  }
}
