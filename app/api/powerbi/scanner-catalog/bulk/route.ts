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
    const catalogSecret = request.headers.get("x-catalog-secret")
    const expectedSecret = process.env.CATALOG_SYNC_SECRET
    const isInternalRequest =
      !!catalogSecret &&
      !!expectedSecret &&
      catalogSecret === expectedSecret

    const body = await request.json()
    const workspaceId = String(body?.workspaceId ?? "").trim()

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId obrigatorio" },
        { status: 400 }
      )
    }

    const supabase = createClient()
    let companyId: string

    if (isInternalRequest) {
      // Modo interno (n8n / cron): resolve company_id a partir do workspace
      const { data: workspace } = await supabase
        .from("workspaces")
        .select("company_id")
        .eq("pbi_workspace_id", workspaceId)
        .single()

      if (!workspace?.company_id) {
        return NextResponse.json(
          { error: "Workspace nao encontrado ou sem empresa vinculada" },
          { status: 404 }
        )
      }

      companyId = workspace.company_id
    } else {
      // Modo autenticado: valida sessao, permissoes e escopo do usuario
      const context = await getRequestContext()
      companyId = context.companyId
      const scope = await getWorkspaceAccessScope(supabase, context)

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
