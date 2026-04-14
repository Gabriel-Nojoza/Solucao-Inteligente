import { NextResponse } from "next/server"
import { getAccessToken, listDatasets } from "@/lib/powerbi"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"
import {
  getWorkspaceAccessScope,
  isWorkspaceAllowed,
} from "@/lib/workspace-access"

export async function GET(request: Request) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get("workspaceId")

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId obrigatorio" },
        { status: 400 }
      )
    }

    if (!isWorkspaceAllowed(scope, { pbiWorkspaceId: workspaceId })) {
      return NextResponse.json(
        { error: "Workspace nao permitido para este usuario" },
        { status: 403 }
      )
    }

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id")
      .eq("company_id", companyId)
      .eq("pbi_workspace_id", workspaceId)
      .single()

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace nao pertence a empresa do usuario" },
        { status: 403 }
      )
    }

    const token = await getAccessToken()
    const datasets = await listDatasets(token, workspaceId)
    const filteredDatasets = scope.datasetRestricted
      ? datasets.filter((dataset) => scope.datasetIds.includes(String(dataset.id ?? "")))
      : datasets

    return NextResponse.json(filteredDatasets)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    )
  }
}
