import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"

export async function GET(request: NextRequest) {
  try {
    const platformSecret = process.env.PLATFORM_SCHEDULER_SECRET?.trim()
    if (!platformSecret) {
      return NextResponse.json({ error: "Endpoint nao configurado" }, { status: 503 })
    }

    const { searchParams } = new URL(request.url)
    const headerSecret = request.headers.get("x-callback-secret")?.trim()
    const querySecret = searchParams.get("secret")?.trim()
    const incomingSecret = headerSecret || querySecret || ""

    if (incomingSecret !== platformSecret) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 })
    }

    const dateParam = searchParams.get("date")?.trim()
    const now = new Date()

    let startOf: Date
    let endOf: Date

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      startOf = new Date(`${dateParam}T00:00:00.000Z`)
      endOf = new Date(`${dateParam}T23:59:59.999Z`)
    } else {
      startOf = new Date(now)
      startOf.setUTCHours(0, 0, 0, 0)
      endOf = new Date(now)
      endOf.setUTCHours(23, 59, 59, 999)
    }

    const supabase = createClient()

    const { data: logs, error } = await supabase
      .from("dispatch_logs")
      .select("company_id, status, error_message, report_name, export_format, contact_name")
      .gte("created_at", startOf.toISOString())
      .lte("created_at", endOf.toISOString())

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data: companies } = await supabase
      .from("companies")
      .select("id, name")

    const companyNameById = new Map<string, string>(
      (companies ?? []).map((c) => [c.id, c.name])
    )

    const total = logs?.length ?? 0
    const delivered = logs?.filter((l) => l.status === "delivered").length ?? 0
    const failed = logs?.filter((l) => l.status === "failed").length ?? 0
    const inProgress = logs?.filter((l) => l.status === "pending" || l.status === "sending" || l.status === "in_progress").length ?? 0

    const byCompanyMap = new Map<string, { name: string; total: number; delivered: number; failed: number }>()
    for (const log of logs ?? []) {
      const companyName = companyNameById.get(log.company_id) ?? log.company_id
      if (!byCompanyMap.has(log.company_id)) {
        byCompanyMap.set(log.company_id, { name: companyName, total: 0, delivered: 0, failed: 0 })
      }
      const entry = byCompanyMap.get(log.company_id)!
      entry.total++
      if (log.status === "delivered") entry.delivered++
      if (log.status === "failed") entry.failed++
    }

    const errorCountMap = new Map<string, number>()
    for (const log of logs ?? []) {
      if (log.status === "failed" && log.error_message) {
        const msg = log.error_message.slice(0, 120)
        errorCountMap.set(msg, (errorCountMap.get(msg) ?? 0) + 1)
      }
    }

    const topErrors = [...errorCountMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([message, count]) => ({ message, count }))

    const byCompany = [...byCompanyMap.values()].sort((a, b) => b.failed - a.failed)

    return NextResponse.json({
      date: dateParam ?? startOf.toISOString().slice(0, 10),
      evaluated_at: now.toISOString(),
      total,
      delivered,
      failed,
      in_progress: inProgress,
      success_rate: total > 0 ? Math.round((delivered / total) * 100) : 0,
      by_company: byCompany,
      top_errors: topErrors,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao gerar resumo" },
      { status: 500 }
    )
  }
}
