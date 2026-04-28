import { createServiceClient as createClient } from "@/lib/supabase/server"
import type { PowerBIConfig } from "@/lib/types"
import { getRequestContext } from "@/lib/tenant"

const PBI_API_BASE = "https://api.powerbi.com/v1.0/myorg"

type EmbedTokenCacheEntry = {
  token: string
  expiresAt: number
}

type CachedValue<T> = {
  value: T
  expiresAt: number
}

type DatasetMetadataSnapshot = {
  tables: Array<{ name: string; description: string; isHidden: boolean }>
  columns: Array<{
    tableName: string
    columnName: string
    dataType: string
    isHidden: boolean
    expression?: string
  }>
  measures: Array<{
    tableName: string
    measureName: string
    expression: string
    dataType?: string
    isHidden: boolean
  }>
}

const embedTokenCache = new Map<string, EmbedTokenCacheEntry>()
const accessTokenCache = new Map<string, EmbedTokenCacheEntry>()
const powerBiConfigCache = new Map<string, CachedValue<PowerBIConfig>>()
const datasetMetadataCache = new Map<string, CachedValue<DatasetMetadataSnapshot>>()
const datasetMetadataRequestCache = new Map<string, Promise<DatasetMetadataSnapshot>>()

const POWERBI_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000
const DATASET_METADATA_CACHE_TTL_MS = 10 * 60 * 1000

type ParsedPowerBiError = {
  code: string | null
  message: string
  raw: string
}

export class PowerBiApiError extends Error {
  status: number
  statusText: string
  code: string | null
  raw: string

  constructor(input: {
    action: string
    status: number
    statusText: string
    code?: string | null
    message: string
    raw?: string
  }) {
    const normalizedStatusText = input.statusText.trim() || "Erro"
    const detail = input.code ? `${input.code}: ${input.message}` : input.message

    super(`${input.action} (${input.status} ${normalizedStatusText}): ${detail}`)
    this.name = "PowerBiApiError"
    this.status = input.status
    this.statusText = normalizedStatusText
    this.code = input.code ?? null
    this.raw = input.raw ?? ""
  }
}

function parsePowerBiError(raw: string): ParsedPowerBiError {
  const normalizedRaw = raw.trim()

  if (!normalizedRaw) {
    return {
      code: null,
      message: "",
      raw: "",
    }
  }

  try {
    const parsed = JSON.parse(normalizedRaw) as
      | {
          error?: {
            code?: string
            message?: string
            ["pbi.error"]?: {
              code?: string
              message?: string
            }
          }
          message?: string
        }
      | undefined

    const nestedError = parsed?.error?.["pbi.error"]
    const code =
      typeof parsed?.error?.code === "string"
        ? parsed.error.code
        : typeof nestedError?.code === "string"
          ? nestedError.code
          : null

    const message =
      (typeof parsed?.error?.message === "string" && parsed.error.message.trim()) ||
      (typeof nestedError?.message === "string" && nestedError.message.trim()) ||
      (typeof parsed?.message === "string" && parsed.message.trim()) ||
      code ||
      normalizedRaw

    return {
      code,
      message,
      raw: normalizedRaw,
    }
  } catch {
    return {
      code: null,
      message: normalizedRaw,
      raw: normalizedRaw,
    }
  }
}

async function throwPowerBiApiError(action: string, response: Response): Promise<never> {
  const raw = (await response.text().catch(() => "")).trim()
  const parsed = parsePowerBiError(raw)
  const fallbackMessage = parsed.message || `${response.status} ${response.statusText}`.trim()

  throw new PowerBiApiError({
    action,
    status: response.status,
    statusText: response.statusText,
    code: parsed.code,
    message: fallbackMessage,
    raw: parsed.raw,
  })
}

export function isPowerBiEntityNotFoundError(error: unknown) {
  if (error instanceof PowerBiApiError) {
    return error.code === "PowerBIEntityNotFound"
  }

  const message = error instanceof Error ? error.message : String(error)
  return /PowerBIEntityNotFound/i.test(message)
}

export function isPowerBiFeatureNotAvailableError(error: unknown) {
  if (error instanceof PowerBiApiError) {
    return error.code === "FeatureNotAvailableError"
  }

  const message = error instanceof Error ? error.message : String(error)
  return /FeatureNotAvailableError/i.test(message)
}

