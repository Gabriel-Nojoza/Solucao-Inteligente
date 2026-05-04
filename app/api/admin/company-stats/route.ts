import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminContext } from "@/lib/tenant"

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export type CompanyStatItem = {
  companyId: string
  companyName: string
  totalDispatches: number
  dispatches30d: number
  dispatchesThisMonth: number
  deliveredDispatches: number
  failedDispatches: number
  successRate: number
  deliveredThisMonth: number
  failedThisMonth: number
  reportLimit: number | null
  reportLimitPercent: number | null
  reportExcessPrice: number | null
  reportOverage: number
  reportOverageCharge: number | null
  chatEnabled: boolean
  chatTrialDays: number | null
  chatTrialEndsAt: string | null
  chatTrialExpired: boolean
  chatLimit: number | null
  chatUsageThisMonth: number
  chatLimitPercent: number | null
  chatExcessPrice: number | null
  chatOverage: number
  chatOverageCharge: number | null
}

export type DailyDispatchPoint = {
  date: string
  total: number
  delivered: number
  failed: number
}

export type CompanyStatsResponse = {
  companies: CompanyStatItem[]
  dailyChart: DailyDispatchPoint[]
}

type CompanyLogMetric = {
  totalDispatches: number
  dispatchesThisMonth: number
  deliveredDispatches: number
  failedDispatches: number
  deliveredThisMonth: number
  failedThisMonth: number
}

