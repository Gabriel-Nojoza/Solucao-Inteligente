// lib/dax-builder.ts

type Column = {
  tableName: string
  columnName: string
}

type Measure = {
  tableName?: string
  measureName: string
}

type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "contains"
  | "startswith"

type Filter = {
  tableName: string
  columnName: string
  operator: FilterOperator
  value: string
  valueTo?: string
  dataType?: string
}

type BuildParams = {
  columns: Column[]
  measures: Measure[]
  filters: Filter[]
  limit?: number
}

function escapeDaxName(value: string) {
  return String(value).replace(/]/g, "]]")
}

function escapeDaxString(value: string) {
  return String(value).replace(/"/g, '""')
}

function tableRef(table: string) {
  return `'${escapeDaxName(table)}'`
}

function colRef(table: string, col: string) {
  return `${tableRef(table)}[${escapeDaxName(col)}]`
}

function measureRef(name: string) {
  return `[${escapeDaxName(name)}]`
}

function isNumericType(dataType?: string) {
  const normalized = String(dataType || "").toLowerCase()
  return (
    normalized.includes("int") ||
    normalized.includes("double") ||
    normalized.includes("decimal") ||
    normalized.includes("number")
  )
}

function isDateType(dataType?: string) {
  const normalized = String(dataType || "").toLowerCase()
  return normalized.includes("date") || normalized.includes("time")
}

function parseDateValue(value: string) {
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }

  return { year, month, day }
}

function formatDaxDate(date: { year: number; month: number; day: number }) {
  return `DATE(${date.year}, ${date.month}, ${date.day})`
}

function formatDaxValue(value: string, dataType?: string) {
  if (isNumericType(dataType)) {
    return value
  }

  if (isDateType(dataType)) {
    const parsed = parseDateValue(value)
    if (parsed) {
      return formatDaxDate(parsed)
    }
  }

  return `"${escapeDaxString(value)}"`
}

function buildFilterExpression(filter: Filter) {
  const ref = colRef(filter.tableName, filter.columnName)
  const rawValue = String(filter.value ?? "").trim()
  const rawValueTo = String(filter.valueTo ?? "").trim()

  if (!rawValue && !rawValueTo) return null

  if (isDateType(filter.dataType)) {
    const startDate = rawValue ? parseDateValue(rawValue) : null
    const endDate = rawValueTo ? parseDateValue(rawValueTo) : null

    if (startDate && endDate) {
      return `${ref} >= ${formatDaxDate(startDate)} && ${ref} <= ${formatDaxDate(endDate)}`
    }

    if (startDate) {
      return `${ref} >= ${formatDaxDate(startDate)}`
    }

    if (endDate) {
      return `${ref} <= ${formatDaxDate(endDate)}`
    }
  }

  const valueRef = formatDaxValue(rawValue, filter.dataType)

  switch (filter.operator) {
    case "neq":
      return `${ref} <> ${valueRef}`
    case "gt":
      return `${ref} > ${valueRef}`
    case "lt":
      return `${ref} < ${valueRef}`
    case "gte":
      return `${ref} >= ${valueRef}`
    case "lte":
      return `${ref} <= ${valueRef}`
    case "contains":
      return `CONTAINSSTRING(${ref}, ${valueRef})`
    case "startswith":
      return `STARTSWITH(${ref}, ${valueRef})`
    case "eq":
    default:
      return `${ref} = ${valueRef}`
  }
}

function buildWrappedFilters(filters: Filter[]) {
  return filters
    .filter(
      (filter) =>
        String(filter.value ?? "").trim() !== "" ||
        String(filter.valueTo ?? "").trim() !== ""
    )
    .map(buildFilterExpression)
    .filter((expr): expr is string => Boolean(expr))
}

function buildMeasureAlias(measureName: string) {
  return `"${escapeDaxString(measureName)}", COALESCE(CALCULATE(${measureRef(measureName)}), 0)`
}

function choosePrimaryTable(columns: Column[], measures: Measure[]) {
  return columns[0]?.tableName || measures[0]?.tableName || ""
}

export function buildDAXQuery({
  columns,
  measures,
  filters,
  limit = 100,
}: BuildParams): string {
  const hasColumns = columns.length > 0
  const hasMeasures = measures.length > 0

  if (!hasColumns && !hasMeasures) {
    return "-- Selecione campos para gerar DAX"
  }

  const wrappedFilters = buildWrappedFilters(filters)
  const primaryTable = choosePrimaryTable(columns, measures)

  // somente medidas
  if (!hasColumns && hasMeasures) {
    const measureRows = measures.map(
      (measure) =>
        `"${escapeDaxString(measure.measureName)}", COALESCE(CALCULATE(${measureRef(
          measure.measureName
        )}), 0)`
    )

    if (wrappedFilters.length === 0) {
      return `EVALUATE\nROW(\n  ${measureRows.join(",\n  ")}\n)`
    }

    return [
      "EVALUATE",
      "CALCULATETABLE(",
      "  ROW(",
      `    ${measureRows.join(",\n    ")}`,
      "  ),",
      `  ${wrappedFilters.join(",\n  ")}`,
      ")",
    ].join("\n")
  }

  // colunas + medidas
  if (hasColumns && hasMeasures) {
    const groupByRefs = columns.map((column) => `    ${colRef(column.tableName, column.columnName)}`)
    const measureAliases = measures.map((measure) => `    ${buildMeasureAlias(measure.measureName)}`)
    const summarizeBody = [...groupByRefs, ...measureAliases].join(",\n")

    const summarizeExpression = ["SUMMARIZECOLUMNS(", summarizeBody, ")"].join("\n")

    if (wrappedFilters.length === 0) {
      return [
        "EVALUATE",
        `TOPN(${limit},`,
        `  ${summarizeExpression.replace(/\n/g, "\n  ")},`,
        `  ${measureRef(measures[0].measureName)}, DESC`,
        ")",
        "ORDER BY",
        `  ${measureRef(measures[0].measureName)} DESC`,
      ].join("\n")
    }

    return [
      "EVALUATE",
      `TOPN(${limit},`,
      "  CALCULATETABLE(",
      `    ${summarizeExpression.replace(/\n/g, "\n    ")},`,
      `    ${wrappedFilters.join(",\n    ")}`,
      "  ),",
      `  ${measureRef(measures[0].measureName)}, DESC`,
      ")",
      "ORDER BY",
      `  ${measureRef(measures[0].measureName)} DESC`,
    ].join("\n")
  }

  // somente colunas
  const selectedFromPrimary = columns.filter((column) => column.tableName === primaryTable)

  if (selectedFromPrimary.length === 0) {
    return "-- Selecione ao menos uma coluna da tabela principal"
  }

  const selectParts = selectedFromPrimary.map(
    (column) =>
      `    "${escapeDaxString(column.columnName)}", ${colRef(column.tableName, column.columnName)}`
  )

  let baseTable = tableRef(primaryTable)

  if (wrappedFilters.length > 0) {
    baseTable = [
      "FILTER(",
      `  ${baseTable},`,
      `  ${wrappedFilters.join("\n  && ")}`,
      ")",
    ].join("\n")
  }

  return [
    "EVALUATE",
    `TOPN(${limit},`,
    "  SELECTCOLUMNS(",
    `    ${baseTable},`,
    `${selectParts.join(",\n")}`,
    "  ),",
    `  ${colRef(selectedFromPrimary[0].tableName, selectedFromPrimary[0].columnName)}, ASC`,
    ")",
  ].join("\n")
}