import { NextRequest, NextResponse } from "next/server"
import { getAccessTokenMasterUser } from "@/lib/powerbi"
import { requireAdminContext } from "@/lib/tenant"
import { createServiceClient } from "@/lib/supabase/server"

const DEFAULT_WORKSPACE_ID = "09b9f53f-2894-40f3-841d-828fb4689eb2"
const DEFAULT_REPORT_ID = "01260e2e-4631-49c4-b480-6f0fca7882d1"

export async function GET(request: NextRequest) {
  try {
    await requireAdminContext()

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get("w") ?? DEFAULT_WORKSPACE_ID
    const reportId = searchParams.get("r") ?? DEFAULT_REPORT_ID
    const companyId = searchParams.get("companyId") ?? undefined

    // List companies that have powerbi config (always shown for reference)
    const supabase = await createServiceClient()
    const { data: configs } = await supabase
      .from("company_settings")
      .select("company_id, value")
      .eq("key", "powerbi")

    const companySummary = (configs ?? []).map((row) => {
      const cfg = row.value as Record<string, unknown>
      return {
        company_id: row.company_id,
        has_tenant_id: !!cfg?.tenant_id,
        has_client_id: !!cfg?.client_id,
        has_client_secret: !!cfg?.client_secret,
        has_master_user_email: !!cfg?.master_user_email,
        has_master_user_password: !!cfg?.master_user_password,
        master_user_email: cfg?.master_user_email ? String(cfg.master_user_email) : null,
      }
    })

    if (!companyId) {
      return NextResponse.json({
        error: "Passe ?companyId=<id> para testar. Veja as empresas disponíveis abaixo.",
        companies: companySummary,
      })
    }

    const token = await getAccessTokenMasterUser(companyId)
    const results: Record<string, unknown> = { companyId, companySummary }

    // User profile (what Power BI sees for this token)
    const profileRes = await fetch("https://api.powerbi.com/v1.0/myorg/profile", {
      headers: { Authorization: `Bearer ${token}` },
    })
    results.userProfile = { status: profileRes.status, body: await profileRes.json().catch(() => null) }

    // Capacities accessible to this user
    const capsRes = await fetch("https://api.powerbi.com/v1.0/myorg/capacities", {
      headers: { Authorization: `Bearer ${token}` },
    })
    results.capacities = { status: capsRes.status, body: await capsRes.json().catch(() => null) }

    const wsRes = await fetch(`https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    results.workspace = { status: wsRes.status, body: await wsRes.json().catch(() => null) }

    const reportRes = await fetch(
      `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${reportId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    results.report = { status: reportRes.status, body: await reportRes.json().catch(() => null) }

    const exportUrl = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${reportId}/ExportTo`
    const exportHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }

    const exportRes = await fetch(exportUrl, {
      method: "POST", headers: exportHeaders,
      body: JSON.stringify({ format: "PDF" }),
    })
    results.exportTo = { status: exportRes.status, body: await exportRes.text() }

    return NextResponse.json(results)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
