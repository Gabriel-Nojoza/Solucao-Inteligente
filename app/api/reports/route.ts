import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get("workspace_id")

    let query = supabase
      .from("reports")
      .select("*")
      .eq("company_id", companyId)
      .order("name")

    if (workspaceId && workspaceId !== "all") {
      query = query.eq("workspace_id", workspaceId)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Enrich with workspace names
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id, name")
      .eq("company_id", companyId)
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
