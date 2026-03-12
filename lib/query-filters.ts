import type { QueryFilter } from "@/lib/types"

export function normalizeFilters(input: unknown): QueryFilter[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []

    const record = item as Record<string, unknown>
    const tableName = typeof record.tableName === "string" ? record.tableName.trim() : ""
    const columnName = typeof record.columnName === "string" ? record.columnName.trim() : ""

    if (!tableName || !columnName) {
      return []
    }

    const operator =
      record.operator === "neq" ||
      record.operator === "gt" ||
      record.operator === "lt" ||
      record.operator === "gte" ||
      record.operator === "lte" ||
      record.operator === "contains" ||
      record.operator === "startswith"
        ? record.operator
        : "eq"

    return [
      {
        id:
          typeof record.id === "string" && record.id.trim()
            ? record.id.trim()
            : crypto.randomUUID(),
        tableName,
        columnName,
        operator,
        value: typeof record.value === "string" ? record.value : "",
        valueTo: typeof record.valueTo === "string" ? record.valueTo : undefined,
        dataType: typeof record.dataType === "string" ? record.dataType : "String",
      },
    ]
  })
}

function isDateLikeDataType(dataType: string) {
  const normalized = dataType.toLowerCase()
  return normalized.includes("date") || normalized.includes("time")
}

function formatFilterDateValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  const isoDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDateMatch) {
    return `${isoDateMatch[3]}/${isoDateMatch[2]}/${isoDateMatch[1]}`
  }

  const isoMonthMatch = trimmed.match(/^(\d{4})-(\d{2})$/)
  if (isoMonthMatch) {
    return `${isoMonthMatch[2]}/${isoMonthMatch[1]}`
  }

  const brDateMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (brDateMatch) {
    return trimmed
  }

  return trimmed
}

export function describePrimaryDateFilter(filters: QueryFilter[]) {
  const primaryDateFilter = filters.find((filter) => {
    if (!isDateLikeDataType(filter.dataType)) return false

    return filter.value.trim() !== "" || (filter.valueTo?.trim() ?? "") !== ""
  })

  if (!primaryDateFilter) {
    return null
  }

  const start = formatFilterDateValue(primaryDateFilter.value)
  const end = formatFilterDateValue(primaryDateFilter.valueTo ?? "")
  let value = ""

  if (start && end) {
    value = start === end ? start : `${start} ate ${end}`
  } else if (start) {
    value = `A partir de ${start}`
  } else if (end) {
    value = `Ate ${end}`
  }

  if (!value) {
    return null
  }

  return {
    label: `${primaryDateFilter.tableName}.${primaryDateFilter.columnName}`,
    value,
  }
}
