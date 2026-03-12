import type { DatasetColumn, QueryFilter } from "@/lib/types"

export type QuickFilterOption = {
  key: string
  label: string
  description: string
  mapped: boolean
  dataType: string
  activeCount: number
  tableName: string | null
  columnName: string | null
}

const QUICK_FILTER_SPECS = [
  {
    key: "status",
    label: "Status",
    description: "Filtrar por status",
    keywords: ["status", "situacao", "situação"],
  },
  {
    key: "client_company",
    label: "Cliente/Empresa",
    description: "Filtrar por cliente ou empresa",
    keywords: ["cliente", "empresa", "razao", "razão", "fantasia"],
  },
  {
    key: "date",
    label: "Data",
    description: "Filtrar por data",
    keywords: ["data", "dt_", "date", "emissao", "emissão"],
  },
  {
    key: "report_type",
    label: "Tipo de Relatorio",
    description: "Filtrar por tipo de relatorio",
    keywords: ["relatorio", "relatório", "tipo_relatorio", "tipo relatório"],
  },
  {
    key: "contact_type",
    label: "Tipo de Contato",
    description: "Filtrar por tipo de contato",
    keywords: ["contato", "tipo_contato", "tipo contato", "grupo"],
  },
  {
    key: "name",
    label: "Buscar por Nome",
    description: "Filtrar por nome",
    keywords: ["nome", "name"],
  },
] as const

export function isDateLikeDataType(dataType: string) {
  const normalized = dataType.toLowerCase()
  return normalized.includes("date") || normalized.includes("time")
}

export function getDefaultFilterValue(dataType: string) {
  if (isDateLikeDataType(dataType)) {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const day = String(now.getDate()).padStart(2, "0")
    return `${now.getFullYear()}-${month}-${day}`
  }

  return ""
}

export function getDefaultFilterValueTo(dataType: string) {
  return isDateLikeDataType(dataType) ? getDefaultFilterValue(dataType) : ""
}

export function buildQuickFilters(
  columns: Array<Pick<DatasetColumn, "tableName" | "columnName" | "dataType">>,
  filters: QueryFilter[]
): QuickFilterOption[] {
  return QUICK_FILTER_SPECS.map((spec) => {
    const match = columns.find((column) => {
      const haystack = `${column.tableName} ${column.columnName}`.toLowerCase()
      return spec.keywords.some((keyword) => haystack.includes(keyword))
    })

    const activeCount = match
      ? filters.filter(
          (filter) =>
            filter.tableName === match.tableName &&
            filter.columnName === match.columnName
        ).length
      : 0

    return {
      key: spec.key,
      label: spec.label,
      description: spec.description,
      mapped: !!match,
      dataType: match?.dataType || "N/A",
      activeCount,
      tableName: match?.tableName || null,
      columnName: match?.columnName || null,
    }
  })
}
