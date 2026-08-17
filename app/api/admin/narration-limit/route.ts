import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminContext } from "@/lib/tenant"
import { getTimePartsInTimeZone } from "@/lib/schedule-cron"

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(request: NextRequest) {
  await requireAdminContext()
  const supabase = getAdminClient()
  const companyId = new URL(request.url).searchParams.get("company_id")

  if (!companyId) {
    return NextResponse.json({ error: "company_id obrigatorio" }, { status: 400 })
  }

  const { data: rows } = await supabase
    .from("company_settings")
    .select("key, value")
    .eq("company_id", companyId)
    .in("key", ["narration_limit", "narration_usage"])

  const settingsMap = new Map((rows ?? []).map((row) => [row.key, row.value as Record<string, unknown>]))

  const limitValue = settingsMap.get("narration_limit")
  const dailyLimit =
    typeof limitValue?.daily_limit === "number" && limitValue.daily_limit > 0
      ? limitValue.daily_limit
      : 230

  const usageValue = settingsMap.get("narration_usage")
  const nowParts = getTimePartsInTimeZone(new Date(), "America/Sao_Paulo")
  const todayKey = `${nowParts.year}-${String(nowParts.month).padStart(2, "0")}-${String(nowParts.day).padStart(2, "0")}`
  const usedToday = usageValue?.date === todayKey && typeof usageValue?.count === "number" ? usageValue.count : 0

  return NextResponse.json({ daily_limit: dailyLimit, used_today: usedToday })
}

export async function PATCH(request: NextRequest) {
  await requireAdminContext()
  const supabase = getAdminClient()
  const body = await request.json().catch(() => null)
  const companyId = typeof body?.company_id === "string" ? body.company_id.trim() : ""
  const dailyLimit = typeof body?.daily_limit === "number" ? body.daily_limit : NaN

  if (!companyId || !Number.isFinite(dailyLimit) || dailyLimit <= 0) {
    return NextResponse.json(
      { error: "company_id e daily_limit (numero positivo) sao obrigatorios" },
      { status: 400 }
    )
  }

  const { error } = await supabase.from("company_settings").upsert(
    { company_id: companyId, key: "narration_limit", value: { daily_limit: dailyLimit } },
    { onConflict: "company_id,key" }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
