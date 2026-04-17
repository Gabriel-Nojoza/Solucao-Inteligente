import type { SupabaseClient } from "@supabase/supabase-js"

type MinimalSupabaseClient = Pick<SupabaseClient, "from">

export async function getCompanyScheduleIdSet(
  supabase: MinimalSupabaseClient,
  companyId: string
) {
  const { data, error } = await supabase
    .from("schedules")
    .select("id")
    .eq("company_id", companyId)

  if (error) {
    throw new Error(error.message)
  }

  return new Set(
    (data ?? []).flatMap((row: { id?: unknown }) =>
      typeof row.id === "string" && row.id.trim() ? [row.id.trim()] : []
    )
  )
}

export function canAccessDispatchLog(
  scheduleId: string | null | undefined,
  accessibleScheduleIds: Set<string>,
  currentScheduleIds: Set<string>
) {
  if (!scheduleId) {
    return true
  }

  if (accessibleScheduleIds.has(scheduleId)) {
    return true
  }

  // Historical logs from deleted schedules should remain visible.
  if (!currentScheduleIds.has(scheduleId)) {
    return true
  }

  return false
}
