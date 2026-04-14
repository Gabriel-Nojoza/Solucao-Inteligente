import type { CatalogPayload } from "@/lib/automation-catalog"
import { getCatalogMap, saveCatalogEntries } from "@/lib/automation-catalog"
import {
  getDatasetMetadata,
  getWorkspaceScanResult,
  getWorkspaceScanStatus,
  listDatasets,
  requestWorkspaceScan,
} from "@/lib/powerbi"

type CatalogSyncSource = "scanner_api" | "metadata_api"

type DatasetCatalogSyncResult = {
  dataset_id: string
  table_count: number
  column_count: number
  measure_count: number
  source: CatalogSyncSource
}

export type WorkspaceCatalogSyncResult = {
  imported_datasets: number
  removed_datasets: number
  results: DatasetCatalogSyncResult[]
  warnings: string[]
  source: "scanner_api_bulk" | "metadata_api" | "mixed" | "none"
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toBool(value: unknown) {
  return value === true || value === "true"
}

function toString(value: unknown) {
  return value == null ? "" : String(value)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function buildCatalogFromScannedTables(scannedTables: unknown[]): CatalogPayload {
  const tables = scannedTables.map((table) => {
    const current = table as Record<string, unknown>
    return {
      name: toString(current.name),
      description: toString(current.description),
      isHidden: toBool(current.isHidden),
    }
  })

  const columns = scannedTables.flatMap((table) => {
    const current = table as Record<string, unknown>
    const tableName = toString(current.name)
    const scannedColumns = Array.isArray(current.columns) ? current.columns : []

    return scannedColumns.map((column) => {
      const item = column as Record<string, unknown>

      return {
        tableName,
        columnName: toString(item.name),
        dataType: toString(item.dataType) || "String",
        isHidden: toBool(item.isHidden),
        expression: item.expression ? toString(item.expression) : undefined,
      }
    })
  })

  const measures = scannedTables.flatMap((table) => {
    const current = table as Record<string, unknown>
    const tableName = toString(current.name)
    const scannedMeasures = Array.isArray(current.measures) ? current.measures : []

    return scannedMeasures.map((measure) => {
      const item = measure as Record<string, unknown>

      return {
        tableName,
        measureName: toString(item.name),
        expression: toString(item.expression),
        dataType: item.dataType ? toString(item.dataType) : undefined,
      }
    })
  })

  return { tables, columns, measures }
}

function buildDatasetResult(
  datasetId: string,
  catalog: CatalogPayload,
  source: CatalogSyncSource
): DatasetCatalogSyncResult {
  return {
    dataset_id: datasetId,
    table_count: catalog.tables.length,
    column_count: catalog.columns.length,
    measure_count: catalog.measures.length,
    source,
  }
}

export async function syncWorkspaceCatalogs(input: {
  companyId: string
  token: string
  workspaceId: string
  workspaceLabel?: string
  syncedAt?: string
  timeoutMs?: number
}) {
  const { companyId, token, workspaceId } = input
  const workspaceLabel = input.workspaceLabel?.trim() || workspaceId
  const syncedAt = input.syncedAt ?? new Date().toISOString()
  const timeoutMs = input.timeoutMs ?? 120000
  const warnings: string[] = []
  const results: DatasetCatalogSyncResult[] = []
  const catalogEntries: Record<string, { workspace_id: string; updated_at: string; catalog: CatalogPayload }> =
    {}

  const datasets = await listDatasets(token, workspaceId)
  const validDatasets = datasets.filter((dataset) => dataset.id)
  const pendingDatasetIds = new Set(validDatasets.map((dataset) => dataset.id))

  let scannerImportedCount = 0
  let metadataImportedCount = 0

  if (pendingDatasetIds.size > 0) {
    try {
      const scanId = await requestWorkspaceScan(token, workspaceId)

      if (!scanId) {
        throw new Error("Power BI nao retornou scanId")
      }

      const startedAt = Date.now()
      let status = "Running"

      while (Date.now() - startedAt < timeoutMs) {
        const check = await getWorkspaceScanStatus(token, scanId)
        status = check.status

        if (status === "Succeeded") {
          break
        }

        if (status === "Failed") {
          throw new Error("Scan do workspace falhou no Power BI")
        }

        await wait(2500)
      }

      if (status !== "Succeeded") {
        throw new Error("Timeout aguardando scan do Power BI")
      }

      const result = await getWorkspaceScanResult(token, scanId)
      const scannedWorkspaces = Array.isArray(result.workspaces) ? result.workspaces : []
      const scannedWorkspace = scannedWorkspaces.find(
        (workspace) => toString((workspace as Record<string, unknown>).id) === workspaceId
      ) as Record<string, unknown> | undefined

      if (!scannedWorkspace) {
        throw new Error("Workspace nao encontrado no resultado do scan")
      }

      const scannedDatasets = Array.isArray(scannedWorkspace.datasets)
        ? scannedWorkspace.datasets
        : []

      for (const dataset of scannedDatasets) {
        const current = dataset as Record<string, unknown>
        const datasetId = toString(current.id)

        if (!datasetId || !pendingDatasetIds.has(datasetId)) {
          continue
        }

        const scannedTables = Array.isArray(current.tables) ? current.tables : []
        const catalog = buildCatalogFromScannedTables(scannedTables)

        catalogEntries[datasetId] = {
          workspace_id: workspaceId,
          updated_at: syncedAt,
          catalog,
        }
        results.push(buildDatasetResult(datasetId, catalog, "scanner_api"))
        pendingDatasetIds.delete(datasetId)
        scannerImportedCount++
      }

      if (pendingDatasetIds.size > 0) {
        warnings.push(
          `Scanner API nao retornou ${pendingDatasetIds.size} dataset(s) do workspace ${workspaceLabel}. Tentando metadata padrao.`
        )
      }
    } catch (error) {
      warnings.push(
        `Nao foi possivel atualizar os catalogos do workspace ${workspaceLabel} via Scanner API. ${getErrorMessage(error)}`
      )
    }
  }

  for (const dataset of validDatasets) {
    if (!pendingDatasetIds.has(dataset.id)) {
      continue
    }

    try {
      const metadata = await getDatasetMetadata(token, dataset.id)
      const catalog: CatalogPayload = {
        tables: metadata.tables,
        columns: metadata.columns,
        measures: metadata.measures,
      }

      catalogEntries[dataset.id] = {
        workspace_id: workspaceId,
        updated_at: syncedAt,
        catalog,
      }
      results.push(buildDatasetResult(dataset.id, catalog, "metadata_api"))
      metadataImportedCount++
    } catch (error) {
      warnings.push(
        `Nao foi possivel atualizar o dataset ${dataset.name || dataset.id} do workspace ${workspaceLabel}. ${getErrorMessage(error)}`
      )
    }
  }

  const currentDatasetIds = new Set(validDatasets.map((dataset) => dataset.id))
  const catalogMap = await getCatalogMap(companyId)
  const staleDatasetIds = Object.entries(catalogMap)
    .filter(([datasetId, entry]) => entry?.workspace_id === workspaceId && !currentDatasetIds.has(datasetId))
    .map(([datasetId]) => datasetId)

  await saveCatalogEntries(companyId, catalogEntries, {
    removeDatasetIds: staleDatasetIds,
  })

  let source: WorkspaceCatalogSyncResult["source"] = "none"
  if (scannerImportedCount > 0 && metadataImportedCount > 0) {
    source = "mixed"
  } else if (scannerImportedCount > 0) {
    source = "scanner_api_bulk"
  } else if (metadataImportedCount > 0) {
    source = "metadata_api"
  }

  return {
    imported_datasets: results.length,
    removed_datasets: staleDatasetIds.length,
    results,
    warnings,
    source,
  } satisfies WorkspaceCatalogSyncResult
}
