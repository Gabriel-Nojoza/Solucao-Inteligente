import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext, requireAdminContext } from "@/lib/tenant"
import { getWorkspaceAccessScope } from "@/lib/workspace-access"

export async function GET() {
  try {
    const context = await getRequestContext()
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)

    if (scope.workspaceRestricted && scope.workspaceIds.length === 0) {
      return NextResponse.json([])
    }

    let datasetWorkspaceIds: string[] | null = null

    if (scope.datasetRestricted) {
      if (scope.datasetIds.length === 0) {
        return NextResponse.json([])
      }

      const { data: reportRows, error: reportScopeError } = await supabase
        .from("reports")
        .select("workspace_id")
        .eq("company_id", context.companyId)
        .eq("is_active", true)
        .in("dataset_id", scope.datasetIds)

      if (reportScopeError) {
        return NextResponse.json(
          { error: reportScopeError.message },
          { status: 500 }
        )
      }

      datasetWorkspaceIds = Array.from(
        new Set(
          (reportRows ?? []).flatMap((report) =>
            typeof report.workspace_id === "string" && report.workspace_id.trim()
              ? [report.workspace_id.trim()]
              : []
          )
        )
      )

      if (datasetWorkspaceIds.length === 0) {
        return NextResponse.json([])
      }
    }

    let query = supabase
      .from("workspaces")
      .select("*")
      .eq("company_id", context.companyId)
      .order("name")

    if (scope.workspaceRestricted) {
      query = query.in("id", scope.workspaceIds)
    }

    if (datasetWorkspaceIds) {
      query = query.in("id", datasetWorkspaceIds)
    }

    const { data: workspaces, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get report counts
    const enriched = await Promise.all(
      (workspaces ?? []).map(async (ws) => {
        let reportsCountQuery = supabase
          .from("reports")
          .select("id", { count: "exact", head: true })
          .eq("company_id", context.companyId)
          .eq("workspace_id", ws.id)
          .eq("is_active", true)

        if (scope.datasetRestricted) {
          reportsCountQuery = reportsCountQuery.in("dataset_id", scope.datasetIds)
        }

        const { count } = await reportsCountQuery
        return { ...ws, report_count: count ?? 0 }
      })
    )

    return NextResponse.json(enriched)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao autorizado" },
      { status: 401 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { companyId } = await requireAdminContext()
    const supabase = createClient()
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("workspaces")
      .update(updates)
      .eq("id", id)
      .eq("company_id", companyId)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao autorizado" },
      { status: 401 }
    )
  }
}