function createEmptyMetric(): CompanyLogMetric {
  return {
    totalDispatches: 0,
    dispatchesThisMonth: 0,
    deliveredDispatches: 0,
    failedDispatches: 0,
    deliveredThisMonth: 0,
    failedThisMonth: 0,
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const lite = searchParams.get("lite") === "1"
    const context = await requireAdminContext()
    const supabase = getAdminClient()

    const now = new Date()

    // Inicio do mes atual no horario de Brasilia (UTC-3)
    const nowBr = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
    const startOfMonth = new Date(Date.UTC(nowBr.getFullYear(), nowBr.getMonth(), 1, 3, 0, 0, 0))

    // Ultimos 30 dias
    const since30d = new Date(now)
    since30d.setDate(since30d.getDate() - 30)

    // Busca empresas
    const companiesQuery = supabase.from("companies").select("id, name").order("name")
    if (!context.isPlatformAdmin) {
      companiesQuery.eq("id", context.companyId)
    }
    const { data: companies, error: companiesError } = await companiesQuery
    if (companiesError) throw companiesError
    if (!companies || companies.length === 0) {
      return NextResponse.json({ companies: [], dailyChart: [] } satisfies CompanyStatsResponse)
    }

    const companyIds = companies.map((c) => c.id)

    // Busca contagens agregadas por empresa e status (evita trazer todas as linhas)
    const [logsThisMonthResult, logsAllResult, dailyResult] = await Promise.all([
      supabase
        .from("dispatch_logs")
        .select("company_id, status, completed_at")
        .in("company_id", companyIds)
        .gte("created_at", startOfMonth.toISOString()),
      supabase
        .from("dispatch_logs")
        .select("company_id, status, completed_at")
        .in("company_id", companyIds)
        .gte("created_at", since30d.toISOString()),
      lite
        ? Promise.resolve({ data: null })
        : supabase
            .from("dispatch_logs")
            .select("company_id, status, created_at")
            .in("company_id", companyIds)
            .gte("created_at", since30d.toISOString()),
    ])

    const companyMetrics = new Map<string, CompanyLogMetric>()
    for (const companyId of companyIds) {
      companyMetrics.set(companyId, createEmptyMetric())
    }

    for (const log of logsAllResult.data ?? []) {
      if (!log.company_id) continue
      const metrics = companyMetrics.get(log.company_id) ?? createEmptyMetric()
      companyMetrics.set(log.company_id, metrics)
      metrics.totalDispatches += 1
      const isDelivered = log.status === "delivered"
      const isFailed = log.status === "failed" || Boolean(log.completed_at && log.status !== "delivered")
      if (isDelivered) metrics.deliveredDispatches += 1
      else if (isFailed) metrics.failedDispatches += 1
    }

    for (const log of logsThisMonthResult.data ?? []) {
      if (!log.company_id) continue
      const metrics = companyMetrics.get(log.company_id) ?? createEmptyMetric()
      companyMetrics.set(log.company_id, metrics)
      metrics.dispatchesThisMonth += 1
      const isDelivered = log.status === "delivered"
      const isFailed = log.status === "failed" || Boolean(log.completed_at && log.status !== "delivered")
      if (isDelivered) metrics.deliveredThisMonth += 1
      else if (isFailed) metrics.failedThisMonth += 1
    }

    const dailyMap = lite
      ? null
      : new Map<string, { total: number; delivered: number; failed: number }>()

    if (dailyMap) {
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now)
        d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        dailyMap.set(key, { total: 0, delivered: 0, failed: 0 })
      }
      for (const log of (dailyResult.data ?? []) as Array<{ company_id: string; status: string; created_at: string }>) {
        if (!log.created_at) continue
        const key = new Date(log.created_at).toISOString().slice(0, 10)
        const entry = dailyMap.get(key)
        if (!entry) continue
        entry.total += 1
        if (log.status === "delivered") entry.delivered += 1
        else if (log.status === "failed") entry.failed += 1
      }
    }

    const chatUsageMap = new Map<string, number>()
    const chatMap = new Map<string, Record<string, unknown>>()
    const limitsMap = new Map<string, Record<string, unknown>>()

    if (!lite) {
      const [chatLogsResult, settingsResult] = await Promise.all([
        supabase
          .from("chat_logs")
          .select("company_id")
          .in("company_id", companyIds)
          .gte("created_at", startOfMonth.toISOString()),
        supabase
          .from("company_settings")
          .select("company_id, key, value")
          .in("company_id", companyIds)
          .in("key", ["chat_ia", "usage_limits"]),
      ])

      for (const row of chatLogsResult.data ?? []) {
        if (!row.company_id) continue
        chatUsageMap.set(row.company_id, (chatUsageMap.get(row.company_id) ?? 0) + 1)
      }

      for (const row of settingsResult.data ?? []) {
        if (!row.company_id || !row.value) continue
        if (row.key === "chat_ia") chatMap.set(row.company_id, row.value as Record<string, unknown>)
        if (row.key === "usage_limits") limitsMap.set(row.company_id, row.value as Record<string, unknown>)
      }
    }

    const companyStats: CompanyStatItem[] = companies.map((company) => {
      const metrics = companyMetrics.get(company.id) ?? createEmptyMetric()
      const delivered = metrics.deliveredDispatches
      const failed = metrics.failedDispatches
      const completed = delivered + failed
      const successRate = completed > 0 ? Math.round((delivered / completed) * 100) : 0

      const chat = chatMap.get(company.id)
      const limits = limitsMap.get(company.id)

      const reportLimit = typeof limits?.report_limit === "number" ? limits.report_limit : null
      const chatLimit = typeof limits?.chat_limit === "number" ? limits.chat_limit : null
      const reportExcessPrice = typeof limits?.report_excess_price === "number" ? limits.report_excess_price : null
      const chatExcessPrice = typeof limits?.chat_excess_price === "number" ? limits.chat_excess_price : null

      const dispatchesThisMonth = metrics.dispatchesThisMonth
      const reportLimitPercent =
        reportLimit !== null && reportLimit > 0
          ? Math.min(Math.round((dispatchesThisMonth / reportLimit) * 100), 100)
          : null
      const reportOverage = reportLimit !== null ? Math.max(0, dispatchesThisMonth - reportLimit) : 0
      const reportOverageCharge =
        reportOverage > 0 && reportExcessPrice !== null
          ? Math.round(reportOverage * reportExcessPrice * 100) / 100
          : null

      const chatUsageThisMonth = chatUsageMap.get(company.id) ?? 0
      const chatLimitPercent =
        chatLimit !== null && chatLimit > 0
          ? Math.min(Math.round((chatUsageThisMonth / chatLimit) * 100), 100)
          : null
      const chatOverage = chatLimit !== null ? Math.max(0, chatUsageThisMonth - chatLimit) : 0
      const chatOverageCharge =
        chatOverage > 0 && chatExcessPrice !== null
          ? Math.round(chatOverage * chatExcessPrice * 100) / 100
          : null

      return {
        companyId: company.id,
        companyName: company.name ?? "Empresa sem nome",
        totalDispatches: metrics.totalDispatches,
        dispatches30d: metrics.totalDispatches,
        dispatchesThisMonth,
        deliveredThisMonth: metrics.deliveredThisMonth,
        failedThisMonth: metrics.failedThisMonth,
        deliveredDispatches: delivered,
        failedDispatches: failed,
        successRate,
        reportLimit,
        reportLimitPercent,
        reportExcessPrice,
        reportOverage,
        reportOverageCharge,
        chatEnabled: chat?.enabled === true,
        chatTrialDays: typeof chat?.trial_days === "number" ? chat.trial_days : null,
        chatTrialEndsAt: typeof chat?.trial_ends_at === "string" ? chat.trial_ends_at : null,
        chatTrialExpired:
          typeof chat?.trial_ends_at === "string"
            ? new Date(chat.trial_ends_at) < now
            : false,
        chatLimit,
        chatUsageThisMonth,
        chatLimitPercent,
        chatExcessPrice,
        chatOverage,
        chatOverageCharge,
      }
    })

    const dailyChart: DailyDispatchPoint[] = dailyMap
      ? Array.from(dailyMap.entries()).map(([date, v]) => ({
          date: new Date(date + "T12:00:00Z").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
          total: v.total,
          delivered: v.delivered,
          failed: v.failed,
        }))
      : []

    return NextResponse.json({ companies: companyStats, dailyChart } satisfies CompanyStatsResponse)
  } catch (error) {
    console.error("Erro ao buscar stats por empresa:", error)
    return NextResponse.json(
      { error: "Erro ao buscar estatisticas por empresa" },
      { status: 500 }
    )
  }
}
