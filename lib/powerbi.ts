import { createClient } from "@/lib/supabase/server"
import type { PowerBIConfig } from "@/lib/types"

const PBI_API_BASE = "https://api.powerbi.com/v1.0/myorg"

async function getConfig(): Promise<PowerBIConfig> {
  const supabase = createClient()
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "powerbi")
    .single()

  if (!data?.value) {
    throw new Error("Configuracoes do Power BI nao encontradas")
  }
  return data.value as unknown as PowerBIConfig
}

export async function getAccessToken(): Promise<string> {
  const config = await getConfig()

  if (!config.tenant_id || !config.client_id || !config.client_secret) {
    throw new Error("Credenciais do Power BI incompletas. Configure em Configuracoes.")
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
  return json.access_token
}

export async function listWorkspaces(token: string) {
  const res = await fetch(`${PBI_API_BASE}/groups`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("Falha ao listar workspaces")
  const json = await res.json()
  return json.value as Array<{ id: string; name: string; isReadOnly: boolean }>
}

export async function listReports(token: string, workspaceId: string) {
  const res = await fetch(`${PBI_API_BASE}/groups/${workspaceId}/reports`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("Falha ao listar relatorios")
  const json = await res.json()
  return json.value as Array<{
    id: string
    name: string
    webUrl: string
    embedUrl: string
    datasetId: string
  }>
}

export async function exportReport(
  token: string,
  workspaceId: string,
  reportId: string,
  format: "PDF" | "PNG" | "PPTX"
) {
  const res = await fetch(
    `${PBI_API_BASE}/groups/${workspaceId}/reports/${reportId}/ExportTo`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        format,
      }),
    }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Falha ao iniciar exportacao: ${err}`)
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
  if (!res.ok) throw new Error("Falha ao verificar status da exportacao")
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
  if (!res.ok) throw new Error("Falha ao baixar arquivo exportado")
  return res.arrayBuffer()
}

// === Dataset Metadata & DAX Queries ===

export async function listDatasets(token: string, workspaceId: string) {
  const res = await fetch(
    `${PBI_API_BASE}/groups/${workspaceId}/datasets`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) throw new Error("Falha ao listar datasets")
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
  const res = await fetch(
    `${PBI_API_BASE}/datasets/${datasetId}/executeQueries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        queries: [{ query }],
        serializerSettings: { includeNulls: true },
      }),
    }
  )
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
  return {
    columns: table.columns?.map((c: { name: string; dataType: string }) => ({
      name: c.name,
      dataType: c.dataType || "string",
    })) || [],
    rows: table.rows || [],
  }
}

export async function getDatasetMetadata(token: string, datasetId: string) {
  // Use DMV queries to get tables, columns, and measures
  const [tablesResult, columnsResult, measuresResult] = await Promise.all([
    executeDAXQuery(
      token,
      datasetId,
      "EVALUATE SELECTCOLUMNS(INFO.TABLES(), \"Name\", [Name], \"IsHidden\", [IsHidden], \"Description\", [Description])"
    ),
    executeDAXQuery(
      token,
      datasetId,
      "EVALUATE SELECTCOLUMNS(INFO.COLUMNS(), \"TableName\", [TableName], \"ColumnName\", [ExplicitName], \"DataType\", [DataType], \"IsHidden\", [IsHidden], \"Expression\", [Expression])"
    ),
    executeDAXQuery(
      token,
      datasetId,
      "EVALUATE SELECTCOLUMNS(INFO.MEASURES(), \"TableName\", [TableName], \"MeasureName\", [Name], \"Expression\", [Expression], \"DataType\", [DataType])"
    ),
  ])

  const tables = tablesResult.rows.map((r: Record<string, unknown>) => ({
    name: String(r["[Name]"] ?? ""),
    description: String(r["[Description]"] ?? ""),
    isHidden: Boolean(r["[IsHidden]"]),
  }))

  const columns = columnsResult.rows.map((r: Record<string, unknown>) => ({
    tableName: String(r["[TableName]"] ?? ""),
    columnName: String(r["[ColumnName]"] ?? ""),
    dataType: String(r["[DataType]"] ?? ""),
    isHidden: Boolean(r["[IsHidden]"]),
    expression: r["[Expression]"] ? String(r["[Expression]"]) : undefined,
  }))

  const measures = measuresResult.rows.map((r: Record<string, unknown>) => ({
    tableName: String(r["[TableName]"] ?? ""),
    measureName: String(r["[MeasureName]"] ?? ""),
    expression: String(r["[Expression]"] ?? ""),
    dataType: r["[DataType]"] ? String(r["[DataType]"]) : undefined,
  }))

  return { tables, columns, measures }
}

export function buildDAXQuery(
  selectedColumns: Array<{ tableName: string; columnName: string }>,
  selectedMeasures: Array<{ tableName: string; measureName: string }>,
  filters: Array<{
    tableName: string
    columnName: string
    operator: string
    value: string
    dataType: string
  }>
): string {
  if (selectedColumns.length === 0 && selectedMeasures.length === 0) {
    return "-- Selecione campos para gerar DAX"
  }

  const colRefs = selectedColumns.map(
    (c) => `'${c.tableName}'[${c.columnName}]`
  )
  const measureRefs = selectedMeasures.map(
    (m) => `\"${m.measureName}\", [${m.measureName}]`
  )

  // Build filter expressions
  const filterExprs = filters.map((f) => {
    const colRef = `'${f.tableName}'[${f.columnName}]`
    const val =
      f.dataType === "Int64" || f.dataType === "Double" || f.dataType === "Decimal"
        ? f.value
        : `\"${f.value}\"`
    switch (f.operator) {
      case "eq":
        return `${colRef} = ${val}`
      case "neq":
        return `${colRef} <> ${val}`
      case "gt":
        return `${colRef} > ${val}`
      case "lt":
        return `${colRef} < ${val}`
      case "gte":
        return `${colRef} >= ${val}`
      case "lte":
        return `${colRef} <= ${val}`
      case "contains":
        return `CONTAINSSTRING(${colRef}, \"${f.value}\")`
      case "startswith":
        return `LEFT(${colRef}, ${f.value.length}) = \"${f.value}\"`
      default:
        return `${colRef} = ${val}`
    }
  })

  if (selectedColumns.length > 0) {
    let dax = "EVALUATE\n"
    if (filterExprs.length > 0 || measureRefs.length > 0) {
      dax += "SUMMARIZECOLUMNS(\n"
      dax += `  ${colRefs.join(",\n  ")}`
      if (filterExprs.length > 0) {
        dax += `,\n  FILTER(ALL(${colRefs[0]}), ${filterExprs.join(" && ")})`
      }
      if (measureRefs.length > 0) {
        dax += `,\n  ${measureRefs.join(",\n  ")}`
      }
      dax += "\n)"
    } else {
      dax += `SELECTCOLUMNS(\n  '${selectedColumns[0].tableName}',\n`
      dax += selectedColumns
        .map((c) => `  \"${c.columnName}\", '${c.tableName}'[${c.columnName}]`)
        .join(",\n")
      dax += "\n)"
    }
    return dax
  }

  // Only measures selected
  let dax = "EVALUATE\nROW(\n"
  dax += measureRefs.join(",\n  ")
  dax += "\n)"
  return dax
}
