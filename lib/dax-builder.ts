/**
 * Build a leaner DAX query from selected columns, measures and filters.
 * The goal here is to reduce returned volume by:
 * - applying filters as early as possible
 * - using SUMMARIZECOLUMNS for grouped output
 * - adding measures after the base rowset so rows are not dropped when measures are BLANK
 * - limiting the returned rows
 */

const MAX_RESULT_ROWS = 500

type DaxFilter = {
  tableName: string
  columnName: string
  operator: string
  value: string
  valueTo?: string
  dataType: string
}

function escapeDaxString(value: string) {
  return value.replace(/"/g, '""')
}

function isNumericType(dataType: string) {
  const normalized = dataType.toLowerCase()
  return (
    normalized.includes("int") ||
    normalized.includes("double") ||
    normalized.includes("decimal") ||
    normalized.includes("number")
  )
}

function isDateType(dataType: string) {
  const normalized = dataType.toLowerCase()
  return normalized.includes("date") || normalized.includes("time")
}

function parseMonthValue(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})$/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])

  if (!year || month < 1 || month > 12) {
    return null
  }

  return { year, month }
}

function parseDateValue(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
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

function formatDaxValue(value: string, dataType: string) {
  if (isNumericType(dataType)) {
    return value
  }

  if (isDateType(dataType)) {
    const dateValue = parseDateValue(value)
    if (dateValue) {
      return formatDaxDate(dateValue)
    }
  }

  return `"${escapeDaxString(value)}"`
}

function buildFilterClause(filter: DaxFilter) {
  const colRef = `'${filter.tableName}'[${filter.columnName}]`
  const trimmedValue = filter.value.trim()
  const rawValueTo = filter.valueTo ?? ""
  const hasExplicitValueTo = filter.valueTo !== undefined
  const trimmedValueTo = rawValueTo.trim()
  const effectiveValueTo = hasExplicitValueTo ? trimmedValueTo : trimmedValue
  const monthValue = isDateType(filter.dataType) ? parseMonthValue(trimmedValue) : null

  if (isDateType(filter.dataType)) {
    if (monthValue && effectiveValueTo === trimmedValue) {
      return `KEEPFILTERS(FILTER(ALL(${colRef}), YEAR(${colRef}) = ${monthValue.year} && MONTH(${colRef}) = ${monthValue.month}))`
    }

    const startDate = parseDateValue(trimmedValue)
    const endDate = parseDateValue(effectiveValueTo)

    if (startDate && endDate) {
      const normalizedStart =
        trimmedValue <= effectiveValueTo ? startDate : endDate
      const normalizedEnd =
        trimmedValue <= effectiveValueTo ? endDate : startDate

      return `KEEPFILTERS(FILTER(ALL(${colRef}), ${colRef} >= ${formatDaxDate(normalizedStart)} && ${colRef} < ${formatDaxDate(normalizedEnd)} + 1))`
    }

    if (startDate) {
      return `KEEPFILTERS(FILTER(ALL(${colRef}), ${colRef} >= ${formatDaxDate(startDate)}))`
    }

    if (endDate) {
      return `KEEPFILTERS(FILTER(ALL(${colRef}), ${colRef} < ${formatDaxDate(endDate)} + 1))`
    }
  }

  const valueRef = formatDaxValue(trimmedValue, filter.dataType)

  let expression = `${colRef} = ${valueRef}`

  switch (filter.operator) {
    case "neq":
      expression = `${colRef} <> ${valueRef}`
      break
    case "gt":
      expression = `${colRef} > ${valueRef}`
      break
    case "lt":
      expression = `${colRef} < ${valueRef}`
      break
    case "gte":
      expression = `${colRef} >= ${valueRef}`
      break
    case "lte":
      expression = `${colRef} <= ${valueRef}`
      break
    case "contains":
      expression = `CONTAINSSTRING(${colRef}, ${valueRef})`
      break
    case "startswith":
      expression = `LEFT(${colRef}, ${filter.value.length}) = ${valueRef}`
      break
    default:
      expression = `${colRef} = ${valueRef}`
      break
  }

  return `KEEPFILTERS(FILTER(ALL(${colRef}), ${expression}))`
}

function buildMeasureProjection(measureName: string) {
  return `"${measureName}", COALESCE([${measureName}], 0)`
}

function buildCalculatedMeasureProjection(measureName: string, filterClauses: string[]) {
  if (filterClauses.length === 0) {
    return buildMeasureProjection(measureName)
  }

  return `"${measureName}", CALCULATE(COALESCE([${measureName}], 0), ${filterClauses.join(", ")})`
}

export function buildDAXQuery(
  selectedColumns: Array<{ tableName: string; columnName: string }>,
  selectedMeasures: Array<{ tableName: string; measureName: string }>,
  filters: DaxFilter[]
): string {
  if (selectedColumns.length === 0 && selectedMeasures.length === 0) {
    return "-- Selecione campos para gerar DAX"
  }

  const colRefs = selectedColumns.map(
    (column) => `'${column.tableName}'[${column.columnName}]`
  )
  const filterClauses = filters
    .filter(
      (filter) =>
        filter.value.trim() !== "" ||
        (typeof filter.valueTo === "string" && filter.valueTo.trim() !== "")
    )
    .map(buildFilterClause)

  if (selectedColumns.length === 0) {
    const measureRefs = selectedMeasures.map((measure) =>
      buildCalculatedMeasureProjection(measure.measureName, filterClauses)
    )

    return `EVALUATE\nROW(\n  ${measureRefs.join(",\n  ")}\n)`
  }

  const sortRef =
    selectedMeasures.length > 0
      ? `[${selectedMeasures[0].measureName}]`
      : colRefs[0]
  const sortDirection = selectedMeasures.length > 0 ? "DESC" : "ASC"

  if (selectedMeasures.length === 0) {
    const summarizeArgs = [...colRefs, ...filterClauses]

    return [
      "DEFINE",
      "VAR __DS0Core =",
      "  SUMMARIZECOLUMNS(",
      `    ${summarizeArgs.join(",\n    ")}`,
      "  )",
      "EVALUATE",
      `TOPN(${MAX_RESULT_ROWS}, __DS0Core, ${sortRef}, ${sortDirection})`,
      "ORDER BY",
      `  ${sortRef} ${sortDirection}`,
    ].join("\n")
  }

  const baseArgs = [...colRefs, ...filterClauses]
  const measureProjections = selectedMeasures.map((measure) =>
    buildMeasureProjection(measure.measureName)
  )

  return [
    "DEFINE",
    "VAR __DS0Base =",
    "  SUMMARIZECOLUMNS(",
    `    ${baseArgs.join(",\n    ")}`,
    "  )",
    "VAR __DS0Core =",
    "  ADDCOLUMNS(",
    "    __DS0Base,",
    `    ${measureProjections.join(",\n    ")}`,
    "  )",
    "EVALUATE",
    `TOPN(${MAX_RESULT_ROWS}, __DS0Core, ${sortRef}, ${sortDirection})`,
    "ORDER BY",
    `  ${sortRef} ${sortDirection}`,
  ].join("\n")
}
