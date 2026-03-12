import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { resolveRequestCompanyContext } from "@/lib/n8n-auth"
import { getTimePartsInTimeZone, isSameMinuteInTimeZone, matchesCronExpression } from "@/lib/schedule-cron"
import {
  isMissingAutomationRelationError,
  loadStoredAutomations,
} from "@/lib/automation-storage"

type ScheduleRow = {
  id: string
  company_id: string
  name: string
  report_id: string
  cron_expression: string
  export_format: string
  message_template: string | null
  is_active: boolean
  last_run_at: string | null
}

function getRequestOrigin(request: NextRequest) {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    request.headers.get("origin") ||
    new URL(request.url).origin
  )
}

export async function GET(request: NextRequest) {
  try {
    const { companyId, source } = await resolveRequestCompanyContext(request, {
      allowCallbackSecret: true,
    })
    const supabase = createClient()

    const { data: schedules, error } = await supabase
      .from("schedules")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data: settingsRows, error: settingsError } = await supabase
      .from("company_settings")
      .select("key, value")
      .eq("company_id", companyId)
      .in("key", ["general"])

    if (settingsError) {
      return NextResponse.json({ error: settingsError.message }, { status: 500 })
    }

    const settingsMap = new Map(
      (settingsRows ?? []).map((row) => [
        row.key,
        (row.value as Record<string, unknown> | null) ?? {},
      ])
    )
    const generalSettings = settingsMap.get("general")
    const timeZone =
      typeof generalSettings?.timezone === "string" && generalSettings.timezone.trim()
        ? generalSettings.timezone.trim()
        : "America/Sao_Paulo"

    const now = new Date()
    const dueSchedules = ((schedules ?? []) as ScheduleRow[]).filter((schedule) => {
      if (!schedule.cron_expression?.trim()) {
        return false
      }

      if (!matchesCronExpression(schedule.cron_expression, now, timeZone)) {
        return false
      }

      if (!schedule.last_run_at) {
        return true
      }

      const lastRunAt = new Date(schedule.last_run_at)
      if (Number.isNaN(lastRunAt.getTime())) {
        return true
      }

      return !isSameMinuteInTimeZone(lastRunAt, now, timeZone)
    })

    const reportIds = Array.from(
      new Set(dueSchedules.map((schedule) => schedule.report_id).filter(Boolean))
    )

    let reportMap = new Map<string, string>()
    if (reportIds.length > 0) {
      const { data: reports } = await supabase
        .from("reports")
        .select("id, name")
        .eq("company_id", companyId)
        .in("id", reportIds)

      reportMap = new Map((reports ?? []).map((report) => [report.id, report.name]))
    }

    let automationMap = new Map<string, string>()
    if (reportIds.length > 0) {
      const { data: automations, error: automationsError } = await supabase
        .from("automations")
        .select("id, name")
        .eq("company_id", companyId)
        .in("id", reportIds)

      if (automationsError) {
        if (!isMissingAutomationRelationError(automationsError)) {
          return NextResponse.json({ error: automationsError.message }, { status: 500 })
        }

        const storedAutomations = await loadStoredAutomations(supabase, companyId)
        automationMap = new Map(
          storedAutomations
            .filter((automation) => reportIds.includes(automation.id))
            .map((automation) => [automation.id, automation.name])
        )
      } else {
        automationMap = new Map(
          (automations ?? []).map((automation) => [automation.id, automation.name])
        )
      }
    }

    if (dueSchedules.length > 0) {
      const claimedAt = now.toISOString()
      await Promise.all(
        dueSchedules.map((schedule) =>
          supabase
            .from("schedules")
            .update({ last_run_at: claimedAt })
            .eq("company_id", companyId)
            .eq("id", schedule.id)
        )
      )
    }

    const currentLocalTime = getTimePartsInTimeZone(now, timeZone)

    return NextResponse.json({
      source,
      company_id: companyId,
      timezone: timeZone,
      evaluated_at: now.toISOString(),
      evaluated_local_time: `${String(currentLocalTime.year).padStart(4, "0")}-${String(
        currentLocalTime.month
      ).padStart(2, "0")}-${String(currentLocalTime.day).padStart(2, "0")} ${String(
        currentLocalTime.hour
      ).padStart(2, "0")}:${String(currentLocalTime.minute).padStart(2, "0")}`,
      dispatch_url: `${getRequestOrigin(request)}/api/dispatch`,
      total_due: dueSchedules.length,
      schedules: dueSchedules.map((schedule) => ({
        id: schedule.id,
        name: schedule.name,
        report_id: schedule.report_id,
        report_name:
          reportMap.get(schedule.report_id) ??
          automationMap.get(schedule.report_id) ??
          "Desconhecido",
        cron_expression: schedule.cron_expression,
        export_format: schedule.export_format,
        message_template: schedule.message_template,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel listar rotinas vencidas"
    const status = message === "Callback secret invalido" ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
