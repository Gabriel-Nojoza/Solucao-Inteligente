import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { resolveCompanyByName } from "@/lib/company-lookup"

// Lista os disparos que falharam (dispatch_logs.status = 'failed'), agrupados
// por empresa e por relatorio/rotina. Autenticado pelo secret da plataforma
// (mesmo padrao de /api/admin/logs/summary). Usado pelo bot do Telegram para
// responder "quantos erros teve na <empresa>" e "quais relatorios nao foram
// enviados".
//
// Query params:
//   secret   (obrigatorio) — PLATFORM_SCHEDULER_SECRET (header x-callback-secret tambem serve)
//   company  (opcional)    — trecho do nome da empresa (fuzzy, sem acento)
//   date     (opcional)    — YYYY-MM-DD (dia UTC). Default: hoje
//   hours    (opcional)    — janela deslizante em horas; ignora "date" quando presente
export async function GET(request: NextRequest) {
  try {
    const platformSecret = process.env.PLATFORM_SCHEDULER_SECRET?.trim()
    if (!platformSecret) {
      return NextResponse.json({ error: "Endpoint nao configurado" }, { status: 503 })
    }

    const { searchParams } = new URL(request.url)
    const incomingSecret =
      request.headers.get("x-callback-secret")?.trim() ||
      searchParams.get("secret")?.trim() ||
      ""

    if (incomingSecret !== platformSecret) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 })
    }

    const supabase = createClient()

    // ── Janela de tempo ──
    const hoursParam = Number(searchParams.get("hours"))
    const dateParam = searchParams.get("date")?.trim()
    let startOf: Date
    let endOf: Date
    let windowLabel: string

    if (Number.isFinite(hoursParam) && hoursParam > 0) {
      endOf = new Date()
      startOf = new Date(endOf.getTime() - hoursParam * 60 * 60 * 1000)
      windowLabel = `ultimas ${hoursParam}h`
    } else if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      startOf = new Date(`${dateParam}T00:00:00.000Z`)
      endOf = new Date(`${dateParam}T23:59:59.999Z`)
      windowLabel = dateParam
    } else {
      const now = new Date()
      startOf = new Date(now)
      startOf.setUTCHours(0, 0, 0, 0)
      endOf = new Date(now)
      endOf.setUTCHours(23, 59, 59, 999)
      windowLabel = startOf.toISOString().slice(0, 10)
    }

    // ── Filtro opcional por empresa ──
    const companyQuery = searchParams.get("company")?.trim()
    let companyFilter: { id: string; name: string } | null = null

    if (companyQuery) {
      const resolved = await resolveCompanyByName(supabase, companyQuery)
      if (resolved.candidates) {
        return NextResponse.json(
          {
            error: "ambiguous_company",
            message: `"${companyQuery}" casa com mais de uma empresa. Seja mais especifico.`,
            candidates: resolved.candidates,
          },
          { status: 409 }
        )
      }
      if (!resolved.match) {
        return NextResponse.json(
          {
            error: "company_not_found",
            message: `Nenhuma empresa encontrada para "${companyQuery}".`,
          },
          { status: 404 }
        )
      }
      companyFilter = resolved.match
    }

    let query = supabase
      .from("dispatch_logs")
      .select(
        "company_id, schedule_id, report_name, contact_name, error_message, export_format, created_at"
      )
      .eq("status", "failed")
      .gte("created_at", startOf.toISOString())
      .lte("created_at", endOf.toISOString())

    if (companyFilter) {
      query = query.eq("company_id", companyFilter.id)
    }

    const { data: logs, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data: companies } = await supabase.from("companies").select("id, name")
    const companyNameById = new Map<string, string>(
      (companies ?? []).map((c) => [c.id, c.name])
    )

    type ReportEntry = {
      schedule_id: string | null
      report_name: string
      count: number
      sample_error: string | null
      contacts: string[]
    }
    type CompanyEntry = {
      company_id: string
      company_name: string
      failed: number
      reports: Map<string, ReportEntry>
    }

    const byCompany = new Map<string, CompanyEntry>()

    for (const log of logs ?? []) {
      const companyId = log.company_id ?? "desconhecido"
      if (!byCompany.has(companyId)) {
        byCompany.set(companyId, {
          company_id: companyId,
          company_name: companyNameById.get(companyId) ?? companyId,
          failed: 0,
          reports: new Map(),
        })
      }
      const entry = byCompany.get(companyId)!
      entry.failed++

      const reportName = log.report_name ?? "Desconhecido"
      const key = `${log.schedule_id ?? ""}|${reportName}`
      if (!entry.reports.has(key)) {
        entry.reports.set(key, {
          schedule_id: log.schedule_id ?? null,
          report_name: reportName,
          count: 0,
          sample_error: null,
          contacts: [],
        })
      }
      const reportEntry = entry.reports.get(key)!
      reportEntry.count++
      if (!reportEntry.sample_error && log.error_message) {
        reportEntry.sample_error = log.error_message.slice(0, 200)
      }
      if (log.contact_name && !reportEntry.contacts.includes(log.contact_name)) {
        reportEntry.contacts.push(log.contact_name)
      }
    }

    const result = [...byCompany.values()]
      .map((entry) => ({
        company_id: entry.company_id,
        company_name: entry.company_name,
        failed: entry.failed,
        reports: [...entry.reports.values()].sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.failed - a.failed)

    return NextResponse.json({
      window: windowLabel,
      evaluated_at: new Date().toISOString(),
      company: companyFilter,
      total_failed: logs?.length ?? 0,
      by_company: result,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao listar falhas" },
      { status: 500 }
    )
  }
}
