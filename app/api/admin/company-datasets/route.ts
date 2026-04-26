import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getAccessToken, listDatasets } from "@/lib/powerbi"
import { requireAdminContext } from "@/lib/tenant"

type WorkspaceRow = {
  id: string
  name: string
  pbi_workspace_id: string
}

type ReportRow = {
  id: string
  name: string
  dataset_id: string | null
  workspace_id: string
}

type DatasetOption = {
  id: string
  name: string
  datasetId: string
}

type CompanyDatasetsResponse = {
  workspaces: WorkspaceRow[]
  datasetsByWorkspace: Record<string, DatasetOption[]>
  defaultWorkspaceId: string | null
  defaultDatasetId: string | null
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function sortDatasetOptions(datasets: DatasetOption[]) {
  return datasets.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

function buildFallbackDatasetsByWorkspace(input: {
  workspaces: WorkspaceRow[]
  reports: ReportRow[]
  chatIaDatasetId: string
  chatIaDatasetName: string
  chatIaWorkspaceId: string
}) {
  const datasetsByWorkspace: Record<string, DatasetOption[]> = {}

  for (const workspace of input.workspaces) {
    const reportRows = input.reports.filter((report) => report.workspace_id === workspace.id)
    const datasetMap = new Map<string, DatasetOption>()

    for (const report of reportRows) {
      const datasetId = typeof report.dataset_id === "string" ? report.dataset_id.trim() : ""
      if (!datasetId) continue

      const preferredName =
        datasetId === input.chatIaDatasetId && input.chatIaDatasetName
          ? input.chatIaDatasetName
          : report.name

      if (!datasetMap.has(datasetId)) {
        datasetMap.set(datasetId, {
          id: datasetId,
          name: preferredName,
          datasetId,
        })
        continue
      }

      if (datasetId === input.chatIaDatasetId && input.chatIaDatasetName) {
        datasetMap.set(datasetId, {
          id: datasetId,
          name: input.chatIaDatasetName,
          datasetId,
        })
      }
    }

    if (
      input.chatIaDatasetId &&
      input.chatIaDatasetName &&
      input.chatIaWorkspaceId === workspace.pbi_workspace_id &&
      !datasetMap.has(input.chatIaDatasetId)
    ) {
      datasetMap.set(input.chatIaDatasetId, {
        id: input.chatIaDatasetId,
        name: input.chatIaDatasetName,
        datasetId: input.chatIaDatasetId,
      })
    }

    datasetsByWorkspace[workspace.id] = sortDatasetOptions(
      Array.from(datasetMap.values())
    )
  }

  return datasetsByWorkspace
}

async function buildLiveDatasetsByWorkspace(
  companyId: string,
  workspaces: WorkspaceRow[]
) {
  const token = await getAccessToken(companyId)
  const entries = await Promise.all(
    workspaces.map(async (workspace) => {
      try {
        const datasets = await listDatasets(token, workspace.pbi_workspace_id)
        const options = sortDatasetOptions(
          datasets.flatMap((dataset) => {
            const datasetId = typeof dataset.id === "string" ? dataset.id.trim() : ""
            const datasetName = typeof dataset.name === "string" ? dataset.name.trim() : ""

            return datasetId
              ? [
                  {
                    id: datasetId,
                    name: datasetName || datasetId,
                    datasetId,
                  } satisfies DatasetOption,
                ]
              : []
          })
        )

        return [workspace.id, options] as const
      } catch {
        return [workspace.id, null] as const
      }
    })
  )

  return Object.fromEntries(entries) as Record<string, DatasetOption[] | null>
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminContext()
    const supabase = getAdminClient()

    const companyId = new URL(request.url).searchParams.get("companyId")
    if (!companyId) {
      return NextResponse.json({ error: "companyId obrigatorio" }, { status: 400 })
    }

    const [{ data: workspaces }, { data: reports }, { data: chatIaRow }] =
      await Promise.all([
        supabase
          .from("workspaces")
          .select("id, name, pbi_workspace_id")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("reports")
          .select("id, name, dataset_id, workspace_id")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .not("dataset_id", "is", null)
          .order("name"),
        supabase
          .from("company_settings")
          .select("value")
          .eq("company_id", companyId)
          .eq("key", "chat_ia")
          .maybeSingle(),
      ])

    const normalizedWorkspaces = (workspaces ?? []) as WorkspaceRow[]
    const normalizedReports = (reports ?? []) as ReportRow[]
    const chatIaValue = chatIaRow?.value as Record<string, unknown> | null
    const chatIaDatasetId =
      typeof chatIaValue?.dataset_id === "string" ? chatIaValue.dataset_id.trim() : ""
    const chatIaDatasetName =
      typeof chatIaValue?.dataset_name === "string" ? chatIaValue.dataset_name.trim() : ""
    const chatIaWorkspaceId =
      typeof chatIaValue?.workspace_id === "string" ? chatIaValue.workspace_id.trim() : ""

    const fallbackDatasetsByWorkspace = buildFallbackDatasetsByWorkspace({
      workspaces: normalizedWorkspaces,
      reports: normalizedReports,
      chatIaDatasetId,
      chatIaDatasetName,
      chatIaWorkspaceId,
    })

    const liveDatasetsByWorkspace = await buildLiveDatasetsByWorkspace(
      companyId,
      normalizedWorkspaces
    ).catch(() => null)

    const datasetsByWorkspace = Object.fromEntries(
      normalizedWorkspaces.map((workspace) => [
        workspace.id,
        liveDatasetsByWorkspace?.[workspace.id] ??
          fallbackDatasetsByWorkspace[workspace.id] ??
          [],
      ])
    )

    const defaultWorkspace =
      normalizedWorkspaces.find(
        (workspace) => workspace.pbi_workspace_id === chatIaWorkspaceId
      ) ?? null
    const defaultWorkspaceId = defaultWorkspace?.id ?? null
    const defaultDatasetId =
      defaultWorkspaceId &&
      chatIaDatasetId &&
      (datasetsByWorkspace[defaultWorkspaceId] ?? []).some(
        (dataset) => dataset.datasetId === chatIaDatasetId
      )
        ? chatIaDatasetId
        : null

    return NextResponse.json({
      workspaces: normalizedWorkspaces,
      datasetsByWorkspace,
      defaultWorkspaceId,
      defaultDatasetId,
    } satisfies CompanyDatasetsResponse)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro" },
      { status: 500 }
    )
  }
}
