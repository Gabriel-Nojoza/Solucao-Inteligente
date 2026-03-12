import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"
import { getWorkspaceAccessScope } from "@/lib/workspace-access"

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext()
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get("workspace_id")

    if (
      scope.restricted &&
      workspaceId &&
      workspaceId !== "all" &&
      !scope.workspaceIds.includes(workspaceId)
    ) {
      return NextResponse.json(
        { error: "Workspace nao permitido para este usuario" },
        { status: 403 }
      )
    }

    if (scope.restricted && scope.workspaceIds.length === 0) {
      return NextResponse.json([])
    }

    let query = supabase
      .from("reports")
      .select("*")
      .eq("company_id", context.companyId)
      .order("name")

    if (workspaceId && workspaceId !== "all") {
      query = query.eq("workspace_id", workspaceId)
    }

    if (scope.restricted) {
      query = query.in("workspace_id", scope.workspaceIds)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Enrich with workspace names
    let workspacesQuery = supabase
      .from("workspaces")
      .select("id, name")
      .eq("company_id", context.companyId)

    if (scope.restricted) {
      workspacesQuery = workspacesQuery.in("id", scope.workspaceIds)
    }

    const { data: workspaces } = await workspacesQuery
    const wsMap = new Map((workspaces ?? []).map((w) => [w.id, w.name]))

    const enriched = (data ?? []).map((r) => ({
      ...r,
      workspace_name: wsMap.get(r.workspace_id) ?? "Desconhecido",
    }))

    return NextResponse.json(enriched)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao autorizado" },
      { status: 401 }
    )
  }
}
