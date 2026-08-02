import { createServiceClient as createClient } from "@/lib/supabase/server"
import { withCustomChatMeasures } from "@/lib/chat"
import type { PowerBIConfig } from "@/lib/types"
import { getRequestContext } from "@/lib/tenant"
import { redisGet, redisSet } from "@/lib/redis"

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

function applyCustomChatMeasuresToSnapshot(
  metadata: DatasetMetadataSnapshot
): DatasetMetadataSnapshot {
  const enrichedMetadata = withCustomChatMeasures(metadata)

  return {
    tables: metadata.tables.map((table) => ({
      name: table.name,
      description: table.description,
      isHidden: table.isHidden,
    })),
    columns: metadata.columns.map((column) => ({
      tableName: column.tableName,
      columnName: column.columnName,
      dataType: column.dataType,
      isHidden: column.isHidden,
      expression: column.expression,
    })),
    measures: enrichedMetadata.measures.map((measure) => ({
      tableName: measure.tableName,
      measureName: measure.measureName,
      expression: measure.expression,
      dataType: measure.dataType,
      isHidden: Boolean(measure.isHidden),
    })),
  }
}

const embedTokenCache = new Map<string, EmbedTokenCacheEntry>()
const accessTokenCache = new Map<string, EmbedTokenCacheEntry>()
const masterUserTokenCache = new Map<string, EmbedTokenCacheEntry>()
const fabricTokenCache = new Map<string, EmbedTokenCacheEntry>()
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
  console.error(`[PowerBI] ${action} — ${response.status} ${response.statusText}:`, raw)
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

export function isPowerBiDedicatedCapacityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /not on dedicated capacity/i.test(message) || /InvalidRequest/i.test(message) && /dedicated capacity/i.test(message)
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

