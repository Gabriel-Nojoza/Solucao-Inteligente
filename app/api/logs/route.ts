import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"
import { getAccessibleScheduleIds } from "@/lib/schedule-access"
import { getWorkspaceAccessScope } from "@/lib/workspace-access"

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

    if (hasRestrictedScope && accessibleScheduleIds.length === 0) {
      return NextResponse.json({ data: [], count: 0 })
    }

    const buildQuery = (orderColumn: "created_at" | "id") => {
      let query = supabase
        .from("dispatch_logs")
        .select("*", { count: "exact" })
        .eq("company_id", companyId)
        .order(orderColumn, { ascending: false })
        .range(offset, offset + limit - 1)

      if (status && status !== "all") {
        query = query.eq("status", status)
      }

      if (hasRestrictedScope) {
        query = query.in("schedule_id", accessibleScheduleIds)
      }

      return query
    }

    let { data, error, count } = await buildQuery("created_at")

    // Fallback for projects where dispatch_logs has no created_at column.
    if (error?.code === "42703") {
      ;({ data, error, count } = await buildQuery("id"))
    }

    if (error) {
      console.error("GET /api/logs Supabase error:", error)
      return NextResponse.json(
        { error: "Erro ao buscar logs no banco de dados." },
        { status: 500 }
      )
    }

    return NextResponse.json({ data: data ?? [], count: count ?? 0 })
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
