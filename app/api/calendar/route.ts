import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"
import { getAccessibleScheduleIds } from "@/lib/schedule-access"
import { getWorkspaceAccessScope } from "@/lib/workspace-access"
import {
  getDispatchLogEffectiveDate,
  getDispatchLogOutcome,
} from "@/lib/dispatch-log"
import {
  canAccessDispatchLog,
  getCompanyScheduleIdSet,
} from "@/lib/dispatch-log-visibility"

// Brazil is UTC-3 (America/Sao_Paulo — no DST since 2019)
const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000

function toBrazilDateStr(date: Date): string {
  const brazilTime = new Date(date.getTime() - BRAZIL_OFFSET_MS)
  const y = brazilTime.getUTCFullYear()
  const m = String(brazilTime.getUTCMonth() + 1).padStart(2, "0")
  const d = String(brazilTime.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

type DispatchLogRecord = {
  id?: string | null
  schedule_id?: string | null
  report_name?: string | null
  contact_name?: string | null
  export_format?: string | null
  status?: string | null
  error_message?: string | null
  created_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}

type DayEntry = {
  id: string
  scheduleId: string | null
  reportName: string
  contactName: string
  exportFormat: string | null
  status: string
  outcome: "delivered" | "failed" | "ongoing"
  errorMessage: string | null
  effectiveAt: string | null
}

type DaySummary = {
  delivered: number
  failed: number
  ongoing: number
  entries: DayEntry[]
}

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)

    const { searchParams } = new URL(request.url)
    const rawYear = parseInt(searchParams.get("year") ?? "", 10)
    const rawMonth = parseInt(searchParams.get("month") ?? "", 10)

    const now = new Date()
    const brazilNow = new Date(now.getTime() - BRAZIL_OFFSET_MS)
    const year = Number.isFinite(rawYear) ? rawYear : brazilNow.getUTCFullYear()
    const month = Number.isFinite(rawMonth) && rawMonth >= 1 && rawMonth <= 12
      ? rawMonth
      : brazilNow.getUTCMonth() + 1

    // Month start/end in Brazil timezone converted back to UTC
    const monthStartBrazil = new Date(Date.UTC(year, month - 1, 1))
    const monthEndBrazil = new Date(Date.UTC(year, month, 1))
    const monthStartUTC = new Date(monthStartBrazil.getTime() + BRAZIL_OFFSET_MS)
    const monthEndUTC = new Date(monthEndBrazil.getTime() + BRAZIL_OFFSET_MS)

    const hasRestrictedScope = scope.workspaceRestricted || scope.datasetRestricted
    const accessibleScheduleIds = hasRestrictedScope
      ? await getAccessibleScheduleIds(supabase, companyId, scope)
      : []

    let query = supabase
      .from("dispatch_logs")
      .select(
        "id, schedule_id, report_name, contact_name, export_format, status, error_message, created_at, started_at, completed_at"
      )
      .eq("company_id", companyId)
      .gte("created_at", monthStartUTC.toISOString())
      .lt("created_at", monthEndUTC.toISOString())

    const { data, error } = await query

    if (error) {
      console.error("GET /api/calendar Supabase error:", error)
      return NextResponse.json(
        { error: "Erro ao buscar dados do calendario." },
        { status: 500 }
      )
    }

    let logs = (data ?? []) as DispatchLogRecord[]

    if (hasRestrictedScope) {
      const currentScheduleIds = await getCompanyScheduleIdSet(supabase, companyId)
      const accessibleScheduleIdSet = new Set(accessibleScheduleIds)
      logs = logs.filter((log) =>
        canAccessDispatchLog(log.schedule_id, accessibleScheduleIdSet, currentScheduleIds)
      )
    }

    const days: Record<string, DaySummary> = {}
    const totals = { delivered: 0, failed: 0, ongoing: 0 }

    for (const log of logs) {
      const effectiveDate = getDispatchLogEffectiveDate(log)
      if (!effectiveDate) continue

      const dayKey = toBrazilDateStr(effectiveDate)
      if (!days[dayKey]) {
        days[dayKey] = { delivered: 0, failed: 0, ongoing: 0, entries: [] }
      }

      const outcome = getDispatchLogOutcome(log)
      days[dayKey][outcome] += 1
      totals[outcome] += 1

      days[dayKey].entries.push({
        id: typeof log.id === "string" ? log.id : `${dayKey}-${days[dayKey].entries.length}`,
        scheduleId: typeof log.schedule_id === "string" ? log.schedule_id : null,
        reportName:
          typeof log.report_name === "string" && log.report_name.trim().length > 0
            ? log.report_name.trim()
            : "Relatorio sem nome",
        contactName:
          typeof log.contact_name === "string" && log.contact_name.trim().length > 0
            ? log.contact_name.trim()
            : "Contato nao informado",
        exportFormat:
          typeof log.export_format === "string" && log.export_format.trim().length > 0
            ? log.export_format.trim()
            : null,
        status:
          typeof log.status === "string" && log.status.trim().length > 0
            ? log.status.trim().toLowerCase()
            : outcome,
        outcome,
        errorMessage:
          typeof log.error_message === "string" && log.error_message.trim().length > 0
            ? log.error_message.trim()
            : null,
        effectiveAt: effectiveDate.toISOString(),
      })
    }

    for (const day of Object.values(days)) {
      day.entries.sort((a, b) => {
        const left = a.effectiveAt ? new Date(a.effectiveAt).getTime() : 0
        const right = b.effectiveAt ? new Date(b.effectiveAt).getTime() : 0
        return right - left
      })
    }

    return NextResponse.json({ days, totals })
  } catch (error) {
    if (isAuthContextError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Nao autenticado" },
        { status: 401 }
      )
    }

    console.error("GET /api/calendar unexpected error:", error)
    return NextResponse.json(
      { error: "Erro interno inesperado." },
      { status: 500 }
    )
  }
}
