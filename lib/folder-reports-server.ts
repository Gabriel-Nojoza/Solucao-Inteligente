// Acesso ao Supabase para os relatorios da pasta (tabela folder_reports e
// bucket privado "folder-reports"). Ver lib/folder-reports.ts.
import { createServiceClient } from "@/lib/supabase/server"
import {
  FOLDER_REPORT_KEEP_DAYS,
  type FolderReportFolderSummary,
  type FolderReportFormat,
  type FolderReportRecord,
} from "@/lib/folder-reports"

type ServiceClient = ReturnType<typeof createServiceClient>

export const FOLDER_REPORTS_BUCKET = "folder-reports"
export const FOLDER_REPORTS_MIGRATION_HINT =
  "O banco ainda nao suporta relatorios da pasta. Execute a migration 20261109_folder_reports.sql no Supabase."

export const FOLDER_REPORT_COLUMNS =
  "id, folder_key, folder_name, format, file_name, mimetype, size_bytes, storage_path, file_saved_at, received_at"

function getErrorText(error: unknown) {
  if (!error) return ""
  if (typeof error === "string") return error
  if (typeof error === "object") {
    const record = error as Record<string, unknown>
    return [record.message, record.details, record.hint].filter((v) => typeof v === "string").join(" ")
  }
  return String(error)
}

export function isMissingFolderReportsTableError(error: unknown) {
  const text = getErrorText(error)
  return text.includes("folder_reports") && /does not exist|schema cache|could not find/i.test(text)
}

export function isMissingFolderReportColumnsError(error: unknown) {
  const text = getErrorText(error)
  return text.includes("folder_report_configs") || text.includes("folder_last_sent")
}

// O bucket e privado: os relatorios tem dados de clientes e nao podem ter link
// publico, ao contrario do bucket de imagens das campanhas.
export async function ensureFolderReportsBucket(supabase: ServiceClient) {
  const { data: bucket } = await supabase.storage.getBucket(FOLDER_REPORTS_BUCKET)

  if (bucket) {
    if (bucket.public) {
      await supabase.storage.updateBucket(FOLDER_REPORTS_BUCKET, { public: false })
    }
    return
  }

  const { error } = await supabase.storage.createBucket(FOLDER_REPORTS_BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Nao foi possivel criar o armazenamento dos relatorios: ${error.message}`)
  }
}

export async function getLatestFolderReport(
  supabase: ServiceClient,
  companyId: string,
  folderKey: string,
  format: FolderReportFormat
): Promise<FolderReportRecord | null> {
  const { data, error } = await supabase
    .from("folder_reports")
    .select(FOLDER_REPORT_COLUMNS)
    .eq("company_id", companyId)
    .eq("folder_key", folderKey)
    .eq("format", format)
    .order("file_saved_at", { ascending: false })
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(
      isMissingFolderReportsTableError(error) ? FOLDER_REPORTS_MIGRATION_HINT : error.message
    )
  }

  return (data as FolderReportRecord | null) ?? null
}

export async function getFolderReportsByIds(
  supabase: ServiceClient,
  companyId: string,
  ids: string[]
): Promise<FolderReportRecord[]> {
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from("folder_reports")
    .select(FOLDER_REPORT_COLUMNS)
    .eq("company_id", companyId)
    .in("id", ids)

  if (error) {
    throw new Error(
      isMissingFolderReportsTableError(error) ? FOLDER_REPORTS_MIGRATION_HINT : error.message
    )
  }

  const byId = new Map(((data ?? []) as FolderReportRecord[]).map((row) => [row.id, row]))
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
}

// Link temporario para o bot baixar o arquivo do bucket privado. Uma hora da
// folga para a espera de 15 s depois do relatorio do Power BI e para novas
// tentativas.
export async function createFolderReportSignedUrl(supabase: ServiceClient, storagePath: string) {
  const { data, error } = await supabase.storage
    .from(FOLDER_REPORTS_BUCKET)
    .createSignedUrl(storagePath, 60 * 60)

  if (error || !data?.signedUrl) {
    throw new Error(`Nao foi possivel preparar o relatorio guardado: ${error?.message ?? "sem link"}`)
  }

  return data.signedUrl
}

export async function downloadFolderReport(supabase: ServiceClient, storagePath: string) {
  const { data, error } = await supabase.storage.from(FOLDER_REPORTS_BUCKET).download(storagePath)

  if (error || !data) {
    throw new Error(`Nao foi possivel ler o relatorio guardado: ${error?.message ?? "arquivo nao encontrado"}`)
  }

  return Buffer.from(await data.arrayBuffer())
}

// Apaga arquivos com mais de 30 dias da mesma pasta e formato, para nao encher
// o armazenamento. Nunca apaga os ids de keepIds (o que acabou de chegar).
export async function cleanupOldFolderReports(
  supabase: ServiceClient,
  companyId: string,
  folderKey: string,
  format: FolderReportFormat,
  keepIds: string[]
) {
  try {
    const cutoff = new Date(Date.now() - FOLDER_REPORT_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase
      .from("folder_reports")
      .select("id, storage_path")
      .eq("company_id", companyId)
      .eq("folder_key", folderKey)
      .eq("format", format)
      .lt("received_at", cutoff)
      .limit(200)

    if (error) throw error

    const oldRows = (data ?? []).filter((row) => !keepIds.includes(row.id))
    if (oldRows.length === 0) return

    await supabase.storage.from(FOLDER_REPORTS_BUCKET).remove(oldRows.map((row) => row.storage_path))
    await supabase
      .from("folder_reports")
      .delete()
      .eq("company_id", companyId)
      .in("id", oldRows.map((row) => row.id))

    console.log("[folder-reports] limpeza de arquivos antigos", {
      companyId,
      folderKey,
      format,
      removed: oldRows.length,
    })
  } catch (error) {
    console.error("[folder-reports] falha na limpeza de arquivos antigos", {
      companyId,
      folderKey,
      format,
      error: getErrorText(error) || error,
    })
  }
}

// Pastas que o robo ja enviou, com o ultimo arquivo de cada formato. Usado na
// tela de rotinas para o cliente escolher a pasta.
export async function listFolderReportFolders(
  supabase: ServiceClient,
  companyId: string
): Promise<FolderReportFolderSummary[]> {
  const { data, error } = await supabase
    .from("folder_reports")
    .select("folder_key, folder_name, format, file_name, file_saved_at, received_at")
    .eq("company_id", companyId)
    .order("file_saved_at", { ascending: false })
    .limit(1000)

  if (error) {
    throw new Error(
      isMissingFolderReportsTableError(error) ? FOLDER_REPORTS_MIGRATION_HINT : error.message
    )
  }

  const folders = new Map<string, FolderReportFolderSummary>()

  for (const row of data ?? []) {
    const format = row.format as FolderReportFormat
    let folder = folders.get(row.folder_key)

    if (!folder) {
      folder = { folder_key: row.folder_key, folder_name: row.folder_name, latest: {} }
      folders.set(row.folder_key, folder)
    }

    if (!folder.latest[format]) {
      folder.latest[format] = {
        file_name: row.file_name,
        file_saved_at: row.file_saved_at,
        received_at: row.received_at,
      }
    }
  }

  return [...folders.values()].sort((a, b) => a.folder_name.localeCompare(b.folder_name, "pt-BR"))
}
