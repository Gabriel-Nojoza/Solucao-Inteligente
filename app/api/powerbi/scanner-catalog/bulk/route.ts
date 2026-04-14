import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"
import { getAccessToken } from "@/lib/powerbi"
import { syncWorkspaceCatalogs } from "@/lib/powerbi-catalog-sync"
import {
  getWorkspaceAccessScope,
  isWorkspaceAllowed,
} from "@/lib/workspace-access"

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)
    const body = await request.json()
    const workspaceId = String(body?.workspaceId ?? "").trim()

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

    if (scope.datasetRestricted) {
      return NextResponse.json(
        {
          error:
            "A importacao em lote do workspace nao esta disponivel quando o usuario possui acesso restrito por dataset.",
        },
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
    const syncResult = await syncWorkspaceCatalogs({
      companyId,
      token,
      workspaceId,
    })

    return NextResponse.json({
      success: true,
      source: syncResult.source,
      imported_datasets: syncResult.imported_datasets,
      removed_datasets: syncResult.removed_datasets,
      results: syncResult.results,
      warnings: syncResult.warnings,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao importar catalogos via scanner" },
      { status: 500 }
    )
  }
}
