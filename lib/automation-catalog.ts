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
}

export type CatalogMap = Record<string, CatalogEntry>

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

  return raw as CatalogMap
}

export async function saveCatalogEntry(
  companyId: string,
  datasetId: string,
  entry: CatalogEntry
) {
  const supabase = createClient()
  const catalogs = await getCatalogMap(companyId)
  catalogs[datasetId] = entry

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

  return catalogs
}
