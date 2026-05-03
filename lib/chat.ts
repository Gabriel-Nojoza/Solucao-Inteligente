// lib/chat.ts

import type { DatasetTable, DatasetColumn, DatasetMeasure } from "@/lib/types"

const CUSTOM_CHAT_MEASURES: DatasetMeasure[] = [
  {
    tableName: "META",
    measureName: "Meta",
    expression: 'IF([Check] = "ok", SUM(META[VLVENDAPREV]))',
  },
  {
    tableName: "PEDIDOS",
    measureName: "Vl Devolução",
    expression: "[Vl Devolução Venda] + [Vl Devolução Avulsa]",
  },
  {
    tableName: "PEDIDOS",
    measureName: "Pedidos Enviados",
    expression: 'IF([Check] = "ok", SUMX(PEDIDOS, PEDIDOS[QT] * PEDIDOS[PRUNIT]))',
  },
  {
    tableName: "PEDIDOS",
    measureName: "Pedidos Enviados - Dev.",
    expression: '[Pedidos Enviados] - [Vl Devolução]',
  },
  {
    tableName: "PEDIDOS",
    measureName: "$ Tendencia Ped.",
    expression: "DIVIDE([Pedidos Enviados - Dev.], [Dias Realizados]) * [Dias Úteis]",
  },
  {
    tableName: "PEDIDOS",
    measureName: "% Tendencia Ped.",
    expression: "DIVIDE([$ Tendencia Ped.], [Meta])",
  },
]

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: string
  data?: {
    columns: Array<{ name: string; dataType: string }>
    rows: Array<Record<string, unknown>>
  } | null
  daxQuery?: string | null
  confidence?: "high" | "medium" | "low" | null
  error?: string | null
  warning?: string | null
  chartType?: "bar" | "line" | "pie" | null
}

export interface ChatQueryPlan {
  selectedColumns: Array<{ tableName: string; columnName: string }>
  selectedMeasures: Array<{ tableName: string; measureName: string }>
  filters: Array<{
    tableName: string
    columnName: string
    operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "startswith"
    value: string
    valueTo?: string
    dataType: string
  }>
  daxQuery: string
  explanation: string
  confidence: "high" | "medium" | "low"
}

export interface ChatRequest {
  question: string
  datasetId: string
  workspaceId: string
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>
}

export interface ChatApiResponse {
  answer: string
  data: {
    columns: Array<{ name: string; dataType: string }>
    rows: Array<Record<string, unknown>>
  } | null
  daxQuery: string | null
  confidence: "high" | "medium" | "low"
  error?: string
  warning?: string
  chartType?: "bar" | "line" | "pie" | null
}

export interface StructuredChartDataResult {
  columns: Array<{ name: string; dataType: string }>
  rows: Array<Record<string, unknown>>
}

export type DatasetMetadata = {
  tables: DatasetTable[]
  columns: DatasetColumn[]
  measures: DatasetMeasure[]
}

function collectWebhookText(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim()
    if (!text) {
      return []
    }

    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try {
        return collectWebhookText(JSON.parse(text))
      } catch {
        // fall through to treat as plain text
      }
    }

    return [text]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectWebhookText(item))
  }

  if (!value || typeof value !== "object") {
    return []
  }

  const record = value as Record<string, unknown>
  const directTextFields = ["content", "text", "message", "markdown", "value"]

  for (const field of directTextFields) {
    const text = collectWebhookText(record[field])
    if (text.length > 0) {
      return text
    }
  }

  if (Array.isArray(record.items)) {
    return record.items.flatMap((item) =>
      collectWebhookText(item).map((line) =>
        /^[-•*]\s/.test(line) ? line : `- ${line}`
      )
    )
  }

  if (Array.isArray(record.blocks)) {
    return collectWebhookText(record.blocks)
  }

  return []
}

export function extractWebhookAnswer(payload: Record<string, unknown>): string {
  const candidateFields = [
    payload.output,
    payload.answer,
    payload.message,
    payload.response,
    payload.content,
    payload.blocks,
  ]

  for (const candidate of candidateFields) {
    const parts = collectWebhookText(candidate)
    if (parts.length > 0) {
      return parts.join("\n\n").trim()
    }
  }

  return JSON.stringify(payload)
}

