import { NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getAccessToken, listWorkspaces, listReports } from "@/lib/powerbi"
import { requireAdminContext } from "@/lib/tenant"

export async function POST() {
  try {
    const { companyId } = await requireAdminContext()
    const token = await getAccessToken()
    const supabase = createClient()

    // Sync workspaces
    const pbiWorkspaces = await listWorkspaces(token)

    for (const ws of pbiWorkspaces) {
      await supabase.from("workspaces").upsert(
        {
          company_id: companyId,
          pbi_workspace_id: ws.id,
          name: ws.name,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "company_id,pbi_workspace_id" }
      )
    }

    // Sync reports for each workspace
    const { data: dbWorkspaces } = await supabase
      .from("workspaces")
      .select("id, pbi_workspace_id")
      .eq("company_id", companyId)
      .eq("is_active", true)

    let totalReports = 0
    for (const ws of dbWorkspaces ?? []) {
      try {
        const pbiReports = await listReports(token, ws.pbi_workspace_id)
        for (const report of pbiReports) {
          await supabase.from("reports").upsert(
            {
              company_id: companyId,
              pbi_report_id: report.id,
              workspace_id: ws.id,
              name: report.name,
              web_url: report.webUrl,
              embed_url: report.embedUrl,
              dataset_id: report.datasetId,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "company_id,pbi_report_id" }
          )
          totalReports++
        }
      } catch {
        // Skip workspaces that fail
      }
    }

    return NextResponse.json({
      success: true,
      workspaces: pbiWorkspaces.length,
      reports: totalReports,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Erro ao sincronizar",
      },
      { status: 500 }
    )
  }
}
