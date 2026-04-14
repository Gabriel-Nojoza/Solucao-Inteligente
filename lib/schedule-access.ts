import type { SupabaseClient } from "@supabase/supabase-js"
import {
  isMissingAutomationRelationError,
  loadStoredAutomations,
} from "@/lib/automation-storage"
import {
  getScheduleReportIds,
  resolveScheduleReportConfigs,
} from "@/lib/schedule-report-configs"
import {
  isDatasetAllowed,
  isWorkspaceAllowed,
  type WorkspaceAccessScope,
} from "@/lib/workspace-access"

type ScopeTargetRow = {
  id: string
  name: string
  dataset_id?: string | null
  workspace_id?: string | null
}

type ScheduleLike = {
  report_configs?: unknown
  report_id?: unknown
  pbi_page_name?: unknown
  pbi_page_names?: unknown
}

export type ScheduleAccessMaps = {
  visibleTargetIds: Set<string>
  reportNames: Map<string, string>
  automationNames: Map<string, string>
}

function isTargetVisible(record: ScopeTargetRow, scope: WorkspaceAccessScope) {
  return (
    isDatasetAllowed(scope, record.dataset_id ?? null) &&
    isWorkspaceAllowed(scope, { workspaceId: record.workspace_id ?? null })
  )
}

export function isScheduleAccessible(
  schedule: ScheduleLike,
  accessMaps: ScheduleAccessMaps
) {
  const reportIds = getScheduleReportIds(resolveScheduleReportConfigs(schedule))

  return reportIds.length > 0 && reportIds.every((reportId) => accessMaps.visibleTargetIds.has(reportId))
}

export async function getScheduleAccessMaps(
  supabase: SupabaseClient,
  companyId: string,
  scope: WorkspaceAccessScope
): Promise<ScheduleAccessMaps> {
  const visibleTargetIds = new Set<string>()
  const reportNames = new Map<string, string>()
  const automationNames = new Map<string, string>()

  if (
    (scope.workspaceRestricted && scope.workspaceIds.length === 0 && scope.pbiWorkspaceIds.length === 0) ||
    (scope.datasetRestricted && scope.datasetIds.length === 0)
  ) {
    return {
      visibleTargetIds,
      reportNames,
      automationNames,
    }
  }

  const { data: reports, error: reportsError } = await supabase
    .from("reports")
    .select("id, name, dataset_id, workspace_id")
    .eq("company_id", companyId)

  if (reportsError) {
    throw new Error(reportsError.message)
  }

  for (const report of reports ?? []) {
    if (!isTargetVisible(report, scope)) {
      continue
    }

    visibleTargetIds.add(report.id)
    reportNames.set(report.id, report.name)
  }

  const { data: automations, error: automationsError } = await supabase
    .from("automations")
    .select("id, name, dataset_id, workspace_id")
    .eq("company_id", companyId)

  if (automationsError) {
    if (!isMissingAutomationRelationError(automationsError)) {
      throw new Error(automationsError.message)
    }

    const storedAutomations = await loadStoredAutomations(supabase, companyId)

    for (const automation of storedAutomations) {
      if (!isTargetVisible(automation, scope)) {
        continue
      }

      visibleTargetIds.add(automation.id)
      automationNames.set(automation.id, automation.name)
    }
  } else {
    for (const automation of automations ?? []) {
      if (!isTargetVisible(automation, scope)) {
        continue
      }

      visibleTargetIds.add(automation.id)
      automationNames.set(automation.id, automation.name)
    }
  }

  return {
    visibleTargetIds,
    reportNames,
    automationNames,
  }
}

export async function getAccessibleScheduleIds(
  supabase: SupabaseClient,
  companyId: string,
  scope: WorkspaceAccessScope
) {
  if (
    (scope.workspaceRestricted && scope.workspaceIds.length === 0 && scope.pbiWorkspaceIds.length === 0) ||
    (scope.datasetRestricted && scope.datasetIds.length === 0)
  ) {
    return []
  }

  const [accessMaps, schedulesResult] = await Promise.all([
    getScheduleAccessMaps(supabase, companyId, scope),
    supabase
      .from("schedules")
      .select("id, report_id, report_configs, pbi_page_name, pbi_page_names")
      .eq("company_id", companyId),
  ])

  if (schedulesResult.error) {
    throw new Error(schedulesResult.error.message)
  }

  return (schedulesResult.data ?? [])
    .filter((schedule) => isScheduleAccessible(schedule, accessMaps))
    .map((schedule) => schedule.id)
}
