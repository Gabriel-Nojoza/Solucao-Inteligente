import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getTimePartsInTimeZone, isSameMinuteInTimeZone, matchesCronValue } from "@/lib/schedule-cron"

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
    const platformSecret = process.env.PLATFORM_SCHEDULER_SECRET?.trim()
    if (!platformSecret) {
      return NextResponse.json({ error: "Endpoint nao configurado" }, { status: 503 })
    }

    const headerSecret = request.headers.get("x-callback-secret")?.trim()
    const querySecret = new URL(request.url).searchParams.get("secret")?.trim()
    const incomingSecret = headerSecret || querySecret || ""

    if (incomingSecret !== platformSecret) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 })
    }

    const supabase = createClient()
    const now = new Date()

    const { data: schedules, error } = await supabase
      .from("schedules")
      .select("*")
      .eq("is_active", true)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data: settingsRows } = await supabase
      .from("company_settings")
      .select("company_id, value")
      .eq("key", "general")

    const timezoneByCompany = new Map<string, string>()
    for (const row of settingsRows ?? []) {
      const tz = (row.value as Record<string, unknown> | null)?.timezone
      if (typeof tz === "string" && tz.trim()) {
        timezoneByCompany.set(row.company_id, tz.trim())
      }
    }

    const dueSchedules = ((schedules ?? []) as ScheduleRow[]).filter((schedule) => {
      if (!schedule.cron_expression?.trim()) return false

      const timeZone = timezoneByCompany.get(schedule.company_id) ?? "America/Sao_Paulo"

      if (!matchesCronValue(schedule.cron_expression, now, timeZone)) return false

      if (!schedule.last_run_at) return true

      const lastRunAt = new Date(schedule.last_run_at)
      if (Number.isNaN(lastRunAt.getTime())) return true

      return !isSameMinuteInTimeZone(lastRunAt, now, timeZone)
    })

    if (dueSchedules.length > 0) {
      const claimedAt = now.toISOString()
      await Promise.all(
        dueSchedules.map((schedule) =>
          supabase
            .from("schedules")
            .update({ last_run_at: claimedAt })
            .eq("company_id", schedule.company_id)
            .eq("id", schedule.id)
        )
      )
    }

    const appUrl = getRequestOrigin(request)

    return NextResponse.json({
      source: "platform",
      evaluated_at: now.toISOString(),
      dispatch_url: `${appUrl}/api/dispatch`,
      total_due: dueSchedules.length,
      schedules: dueSchedules.map((schedule) => ({
        id: schedule.id,
        company_id: schedule.company_id,
        name: schedule.name,
        report_id: schedule.report_id,
        cron_expression: schedule.cron_expression,
        export_format: schedule.export_format,
        message_template: schedule.message_template,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao listar rotinas vencidas" },
      { status: 500 }
    )
  }
}
