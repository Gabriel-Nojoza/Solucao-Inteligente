import { buildDAXQuery } from "@/lib/dax-builder"
import type {
  DAXQueryResult,
  QueryFilter,
  SelectedColumn,
  SelectedMeasure,
} from "@/lib/types"

type FallbackResult = {
  result: DAXQueryResult
  appliedFilters: QueryFilter[]
}

function isBlankLike(value: unknown) {
  return value === null || value === undefined || value === ""
}

function hasUsableValues(result: DAXQueryResult, selectedMeasures: SelectedMeasure[]) {
  if (result.rows.length === 0) {
    return false
  }

  if (selectedMeasures.length === 0) {
    return true
  }

  const measureNames = selectedMeasures.map((measure) => measure.measureName)

  return result.rows.some((row) =>
    measureNames.some((measureName) => !isBlankLike(row[measureName]))
  )
}

export async function executeWithQueryFallback(params: {
  runQuery: (query: string) => Promise<DAXQueryResult>
  query: string
  filters: QueryFilter[]
  selectedColumns: SelectedColumn[]
  selectedMeasures: SelectedMeasure[]
}): Promise<FallbackResult> {
  const candidates: Array<{ query: string; appliedFilters: QueryFilter[] }> = []
  const seen = new Set<string>()

  const pushCandidate = (query: string, appliedFilters: QueryFilter[]) => {
    if (!query || query.startsWith("--") || seen.has(query)) {
      return
    }

    seen.add(query)
    candidates.push({ query, appliedFilters })
  }

  pushCandidate(params.query, params.filters)

  if (params.filters.length > 0) {
    pushCandidate(
      buildDAXQuery({
        columns: params.selectedColumns,
        measures: params.selectedMeasures,
        filters: [],
      }),
      []
    )
  }

  if (params.selectedColumns.length > 0 && params.selectedMeasures.length > 0) {
    pushCandidate(
      buildDAXQuery({
        columns: [],
        measures: params.selectedMeasures,
        filters: params.filters,
      }),
      params.filters
    )

    if (params.filters.length > 0) {
      pushCandidate(
        buildDAXQuery({
          columns: [],
          measures: params.selectedMeasures,
          filters: [],
        }),
        []
      )
    }
  }

  let firstError: unknown = null
  let firstResult: FallbackResult | null = null

  for (const candidate of candidates) {
    try {
      const result = await params.runQuery(candidate.query)
      firstResult ??= { result, appliedFilters: candidate.appliedFilters }

      if (hasUsableValues(result, params.selectedMeasures)) {
        return {
          result,
          appliedFilters: candidate.appliedFilters,
        }
      }
    } catch (error) {
      firstError ??= error
    }
  }

  if (firstResult) {
    return firstResult
  }

  if (firstError) {
    throw firstError
  }

  return {
    result: { columns: [], rows: [] },
    appliedFilters: params.filters,
  }
}
