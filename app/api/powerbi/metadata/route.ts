import { NextResponse } from "next/server"
import { getAccessToken, getDatasetMetadata, listDatasets } from "@/lib/powerbi"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"
import {
  getWorkspaceAccessScope,
  isDatasetAllowed,
  isWorkspaceAllowed,
} from "@/lib/workspace-access"

export async function GET(request: Request) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)
    const { searchParams } = new URL(request.url)
    const datasetId = searchParams.get("datasetId")?.trim()
    const workspaceId = searchParams.get("workspaceId")?.trim()

    if (!datasetId) {
      return NextResponse.json(
        { error: "datasetId obrigatorio" },
        { status: 400 }
      )
    }

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

    if (!isDatasetAllowed(scope, datasetId)) {
      return NextResponse.json(
        { error: "Dataset nao permitido para este usuario" },
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
    const datasetInWorkspace = datasets.some((dataset) => dataset.id === datasetId)

    if (!datasetInWorkspace) {
      return NextResponse.json(
        { error: "Dataset nao pertence ao workspace selecionado" },
        { status: 403 }
      )
    }

    const metadata = await getDatasetMetadata(token, datasetId)

    return NextResponse.json(metadata)
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Erro desconhecido ao carregar metadata",
      },
      { status: 500 }
    )
  }
}
