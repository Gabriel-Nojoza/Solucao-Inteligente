type WorkspaceAccessSupabase = {
  from: (table: string) => any
}

type MetadataCarrier = {
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}

export type WorkspaceAccessContext = {
  userId: string
  companyId: string
  role: "admin" | "client"
  workspaceAccessConfigured: boolean
  datasetAccessConfigured: boolean
  selectedPbiWorkspaceIds: string[]
  selectedPbiDatasetIds: string[]
}

export type WorkspaceAccessScope = {
  workspaceRestricted: boolean
  datasetRestricted: boolean
  workspaceIds: string[]
  pbiWorkspaceIds: string[]
  datasetIds: string[]
}

export type WorkspaceAccessOption = {
  id: string
  name: string
  dataset_count?: number
  datasets?: DatasetAccessOption[]
}

export type DatasetAccessOption = {
  id: string
  name: string
}

export type PbiDatasetSelection = {
  workspaceId: string
  datasetId: string
}

type WorkspaceRecord = {
  id?: unknown
  pbi_workspace_id?: unknown
  name?: unknown
}

type WorkspaceAccessRow = {
  workspace_id?: unknown
  workspaces?: unknown
}

type DatasetAccessRow = {
  dataset_id?: unknown
  workspace_id?: unknown
  workspaces?: unknown
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
    message.includes("user_workspace_access") ||
    message.includes("user_dataset_access")
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

export function isDatasetAccessConfigured(user: MetadataCarrier) {
  return (
    readBoolean(user.app_metadata?.dataset_access_configured) ||
    readBoolean(user.user_metadata?.dataset_access_configured)
  )
}

export function getSelectedPbiDatasetIds(user: MetadataCarrier) {
  const fromApp = normalizePbiDatasetIds(user.app_metadata?.selected_pbi_dataset_ids)
  if (fromApp.length > 0) {
    return fromApp
  }

  return normalizePbiDatasetIds(user.user_metadata?.selected_pbi_dataset_ids)
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

export function normalizePbiDatasetIds(input: unknown) {
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

export function normalizePbiDatasetSelections(input: unknown): PbiDatasetSelection[] {
  if (!Array.isArray(input)) return []

  const entries = input.flatMap((value) => {
    if (!value || typeof value !== "object") return []

    const record = value as Record<string, unknown>
    const workspaceIdSource = record.workspaceId ?? record.workspace_id
    const datasetIdSource = record.datasetId ?? record.dataset_id
    const workspaceId =
      typeof workspaceIdSource === "string" ? workspaceIdSource.trim() : ""
    const datasetId =
      typeof datasetIdSource === "string" ? datasetIdSource.trim() : ""

    return workspaceId && datasetId ? [{ workspaceId, datasetId }] : []
  })

  return Array.from(
    new Map(
      entries.map((entry) => [`${entry.workspaceId}::${entry.datasetId}`, entry])
    ).values()
  )
}

export async function getCompanyWorkspaceOptions(
  supabase: WorkspaceAccessSupabase,
  companyId: string
): Promise<WorkspaceAccessOption[]> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("name, pbi_workspace_id")
    .eq("company_id", companyId)
    .order("name")

  if (error) throw new Error(error.message)

  return (data ?? []).map((workspace: { pbi_workspace_id?: unknown; name?: unknown }) => ({
    id: String(workspace.pbi_workspace_id ?? ""),
    name: String(workspace.name ?? ""),
  }))
}

export async function getUserAssignedPbiWorkspaceIds(
  supabase: WorkspaceAccessSupabase,
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

  const pbiWorkspaceIds = (data ?? []).flatMap((row: WorkspaceAccessRow) => {
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

export async function getUserAssignedPbiDatasetIds(
  supabase: WorkspaceAccessSupabase,
  userId: string,
  companyId: string,
  fallbackUser?: MetadataCarrier
) {
  const { data, error } = await supabase
    .from("user_dataset_access")
    .select("dataset_id")
    .eq("company_id", companyId)
    .eq("user_id", userId)

  if (error) {
    if (isMissingRelationError(error)) {
      return fallbackUser ? getSelectedPbiDatasetIds(fallbackUser) : null
    }

    throw new Error(error.message)
  }

  const datasetIds = (data ?? []).flatMap((row: { dataset_id?: unknown }) => {
    const datasetId = row.dataset_id
    return typeof datasetId === "string" && datasetId.trim()
      ? [datasetId.trim()]
      : []
  })

  return Array.from(new Set(datasetIds))
}

function collectWorkspaceIdsFromRelation(
  rows: Array<WorkspaceAccessRow | DatasetAccessRow>
) {
  const workspaceIds: string[] = []
  const pbiWorkspaceIds: string[] = []

  for (const row of rows) {
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
    workspaceIds: Array.from(new Set(workspaceIds)),
    pbiWorkspaceIds: Array.from(new Set(pbiWorkspaceIds)),
  }
}

export function isWorkspaceAllowed(
  scope: WorkspaceAccessScope,
  input: { workspaceId?: string | null; pbiWorkspaceId?: string | null }
) {
  const hasEffectiveWorkspaceRestriction =
    scope.workspaceRestricted ||
    (scope.datasetRestricted &&
      (scope.workspaceIds.length > 0 || scope.pbiWorkspaceIds.length > 0))

  if (!hasEffectiveWorkspaceRestriction) {
    return true
  }

  if (input.workspaceId && scope.workspaceIds.includes(input.workspaceId)) {
    return true
  }

  if (input.pbiWorkspaceId && scope.pbiWorkspaceIds.includes(input.pbiWorkspaceId)) {
    return true
  }

  return false
}

export function isDatasetAllowed(
  scope: WorkspaceAccessScope,
  datasetId: string | null | undefined
) {
  if (!scope.datasetRestricted) {
    return true
  }

  return typeof datasetId === "string" && scope.datasetIds.includes(datasetId)
}

export async function getWorkspaceAccessScope(
  supabase: WorkspaceAccessSupabase,
  context: WorkspaceAccessContext
): Promise<WorkspaceAccessScope> {
  const workspaceRestricted =
    context.role !== "admin" && context.workspaceAccessConfigured
  const datasetRestricted =
    context.role !== "admin" && context.datasetAccessConfigured

  if (!workspaceRestricted && !datasetRestricted) {
    return {
      workspaceRestricted: false,
      datasetRestricted: false,
      workspaceIds: [],
      pbiWorkspaceIds: [],
      datasetIds: [],
    }
  }

  let workspaceIds: string[] = []
  let pbiWorkspaceIds: string[] = []
  let datasetIds: string[] = []

  if (workspaceRestricted) {
    const { data, error } = await supabase
      .from("user_workspace_access")
      .select("workspace_id, workspaces!inner(pbi_workspace_id)")
      .eq("company_id", context.companyId)
      .eq("user_id", context.userId)

    if (error) {
      if (isMissingRelationError(error)) {
        if (context.selectedPbiWorkspaceIds.length > 0) {
          const { data: workspaces, error: workspacesError } = await supabase
            .from("workspaces")
            .select("id, pbi_workspace_id")
            .eq("company_id", context.companyId)
            .in("pbi_workspace_id", context.selectedPbiWorkspaceIds)

          if (workspacesError) throw new Error(workspacesError.message)

          workspaceIds = Array.from(
            new Set(
              (workspaces ?? []).flatMap((workspace: WorkspaceRecord) =>
                typeof workspace.id === "string" && workspace.id.trim()
                  ? [workspace.id.trim()]
                  : []
              )
            )
          )
          pbiWorkspaceIds = Array.from(
            new Set(
              (workspaces ?? []).flatMap((workspace: WorkspaceRecord) =>
                typeof workspace.pbi_workspace_id === "string" &&
                workspace.pbi_workspace_id.trim()
                  ? [workspace.pbi_workspace_id.trim()]
                  : []
              )
            )
          )
        }
      } else {
        throw new Error(error.message)
      }
    } else {
      const idsFromWorkspaceScope = collectWorkspaceIdsFromRelation(
        (data ?? []) as WorkspaceAccessRow[]
      )
      workspaceIds = idsFromWorkspaceScope.workspaceIds
      pbiWorkspaceIds = idsFromWorkspaceScope.pbiWorkspaceIds
    }
  }

  if (datasetRestricted) {
    const { data, error } = await supabase
      .from("user_dataset_access")
      .select("dataset_id, workspace_id, workspaces!inner(pbi_workspace_id)")
      .eq("company_id", context.companyId)
      .eq("user_id", context.userId)

    if (error) {
      if (isMissingRelationError(error)) {
        datasetIds = context.selectedPbiDatasetIds
      } else {
        throw new Error(error.message)
      }
    } else {
      const datasetRows = (data ?? []) as DatasetAccessRow[]
      datasetIds = Array.from(
        new Set(
          datasetRows.flatMap((row) =>
            typeof row.dataset_id === "string" && row.dataset_id.trim()
              ? [row.dataset_id.trim()]
              : []
          )
        )
      )

      const idsFromDatasetScope = collectWorkspaceIdsFromRelation(datasetRows)
      workspaceIds = Array.from(
        new Set([...workspaceIds, ...idsFromDatasetScope.workspaceIds])
      )
      pbiWorkspaceIds = Array.from(
        new Set([...pbiWorkspaceIds, ...idsFromDatasetScope.pbiWorkspaceIds])
      )
    }
  }

  return {
    workspaceRestricted,
    datasetRestricted,
    workspaceIds,
    pbiWorkspaceIds,
    datasetIds: Array.from(new Set(datasetIds)),
  }
}

export async function syncUserWorkspaceAccess(
  supabase: WorkspaceAccessSupabase,
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

  const rows = (workspaces ?? []).map((workspace: WorkspaceRecord) => ({
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

export async function syncUserDatasetAccess(
  supabase: WorkspaceAccessSupabase,
  params: {
    userId: string
    companyId: string
    selectedDatasets: PbiDatasetSelection[]
  }
) {
  const selectedDatasets = normalizePbiDatasetSelections(params.selectedDatasets)

  const { error: deleteError } = await supabase
    .from("user_dataset_access")
    .delete()
    .eq("company_id", params.companyId)
    .eq("user_id", params.userId)

  if (deleteError) {
    if (isMissingRelationError(deleteError)) {
      return
    }

    throw new Error(deleteError.message)
  }

  if (selectedDatasets.length === 0) {
    return
  }

  const pbiWorkspaceIds = Array.from(
    new Set(selectedDatasets.map((entry) => entry.workspaceId))
  )

  const { data: workspaces, error: workspacesError } = await supabase
    .from("workspaces")
    .select("id, pbi_workspace_id")
    .eq("company_id", params.companyId)
    .in("pbi_workspace_id", pbiWorkspaceIds)

  if (workspacesError) throw new Error(workspacesError.message)

  const workspaceMap = new Map(
    (workspaces ?? []).flatMap((workspace: WorkspaceRecord) =>
      typeof workspace.id === "string" &&
      workspace.id.trim() &&
      typeof workspace.pbi_workspace_id === "string" &&
      workspace.pbi_workspace_id.trim()
        ? [[workspace.pbi_workspace_id.trim(), workspace.id.trim()] as const]
        : []
    )
  )

  const rows = Array.from(
    new Map(
      selectedDatasets.flatMap((entry) => {
        const workspaceId = workspaceMap.get(entry.workspaceId)
        if (!workspaceId) return []

        const row = {
          user_id: params.userId,
          company_id: params.companyId,
          workspace_id: workspaceId,
          dataset_id: entry.datasetId,
        }

        return [[`${row.user_id}::${row.dataset_id}`, row] as const]
      })
    ).values()
  )

  if (rows.length === 0) {
    return
  }

  const { error: insertError } = await supabase
    .from("user_dataset_access")
    .upsert(rows, { onConflict: "user_id,dataset_id" })

  if (insertError) {
    if (isMissingRelationError(insertError)) {
      return
    }

    throw new Error(insertError.message)
  }
}
