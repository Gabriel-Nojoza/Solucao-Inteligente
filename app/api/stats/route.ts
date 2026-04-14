import { NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"
import { getAccessibleScheduleIds } from "@/lib/schedule-access"
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

type DispatchLogStatsRecord = {
  status?: string | null
  error_message?: string | null
  created_at?: string | null
  started_at?: string | null
  completed_at?: string | null
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

    const thirtyDaysAgo = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000)
    const hasRestrictedScope =
      workspaceScope.workspaceRestricted || workspaceScope.datasetRestricted
    const accessibleScheduleIds = hasRestrictedScope
      ? await getAccessibleScheduleIds(supabase, companyId, workspaceScope)
      : []

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
    const dispatchLogsQuery =
      hasRestrictedScope && accessibleScheduleIds.length === 0
        ? Promise.resolve({ data: [], error: null } as const)
        : (() => {
            let query = supabase
              .from("dispatch_logs")
              .select("*")
              .eq("company_id", companyId)

            if (hasRestrictedScope) {
              query = query.in("schedule_id", accessibleScheduleIds)
            }

            return query
          })()

    const [reportsRes, contactsRes, dispatchLogsRes, settingsRes, botInstancesRes] =
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
          .in("key", ["powerbi", "n8n"]),
        listCompanyWhatsAppBotInstances(supabase, companyId).catch((error) => {
          if (isMissingWhatsAppBotInstancesTableError(error)) {
            return null
          }

          throw error
        }),
      ])

    const queryError =
      reportsRes.error ?? contactsRes.error ?? dispatchLogsRes.error ?? settingsRes.error

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

    const dispatchLogs = (dispatchLogsRes.data ?? []) as DispatchLogStatsRecord[]
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
