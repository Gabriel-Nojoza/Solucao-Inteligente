import type { SupabaseClient } from "@supabase/supabase-js"

type MetadataCarrier = {
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}

export type WorkspaceAccessContext = {
  userId: string
  companyId: string
  role: "admin" | "client"
  workspaceAccessConfigured: boolean
  selectedPbiWorkspaceIds: string[]
}

export type WorkspaceAccessScope = {
  restricted: boolean
  workspaceIds: string[]
  pbiWorkspaceIds: string[]
}

export type WorkspaceAccessOption = {
  id: string
  name: string
}

function readBoolean(value: unknown) {
  return value === true || value === "true"
}

function isMissingRelationError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : ""
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: string }).message ?? "")
      : ""

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("user_workspace_access")
  )
}

export function isWorkspaceAccessConfigured(user: MetadataCarrier) {
  return (
    readBoolean(user.app_metadata?.workspace_access_configured) ||
    readBoolean(user.user_metadata?.workspace_access_configured)
  )
}

export function getSelectedPbiWorkspaceIds(user: MetadataCarrier) {
  const fromApp = normalizePbiWorkspaceIds(user.app_metadata?.selected_pbi_workspace_ids)
  if (fromApp.length > 0) {
    return fromApp
  }

  return normalizePbiWorkspaceIds(user.user_metadata?.selected_pbi_workspace_ids)
}

export function normalizePbiWorkspaceIds(input: unknown) {
  if (!Array.isArray(input)) return []

  return Array.from(
    new Set(
      input
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  )
}

export async function getCompanyWorkspaceOptions(
  supabase: SupabaseClient,
  companyId: string
) {
  const { data, error } = await supabase
    .from("workspaces")
    .select("name, pbi_workspace_id")
    .eq("company_id", companyId)
    .order("name")

  if (error) throw new Error(error.message)

  return (data ?? []).map((workspace) => ({
    id: String(workspace.pbi_workspace_id ?? ""),
    name: String(workspace.name ?? ""),
  }))
}

export async function getUserAssignedPbiWorkspaceIds(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
  fallbackUser?: MetadataCarrier
) {
  const { data, error } = await supabase
    .from("user_workspace_access")
    .select("workspaces!inner(pbi_workspace_id)")
    .eq("company_id", companyId)
    .eq("user_id", userId)

  if (error) {
    if (isMissingRelationError(error)) {
      return fallbackUser ? getSelectedPbiWorkspaceIds(fallbackUser) : null
    }

    throw new Error(error.message)
  }

  const pbiWorkspaceIds = (data ?? []).flatMap((row) => {
    const workspaceValue = (row as Record<string, unknown>).workspaces
    const workspace =
      Array.isArray(workspaceValue) ? workspaceValue[0] : workspaceValue

    const pbiWorkspaceId =
      workspace && typeof workspace === "object"
        ? (workspace as Record<string, unknown>).pbi_workspace_id
        : undefined

    return typeof pbiWorkspaceId === "string" && pbiWorkspaceId.trim()
      ? [pbiWorkspaceId.trim()]
      : []
  })

  return Array.from(new Set(pbiWorkspaceIds))
}

export async function getWorkspaceAccessScope(
  supabase: SupabaseClient,
  context: WorkspaceAccessContext
): Promise<WorkspaceAccessScope> {
  if (context.role === "admin" || !context.workspaceAccessConfigured) {
    return {
      restricted: false,
      workspaceIds: [],
      pbiWorkspaceIds: [],
    }
  }

  const { data, error } = await supabase
    .from("user_workspace_access")
    .select("workspace_id, workspaces!inner(pbi_workspace_id)")
    .eq("company_id", context.companyId)
    .eq("user_id", context.userId)

  if (error) {
    if (isMissingRelationError(error)) {
      if (context.selectedPbiWorkspaceIds.length === 0) {
        return {
          restricted: true,
          workspaceIds: [],
          pbiWorkspaceIds: [],
        }
      }

      const { data: workspaces, error: workspacesError } = await supabase
        .from("workspaces")
        .select("id, pbi_workspace_id")
        .eq("company_id", context.companyId)
        .in("pbi_workspace_id", context.selectedPbiWorkspaceIds)

      if (workspacesError) throw new Error(workspacesError.message)

      return {
        restricted: true,
        workspaceIds: Array.from(new Set((workspaces ?? []).map((workspace) => workspace.id))),
        pbiWorkspaceIds: Array.from(
          new Set((workspaces ?? []).map((workspace) => String(workspace.pbi_workspace_id ?? "")))
        ).filter(Boolean),
      }
    }

    throw new Error(error.message)
  }

  const workspaceIds: string[] = []
  const pbiWorkspaceIds: string[] = []

  for (const row of data ?? []) {
    const workspaceId = (row as Record<string, unknown>).workspace_id
    if (typeof workspaceId === "string" && workspaceId.trim()) {
      workspaceIds.push(workspaceId.trim())
    }

    const workspaceValue = (row as Record<string, unknown>).workspaces
    const workspace =
      Array.isArray(workspaceValue) ? workspaceValue[0] : workspaceValue
    const pbiWorkspaceId =
      workspace && typeof workspace === "object"
        ? (workspace as Record<string, unknown>).pbi_workspace_id
        : undefined

    if (typeof pbiWorkspaceId === "string" && pbiWorkspaceId.trim()) {
      pbiWorkspaceIds.push(pbiWorkspaceId.trim())
    }
  }

  return {
    restricted: true,
    workspaceIds: Array.from(new Set(workspaceIds)),
    pbiWorkspaceIds: Array.from(new Set(pbiWorkspaceIds)),
  }
}

export async function syncUserWorkspaceAccess(
  supabase: SupabaseClient,
  params: {
    userId: string
    companyId: string
    selectedPbiWorkspaceIds: string[]
  }
) {
  const selectedPbiWorkspaceIds = normalizePbiWorkspaceIds(params.selectedPbiWorkspaceIds)

  const { error: deleteError } = await supabase
    .from("user_workspace_access")
    .delete()
    .eq("company_id", params.companyId)
    .eq("user_id", params.userId)

  if (deleteError) {
    if (isMissingRelationError(deleteError)) {
      return
    }

    throw new Error(deleteError.message)
  }

  if (selectedPbiWorkspaceIds.length === 0) {
    return
  }

  const { data: workspaces, error: workspacesError } = await supabase
    .from("workspaces")
    .select("id, pbi_workspace_id")
    .eq("company_id", params.companyId)
    .in("pbi_workspace_id", selectedPbiWorkspaceIds)

  if (workspacesError) throw new Error(workspacesError.message)

  const rows = (workspaces ?? []).map((workspace) => ({
    user_id: params.userId,
    company_id: params.companyId,
    workspace_id: workspace.id,
  }))

  if (rows.length === 0) {
    return
  }

  const { error: insertError } = await supabase
    .from("user_workspace_access")
    .upsert(rows, { onConflict: "user_id,workspace_id" })

  if (insertError) {
    if (isMissingRelationError(insertError)) {
      return
    }

    throw new Error(insertError.message)
  }
}
