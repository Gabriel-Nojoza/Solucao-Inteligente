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
  deliveredDispatches: number
  failedDispatches: number
  successRate: number
  chatEnabled: boolean
  chatTrialDays: number | null
  chatTrialEndsAt: string | null
  chatTrialExpired: boolean
}

export async function GET() {
  try {
    const context = await requireAdminContext()
    const supabase = getAdminClient()

    const since30d = new Date()
    since30d.setDate(since30d.getDate() - 30)
    const since30dIso = since30d.toISOString()

    // Busca empresas conforme escopo do admin
    const companiesQuery = supabase.from("companies").select("id, name").order("name")
    if (!context.isPlatformAdmin) {
      companiesQuery.eq("id", context.companyId)
    }
    const { data: companies, error: companiesError } = await companiesQuery
    if (companiesError) throw companiesError

    if (!companies || companies.length === 0) {
      return NextResponse.json([])
    }

    const companyIds = companies.map((c) => c.id)

    // Busca todos os dispatch_logs das empresas de uma vez
    const { data: logs } = await supabase
      .from("dispatch_logs")
      .select("company_id, status, completed_at, created_at")
      .in("company_id", companyIds)

    // Busca configuracoes de chat_ia das empresas
    const { data: chatSettings } = await supabase
      .from("company_settings")
      .select("company_id, value")
      .in("company_id", companyIds)
      .eq("key", "chat_ia")

    const chatMap = new Map<string, Record<string, unknown>>()
    for (const row of chatSettings ?? []) {
      if (row.company_id && row.value) {
        chatMap.set(row.company_id, row.value as Record<string, unknown>)
      }
    }

    const now = new Date()

    const result: CompanyStatItem[] = companies.map((company) => {
      const companyLogs = (logs ?? []).filter((l) => l.company_id === company.id)
      const logs30d = companyLogs.filter(
        (l) => l.created_at && new Date(l.created_at) >= since30d
      )

      const delivered = logs30d.filter((l) => l.status === "delivered").length
      const failed = logs30d.filter(
        (l) => l.status === "failed" || (l.completed_at && l.status !== "delivered")
      ).length
      const completed = delivered + failed
      const successRate = completed > 0 ? Math.round((delivered / completed) * 100) : 0

      const chat = chatMap.get(company.id)
      const chatEnabled = chat?.enabled === true
      const chatTrialDays =
        typeof chat?.trial_days === "number" ? chat.trial_days : null
      const chatTrialEndsAt =
        typeof chat?.trial_ends_at === "string" ? chat.trial_ends_at : null
      const chatTrialExpired = chatTrialEndsAt ? new Date(chatTrialEndsAt) < now : false

      return {
        companyId: company.id,
        companyName: company.name ?? "Empresa sem nome",
        totalDispatches: companyLogs.length,
        dispatches30d: logs30d.length,
        deliveredDispatches: delivered,
        failedDispatches: failed,
        successRate,
        chatEnabled,
        chatTrialDays,
        chatTrialEndsAt,
        chatTrialExpired,
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao buscar stats por empresa:", error)
    return NextResponse.json(
      { error: "Erro ao buscar estatisticas por empresa" },
      { status: 500 }
    )
  }
}
