import { NextResponse } from "next/server"
import { getAccessToken, getDatasetMetadata, listDatasets } from "@/lib/powerbi"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"

export async function GET(request: Request) {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const { searchParams } = new URL(request.url)
    const datasetId = searchParams.get("datasetId")
    const workspaceId = searchParams.get("workspaceId")

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
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    )
  }
}
