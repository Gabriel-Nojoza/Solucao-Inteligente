import { NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"
import { readWhatsAppBotRuntimeState } from "@/lib/whatsapp-bot"

type DispatchLogRecord = {
  status?: string | null
  created_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}

function getLogTimestamp(log: DispatchLogRecord) {
  const candidates = [log.created_at, log.started_at, log.completed_at]

  for (const value of candidates) {
    if (!value) {
      continue
    }

    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return null
}

function summarizeDispatchLogs(logs: DispatchLogRecord[]) {
  return logs.reduce(
    (summary, log) => {
      const status = typeof log.status === "string" ? log.status.trim() : ""

      if (status === "delivered") {
        summary.delivered += 1
      } else if (status === "failed") {
        summary.failed += 1
      } else if (status) {
        summary.inProgress += 1
      }

      summary.total += 1
      return summary
    },
    { total: 0, delivered: 0, failed: 0, inProgress: 0 }
  )
}

async function loadRecentDispatchLogs(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  sinceIso: string
) {
  const timestampColumns = ["created_at", "started_at", "completed_at"] as const

  for (const column of timestampColumns) {
    const { data, error } = await supabase
      .from("dispatch_logs")
      .select("*")
      .eq("company_id", companyId)
      .gte(column, sinceIso)

    if (!error) {
      return (data ?? []) as DispatchLogRecord[]
    }

    if (error.code !== "42703") {
      throw error
    }
  }

  return [] as DispatchLogRecord[]
}

export async function GET() {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const botState = await readWhatsAppBotRuntimeState()
    const whatsappConnected = botState?.status === "connected"

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const [reportsRes, contactsRes, monthLogs, settingsRes] = await Promise.all([
      supabase
        .from("reports")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("is_active", true),
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("is_active", true),
      loadRecentDispatchLogs(supabase, companyId, thirtyDaysAgo.toISOString()),
      supabase
        .from("company_settings")
        .select("key, value")
        .eq("company_id", companyId)
        .in("key", ["powerbi", "n8n"]),
    ])

    const totalReports = reportsRes.count ?? 0
    const activeContacts = contactsRes.count ?? 0
    const todayLogs = monthLogs.filter((log) => {
      const timestamp = getLogTimestamp(log)
      return timestamp ? timestamp >= todayStart : false
    })
    const weekLogs = monthLogs.filter((log) => {
      const timestamp = getLogTimestamp(log)
      return timestamp ? timestamp >= sevenDaysAgo : false
    })

    const todaySummary = summarizeDispatchLogs(todayLogs)
    const monthSummary = summarizeDispatchLogs(monthLogs)
    const completedDispatches30d = monthSummary.delivered + monthSummary.failed
    const successRate =
      completedDispatches30d > 0
        ? Math.round((monthSummary.delivered / completedDispatches30d) * 100)
        : null

    const settingsMap = new Map((settingsRes.data ?? []).map((setting) => [setting.key, setting.value]))
    const powerbi = settingsMap.get("powerbi") as Record<string, unknown> | undefined
    const n8n = settingsMap.get("n8n") as Record<string, unknown> | undefined

    const pbiConfigured = !!(powerbi?.client_id || process.env.PBI_CLIENT_ID)
    const n8nConfigured = !!(
      typeof n8n?.webhook_url === "string" &&
      n8n.webhook_url.trim() &&
      typeof n8n?.callback_secret === "string" &&
      n8n.callback_secret.trim()
    )

    const chartData = []
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date()
      day.setDate(day.getDate() - i)
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate())
      const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
      const dayItems = weekLogs.filter((log) => {
        const timestamp = getLogTimestamp(log)
        return timestamp ? timestamp >= dayStart && timestamp < dayEnd : false
      })
      const daySummary = summarizeDispatchLogs(dayItems)

      chartData.push({
        date: day.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        }),
        total: daySummary.total,
        delivered: daySummary.delivered,
        failed: daySummary.failed,
        inProgress: daySummary.inProgress,
      })
    }

    return NextResponse.json({
      totalReports,
      activeContacts,
      whatsappConnected,
      whatsappStatus: botState?.status ?? "offline",
      whatsappPhoneNumber: botState?.phone_number ?? null,
      whatsappDisplayName: botState?.display_name ?? null,
      dispatchesToday: todaySummary.total,
      deliveredToday: todaySummary.delivered,
      failedToday: todaySummary.failed,
      inProgressToday: todaySummary.inProgress,
      successRate,
      completedDispatches30d,
      deliveredDispatches30d: monthSummary.delivered,
      failedDispatches30d: monthSummary.failed,
      pbiConfigured,
      n8nConfigured,
      chartData,
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
