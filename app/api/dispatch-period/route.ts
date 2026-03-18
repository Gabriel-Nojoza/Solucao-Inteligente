import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { resolveRequestCompanyContext } from "@/lib/n8n-auth"
import { extractHoursFromCronValue } from "@/lib/schedule-cron"

type DispatchPeriod = "morning" | "afternoon" | "night"

function isValidPeriod(value: string): value is DispatchPeriod {
  return value === "morning" || value === "afternoon" || value === "night"
}

function getAllowedHours(period: DispatchPeriod) {
  if (period === "morning") return [6, 7, 8, 9, 10, 11]
  if (period === "afternoon") return [12, 13, 14, 15, 16, 17]
  return [18, 19, 20, 21, 22, 23]
}

export async function POST(request: NextRequest) {
  try {
    const { companyId } = await resolveRequestCompanyContext(request, {
      allowCallbackSecret: true,
    })

    const supabase = createClient()
    const body = await request.json().catch(() => ({}))
    const period = String(body?.period ?? "").trim().toLowerCase()

    if (!isValidPeriod(period)) {
      return NextResponse.json(
        { error: "period obrigatorio: morning, afternoon ou night" },
        { status: 400 }
      )
    }

    const allowedHours = getAllowedHours(period)

    const { data: schedules, error } = await supabase
      .from("schedules")
      .select("id, name, cron_expression, is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const matchedSchedules = (schedules ?? []).filter((schedule) => {
      const hours = extractHoursFromCronValue(schedule.cron_expression ?? "")
      return hours.some((hour) => allowedHours.includes(hour))
    })

    if (matchedSchedules.length === 0) {
      return NextResponse.json({
        success: true,
        period,
        matched: 0,
        dispatched: 0,
        results: [],
      })
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
    }

    const callbackSecret = request.headers.get("x-callback-secret")
    if (callbackSecret) {
      headers["x-callback-secret"] = callbackSecret
    }

    const authorization = request.headers.get("authorization")
    if (authorization) {
      headers["authorization"] = authorization
    }

    const results: Array<{
      schedule_id: string
      schedule_name: string
      success: boolean
      status: number
      error?: string
      logs_created?: number
    }> = []

    for (const schedule of matchedSchedules) {
      try {
        const response = await fetch(new URL("/api/dispatch", appUrl), {
          method: "POST",
          headers,
          body: JSON.stringify({
            schedule_id: schedule.id,
          }),
        })

        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          results.push({
            schedule_id: schedule.id,
            schedule_name: schedule.name,
            success: false,
            status: response.status,
            error: payload?.error || "Erro ao disparar rotina",
          })
          continue
        }

        results.push({
          schedule_id: schedule.id,
          schedule_name: schedule.name,
          success: true,
          status: response.status,
          logs_created: payload?.logs_created ?? 0,
        })
      } catch (error) {
        results.push({
          schedule_id: schedule.id,
          schedule_name: schedule.name,
          success: false,
          status: 500,
          error: error instanceof Error ? error.message : "Erro inesperado",
        })
      }
    }

    const dispatched = results.filter((item) => item.success).length

    return NextResponse.json({
      success: true,
      period,
      matched: matchedSchedules.length,
      dispatched,
      results,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Erro ao disparar por periodo",
      },
      { status: 500 }
    )
  }
}