async function getConfig(): Promise<PowerBIConfig> {
  const { companyId } = await getRequestContext()
  return getConfigForCompany(companyId)
}

async function getConfigForCompany(companyId: string): Promise<PowerBIConfig> {
  const cached = powerBiConfigCache.get(companyId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const supabase = await createClient()

  const { data } = await supabase
    .from("company_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", "powerbi")
    .single()

  if (!data?.value) {
    throw new Error("Configuracoes do Power BI nao encontradas")
  }

  const config = data.value as unknown as PowerBIConfig

  powerBiConfigCache.set(companyId, {
    value: config,
    expiresAt: Date.now() + POWERBI_CONFIG_CACHE_TTL_MS,
  })

  return config
}

export async function getAccessToken(companyId?: string): Promise<string> {
  const config = companyId
    ? await getConfigForCompany(companyId)
    : await getConfig()

  if (!config.tenant_id || !config.client_id || !config.client_secret) {
    throw new Error(
      "Credenciais do Power BI incompletas. Configure em Configuracoes."
    )
  }

  const cacheKey = `${config.tenant_id}:${config.client_id}`
  const SAFETY_MARGIN_MS = 5 * 60 * 1000

  const cached = accessTokenCache.get(cacheKey)
  if (cached && cached.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
    return cached.token
  }

  const tokenUrl = `https://login.microsoftonline.com/${config.tenant_id}/oauth2/v2.0/token`

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.client_id,
    client_secret: config.client_secret,
    scope: "https://analysis.windows.net/powerbi/api/.default",
  })

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Falha ao obter token Power BI: ${err}`)
  }

  const json = await res.json()
  const accessToken = String(json.access_token ?? "")
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600
  const expiresAt = Date.now() + expiresIn * 1000

  accessTokenCache.set(cacheKey, { token: accessToken, expiresAt })

  return accessToken
}

export async function listWorkspaces(token: string) {
  const res = await fetch(`${PBI_API_BASE}/groups`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    await throwPowerBiApiError("Falha ao listar workspaces", res)
  }

  const json = await res.json()
  return json.value as Array<{ id: string; name: string; isReadOnly: boolean }>
}

export async function listReports(token: string, workspaceId: string) {
  const res = await fetch(`${PBI_API_BASE}/groups/${workspaceId}/reports`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    await throwPowerBiApiError(`Falha ao listar relatorios do workspace ${workspaceId}`, res)
  }

  const json = await res.json()
  return json.value as Array<{
    id: string
    name: string
    webUrl: string
    embedUrl: string
    datasetId: string
  }>
}

export async function listReportPages(
  token: string,
  workspaceId: string,
  reportId: string
) {
  const res = await fetch(
    `${PBI_API_BASE}/groups/${workspaceId}/reports/${reportId}/pages`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  if (!res.ok) {
    await throwPowerBiApiError(
      `Falha ao listar paginas do relatorio ${reportId}`,
      res
    )
  }

  const json = await res.json()
  return json.value as Array<{
    name: string
    displayName: string
    order: number
  }>
}

export async function generateReportEmbedToken(
  token: string,
  workspaceId: string,
  reportId: string
) {
  const cacheKey = `${workspaceId}:${reportId}`
  const SAFETY_MARGIN_MS = 5 * 60 * 1000

  const cached = embedTokenCache.get(cacheKey)
  if (cached && cached.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
    return cached.token
  }

  const body: Record<string, unknown> = {
    accessLevel: "View",
    allowSaveAs: false,
  }

  const response = await fetch(
    `${PBI_API_BASE}/groups/${workspaceId}/reports/${reportId}/GenerateToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    await throwPowerBiApiError("Falha ao gerar token de exibicao do Power BI", response)
  }

  const data = (await response.json()) as { token?: string | null; expiration?: string | null }
  const embedToken = typeof data.token === "string" ? data.token.trim() : ""

  if (!embedToken) {
    throw new Error("Power BI nao retornou token de exibicao para o relatorio")
  }

  const expiresAt = data.expiration
    ? Date.parse(data.expiration)
    : Date.now() + 60 * 60 * 1000

  embedTokenCache.set(cacheKey, { token: embedToken, expiresAt })

  return embedToken
}