function normalizeStructuredChartResult(
  value: unknown
): StructuredChartDataResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  if (!Array.isArray(record.columns) || !Array.isArray(record.rows)) {
    return null
  }

  const columns = record.columns
    .map((column) => {
      if (!column || typeof column !== "object") return null
      const candidate = column as Record<string, unknown>
      const name = typeof candidate.name === "string" ? candidate.name.trim() : ""
      if (!name) return null
      return {
        name,
        dataType: typeof candidate.dataType === "string" ? candidate.dataType : "string",
      }
    })
    .filter((column): column is { name: string; dataType: string } => Boolean(column))

  const rows = record.rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))

  if (columns.length === 0 || rows.length === 0) {
    return null
  }

  return { columns, rows }
}

function extractStructuredChartResultFromUnknown(
  value: unknown
): StructuredChartDataResult | null {
  const direct = normalizeStructuredChartResult(value)
  if (direct) {
    return direct
  }

  if (typeof value === "string") {
    const text = value.trim()
    if (!text) return null

    const directJson =
      (text.startsWith("{") && text.endsWith("}")) ||
      (text.startsWith("[") && text.endsWith("]"))
        ? text
        : null

    if (directJson) {
      try {
        return extractStructuredChartResultFromUnknown(JSON.parse(directJson))
      } catch {
        // ignore invalid JSON
      }
    }

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (fenced?.[1]) {
      try {
        return extractStructuredChartResultFromUnknown(JSON.parse(fenced[1]))
      } catch {
        // ignore invalid fenced JSON
      }
    }

    return null
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractStructuredChartResultFromUnknown(item)
      if (nested) return nested
    }
    return null
  }

  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Record<string, unknown>
  const candidateKeys = [
    "output",
    "answer",
    "message",
    "response",
    "content",
    "text",
    "markdown",
    "value",
    "data",
    "payload",
    "result",
    "blocks",
  ]

  for (const key of candidateKeys) {
    const nested = extractStructuredChartResultFromUnknown(record[key])
    if (nested) return nested
  }

  for (const nestedValue of Object.values(record)) {
    const nested = extractStructuredChartResultFromUnknown(nestedValue)
    if (nested) return nested
  }

  return null
}

export function extractStructuredChartResult(
  payload: unknown
): StructuredChartDataResult | null {
  return extractStructuredChartResultFromUnknown(payload)
}

function normalizeMeasureName(value: string) {
  return value.trim().toLowerCase()
}

export function withCustomChatMeasures(metadata: DatasetMetadata): DatasetMetadata {
  const existingMeasureNames = new Set(
    metadata.measures.map((measure) => normalizeMeasureName(measure.measureName))
  )

  const appendedMeasures = CUSTOM_CHAT_MEASURES.filter(
    (measure) => !existingMeasureNames.has(normalizeMeasureName(measure.measureName))
  )

  if (appendedMeasures.length === 0) {
    return metadata
  }

  return {
    ...metadata,
    measures: [...metadata.measures, ...appendedMeasures],
  }
}

function getReferencedCustomMeasures(daxQuery: string) {
  const normalized = daxQuery.toLowerCase()
  return CUSTOM_CHAT_MEASURES.filter((measure) =>
    normalized.includes(`[${measure.measureName.toLowerCase()}]`)
  )
}

export function injectCustomMeasuresIntoDax(daxQuery: string) {
  const referencedMeasures = getReferencedCustomMeasures(daxQuery)

  if (referencedMeasures.length === 0) {
    return daxQuery
  }

  const measureDefinitions = CUSTOM_CHAT_MEASURES.map(
    (measure) =>
      `  MEASURE '${measure.tableName}'[${measure.measureName}] = ${measure.expression}`
  ).join("\n")

  if (/^\s*DEFINE\b/i.test(daxQuery)) {
    return daxQuery.replace(/^\s*DEFINE\b/i, `DEFINE\n${measureDefinitions}`)
  }

  return `DEFINE\n${measureDefinitions}\n${daxQuery}`
}