async function getFabricToken(companyId?: string): Promise<string> {
  const config = companyId
    ? await getConfigForCompany(companyId)
    : await getConfig()

  if (!config.tenant_id || !config.client_id || !config.client_secret) {
    throw new Error("Credenciais incompletas")
  }

  const cacheKey = `pbi:fabric:${config.tenant_id}:${config.client_id}`
  const SAFETY_MARGIN_MS = 5 * 60 * 1000

  const memCachedFabric = fabricTokenCache.get(cacheKey)
  if (memCachedFabric && memCachedFabric.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
    return memCachedFabric.token
  }

  const redisCachedFabric = await redisGet(cacheKey)
  if (redisCachedFabric) {
    try {
      const parsed = JSON.parse(redisCachedFabric) as EmbedTokenCacheEntry
      if (parsed.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
        fabricTokenCache.set(cacheKey, parsed)
        return parsed.token
      }
    } catch {}
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.client_id,
    client_secret: config.client_secret,
    scope: "https://api.fabric.microsoft.com/.default",
  })

  const res = await fetch(
    `https://login.microsoftonline.com/${config.tenant_id}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() }
  )

  if (!res.ok) throw new Error("Falha ao obter token Fabric")

  const json = await res.json()
  const token = String(json.access_token ?? "")
  const expiresAt = Date.now() + (typeof json.expires_in === "number" ? json.expires_in : 3600) * 1000
  const fabricEntry = { token, expiresAt }
  fabricTokenCache.set(cacheKey, fabricEntry)
  const fabricTtl = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000) - 300)
  await redisSet(cacheKey, JSON.stringify(fabricEntry), fabricTtl)
  return token
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

  const cacheKey = `pbi:access:${config.tenant_id}:${config.client_id}`
  const SAFETY_MARGIN_MS = 5 * 60 * 1000

  const memCached = accessTokenCache.get(cacheKey)
  if (memCached && memCached.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
    return memCached.token
  }

  const redisCached = await redisGet(cacheKey)
  if (redisCached) {
    try {
      const parsed = JSON.parse(redisCached) as EmbedTokenCacheEntry
      if (parsed.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
        accessTokenCache.set(cacheKey, parsed)
        return parsed.token
      }
    } catch {}
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

  const accessEntry = { token: accessToken, expiresAt }
  accessTokenCache.set(cacheKey, accessEntry)
  const accessTtl = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000) - 300)
  await redisSet(cacheKey, JSON.stringify(accessEntry), accessTtl)

  return accessToken
}

export async function getAccessTokenMasterUser(companyId?: string): Promise<string> {
  const config = companyId
    ? await getConfigForCompany(companyId)
    : await getConfig()

  if (!config.tenant_id || !config.client_id) {
    throw new Error("Credenciais do Power BI incompletas. Configure em Configuracoes.")
  }

  if (!config.master_user_email || !config.master_user_password) {
    throw new Error(
      "Email e senha do usuario master nao configurados. Configure em Admin > Usuarios > Power BI (Master User)."
    )
  }

  const cacheKey = `pbi:master:${config.tenant_id}:${config.master_user_email}`
  const SAFETY_MARGIN_MS = 5 * 60 * 1000

  const memCached = masterUserTokenCache.get(cacheKey)
  if (memCached && memCached.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
    return memCached.token
  }

  const redisCached = await redisGet(cacheKey)
  if (redisCached) {
    try {
      const parsed = JSON.parse(redisCached) as EmbedTokenCacheEntry
      if (parsed.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
        masterUserTokenCache.set(cacheKey, parsed)
        return parsed.token
      }
    } catch {}
  }

  const tokenUrl = `https://login.microsoftonline.com/${config.tenant_id}/oauth2/v2.0/token`

  const body = new URLSearchParams({
    grant_type: "password",
    client_id: config.client_id,
    username: config.master_user_email,
    password: config.master_user_password,
    scope: "https://analysis.windows.net/powerbi/api/.default",
  })

  if (config.client_secret) {
    body.set("client_secret", config.client_secret)
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Falha ao autenticar usuario master Power BI: ${err}`)
  }

  const json = await res.json()
  const accessToken = String(json.access_token ?? "")
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600
  const expiresAt = Date.now() + expiresIn * 1000

  const entry = { token: accessToken, expiresAt }
  masterUserTokenCache.set(cacheKey, entry)
  const ttl = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000) - 300)
  await redisSet(cacheKey, JSON.stringify(entry), ttl)

  return accessToken
}

export async function listWorkspaces(token: string) {
  const headers = { Authorization: `Bearer ${token}` }

  // Use admin endpoint to list ALL workspaces in the tenant (requires Power BI/Fabric Admin role)
  // Falls back to member-only /groups if admin endpoint is not accessible
  try {
    const adminRes = await fetch(
      `${PBI_API_BASE}/admin/groups?$top=1000&$filter=type eq 'Workspace'`,
      { headers }
    )
    if (adminRes.ok) {
      const adminJson = await adminRes.json()
      const adminWorkspaces = (adminJson.value ?? []) as Array<{ id: string; name: string; isReadOnly: boolean }>
      if (adminWorkspaces.length > 0) {
        return adminWorkspaces
      }
    }
  } catch {
    // fall through to member-only endpoint
  }

  // Fallback: member workspaces + Fabric workspaces
  const pbiRes = await fetch(`${PBI_API_BASE}/groups`, { headers })
  if (!pbiRes.ok) {
    await throwPowerBiApiError("Falha ao listar workspaces", pbiRes)
  }
  const pbiJson = await pbiRes.json()
  const pbiWorkspaces = (pbiJson.value ?? []) as Array<{ id: string; name: string; isReadOnly: boolean }>

  let fabricWorkspaces: Array<{ id: string; name: string; isReadOnly: boolean }> = []
  try {
    const fabricRes = await fetch("https://api.fabric.microsoft.com/v1/workspaces", { headers })
    if (fabricRes.ok) {
      const fabricJson = await fabricRes.json()
      const fabricItems = (fabricJson.value ?? []) as Array<{ id: string; displayName: string }>
      fabricWorkspaces = fabricItems.map((w) => ({ id: w.id, name: w.displayName, isReadOnly: false }))
    }
  } catch {
    // Fabric API unavailable
  }

  const seen = new Set(pbiWorkspaces.map((w) => w.id))
  return [
    ...pbiWorkspaces,
    ...fabricWorkspaces.filter((w) => !seen.has(w.id)),
  ]
}

export async function listReports(token: string, workspaceId: string) {
  const headers = { Authorization: `Bearer ${token}` }

  type ReportItem = { id: string; name: string; webUrl: string; embedUrl: string; datasetId: string }

  // Classic Power BI reports
  const res = await fetch(`${PBI_API_BASE}/groups/${workspaceId}/reports`, { headers })
  if (!res.ok) {
    await throwPowerBiApiError(`Falha ao listar relatorios do workspace ${workspaceId}`, res)
  }
  const json = await res.json()
  const pbiReports = (json.value ?? []) as ReportItem[]
  const seen = new Set(pbiReports.map((r) => r.id))

  // Fabric Report items require a separate token with Fabric scope
  let fabricReports: ReportItem[] = []
  try {
    const fabricToken = await getFabricToken()
    const fabricRes = await fetch(
      `https://api.fabric.microsoft.com/v1/workspaces/${workspaceId}/items?type=Report`,
      { headers: { Authorization: `Bearer ${fabricToken}` } }
    )
    if (fabricRes.ok) {
      const fabricJson = await fabricRes.json()
      const fabricItems = (fabricJson.value ?? []) as Array<{ id: string; displayName: string }>
      fabricReports = fabricItems
        .filter((item) => !seen.has(item.id))
        .map((item) => ({
          id: item.id,
          name: item.displayName,
          webUrl: `https://app.powerbi.com/groups/${workspaceId}/reports/${item.id}`,
          embedUrl: `https://app.powerbi.com/reportEmbed?reportId=${item.id}&groupId=${workspaceId}`,
          datasetId: "",
        }))
    }
  } catch {
    // Fabric API unavailable or token fetch failed
  }

  return [...pbiReports, ...fabricReports]
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
  reportId: string,
  datasetId?: string
) {
  const cacheKey = `pbi:embed:${workspaceId}:${reportId}`
  const SAFETY_MARGIN_MS = 5 * 60 * 1000

  const memCachedEmbed = embedTokenCache.get(cacheKey)
  if (memCachedEmbed && memCachedEmbed.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
    return memCachedEmbed.token
  }

  const redisCachedEmbed = await redisGet(cacheKey)
  if (redisCachedEmbed) {
    try {
      const parsed = JSON.parse(redisCachedEmbed) as EmbedTokenCacheEntry
      if (parsed.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
        embedTokenCache.set(cacheKey, parsed)
        return parsed.token
      }
    } catch {}
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

  const embedEntry = { token: embedToken, expiresAt }
  embedTokenCache.set(cacheKey, embedEntry)
  const embedTtl = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000) - 300)
  await redisSet(cacheKey, JSON.stringify(embedEntry), embedTtl)

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

  const layoutType = format === "PNG" ? "FitToPage" : "Print"

  const body =
    selectedPageNames.length > 0
      ? {
          format,
          powerBIReportConfiguration: {
            pages: selectedPageNames.map((pageName) => ({ pageName })),
            settings: {
              layoutType,
            },
          },
        }
      : {
          format,
          powerBIReportConfiguration: {
            settings: {
              layoutType,
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

export async function getDatasetMetadata(
  token: string,
  datasetId: string,
  options?: { forceRefresh?: boolean; includeCustomChatMeasures?: boolean }
): Promise<DatasetMetadataSnapshot> {
  const forceRefresh = options?.forceRefresh === true
  const includeCustomChatMeasures = options?.includeCustomChatMeasures !== false

  if (!forceRefresh) {
    const cached = datasetMetadataCache.get(datasetId)
    if (cached && cached.expiresAt > Date.now()) {
      return includeCustomChatMeasures
        ? applyCustomChatMeasuresToSnapshot(cached.value)
        : cached.value
    }
  }

  const requestCacheKey = forceRefresh ? `${datasetId}:force` : datasetId
  const pendingRequest = datasetMetadataRequestCache.get(requestCacheKey)
  if (pendingRequest) {
    const metadata = await pendingRequest
    return includeCustomChatMeasures
      ? applyCustomChatMeasuresToSnapshot(metadata)
      : metadata
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
      if (measure.tableName.startsWith("DateTableTemplate")) return false
      if (measure.tableName.startsWith("LocalDateTable")) return false
      if (measure.tableName.startsWith("RowNumber")) return false
      return true
    })

    const rawMetadata: DatasetMetadataSnapshot = {
      tables: tables.map((table) => ({
        name: table.name,
        description: table.description,
        isHidden: table.isHidden,
      })),
      columns: columns.map((column) => ({
        tableName: column.tableName,
        columnName: column.columnName,
        dataType: column.dataType,
        isHidden: column.isHidden,
        expression: column.expression,
      })),
      measures: measures.map((measure) => ({
        tableName: measure.tableName,
        measureName: measure.measureName,
        expression: measure.expression,
        dataType: measure.dataType,
        isHidden: Boolean(measure.isHidden),
      })),
    }

    datasetMetadataCache.set(datasetId, {
      value: rawMetadata,
      expiresAt: Date.now() + DATASET_METADATA_CACHE_TTL_MS,
    })

    return rawMetadata
  })()

  datasetMetadataRequestCache.set(requestCacheKey, request)

  try {
    const metadata = await request
    return includeCustomChatMeasures
      ? applyCustomChatMeasuresToSnapshot(metadata)
      : metadata
  } finally {
    datasetMetadataRequestCache.delete(requestCacheKey)
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

export async function getDatasetLastRefresh(
  token: string,
  workspaceId: string,
  datasetId: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `${PBI_API_BASE}/groups/${workspaceId}/datasets/${datasetId}/refreshes?$top=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return null
    const data = await res.json() as { value?: Array<{ endTime?: string; startTime?: string }> }
    const latest = data?.value?.[0]
    return latest?.endTime ?? latest?.startTime ?? null
  } catch {
    return null
  }
}

export async function listPageVisuals(
  token: string,
  workspaceId: string,
  reportId: string,
  pageName: string
): Promise<Array<{ id: string; title: string; type: string }>> {
  try {
    const url = `${PBI_API_BASE}/groups/${workspaceId}/reports/${reportId}/pages/${pageName}/visuals`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const text = await res.text()
    if (!res.ok) {
      console.log("[audio] listPageVisuals erro", res.status, text.slice(0, 300))
      return []
    }
    const json = JSON.parse(text) as { value?: Array<{ id: string; title: string; type: string }> }
    return json.value ?? []
  } catch (err) {
    console.log("[audio] listPageVisuals exception", err instanceof Error ? err.message : err)
    return []
  }
}

function parseCSVRow(line: string): string[] {
  const values: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim())
      current = ""
    } else {
      current += char
    }
  }
  values.push(current.trim())
  return values
}

export async function exportVisualData(
  token: string,
  workspaceId: string,
  reportId: string,
  pageName: string,
  visualId: string
): Promise<Array<Record<string, unknown>>> {
  try {
    const res = await fetch(
      `${PBI_API_BASE}/groups/${workspaceId}/reports/${reportId}/pages/${pageName}/visuals/${visualId}/exportData`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rows: 50 }),
      }
    )
    if (!res.ok) return []
    const json = await res.json() as { data?: string }
    if (!json.data) return []

    const lines = json.data.trim().split("\n")
    if (lines.length < 2) return []
    const headers = parseCSVRow(lines[0])
    return lines.slice(1).map((line) => {
      const values = parseCSVRow(line)
      return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]))
    })
  } catch {
    return []
  }
}
