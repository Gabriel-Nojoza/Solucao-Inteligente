import { createServiceClient as createClient } from "@/lib/supabase/server"

export type CatalogPayload = {
  tables: Array<Record<string, unknown>>
  columns: Array<Record<string, unknown>>
  measures: Array<Record<string, unknown>>
}

export type CatalogEntry = {
  workspace_id: string | null
  updated_at: string
  catalog: CatalogPayload
  execution_dataset_id?: string | null
  execution_workspace_id?: string | null
  execution_dataset_name?: string | null
}

export type CatalogMap = Record<string, CatalogEntry>

type CatalogCacheEntry = {
  value: CatalogMap
  expiresAt: number
}

const CATALOG_CACHE_TTL_MS = 60 * 1000
const catalogMapCache = new Map<string, CatalogCacheEntry>()

function buildCatalogEntry(
  current: CatalogEntry | undefined,
  entry: Partial<CatalogEntry> & { updated_at: string }
) {
  const nextEntry: CatalogEntry = {
    workspace_id: entry.workspace_id ?? current?.workspace_id ?? null,
    updated_at: entry.updated_at,
    catalog: entry.catalog ?? current?.catalog ?? { tables: [], columns: [], measures: [] },
    execution_dataset_id:
      entry.execution_dataset_id !== undefined
        ? entry.execution_dataset_id
        : current?.execution_dataset_id ?? null,
    execution_workspace_id:
      entry.execution_workspace_id !== undefined
        ? entry.execution_workspace_id
        : current?.execution_workspace_id ?? null,
    execution_dataset_name:
      entry.execution_dataset_name !== undefined
        ? entry.execution_dataset_name
        : current?.execution_dataset_name ?? null,
  }

  if (!isValidCatalog(nextEntry.catalog)) {
    throw new Error("Catalogo invalido")
  }

  return nextEntry
}

async function persistCatalogMap(companyId: string, catalogs: CatalogMap) {
  const supabase = createClient()
  const { error } = await supabase
    .from("company_settings")
    .upsert(
      {
        company_id: companyId,
        key: "automation_catalogs",
        value: catalogs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,key" }
    )

  if (error) throw new Error(error.message)

  catalogMapCache.set(companyId, {
    value: catalogs,
    expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
  })
}

export function isValidCatalog(catalog: unknown): catalog is CatalogPayload {
  if (!catalog || typeof catalog !== "object") return false
  const maybeCatalog = catalog as Record<string, unknown>
  return (
    Array.isArray(maybeCatalog.tables) &&
    Array.isArray(maybeCatalog.columns) &&
    Array.isArray(maybeCatalog.measures)
  )
}

export async function getCatalogMap(companyId: string) {
  const cached = catalogMapCache.get(companyId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const supabase = createClient()
  const { data, error } = await supabase
    .from("company_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", "automation_catalogs")
    .maybeSingle()

  if (error) throw new Error(error.message)

  const raw = data?.value
  if (!raw || typeof raw !== "object") {
    return {} as CatalogMap
  }

  const catalogs = raw as CatalogMap
  catalogMapCache.set(companyId, {
    value: catalogs,
    expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
  })

  return catalogs
}

export async function saveCatalogEntry(
  companyId: string,
  datasetId: string,
  entry: Partial<CatalogEntry> & { updated_at: string }
) {
  return saveCatalogEntries(companyId, {
    [datasetId]: entry,
  })
}

export async function saveCatalogEntries(
  companyId: string,
  entries: Record<string, Partial<CatalogEntry> & { updated_at: string }>,
  options?: { removeDatasetIds?: string[] }
) {
  const catalogs = await getCatalogMap(companyId)

  for (const [datasetId, entry] of Object.entries(entries)) {
    const current = catalogs[datasetId]
    catalogs[datasetId] = buildCatalogEntry(current, entry)
  }

  for (const datasetId of options?.removeDatasetIds ?? []) {
    delete catalogs[datasetId]
  }

  if (Object.keys(entries).length > 0 || (options?.removeDatasetIds?.length ?? 0) > 0) {
    await persistCatalogMap(companyId, catalogs)
  }

  return catalogs
}

export async function removeCatalogEntries(companyId: string, datasetIds: string[]) {
  if (datasetIds.length === 0) {
    return getCatalogMap(companyId)
  }

  return saveCatalogEntries(companyId, {}, { removeDatasetIds: datasetIds })
}

export function getExecutionTarget(
  entry: CatalogEntry | undefined,
  sourceDatasetId: string
) {
  return {
    datasetId: entry?.execution_dataset_id || sourceDatasetId,
    workspaceId: entry?.execution_workspace_id || entry?.workspace_id || null,
    datasetName: entry?.execution_dataset_name || null,
  }
}
