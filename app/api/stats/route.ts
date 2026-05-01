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
import { describeCronValue, getNextCronOccurrence } from "@/lib/schedule-cron"
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

function formatNextRunLabel(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(date)
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

function getBrazilDayStart(date: Date): Date {
  const brazilTime = new Date(date.getTime() - BRAZIL_OFFSET_MS)
  const midnight = new Date(Date.UTC(
    brazilTime.getUTCFullYear(),
    brazilTime.getUTCMonth(),
    brazilTime.getUTCDate()
  ))
  return new Date(midnight.getTime() + BRAZIL_OFFSET_MS)
}

export async function GET() {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const workspaceScope = await getWorkspaceAccessScope(supabase, context)

    const now = new Date()
    const todayStart = getBrazilDayStart(now)
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

    const chartStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)

    // Inicio do mes atual no fuso Brasil (UTC-3)
    const brazilNow = new Date(now.getTime() - BRAZIL_OFFSET_MS)
    const startOfMonthUTC = new Date(Date.UTC(brazilNow.getUTCFullYear(), brazilNow.getUTCMonth(), 1))
    const thirtyDaysAgo = new Date(startOfMonthUTC.getTime() + BRAZIL_OFFSET_MS)
    const hasRestrictedScope =
      workspaceScope.workspaceRestricted || workspaceScope.datasetRestricted

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
    const dispatchLogsQuery = supabase
      .from("dispatch_logs")
      .select("*")
      .eq("company_id", companyId)
      .gte("created_at", thirtyDaysAgo.toISOString())
    const schedulesQuery = supabase
      .from("schedules")
      .select("id, name, report_id, report_configs, pbi_page_name, pbi_page_names, cron_expression, export_format, is_active, last_run_at")
      .eq("company_id", companyId)
      .eq("is_active", true)

    const [reportsRes, contactsRes, dispatchLogsRes, settingsRes, botInstancesRes, schedulesRes] =
      await Promise.all([
        reportsQuery,
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("is_active", true),
        dispatchLogsQuery,
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
      dispatchLogsRes.error ??
      settingsRes.error ??
      schedulesRes.error

    if (queryError) {
      throw new Error(queryError.message)
    }

    const botInstances = Array.isArray(botInstancesRes) ? botInstancesRes : null
    const botState = botInstances ? null : await readWhatsAppBotRuntimeState()
    const connectedWhatsAppInstances = botInstances
      ? botInstances.filter((instance) => instance.status === "connected").length
      : botState?.status === "connected"
        ? 1
        : 0
    const totalWhatsAppInstances = botInstances?.length ?? (botState ? 1 : 0)
    const whatsappConnected = connectedWhatsAppInstances > 0

    const totalReports = reportsRes.count ?? 0
    const activeContacts = contactsRes.count ?? 0

    let dispatchLogs = (dispatchLogsRes.data ?? []) as DispatchLogStatsRecord[]
    const activeSchedules = (schedulesRes.data ?? []) as ActiveScheduleStatsRecord[]
    const accessMaps =
      activeSchedules.length > 0
        ? await getScheduleAccessMaps(supabase, companyId, workspaceScope)
        : {
            visibleTargetIds: new Set<string>(),
            reportNames: new Map<string, string>(),
            automationNames: new Map<string, string>(),
          }
    const visibleSchedules = activeSchedules.filter((schedule) =>
      isScheduleAccessible(schedule, accessMaps)
    )

    if (hasRestrictedScope) {
      const currentScheduleIds = await getCompanyScheduleIdSet(supabase, companyId)
      const accessibleScheduleIdSet = new Set(visibleSchedules.map((schedule) => schedule.id))
      dispatchLogs = dispatchLogs.filter((log) =>
        canAccessDispatchLog(log.schedule_id, accessibleScheduleIdSet, currentScheduleIds)
      )
    }

    const logsWithDates = dispatchLogs.flatMap((log) => {
      const effectiveDate = getDispatchLogEffectiveDate(log)
      if (!effectiveDate) {
        return []
      }

      return [
        {
          effectiveDate,
          outcome: getDispatchLogOutcome(log),
        },
      ]
    })

    const dispatchesToday = logsWithDates.filter(
      (log) => log.effectiveDate >= todayStart && log.effectiveDate < tomorrowStart
    ).length

    const monthLogs = logsWithDates.filter((log) => log.effectiveDate >= thirtyDaysAgo)
    const monthOutcomeCounts = countDispatchLogOutcomes(monthLogs)
    const deliveredCount = monthOutcomeCounts.delivered
    const failedCount = monthOutcomeCounts.failed
    const ongoingCount = monthOutcomeCounts.ongoing
    const completedMonthLogs = monthLogs.filter((log) => log.outcome !== "ongoing")
    const successRate =
      completedMonthLogs.length > 0
        ? Math.round((deliveredCount / completedMonthLogs.length) * 100)
        : null

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

    // Chart data: last 7 days (boundaries in Brazil timezone UTC-3)
    const chartData = []
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(chartStart.getTime() + i * 24 * 60 * 60 * 1000)
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
      const brazilDay = new Date(dayStart.getTime() - BRAZIL_OFFSET_MS)
      const dayStr = `${String(brazilDay.getUTCDate()).padStart(2, "0")}/${String(brazilDay.getUTCMonth() + 1).padStart(2, "0")}`

      const dayItems = logsWithDates.filter((log) => {
        return log.effectiveDate >= dayStart && log.effectiveDate < dayEnd
      })

      chartData.push({
        date: dayStr,
        delivered: dayItems.filter((log) => log.outcome === "delivered").length,
        failed: dayItems.filter((log) => log.outcome === "failed").length,
      })
    }

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
      connectedWhatsAppInstances,
      totalWhatsAppInstances,
      dispatchesToday,
      successRate,
      completed30d: completedMonthLogs.length,
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
      nextDispatches,
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