export async function exportReport(
  token: string,
  workspaceId: string,
  reportId: string,
  format: "PDF" | "PNG" | "PPTX",
  options?: {
    pageNames?: string[] | null
    pageName?: string | null
  }
) {
  const pageNames = Array.isArray(options?.pageNames)
    ? [...new Set(options.pageNames.map((pageName) => pageName.trim()).filter(Boolean))]
    : []
  const fallbackPageName =
    typeof options?.pageName === "string" && options.pageName.trim()
      ? options.pageName.trim()
      : null
  const selectedPageNames =
    pageNames.length > 0 ? pageNames : fallbackPageName ? [fallbackPageName] : []

  const body =
    selectedPageNames.length > 0
      ? {
          format,
          powerBIReportConfiguration: {
            pages: selectedPageNames.map((pageName) => ({ pageName })),
            settings: {
              layoutType: "Print",
            },
          },
        }
      : {
          format,
          powerBIReportConfiguration: {
            settings: {
              layoutType: "Print",
            },
          },
        }

  const res = await fetch(
    `${PBI_API_BASE}/groups/${workspaceId}/reports/${reportId}/ExportTo`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  )

  if (!res.ok) {
    await throwPowerBiApiError("Falha ao iniciar exportacao", res)
  }

  const json = await res.json()
  return json as { id: string; status: string; percentComplete: number }
}

export async function getExportStatus(
  token: string,
  workspaceId: string,
  reportId: string,
  exportId: string
) {
  const res = await fetch(
    `${PBI_API_BASE}/groups/${workspaceId}/reports/${reportId}/exports/${exportId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  if (!res.ok) {
    await throwPowerBiApiError("Falha ao verificar status da exportacao", res)
  }

  return res.json() as Promise<{
    id: string
    status: string
    percentComplete: number
    resourceLocation: string
  }>
}

export async function getExportFile(
  token: string,
  workspaceId: string,
  reportId: string,
  exportId: string
): Promise<ArrayBuffer> {
  const res = await fetch(
    `${PBI_API_BASE}/groups/${workspaceId}/reports/${reportId}/exports/${exportId}/file`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  if (!res.ok) {
    await throwPowerBiApiError("Falha ao baixar arquivo exportado", res)
  }

  return res.arrayBuffer()
}

export async function listDatasets(token: string, workspaceId: string) {
  const res = await fetch(`${PBI_API_BASE}/groups/${workspaceId}/datasets`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    await throwPowerBiApiError(`Falha ao listar datasets do workspace ${workspaceId}`, res)
  }

  const json = await res.json()
  return json.value as Array<{
    id: string
    name: string
    configuredBy: string
    isRefreshable: boolean
  }>
}

export async function executeDAXQuery(
  token: string,
  datasetId: string,
  query: string
) {
  const res = await fetch(`${PBI_API_BASE}/datasets/${datasetId}/executeQueries`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      queries: [{ query }],
      serializerSettings: { includeNulls: true },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Falha ao executar DAX: ${err}`)
  }

  const json = await res.json()
  const result = json.results?.[0]

  if (!result || !result.tables?.[0]) {
    return { columns: [], rows: [] }
  }

  const table = result.tables[0]
  const rawRows = (table.rows || []) as Array<Record<string, unknown>>

  function cleanKey(key: string) {
    return String(key).replace(/^\[/, "").replace(/\]$/, "")
  }

  const rows = rawRows.map((row) => {
    const normalized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      normalized[cleanKey(key)] = value
    }
    return normalized
  })

  const fallbackColumns =
    rows.length > 0
      ? Object.keys(rows[0]).map((name) => ({
          name,
          dataType: typeof rows[0][name] === "number" ? "Int64" : "String",
        }))
      : []

  const columns =
    table.columns?.map((c: { name: string; dataType: string }) => ({
      name: cleanKey(c.name),
      dataType: c.dataType || "string",
    })) || fallbackColumns

  return {
    columns,
    rows,
  }
}

