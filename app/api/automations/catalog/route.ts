import { NextRequest, NextResponse } from "next/server"
import { getRequestContext } from "@/lib/tenant"
import { getCatalogMap, isValidCatalog, saveCatalogEntry } from "@/lib/automation-catalog"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import {
  getWorkspaceAccessScope,
  isDatasetAllowed,
  isWorkspaceAllowed,
} from "@/lib/workspace-access"

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)
    const { searchParams } = new URL(request.url)
    const datasetId = searchParams.get("datasetId")?.trim()

    if (!datasetId) {
      return NextResponse.json(
        { error: "datasetId obrigatorio" },
        { status: 400 }
      )
    }

    if (!isDatasetAllowed(scope, datasetId)) {
      return NextResponse.json(
        { error: "Dataset nao permitido para este usuario." },
        { status: 403 }
      )
    }

    const catalogs = await getCatalogMap(companyId)
    const entry = catalogs[datasetId]

    if (!entry || !isValidCatalog(entry.catalog)) {
      return NextResponse.json({
        catalog: null,
        updated_at: null,
        workspace_id: null,
        execution_dataset_id: null,
        execution_workspace_id: null,
        execution_dataset_name: null,
      })
    }

    return NextResponse.json({
      catalog: entry.catalog,
      updated_at: entry.updated_at ?? null,
      workspace_id: entry.workspace_id ?? null,
      execution_dataset_id: entry.execution_dataset_id ?? null,
      execution_workspace_id: entry.execution_workspace_id ?? null,
      execution_dataset_name: entry.execution_dataset_name ?? null,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar catalogo" },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)
    const catalogs = await getCatalogMap(companyId)
    const body = await request.json()

    const datasetId = String(body?.datasetId ?? "").trim()
    const workspaceId = String(body?.workspaceId ?? "").trim()
    const catalog = body?.catalog
    const existing = catalogs[datasetId]

    const hasExecutionDatasetId = Object.prototype.hasOwnProperty.call(body, "executionDatasetId")
    const hasExecutionWorkspaceId = Object.prototype.hasOwnProperty.call(body, "executionWorkspaceId")
    const hasExecutionDatasetName = Object.prototype.hasOwnProperty.call(body, "executionDatasetName")

    const executionDatasetId = String(body?.executionDatasetId ?? "").trim()
    const executionWorkspaceId = String(body?.executionWorkspaceId ?? "").trim()
    const executionDatasetName = String(body?.executionDatasetName ?? "").trim()

    if (!datasetId) {
      return NextResponse.json(
        { error: "datasetId obrigatorio" },
        { status: 400 }
      )
    }

    if (!isDatasetAllowed(scope, datasetId)) {
      return NextResponse.json(
        { error: "Dataset nao permitido para este usuario." },
        { status: 403 }
      )
    }

    if (workspaceId && !isWorkspaceAllowed(scope, { pbiWorkspaceId: workspaceId })) {
      return NextResponse.json(
        { error: "Workspace nao permitido para este usuario." },
        { status: 403 }
      )
    }

    if (
      hasExecutionDatasetId &&
      executionDatasetId &&
      !isDatasetAllowed(scope, executionDatasetId)
    ) {
      return NextResponse.json(
        { error: "Dataset auxiliar de execucao nao permitido para este usuario." },
        { status: 403 }
      )
    }

    if (
      hasExecutionWorkspaceId &&
      executionWorkspaceId &&
      !isWorkspaceAllowed(scope, { pbiWorkspaceId: executionWorkspaceId })
    ) {
      return NextResponse.json(
        { error: "Workspace auxiliar de execucao nao permitido para este usuario." },
        { status: 403 }
      )
    }

    const nextCatalog = catalog ?? existing?.catalog

    if (!isValidCatalog(nextCatalog)) {
      return NextResponse.json(
        { error: "catalog invalido: esperado { tables: [], columns: [], measures: [] }" },
        { status: 400 }
      )
    }

    const updatedCatalogs = await saveCatalogEntry(companyId, datasetId, {
      workspace_id: workspaceId || existing?.workspace_id || null,
      updated_at: new Date().toISOString(),
      catalog: nextCatalog,
      execution_dataset_id: hasExecutionDatasetId ? executionDatasetId || null : undefined,
      execution_workspace_id: hasExecutionWorkspaceId ? executionWorkspaceId || null : undefined,
      execution_dataset_name: hasExecutionDatasetName ? executionDatasetName || null : undefined,
    })

    return NextResponse.json({
      success: true,
      catalog: updatedCatalogs[datasetId],
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar catalogo" },
      { status: 500 }
    )
  }
}
