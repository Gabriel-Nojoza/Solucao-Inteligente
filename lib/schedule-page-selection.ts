import type { SupabaseClient } from "@supabase/supabase-js"

type SchedulePageSelectionLike = {
  pbi_page_name?: unknown
  pbi_page_names?: unknown
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message) {
      return message
    }
  }

  return ""
}

function normalizePageName(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function normalizeSchedulePageNames(value: unknown) {
  const values = Array.isArray(value) ? value : [value]
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const item of values) {
    const pageName = normalizePageName(item)
    if (!pageName || seen.has(pageName)) {
      continue
    }

    seen.add(pageName)
    normalized.push(pageName)
  }

  return normalized
}

export function getSchedulePageNames(schedule: SchedulePageSelectionLike) {
  const pageNamesFromArray = normalizeSchedulePageNames(schedule.pbi_page_names)
  if (pageNamesFromArray.length > 0) {
    return pageNamesFromArray
  }

  return normalizeSchedulePageNames(schedule.pbi_page_name)
}

export function normalizeSchedulePageSelectionForResponse<
  T extends SchedulePageSelectionLike,
>(schedule: T) {
  const pageNames = getSchedulePageNames(schedule)

  return {
    ...schedule,
    pbi_page_name: pageNames[0] ?? null,
    pbi_page_names: pageNames,
  }
}

export function buildSchedulePageSelectionPayload(
  pageNames: string[],
  supportsPageNames: boolean
) {
  const normalizedPageNames = normalizeSchedulePageNames(pageNames)
  const payload: Record<string, string | string[] | null> = {
    pbi_page_name: normalizedPageNames[0] ?? null,
  }

  if (supportsPageNames) {
    payload.pbi_page_names =
      normalizedPageNames.length > 0 ? normalizedPageNames : null
  }

  return payload
}

export function isMissingSchedulesPageNamesColumnError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : ""
  const message = getErrorMessage(error).toLowerCase()

  return (
    code === "42703" ||
    message.includes("pbi_page_names") ||
    message.includes("schedules.pbi_page_names")
  )
}

export async function schedulesSupportPageNames(supabase: SupabaseClient) {
  const { error } = await supabase.from("schedules").select("pbi_page_names").limit(1)

  if (!error) {
    return true
  }

  if (isMissingSchedulesPageNamesColumnError(error)) {
    return false
  }

  throw new Error(getErrorMessage(error) || "Erro ao validar paginas da rotina")
}