function buildSchemaContext(metadata: DatasetMetadata): string {
  const visibleTables = metadata.tables.filter((t) => !t.isHidden)
  const visibleColumns = metadata.columns.filter((c) => !c.isHidden)
  const visibleMeasures = metadata.measures.filter((m) => !m.isHidden)

  const tableLines: string[] = []

  for (const table of visibleTables) {
    const cols = visibleColumns
      .filter((c) => c.tableName === table.name)
      .map((c) => `      - ${c.columnName} (${c.dataType})${c.expression ? " [calculado]" : ""}`)

    const meas = visibleMeasures
      .filter((m) => m.tableName === table.name)
      .map((m) => {
        const isCustom = CUSTOM_CHAT_MEASURES.some(
          (customMeasure) => normalizeMeasureName(customMeasure.measureName) === normalizeMeasureName(m.measureName)
        )
        return `      - [${m.measureName}]${m.dataType ? ` → ${m.dataType}` : ""}${isCustom ? " [customizada]" : ""}`
      })

    tableLines.push(`  Tabela: '${table.name}'`)
    if (cols.length > 0) {
      tableLines.push("    Colunas:")
      tableLines.push(...cols)
    }
    if (meas.length > 0) {
      tableLines.push("    Medidas:")
      tableLines.push(...meas)
    }
  }

  // Tabelas que aparecem em colunas/medidas mas não estão na lista de tables
  const extraTableNames = new Set<string>()
  for (const col of visibleColumns) {
    if (!visibleTables.find((t) => t.name === col.tableName)) {
      extraTableNames.add(col.tableName)
    }
  }
  for (const meas of visibleMeasures) {
    if (!visibleTables.find((t) => t.name === meas.tableName)) {
      extraTableNames.add(meas.tableName)
    }
  }

  for (const tableName of extraTableNames) {
    const cols = visibleColumns
      .filter((c) => c.tableName === tableName)
      .map((c) => `      - ${c.columnName} (${c.dataType})`)
    const meas = visibleMeasures
      .filter((m) => m.tableName === tableName)
      .map((m) => `      - [${m.measureName}]`)

    tableLines.push(`  Tabela: '${tableName}'`)
    if (cols.length > 0) {
      tableLines.push("    Colunas:")
      tableLines.push(...cols)
    }
    if (meas.length > 0) {
      tableLines.push("    Medidas:")
      tableLines.push(...meas)
    }
  }

  return tableLines.join("\n")
}

export function buildChatSystemPrompt(metadata: DatasetMetadata, todayDate: string): string {
  const schema = buildSchemaContext(metadata)

  return `Você é um especialista em Power BI e DAX. Seu papel é interpretar perguntas em linguagem natural e gerar consultas DAX válidas com base no schema do dataset fornecido.

DATA DE HOJE: ${todayDate}

=== SCHEMA DO DATASET ===
${schema}
=== FIM DO SCHEMA ===

REGRAS OBRIGATÓRIAS:
1. Use APENAS tabelas, colunas e medidas que existem no schema acima. Nunca invente nomes.
2. Sempre use o formato 'NomeDaTabela'[NomeDaColuna] para colunas e [NomeDaMedida] para medidas.
3. Para filtros de data, use TODAY(), DATE(ano, mes, dia) ou DATEVALUE().
4. Para "hoje" use: 'Tabela'[DataColuna] = TODAY()
5. Para "este mês" use: MONTH('Tabela'[DataColuna]) = MONTH(TODAY()) && YEAR('Tabela'[DataColuna]) = YEAR(TODAY())
6. Para "este ano" use: YEAR('Tabela'[DataColuna]) = YEAR(TODAY())
7. Sempre envolva medidas com COALESCE([Medida], 0) para evitar valores em branco.
8. Para valores únicos/totais sem agrupamento, use: EVALUATE ROW("Nome", CALCULATE([Medida]))
9. Para agrupamentos com medidas, use: EVALUATE TOPN(100, SUMMARIZECOLUMNS(...), [Medida], DESC)
10. Para listagens simples, use: EVALUATE TOPN(100, SELECTCOLUMNS('Tabela', ...), ...)
11. Se a pergunta for ambígua, escolha a interpretação mais provável e explique.
12. Confidence: "high" = pergunta clara + mapeamento direto; "medium" = interpretação razoável; "low" = pergunta vaga ou mapeamento incerto.

FORMATO DE RESPOSTA (JSON PURO, sem markdown, sem \`\`\`):
{
  "selectedColumns": [{"tableName": "string", "columnName": "string"}],
  "selectedMeasures": [{"tableName": "string", "measureName": "string"}],
  "filters": [{"tableName": "string", "columnName": "string", "operator": "eq|neq|gt|lt|gte|lte|contains|startswith", "value": "string", "valueTo": "string", "dataType": "string"}],
  "daxQuery": "EVALUATE ...",
  "explanation": "Explicação em português do que a query faz",
  "confidence": "high|medium|low"
}

EXEMPLOS DE DAX VÁLIDOS:

Pergunta: "qual o total de vendas?"
{
  "selectedColumns": [],
  "selectedMeasures": [{"tableName": "fVendas", "measureName": "Total Vendas"}],
  "filters": [],
  "daxQuery": "EVALUATE\\nROW(\\n  \\"Total Vendas\\", COALESCE(CALCULATE([Total Vendas]), 0)\\n)",
  "explanation": "Retorna o total geral da medida Total Vendas.",
  "confidence": "high"
}

Pergunta: "vendas por produto este mês"
{
  "selectedColumns": [{"tableName": "dProdutos", "columnName": "Produto"}],
  "selectedMeasures": [{"tableName": "fVendas", "measureName": "Total Vendas"}],
  "filters": [],
  "daxQuery": "EVALUATE\\nTOPN(100,\\n  CALCULATETABLE(\\n    SUMMARIZECOLUMNS(\\n      'dProdutos'[Produto],\\n      \\"Total Vendas\\", COALESCE(CALCULATE([Total Vendas]), 0)\\n    ),\\n    MONTH('fVendas'[Data]) = MONTH(TODAY()),\\n    YEAR('fVendas'[Data]) = YEAR(TODAY())\\n  ),\\n  [Total Vendas], DESC\\n)",
  "explanation": "Lista os produtos com suas vendas totais filtradas para o mês corrente.",
  "confidence": "high"
}`
}

