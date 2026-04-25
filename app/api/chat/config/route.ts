import { NextResponse } from "next/server"
import { getAccessToken, listDatasets } from "@/lib/powerbi"
import { createServiceClient } from "@/lib/supabase/server"
import {
  buildDisabledExpiredChatIASettingsValue,
  normalizeChatIASettings,
} from "@/lib/chat-ia-config"
import { getRequestContext } from "@/lib/tenant"
import { getWorkspaceAccessScope } from "@/lib/workspace-access"

export type ChatIAConfig = {
  enabled: boolean
  workspaceId: string
  datasetId: string
  datasetName: string
  webhookUrl: string
  trialDays: number | null
  trialEndsAt: string
  isExpired: boolean
}

async function resolveAutomaticChatDataset(
  supabase: ReturnType<typeof createServiceClient>,
  context: Awaited<ReturnType<typeof getRequestContext>>
) {
  const scope = await getWorkspaceAccessScope(supabase, context)

  if (scope.workspaceRestricted && scope.workspaceIds.length === 0) {
    return null
  }

  let workspaceQuery = supabase
    .from("workspaces")
    .select("pbi_workspace_id, name")
    .eq("company_id", context.companyId)
    .eq("is_active", true)
    .order("name")

  if (scope.workspaceRestricted) {
    workspaceQuery = workspaceQuery.in("id", scope.workspaceIds)
  }

  const { data: workspaces, error: workspaceError } = await workspaceQuery

  if (workspaceError) {
    throw new Error(workspaceError.message)
  }

  const token = await getAccessToken(context.companyId)

  for (const workspace of workspaces ?? []) {
    const pbiWorkspaceId =
      typeof workspace.pbi_workspace_id === "string"
        ? workspace.pbi_workspace_id.trim()
        : ""

    if (!pbiWorkspaceId) {
      continue
    }

    const datasets = await listDatasets(token, pbiWorkspaceId)
    const allowedDatasets = scope.datasetRestricted
      ? datasets.filter((dataset) => scope.datasetIds.includes(String(dataset.id ?? "")))
      : datasets

    const firstDataset = allowedDatasets[0]
    if (!firstDataset?.id) {
      continue
    }

    return {
      workspaceId: pbiWorkspaceId,
      datasetId: String(firstDataset.id),
      datasetName: String(firstDataset.name ?? ""),
    }
  }

  return null
}

export async function GET() {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createServiceClient()

    const { data } = await supabase
      .from("company_settings")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", "chat_ia")
      .maybeSingle()

    const value = data?.value as Record<string, unknown> | null
    const config = normalizeChatIASettings(value)

    if (config.isExpired && config.enabled) {
      await supabase
        .from("company_settings")
        .update({
          value: buildDisabledExpiredChatIASettingsValue(value),
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .eq("key", "chat_ia")
    }

    if (!config.effectiveEnabled) {
      return NextResponse.json<ChatIAConfig>({
        enabled: false,
        workspaceId: "",
        datasetId: "",
        datasetName: "",
        webhookUrl: "",
        trialDays: config.trialDays,
        trialEndsAt: config.trialEndsAt,
        isExpired: config.isExpired,
      })
    }

    const automaticConfig =
      !config.workspaceId || !config.datasetId
        ? await resolveAutomaticChatDataset(supabase, context)
        : null

    return NextResponse.json<ChatIAConfig>({
      enabled: true,
      workspaceId: config.workspaceId || automaticConfig?.workspaceId || "",
      datasetId: config.datasetId || automaticConfig?.datasetId || "",
      datasetName: config.datasetName || automaticConfig?.datasetName || "",
      webhookUrl: config.webhookUrl,
      trialDays: config.trialDays,
      trialEndsAt: config.trialEndsAt,
      isExpired: config.isExpired,
    })
  } catch {
    return NextResponse.json<ChatIAConfig>({
      enabled: false,
      workspaceId: "",
      datasetId: "",
      datasetName: "",
      webhookUrl: "",
      trialDays: null,
      trialEndsAt: "",
      isExpired: false,
    })
  }
}
