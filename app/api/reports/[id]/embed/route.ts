import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { generateReportEmbedToken, getAccessToken } from "@/lib/powerbi"
import { getRequestContext } from "@/lib/tenant"
import {
  getWorkspaceAccessScope,
  isDatasetAllowed,
  isWorkspaceAllowed,
} from "@/lib/workspace-access"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const contextValue = await getRequestContext()
    const { companyId } = contextValue
    const { id } = await context.params
    const reportId = String(id ?? "").trim()

    if (!reportId) {
      return NextResponse.json({ error: "id do relatorio obrigatorio" }, { status: 400 })
    }

    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, contextValue)

    const { data: report, error } = await supabase
      .from("reports")
      .select("id, name, pbi_report_id, workspace_id, dataset_id, web_url, embed_url, is_active")
      .eq("company_id", companyId)
      .eq("id", reportId)
      .eq("is_active", true)
      .single()

    if (error || !report) {
      return NextResponse.json({ error: "Relatorio nao encontrado" }, { status: 404 })
    }

    if (!isDatasetAllowed(scope, report.dataset_id)) {
      return NextResponse.json(
        { error: "Relatorio nao permitido para este usuario" },
        { status: 403 }
      )
    }

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .select("id, name, pbi_workspace_id, is_active")
      .eq("company_id", companyId)
      .eq("id", report.workspace_id)
      .eq("is_active", true)
      .single()

    if (workspaceError || !workspace?.pbi_workspace_id) {
      return NextResponse.json(
        { error: "Workspace do relatorio nao encontrado" },
        { status: 404 }
      )
    }

    if (
      !isWorkspaceAllowed(scope, {
        workspaceId: report.workspace_id,
        pbiWorkspaceId: workspace.pbi_workspace_id,
      })
    ) {
      return NextResponse.json(
        { error: "Workspace nao permitido para este usuario" },
        { status: 403 }
      )
    }

    if (!report.embed_url?.trim()) {
      return NextResponse.json(
        { error: "Relatorio sem embed_url. Sincronize o Power BI novamente." },
        { status: 400 }
      )
    }

    const token = await getAccessToken(companyId)
    const embedToken = await generateReportEmbedToken(
      token,
      workspace.pbi_workspace_id,
      report.pbi_report_id
    )

    return NextResponse.json({
      id: report.id,
      name: report.name,
      workspace_name: workspace.name,
      pbi_workspace_id: workspace.pbi_workspace_id,
      pbi_report_id: report.pbi_report_id,
      web_url: report.web_url,
      embed_url: report.embed_url,
      embed_token: embedToken,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao carregar visualizacao do relatorio",
      },
      { status: 500 }
    )
  }
}
