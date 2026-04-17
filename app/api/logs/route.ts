import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"
import { getAccessibleScheduleIds } from "@/lib/schedule-access"
import { getWorkspaceAccessScope } from "@/lib/workspace-access"
import {
  canAccessDispatchLog,
  getCompanyScheduleIdSet,
} from "@/lib/dispatch-log-visibility"

type DispatchLogRow = {
  schedule_id?: string | null
}

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)
    const { searchParams } = new URL(request.url)

    const status = searchParams.get("status")
    const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10)
    const rawOffset = parseInt(searchParams.get("offset") ?? "0", 10)

    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 200)
      : 50
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0
    const hasRestrictedScope = scope.workspaceRestricted || scope.datasetRestricted
    const accessibleScheduleIds = hasRestrictedScope
      ? await getAccessibleScheduleIds(supabase, companyId, scope)
      : []

    const buildQuery = (
      orderColumn: "created_at" | "id",
      paginated: boolean
    ) => {
      let query = supabase
        .from("dispatch_logs")
        .select("*", { count: paginated ? "exact" : undefined })
        .eq("company_id", companyId)
        .order(orderColumn, { ascending: false })

      if (status && status !== "all") {
        query = query.eq("status", status)
      }

      if (paginated && hasRestrictedScope) {
        query = query.in("schedule_id", accessibleScheduleIds)
      }

      if (paginated) {
        query = query.range(offset, offset + limit - 1)
      }

      return query
    }

    let data
    let error
    let count

    if (!hasRestrictedScope) {
      ;({ data, error, count } = await buildQuery("created_at", true))
    } else {
      ;({ data, error } = await buildQuery("created_at", false))
    }

    // Fallback for projects where dispatch_logs has no created_at column.
    if (error?.code === "42703") {
      if (!hasRestrictedScope) {
        ;({ data, error, count } = await buildQuery("id", true))
      } else {
        ;({ data, error } = await buildQuery("id", false))
      }
    }

    if (error) {
      console.error("GET /api/logs Supabase error:", error)
      return NextResponse.json(
        { error: "Erro ao buscar logs no banco de dados." },
        { status: 500 }
      )
    }

    if (!hasRestrictedScope) {
      return NextResponse.json({ data: data ?? [], count: count ?? 0 })
    }

    const currentScheduleIds = await getCompanyScheduleIdSet(supabase, companyId)
    const accessibleScheduleIdSet = new Set(accessibleScheduleIds)
    const filteredLogs = ((data ?? []) as DispatchLogRow[]).filter((log) =>
      canAccessDispatchLog(log.schedule_id, accessibleScheduleIdSet, currentScheduleIds)
    )

    return NextResponse.json({
      data: filteredLogs.slice(offset, offset + limit),
      count: filteredLogs.length,
    })
  } catch (error) {
    if (isAuthContextError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Nao autenticado" },
        { status: 401 }
      )
    }

    console.error("GET /api/logs unexpected error:", error)
    return NextResponse.json(
      { error: "Erro interno inesperado ao buscar logs." },
      { status: 500 }
    )
  }
}
