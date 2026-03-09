import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"
import { getAccessToken, getWorkspaceScanResult, getWorkspaceScanStatus, requestWorkspaceScan } from "@/lib/powerbi"
import { saveCatalogEntry } from "@/lib/automation-catalog"

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toBool(value: unknown) {
  return value === true || value === "true"
}

function toString(value: unknown) {
  return value == null ? "" : String(value)
}

export async function POST(request: NextRequest) {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const body = await request.json()
    const workspaceId = String(body?.workspaceId ?? "").trim()

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId obrigatorio" },
        { status: 400 }
      )
    }

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id")
      .eq("company_id", companyId)
      .eq("pbi_workspace_id", workspaceId)
      .single()

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace nao pertence a empresa do usuario" },
        { status: 403 }
      )
    }

    const token = await getAccessToken()
    const scanId = await requestWorkspaceScan(token, workspaceId)
    if (!scanId) {
      return NextResponse.json(
        { error: "Power BI nao retornou scanId" },
        { status: 500 }
      )
    }

    const timeoutMs = 120000
    const start = Date.now()
    let status = "Running"

    while (Date.now() - start < timeoutMs) {
      const check = await getWorkspaceScanStatus(token, scanId)
      status = check.status
      if (status === "Succeeded") break
      if (status === "Failed") {
        return NextResponse.json(
          { error: "Scan do workspace falhou no Power BI" },
          { status: 500 }
        )
      }
      await wait(2500)
    }

    if (status !== "Succeeded") {
      return NextResponse.json(
        { error: "Timeout aguardando scan do Power BI" },
        { status: 504 }
      )
    }

    const result = await getWorkspaceScanResult(token, scanId)
    const workspaces = Array.isArray(result.workspaces) ? result.workspaces : []
    const scannedWorkspace = workspaces.find(
      (ws) => toString((ws as Record<string, unknown>).id) === workspaceId
    ) as Record<string, unknown> | undefined

    if (!scannedWorkspace) {
      return NextResponse.json(
        { error: "Workspace nao encontrado no resultado do scan" },
        { status: 404 }
      )
    }

    const scannedDatasets = Array.isArray(scannedWorkspace.datasets)
      ? scannedWorkspace.datasets
      : []

    let imported = 0
    const results: Array<{
      dataset_id: string
      table_count: number
      column_count: number
      measure_count: number
    }> = []

    for (const dataset of scannedDatasets) {
      const ds = dataset as Record<string, unknown>
      const datasetId = toString(ds.id)
      if (!datasetId) continue

      const scannedTables = Array.isArray(ds.tables) ? ds.tables : []

      const tables = scannedTables.map((table) => {
        const t = table as Record<string, unknown>
        return {
          name: toString(t.name),
          description: toString(t.description),
          isHidden: toBool(t.isHidden),
        }
      })

      const columns = scannedTables.flatMap((table) => {
        const t = table as Record<string, unknown>
        const tableName = toString(t.name)
        const cols = Array.isArray(t.columns) ? t.columns : []
        return cols.map((column) => {
          const c = column as Record<string, unknown>
          return {
            tableName,
            columnName: toString(c.name),
            dataType: toString(c.dataType) || "String",
            isHidden: toBool(c.isHidden),
            expression: c.expression ? toString(c.expression) : undefined,
          }
        })
      })

      const measures = scannedTables.flatMap((table) => {
        const t = table as Record<string, unknown>
        const tableName = toString(t.name)
        const ms = Array.isArray(t.measures) ? t.measures : []
        return ms.map((measure) => {
          const m = measure as Record<string, unknown>
          return {
            tableName,
            measureName: toString(m.name),
            expression: toString(m.expression),
            dataType: m.dataType ? toString(m.dataType) : undefined,
          }
        })
      })

      await saveCatalogEntry(companyId, datasetId, {
        workspace_id: workspaceId,
        updated_at: new Date().toISOString(),
        catalog: { tables, columns, measures },
      })

      imported++
      results.push({
        dataset_id: datasetId,
        table_count: tables.length,
        column_count: columns.length,
        measure_count: measures.length,
      })
    }

    return NextResponse.json({
      success: true,
      source: "scanner_api_bulk",
      imported_datasets: imported,
      results,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao importar catalogos via scanner" },
      { status: 500 }
    )
  }
}