export async function getDatasetMetadata(token: string, datasetId: string) {
  const cached = datasetMetadataCache.get(datasetId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const pendingRequest = datasetMetadataRequestCache.get(datasetId)
  if (pendingRequest) {
    return pendingRequest
  }

  const request = (async () => {
  const [tablesResult, columnsResult, measuresResult] = await Promise.all([
    executeDAXQuery(token, datasetId, "EVALUATE INFO.VIEW.TABLES()"),
    executeDAXQuery(token, datasetId, "EVALUATE INFO.VIEW.COLUMNS()"),
    executeDAXQuery(token, datasetId, "EVALUATE INFO.VIEW.MEASURES()"),
  ])

  function pick(row: Record<string, unknown>, key: string) {
    return row[key] ?? row[`[${key}]`] ?? ""
  }

  const tables = tablesResult.rows
    .map((r: Record<string, unknown>) => ({
      name: String(pick(r, "Name")),
      description: String(pick(r, "Description")),
      isHidden: Boolean(pick(r, "IsHidden")),
    }))
    .filter((table) => {
      if (!table.name) return false
      if (table.name.startsWith("DateTableTemplate")) return false
      if (table.name.startsWith("LocalDateTable")) return false
      if (table.name.startsWith("RowNumber")) return false
      return true
    })

  const columns = columnsResult.rows
    .map((r: Record<string, unknown>) => ({
      tableName: String(pick(r, "Table")),
      columnName: String(pick(r, "Name")),
      dataType: String(pick(r, "DataType")),
      isHidden: Boolean(pick(r, "IsHidden")),
      expression: pick(r, "Expression")
        ? String(pick(r, "Expression"))
        : undefined,
    }))
    .filter((column) => {
      if (!column.tableName || !column.columnName) return false
      if (column.isHidden) return false
      if (column.tableName.startsWith("DateTableTemplate")) return false
      if (column.tableName.startsWith("LocalDateTable")) return false
      if (column.tableName.startsWith("RowNumber")) return false
      return true
    })

  const measures = measuresResult.rows
    .map((r: Record<string, unknown>) => ({
      tableName: String(pick(r, "Table")),
      measureName: String(pick(r, "Name")),
      expression: String(pick(r, "Expression") ?? ""),
      dataType: pick(r, "DataType")
        ? String(pick(r, "DataType"))
        : undefined,
      isHidden: Boolean(pick(r, "IsHidden")),
    }))
    .filter((measure) => {
      if (!measure.tableName || !measure.measureName) return false
      if (measure.isHidden) return false
      if (measure.tableName.startsWith("DateTableTemplate")) return false
      if (measure.tableName.startsWith("LocalDateTable")) return false
      if (measure.tableName.startsWith("RowNumber")) return false
      return true
    })

    const metadata = { tables, columns, measures }

    datasetMetadataCache.set(datasetId, {
      value: metadata,
      expiresAt: Date.now() + DATASET_METADATA_CACHE_TTL_MS,
    })

    return metadata
  })()

  datasetMetadataRequestCache.set(datasetId, request)

  try {
    return await request
  } finally {
    datasetMetadataRequestCache.delete(datasetId)
  }
}

type WorkspaceScanStatus = "NotStarted" | "Running" | "Succeeded" | "Failed"

export async function requestWorkspaceScan(token: string, workspaceId: string) {
  const res = await fetch(
    `${PBI_API_BASE}/admin/workspaces/getInfo?datasetSchema=true&datasetExpressions=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaces: [workspaceId],
      }),
    }
  )

  if (!res.ok) {
    await throwPowerBiApiError(`Falha ao solicitar scan do workspace ${workspaceId}`, res)
  }

  const json = await res.json()
  return String(json.id ?? "")
}

export async function getWorkspaceScanStatus(token: string, scanId: string) {
  const res = await fetch(`${PBI_API_BASE}/admin/workspaces/scanStatus/${scanId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    await throwPowerBiApiError(`Falha ao consultar status do scan ${scanId}`, res)
  }

  const json = await res.json()
  return {
    id: String(json.id ?? scanId),
    status: String(json.status ?? "Failed") as WorkspaceScanStatus,
  }
}

export async function getWorkspaceScanResult(token: string, scanId: string) {
  const res = await fetch(`${PBI_API_BASE}/admin/workspaces/scanResult/${scanId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    await throwPowerBiApiError(`Falha ao consultar resultado do scan ${scanId}`, res)
  }

  return res.json() as Promise<Record<string, unknown>>
}
