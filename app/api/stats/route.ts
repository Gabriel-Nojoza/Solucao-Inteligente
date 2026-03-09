import { NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"

export async function GET() {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const [reportsRes, contactsRes, todayLogsRes, monthLogsRes, weekLogs, settingsRes] =
      await Promise.all([
        supabase
          .from("reports")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId),
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("is_active", true),
        supabase
          .from("dispatch_logs")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .gte("created_at", todayStart.toISOString()),
        supabase
          .from("dispatch_logs")
          .select("status")
          .eq("company_id", companyId)
          .gte("created_at", thirtyDaysAgo.toISOString()),
        supabase
          .from("dispatch_logs")
          .select("status, created_at")
          .eq("company_id", companyId)
          .gte("created_at", sevenDaysAgo.toISOString()),
        supabase
          .from("company_settings")
          .select("key, value")
          .eq("company_id", companyId)
          .in("key", ["powerbi", "n8n"]),
      ])

    const totalReports = reportsRes.count ?? 0
    const activeContacts = contactsRes.count ?? 0
    const dispatchesToday = todayLogsRes.count ?? 0

    const monthLogs = monthLogsRes.data ?? []
    const deliveredCount = monthLogs.filter(
      (l) => l.status === "delivered"
    ).length
    const successRate =
      monthLogs.length > 0
        ? Math.round((deliveredCount / monthLogs.length) * 100)
        : 100

    // Configuration status
    const settingsMap = new Map(
      (settingsRes.data ?? []).map((s) => [s.key, s.value])
    )
    const powerbi = settingsMap.get("powerbi") as Record<string, unknown> | undefined
    const n8n = settingsMap.get("n8n") as Record<string, unknown> | undefined
    const pbiConfigured = !!(powerbi?.client_id || process.env.PBI_CLIENT_ID)
    const n8nConfigured = !!(n8n?.webhook_url || process.env.N8N_WEBHOOK_URL)

    // Chart data: last 7 days
    const chartData = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dayStr = d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      })
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)

      const dayItems = (weekLogs.data ?? []).filter((l) => {
        const c = new Date(l.created_at)
        return c >= dayStart && c < dayEnd
      })

      chartData.push({
        date: dayStr,
        delivered: dayItems.filter((l) => l.status === "delivered").length,
        failed: dayItems.filter((l) => l.status === "failed").length,
      })
    }

    return NextResponse.json({
      totalReports,
      activeContacts,
      dispatchesToday,
      successRate,
      pbiConfigured,
      n8nConfigured,
      chartData,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro" },
      { status: 500 }
    )
  }
}
