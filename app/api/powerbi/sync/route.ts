import { NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getAccessToken, listReports, listWorkspaces } from "@/lib/powerbi"
import { syncWorkspaceCatalogs } from "@/lib/powerbi-catalog-sync"
import { getRequestContext } from "@/lib/tenant"

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getWorkspaceLabel(workspace: { name?: string | null; pbi_workspace_id?: string | null }) {
  const name = typeof workspace.name === "string" ? workspace.name.trim() : ""
  if (name) {
    return name
  }

  const workspaceId =
    typeof workspace.pbi_workspace_id === "string" ? workspace.pbi_workspace_id.trim() : ""

  return workspaceId || "workspace desconhecido"
}

export async function POST() {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const token = await getAccessToken()
    const syncedAt = new Date().toISOString()

    const pbiWorkspaces = await listWorkspaces(token)

    for (const ws of pbiWorkspaces) {
      const { error } = await supabase.from("workspaces").upsert(
        {
          company_id: companyId,
          pbi_workspace_id: ws.id,
          name: ws.name,
          synced_at: syncedAt,
        },
        {
          onConflict: "company_id,pbi_workspace_id",
        }
      )

      if (error) {
        throw new Error(`Erro ao salvar workspace ${ws.name}: ${error.message}`)
      }
    }

    const { data: dbWorkspaces, error: dbWorkspacesError } = await supabase
      .from("workspaces")
      .select("id, name, pbi_workspace_id")
      .eq("company_id", companyId)

    if (dbWorkspacesError) {
      throw new Error(dbWorkspacesError.message)
    }

    const dbWorkspaceList = dbWorkspaces ?? []
    const activeWorkspaceIds = new Set(pbiWorkspaces.map((workspace) => workspace.id))
    const currentDbWorkspaces = dbWorkspaceList.filter((workspace) =>
      activeWorkspaceIds.has(workspace.pbi_workspace_id)
    )
    const staleDbWorkspaces = dbWorkspaceList.filter(
      (workspace) => !activeWorkspaceIds.has(workspace.pbi_workspace_id)
    )

    if (staleDbWorkspaces.length > 0) {
      const staleWorkspaceIds = staleDbWorkspaces.map((workspace) => workspace.id)
      const stalePbiWorkspaceIds = staleDbWorkspaces.map((workspace) => workspace.pbi_workspace_id)

      const { error: deactivateWorkspacesError } = await supabase
        .from("workspaces")
        .update({
          is_active: false,
          synced_at: syncedAt,
        })
        .eq("company_id", companyId)
        .in("pbi_workspace_id", stalePbiWorkspaceIds)

      if (deactivateWorkspacesError) {
        throw new Error(
          `Erro ao desativar workspaces obsoletos: ${deactivateWorkspacesError.message}`
        )
      }

      const { error: deactivateReportsError } = await supabase
        .from("reports")
        .update({
          is_active: false,
          synced_at: syncedAt,
        })
        .eq("company_id", companyId)
        .in("workspace_id", staleWorkspaceIds)

      if (deactivateReportsError) {
        throw new Error(
          `Erro ao desativar relatorios de workspaces obsoletos: ${deactivateReportsError.message}`
        )
      }
    }

    let totalReports = 0
    let totalDatasets = 0
    let removedCatalogDatasets = 0
    const warnings: string[] = []

    for (const ws of currentDbWorkspaces) {
      let reports: Awaited<ReturnType<typeof listReports>> | null = null

      try {
        reports = await listReports(token, ws.pbi_workspace_id)
      } catch (error) {
        warnings.push(
          `Nao foi possivel sincronizar os relatorios do workspace ${getWorkspaceLabel(ws)}. ${getErrorMessage(error)}`
        )
      }

      if (reports) {
        for (const report of reports) {
          const { error } = await supabase.from("reports").upsert(
            {
              company_id: companyId,
              workspace_id: ws.id,
              pbi_report_id: report.id,
              name: report.name,
              web_url: report.webUrl,
              embed_url: report.embedUrl,
              dataset_id: report.datasetId,
              is_active: true,
              synced_at: syncedAt,
            },
            {
              onConflict: "company_id,pbi_report_id",
            }
          )

          if (error) {
            throw new Error(`Erro ao salvar report ${report.name}: ${error.message}`)
          }

          totalReports++
        }

        const currentReportIds = reports.map((report) => report.id)
        const { data: existingReports, error: existingReportsError } = await supabase
          .from("reports")
          .select("pbi_report_id")
          .eq("company_id", companyId)
          .eq("workspace_id", ws.id)

        if (existingReportsError) {
          throw new Error(
            `Erro ao consultar relatorios atuais do workspace ${getWorkspaceLabel(ws)}: ${existingReportsError.message}`
          )
        }

        const staleReportIds = (existingReports ?? [])
          .map((report) => report.pbi_report_id)
          .filter((reportId) => !currentReportIds.includes(reportId))

        if (staleReportIds.length > 0) {
          const { error: deactivateReportsError } = await supabase
            .from("reports")
            .update({
              is_active: false,
              synced_at: syncedAt,
            })
            .eq("company_id", companyId)
            .eq("workspace_id", ws.id)
            .in("pbi_report_id", staleReportIds)

          if (deactivateReportsError) {
            throw new Error(
              `Erro ao desativar relatorios obsoletos do workspace ${getWorkspaceLabel(ws)}: ${deactivateReportsError.message}`
            )
          }
        }
      }

      try {
        const catalogSync = await syncWorkspaceCatalogs({
          companyId,
          token,
          workspaceId: ws.pbi_workspace_id,
          workspaceLabel: getWorkspaceLabel(ws),
          syncedAt,
        })

        totalDatasets += catalogSync.imported_datasets
        removedCatalogDatasets += catalogSync.removed_datasets
        warnings.push(...catalogSync.warnings)
      } catch (error) {
        warnings.push(
          `Nao foi possivel sincronizar os datasets do workspace ${getWorkspaceLabel(ws)}. ${getErrorMessage(error)}`
        )
      }
    }

    return NextResponse.json({
      success: true,
      workspaces: pbiWorkspaces.length,
      reports: totalReports,
      datasets: totalDatasets,
      removed_catalog_datasets: removedCatalogDatasets,
      inactive_workspaces: staleDbWorkspaces.length,
      warnings,
    })
  } catch (error) {
    console.log("sync error", error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao sincronizar",
      },
      { status: 500 }
    )
  }
}
