/**
 * Build a DAX query string from selected columns, measures and filters.
 * This is a pure function safe to run on both client and server.
 */
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
    (m) => `"${m.measureName}", [${m.measureName}]`
  )

  // Build filter expressions
  const filterExprs = filters
    .filter((f) => f.value.trim() !== "")
    .map((f) => {
      const colRef = `'${f.tableName}'[${f.columnName}]`
      const isNumeric =
        f.dataType === "Int64" ||
        f.dataType === "Double" ||
        f.dataType === "Decimal"
      const val = isNumeric ? f.value : `"${f.value}"`
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
          return `CONTAINSSTRING(${colRef}, "${f.value}")`
        case "startswith":
          return `LEFT(${colRef}, ${f.value.length}) = "${f.value}"`
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
        .map((c) => `  "${c.columnName}", '${c.tableName}'[${c.columnName}]`)
        .join(",\n")
      dax += "\n)"
    }
    return dax
  }

  // Only measures selected
  let dax = "EVALUATE\nROW(\n  "
  dax += measureRefs.join(",\n  ")
  dax += "\n)"
  return dax
}
