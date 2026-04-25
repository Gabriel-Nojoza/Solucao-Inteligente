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
  reportLimit: number | null
  reportLimitPercent: number | null
  chatEnabled: boolean
  chatTrialDays: number | null
  chatTrialEndsAt: string | null
  chatTrialExpired: boolean
  chatLimit: number | null
  chatUsageThisMonth: number
  chatLimitPercent: number | null
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

export async function GET() {
  try {
    const context = await requireAdminContext()
    const supabase = getAdminClient()

    const now = new Date()

    // Inicio do mes atual (UTC-3)
    const startOfMonth = new Date(now)
    startOfMonth.setHours(startOfMonth.getHours() - 3)
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    startOfMonth.setHours(startOfMonth.getHours() + 3)

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

    // Busca logs dos ultimos 30 dias
    const { data: logs } = await supabase
      .from("dispatch_logs")
      .select("company_id, status, completed_at, created_at")
      .in("company_id", companyIds)
      .gte("created_at", since30d.toISOString())

    // Busca perguntas do chat este mes
    const { data: chatLogsThisMonth } = await supabase
      .from("chat_logs")
      .select("company_id")
      .in("company_id", companyIds)
      .gte("created_at", startOfMonth.toISOString())

    const chatUsageMap = new Map<string, number>()
    for (const row of chatLogsThisMonth ?? []) {
      if (!row.company_id) continue
      chatUsageMap.set(row.company_id, (chatUsageMap.get(row.company_id) ?? 0) + 1)
    }

    // Busca configuracoes: chat_ia + usage_limits
    const { data: settingsRows } = await supabase
      .from("company_settings")
      .select("company_id, key, value")
      .in("company_id", companyIds)
      .in("key", ["chat_ia", "usage_limits"])

    const chatMap = new Map<string, Record<string, unknown>>()
    const limitsMap = new Map<string, Record<string, unknown>>()

    for (const row of settingsRows ?? []) {
      if (!row.company_id || !row.value) continue
      if (row.key === "chat_ia") chatMap.set(row.company_id, row.value as Record<string, unknown>)
      if (row.key === "usage_limits") limitsMap.set(row.company_id, row.value as Record<string, unknown>)
    }

    // Monta stats por empresa
    const companyStats: CompanyStatItem[] = companies.map((company) => {
      const companyLogs = (logs ?? []).filter((l) => l.company_id === company.id)

      const logsThisMonth = companyLogs.filter(
        (l) => l.created_at && new Date(l.created_at) >= startOfMonth
      )

      const delivered = companyLogs.filter((l) => l.status === "delivered").length
      const failed = companyLogs.filter(
        (l) => l.status === "failed" || (l.completed_at && l.status !== "delivered")
      ).length
      const completed = delivered + failed
      const successRate = completed > 0 ? Math.round((delivered / completed) * 100) : 0

      const chat = chatMap.get(company.id)
      const limits = limitsMap.get(company.id)

      const reportLimit = typeof limits?.report_limit === "number" ? limits.report_limit : null
      const chatLimit = typeof limits?.chat_limit === "number" ? limits.chat_limit : null

      const dispatchesThisMonth = logsThisMonth.length
      const reportLimitPercent =
        reportLimit !== null && reportLimit > 0
          ? Math.min(Math.round((dispatchesThisMonth / reportLimit) * 100), 100)
          : null

      const chatUsageThisMonth = chatUsageMap.get(company.id) ?? 0
      const chatLimitPercent =
        chatLimit !== null && chatLimit > 0
          ? Math.min(Math.round((chatUsageThisMonth / chatLimit) * 100), 100)
          : null

      return {
        companyId: company.id,
        companyName: company.name ?? "Empresa sem nome",
        totalDispatches: companyLogs.length,
        dispatches30d: companyLogs.length,
        dispatchesThisMonth,
        deliveredDispatches: delivered,
        failedDispatches: failed,
        successRate,
        reportLimit,
        reportLimitPercent,
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
      }
    })

    // Monta grafico diario (ultimos 30 dias, todos as empresas somados)
    const dailyMap = new Map<string, { total: number; delivered: number; failed: number }>()

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      dailyMap.set(key, { total: 0, delivered: 0, failed: 0 })
    }

    for (const log of logs ?? []) {
      if (!log.created_at) continue
      const key = new Date(log.created_at).toISOString().slice(0, 10)
      const entry = dailyMap.get(key)
      if (!entry) continue
      entry.total++
      if (log.status === "delivered") entry.delivered++
      else if (log.status === "failed") entry.failed++
    }

    const dailyChart: DailyDispatchPoint[] = Array.from(dailyMap.entries()).map(([date, v]) => ({
      date: new Date(date + "T12:00:00Z").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      total: v.total,
      delivered: v.delivered,
      failed: v.failed,
    }))

    return NextResponse.json({ companies: companyStats, dailyChart } satisfies CompanyStatsResponse)
  } catch (error) {
    console.error("Erro ao buscar stats por empresa:", error)
    return NextResponse.json(
      { error: "Erro ao buscar estatisticas por empresa" },
      { status: 500 }
    )
  }
}
