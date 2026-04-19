import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"

export type ChatIAConfig = {
  enabled: boolean
  workspaceId: string
  datasetId: string
  datasetName: string
  webhookUrl: string
}

export async function GET() {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createServiceClient()

    const { data } = await supabase
      .from("company_settings")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", "chat_ia")
      .maybeSingle()

    const value = data?.value as Record<string, unknown> | null

    if (!value?.enabled) {
      return NextResponse.json<ChatIAConfig>({
        enabled: false,
        workspaceId: "",
        datasetId: "",
        datasetName: "",
        webhookUrl: "",
      })
    }

    return NextResponse.json<ChatIAConfig>({
      enabled: true,
      workspaceId: String(value.workspace_id ?? ""),
      datasetId: String(value.dataset_id ?? ""),
      datasetName: String(value.dataset_name ?? ""),
      webhookUrl: String(value.webhook_url ?? ""),
    })
  } catch {
    return NextResponse.json<ChatIAConfig>({
      enabled: false,
      workspaceId: "",
      datasetId: "",
      datasetName: "",
      webhookUrl: "",
    })
  }
}
