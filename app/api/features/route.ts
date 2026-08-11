import { NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"

export type CompanyFeatures = {
  reportBuilder: boolean
  campaigns: boolean
  excelExport: boolean
  appName: string
  daxCalculatetable: boolean
  hideZeroRows: boolean
  hideZeroRowsIncludeDevolution: boolean
  campaignClientPreview: boolean
  daxPreserveGroupBy: boolean
  pngExport: boolean
}

export async function GET() {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()

    const { data: rows } = await supabase
      .from("company_settings")
      .select("key, value")
      .eq("company_id", companyId)
      .in("key", ["features", "general"])

    const settingsMap: Record<string, Record<string, unknown>> = {}
    for (const row of rows ?? []) {
      settingsMap[row.key] = (row.value ?? {}) as Record<string, unknown>
    }

    const features = settingsMap.features ?? {}
    const general = settingsMap.general ?? {}

    return NextResponse.json({
      reportBuilder: features.report_builder === true,
      campaigns: features.campaigns === true,
      excelExport: features.excel_export === true,
      appName: typeof general.app_name === "string" ? general.app_name : "",
      daxCalculatetable: features.dax_calculatetable === true,
      hideZeroRows: features.hide_zero_rows === true,
      hideZeroRowsIncludeDevolution: features.hide_zero_rows_include_devolution === true,
      campaignClientPreview: features.campaign_client_preview === true,
      daxPreserveGroupBy: features.dax_preserve_groupby === true,
      pngExport: features.png_export === true,
    } satisfies CompanyFeatures)
  } catch (error) {
    if (isAuthContextError(error)) {
      return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
    }
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