export function buildConversationMessages(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  question: string
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
  ]

  // Inclui últimas 6 mensagens do histórico para contexto
  const recentHistory = history.slice(-6)
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content })
  }

  messages.push({ role: "user", content: question })

  return messages
}

export function validateQueryPlan(
  plan: ChatQueryPlan,
  metadata: DatasetMetadata
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  const columnSet = new Set(
    metadata.columns.map((c) => `${c.tableName}::${c.columnName}`)
  )
  const measureSet = new Set(
    metadata.measures.map((m) => `${m.tableName}::${m.measureName}`)
  )
  const measureNameSet = new Set(metadata.measures.map((m) => m.measureName))

  for (const col of plan.selectedColumns) {
    if (!columnSet.has(`${col.tableName}::${col.columnName}`)) {
      errors.push(`Coluna inexistente: '${col.tableName}'[${col.columnName}]`)
    }
  }

  for (const meas of plan.selectedMeasures) {
    if (
      !measureSet.has(`${meas.tableName}::${meas.measureName}`) &&
      !measureNameSet.has(meas.measureName)
    ) {
      errors.push(`Medida inexistente: [${meas.measureName}]`)
    }
  }

  for (const filter of plan.filters) {
    if (!columnSet.has(`${filter.tableName}::${filter.columnName}`)) {
      errors.push(`Coluna de filtro inexistente: '${filter.tableName}'[${filter.columnName}]`)
    }
  }

  if (!plan.daxQuery || !plan.daxQuery.trim().toUpperCase().startsWith("EVALUATE")) {
    errors.push("A query DAX deve começar com EVALUATE")
  }

  return { valid: errors.length === 0, errors }
}

export function formatDataAnswer(
  explanation: string,
  columns: Array<{ name: string; dataType: string }>,
  rows: Array<Record<string, unknown>>
): string {
  if (rows.length === 0) {
    return `${explanation}\n\nNenhum dado encontrado para essa consulta.`
  }

  if (rows.length === 1 && columns.length === 1) {
    const value = rows[0][columns[0].name]
    return `${explanation}\n\n**Resultado:** ${formatValue(value)}`
  }

  if (rows.length === 1) {
    const parts = columns.map((col) => `**${col.name}:** ${formatValue(rows[0][col.name])}`)
    return `${explanation}\n\n${parts.join("  |  ")}`
  }

  return `${explanation}\n\n*${rows.length} ${rows.length === 1 ? "linha retornada" : "linhas retornadas"}*`
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "number") {
    return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
  }
  return String(value)
}
