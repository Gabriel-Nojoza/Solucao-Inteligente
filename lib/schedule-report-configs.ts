import {
  getPrimarySchedulePageName,
  resolveSchedulePageNames,
} from "@/lib/schedule-pages"

export type ScheduleReportConfigRecord = {
  report_id: string
  pbi_page_name: string | null
  pbi_page_names: string[]
}

function normalizeReportId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeRawReportConfig(value: unknown) {
  if (typeof value === "string") {
    const reportId = normalizeReportId(value)
    if (!reportId) {
      return null
    }

    return {
      report_id: reportId,
      pbi_page_name: null,
      pbi_page_names: [],
    } satisfies ScheduleReportConfigRecord
  }

  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Record<string, unknown>
  const reportId =
    normalizeReportId(record.report_id) ??
    normalizeReportId(record.reportId) ??
    normalizeReportId(record.id)

  if (!reportId) {
    return null
  }

  const pageNames = resolveSchedulePageNames({
    pbi_page_name: record.pbi_page_name ?? record.pageName,
    pbi_page_names: record.pbi_page_names ?? record.pageNames,
  })

  return {
    report_id: reportId,
    pbi_page_name: getPrimarySchedulePageName(pageNames),
    pbi_page_names: pageNames,
  } satisfies ScheduleReportConfigRecord
}

export function normalizeScheduleReportConfigs(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) {
      return []
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown
      return normalizeScheduleReportConfigs(parsed)
    } catch {
      return normalizeScheduleReportConfigs([trimmed])
    }
  }

  if (!Array.isArray(value)) {
    return []
  }

  const mergedConfigs = new Map<string, Set<string>>()

  for (const item of value) {
    const normalized = normalizeRawReportConfig(item)
    if (!normalized) {
      continue
    }

    const existingPages = mergedConfigs.get(normalized.report_id) ?? new Set<string>()
    for (const pageName of normalized.pbi_page_names) {
      existingPages.add(pageName)
    }

    mergedConfigs.set(normalized.report_id, existingPages)
  }

  return Array.from(mergedConfigs.entries()).map(([report_id, pageNamesSet]) => {
    const pbi_page_names = [...pageNamesSet]

    return {
      report_id,
      pbi_page_name: getPrimarySchedulePageName(pbi_page_names),
      pbi_page_names,
    } satisfies ScheduleReportConfigRecord
  })
}

export function resolveScheduleReportConfigs(input: {
  report_configs?: unknown
  report_id?: unknown
  pbi_page_name?: unknown
  pbi_page_names?: unknown
}) {
  const normalizedConfigs = normalizeScheduleReportConfigs(input.report_configs)

  if (normalizedConfigs.length > 0) {
    return normalizedConfigs
  }

  const primaryReportId = normalizeReportId(input.report_id)
  if (!primaryReportId) {
    return []
  }

  const pageNames = resolveSchedulePageNames(input)

  return [
    {
      report_id: primaryReportId,
      pbi_page_name: getPrimarySchedulePageName(pageNames),
      pbi_page_names: pageNames,
    } satisfies ScheduleReportConfigRecord,
  ]
}

export function getPrimaryScheduleReportConfig(reportConfigs: ScheduleReportConfigRecord[]) {
  return reportConfigs[0] ?? null
}

export function getScheduleReportIds(reportConfigs: ScheduleReportConfigRecord[]) {
  return [...new Set(reportConfigs.map((reportConfig) => reportConfig.report_id))]
}
