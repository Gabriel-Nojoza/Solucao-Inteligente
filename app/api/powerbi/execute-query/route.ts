import { NextResponse } from "next/server"
import { getAccessToken, executeDAXQuery, listDatasets } from "@/lib/powerbi"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getCatalogMap, getExecutionTarget } from "@/lib/automation-catalog"
import { buildCsvContent, buildHtmlReport, buildTextReport } from "@/lib/report-export"
import { BRAND_LOGO_PATH } from "@/lib/branding"
import { executeWithQueryFallback } from "@/lib/query-execution-fallback"
import { normalizeFilters } from "@/lib/query-filters"
import { getRequestContext } from "@/lib/tenant"
import type { SelectedColumn, SelectedMeasure } from "@/lib/types"
import {
  getWorkspaceAccessScope,
  isDatasetAllowed,
  isWorkspaceAllowed,
} from "@/lib/workspace-access"

function mapExecuteError(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro desconhecido"

  if (message.includes("exceeds the limit of 2048 MB")) {
    return {
      status: 413,
      code: "DATASET_TOO_LARGE",
      error:
        "Dataset acima de 2GB para executeQueries. Use Premium/Fabric ou um dataset auxiliar para automacoes.",
    }
  }

  if (
    message.includes("cannot be determined") ||
    message.includes("single value for column") ||
    message.includes("A single value for column")
  ) {
    return {
      status: 422,
      code: "INVALID_MEASURE_CONTEXT",
      error:
        "A medida selecionada nao suporta esse agrupamento. Ajuste a medida no Power BI ou escolha outra combinacao de coluna e medida.",
    }
  }

  if (message.includes("Dataset nao pertence a empresa do usuario")) {
    return {
      status: 403,
      code: "DATASET_NOT_ALLOWED",
      error: "Dataset nao pertence a empresa do usuario.",
    }
  }

  return {
    status: 500,
    code: "EXECUTE_QUERY_ERROR",
    error: message,
  }
}

function normalizeSelectedColumns(input: unknown): SelectedColumn[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []

    const record = item as Record<string, unknown>
    const tableName = typeof record.tableName === "string" ? record.tableName.trim() : ""
    const columnName = typeof record.columnName === "string" ? record.columnName.trim() : ""

    return tableName && columnName ? [{ tableName, columnName }] : []
  })
}

function normalizeSelectedMeasures(input: unknown): SelectedMeasure[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []

    const record = item as Record<string, unknown>
    const tableName = typeof record.tableName === "string" ? record.tableName.trim() : ""
    const measureName = typeof record.measureName === "string" ? record.measureName.trim() : ""

    return tableName && measureName ? [{ tableName, measureName }] : []
  })
}

export async function POST(request: Request) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)
    const body = await request.json()
    const { datasetId, query } = body
    const filters = normalizeFilters(body?.filters)
    const selectedColumns = normalizeSelectedColumns(body?.selectedColumns)
    const selectedMeasures = normalizeSelectedMeasures(body?.selectedMeasures)
    const requestedExecutionDatasetId = String(body?.executionDatasetId ?? "").trim()
    const requestedExecutionWorkspaceId = String(body?.executionWorkspaceId ?? "").trim()

    if (!datasetId || !query) {
      return NextResponse.json(
        { error: "datasetId e query sao obrigatorios" },
        { status: 400 }
      )
    }

    if (!isDatasetAllowed(scope, String(datasetId))) {
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
    const catalogEntry = catalogs[String(datasetId)]

    if (!report && !catalogEntry) {
      return NextResponse.json(
        { error: "Dataset nao pertence a empresa do usuario" },
        { status: 403 }
      )
    }

    const token = await getAccessToken()
    const savedExecutionTarget = getExecutionTarget(catalogEntry, String(datasetId))
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

      let executionAllowed: boolean = Boolean(executionReport || executionCatalogEntry)

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

    const execution = await executeWithQueryFallback({
      runQuery: (nextQuery) => executeDAXQuery(token, effectiveExecutionDatasetId, nextQuery),
      query,
      filters,
      selectedColumns,
      selectedMeasures,
    })
    const result = execution.result
    const generatedAt = new Date()
    const reportTitle = String(body?.reportTitle ?? "Resultado da Query")
    const selectedItems = Array.isArray(body?.selectedItems)
      ? body.selectedItems.filter((item: unknown): item is string => typeof item === "string")
      : []
    const reportHtml = buildHtmlReport({
      title: reportTitle,
      subtitle:
        effectiveExecutionDatasetId === datasetId
          ? `Dataset ${datasetId}`
          : `Dataset origem ${datasetId} | Execucao ${effectiveExecutionDatasetId}`,
      generatedAt,
      selectedItems,
      filters: execution.appliedFilters,
      brandLogoUrl: new URL(BRAND_LOGO_PATH, request.url).toString(),
      result,
    })

    return NextResponse.json({
      ...result,
      report: {
        title: reportTitle,
        generated_at: generatedAt.toISOString(),
        executed_dataset_id: effectiveExecutionDatasetId,
        html: reportHtml,
        csv: buildCsvContent(result),
        text: buildTextReport(result),
      },
    })
  } catch (error) {
    const mapped = mapExecuteError(error)
    return NextResponse.json(
      { error: mapped.error, code: mapped.code },
      { status: mapped.status }
    )
  }
}
