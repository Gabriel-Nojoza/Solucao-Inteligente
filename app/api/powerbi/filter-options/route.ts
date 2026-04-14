import { NextResponse } from "next/server"
import { getAccessToken, executeDAXQuery, listDatasets } from "@/lib/powerbi"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getCatalogMap, getExecutionTarget } from "@/lib/automation-catalog"
import { getRequestContext } from "@/lib/tenant"
import {
  getWorkspaceAccessScope,
  isDatasetAllowed,
  isWorkspaceAllowed,
} from "@/lib/workspace-access"

const MAX_FILTER_OPTIONS = 200

function mapExecuteError(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro desconhecido"

  if (message.includes("Dataset nao pertence a empresa do usuario")) {
    return {
      status: 403,
      code: "DATASET_NOT_ALLOWED",
      error: "Dataset nao pertence a empresa do usuario.",
    }
  }

  return {
    status: 500,
    code: "FILTER_OPTIONS_ERROR",
    error: message,
  }
}

function escapeDaxTableName(value: string) {
  return value.replace(/'/g, "''")
}

function escapeDaxColumnName(value: string) {
  return value.replace(/\]/g, "]]")
}

function isDateLikeDataType(dataType: string) {
  const normalized = dataType.toLowerCase()
  return normalized.includes("date") || normalized.includes("time")
}

function isNumericDataType(dataType: string) {
  const normalized = dataType.toLowerCase()
  return (
    normalized.includes("int") ||
    normalized.includes("double") ||
    normalized.includes("decimal") ||
    normalized.includes("number")
  )
}

function buildDistinctValuesQuery(
  tableName: string,
  columnName: string,
  dataType: string
) {
  const colRef = `'${escapeDaxTableName(tableName)}'[${escapeDaxColumnName(columnName)}]`
  const hasStringValues = !isNumericDataType(dataType) && !isDateLikeDataType(dataType)
  const filterExpression = hasStringValues
    ? `NOT ISBLANK(${colRef}) && LEN(TRIM(${colRef} & "")) > 0`
    : `NOT ISBLANK(${colRef})`

  return [
    "DEFINE",
    "VAR __Values =",
    `  FILTER(VALUES(${colRef}), ${filterExpression})`,
    "VAR __Projected =",
    `  SELECTCOLUMNS(__Values, "Value", ${colRef})`,
    "EVALUATE",
    `  TOPN(${MAX_FILTER_OPTIONS}, __Projected, [Value], ASC)`,
    "ORDER BY",
    "  [Value] ASC",
  ].join("\n")
}

export async function GET(request: Request) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)
    const { searchParams } = new URL(request.url)
    const datasetId = searchParams.get("datasetId")?.trim() || ""
    const tableName = searchParams.get("tableName")?.trim() || ""
    const columnName = searchParams.get("columnName")?.trim() || ""
    const dataType = searchParams.get("dataType")?.trim() || "String"
    const requestedExecutionDatasetId =
      searchParams.get("executionDatasetId")?.trim() || ""
    const requestedExecutionWorkspaceId =
      searchParams.get("executionWorkspaceId")?.trim() || ""

    if (!datasetId || !tableName || !columnName) {
      return NextResponse.json(
        { error: "datasetId, tableName e columnName sao obrigatorios" },
        { status: 400 }
      )
    }

    if (!isDatasetAllowed(scope, datasetId)) {
      return NextResponse.json(
        { error: "Dataset nao permitido para este usuario." },
        { status: 403 }
      )
    }

    const { data: report } = await supabase
      .from("reports")
      .select("id")
      .eq("company_id", companyId)
      .eq("dataset_id", datasetId)
      .limit(1)
      .maybeSingle()

    const catalogs = await getCatalogMap(companyId)
    const catalogEntry = catalogs[datasetId]

    if (!report && !catalogEntry) {
      return NextResponse.json(
        { error: "Dataset nao pertence a empresa do usuario" },
        { status: 403 }
      )
    }

    const token = await getAccessToken()
    const savedExecutionTarget = getExecutionTarget(catalogEntry, datasetId)
    const effectiveExecutionDatasetId =
      requestedExecutionDatasetId || savedExecutionTarget.datasetId
    const effectiveExecutionWorkspaceId =
      requestedExecutionWorkspaceId || savedExecutionTarget.workspaceId || null

    if (effectiveExecutionDatasetId !== datasetId) {
      if (!isDatasetAllowed(scope, effectiveExecutionDatasetId)) {
        return NextResponse.json(
          { error: "Dataset auxiliar de execucao nao permitido para este usuario." },
          { status: 403 }
        )
      }

      if (
        effectiveExecutionWorkspaceId &&
        !isWorkspaceAllowed(scope, { pbiWorkspaceId: effectiveExecutionWorkspaceId })
      ) {
        return NextResponse.json(
          { error: "Workspace auxiliar de execucao nao permitido para este usuario." },
          { status: 403 }
        )
      }

      const { data: executionReport } = await supabase
        .from("reports")
        .select("id")
        .eq("company_id", companyId)
        .eq("dataset_id", effectiveExecutionDatasetId)
        .limit(1)
        .maybeSingle()

      const executionCatalogEntry = catalogs[effectiveExecutionDatasetId]

      let executionAllowed = Boolean(executionReport || executionCatalogEntry)

      if (!executionAllowed && effectiveExecutionWorkspaceId) {
        const { data: workspace } = await supabase
          .from("workspaces")
          .select("id")
          .eq("company_id", companyId)
          .eq("pbi_workspace_id", effectiveExecutionWorkspaceId)
          .single()

        if (workspace) {
          const datasets = await listDatasets(token, effectiveExecutionWorkspaceId)
          executionAllowed = datasets.some((dataset) => dataset.id === effectiveExecutionDatasetId)
        }
      }

      if (!executionAllowed) {
        return NextResponse.json(
          { error: "Dataset auxiliar de execucao nao pertence a empresa do usuario." },
          { status: 403 }
        )
      }
    }

    const query = buildDistinctValuesQuery(tableName, columnName, dataType)
    const result = await executeDAXQuery(token, effectiveExecutionDatasetId, query)
    const options = Array.from(
      new Set(
        result.rows
          .map((row) => {
            const firstValue = Object.values(row)[0]
            return firstValue == null ? "" : String(firstValue).trim()
          })
          .filter(Boolean)
      )
    )

    return NextResponse.json({
      options,
      truncated: options.length >= MAX_FILTER_OPTIONS,
      executed_dataset_id: effectiveExecutionDatasetId,
    })
  } catch (error) {
    const mapped = mapExecuteError(error)
    return NextResponse.json(
      { error: mapped.error, code: mapped.code },
      { status: mapped.status }
    )
  }
}
