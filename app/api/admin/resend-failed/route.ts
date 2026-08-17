import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminContext } from "@/lib/tenant"

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function getRequestOrigin(request: NextRequest) {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    request.headers.get("origin") ||
    new URL(request.url).origin
  )
}

// Lista, por empresa, quantos disparos falharam nas ultimas 24h (agrupado por rotina).
export async function GET(request: NextRequest) {
  await requireAdminContext()
  const supabase = getAdminClient()
  const companyId = new URL(request.url).searchParams.get("company_id")

  if (!companyId) {
    return NextResponse.json({ error: "company_id obrigatorio" }, { status: 400 })
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from("dispatch_logs")
    .select("schedule_id, report_name, created_at")
    .eq("company_id", companyId)
    .eq("status", "failed")
    .gte("created_at", since)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bySchedule = new Map<string, { schedule_id: string; report_name: string; count: number }>()
  for (const row of data ?? []) {
    if (!row.schedule_id) continue
    const existing = bySchedule.get(row.schedule_id)
    if (existing) {
      existing.count += 1
    } else {
      bySchedule.set(row.schedule_id, {
        schedule_id: row.schedule_id,
        report_name: row.report_name ?? "Desconhecido",
        count: 1,
      })
    }
  }

  return NextResponse.json({
    total_failed: data?.length ?? 0,
    schedules: Array.from(bySchedule.values()),
  })
}

// Reenvia todas as rotinas que tiveram falha nas ultimas 24h para a empresa.
export async function POST(request: NextRequest) {
  await requireAdminContext()
  const supabase = getAdminClient()
  const body = await request.json().catch(() => null)
  const companyId = typeof body?.company_id === "string" ? body.company_id.trim() : ""

  if (!companyId) {
    return NextResponse.json({ error: "company_id obrigatorio" }, { status: 400 })
  }

  const platformSecret = process.env.PLATFORM_SCHEDULER_SECRET?.trim()
  if (!platformSecret) {
    return NextResponse.json({ error: "PLATFORM_SCHEDULER_SECRET nao configurado" }, { status: 500 })
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from("dispatch_logs")
    .select("schedule_id, report_name")
    .eq("company_id", companyId)
    .eq("status", "failed")
    .gte("created_at", since)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const scheduleIds = Array.from(
    new Set((data ?? []).map((row) => row.schedule_id).filter((id): id is string => !!id))
  )

  if (scheduleIds.length === 0) {
    return NextResponse.json({ started: false, total: 0 })
  }

  const appUrl = getRequestOrigin(request)
  const RESEND_INTERVAL_MS = 3 * 60 * 1000

  // Roda em segundo plano no processo do servidor — nao trava a resposta HTTP
  // esperando todas as rotinas (com 3 min de intervalo, pode levar bastante tempo).
  ;(async () => {
    for (const scheduleId of scheduleIds) {
      try {
        const res = await fetch(`${appUrl}/api/dispatch?secret=${encodeURIComponent(platformSecret)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schedule_id: scheduleId }),
        })
        const json = await res.json().catch(() => null)
        console.log("[admin/resend-failed] resultado", {
          companyId,
          scheduleId,
          ok: res.ok,
          error: res.ok ? undefined : json?.error,
        })
      } catch (err) {
        console.error("[admin/resend-failed] erro ao reenviar", {
          companyId,
          scheduleId,
          error: err instanceof Error ? err.message : "Erro desconhecido",
        })
      }
      await new Promise((resolve) => setTimeout(resolve, RESEND_INTERVAL_MS))
    }
    console.log("[admin/resend-failed] concluido", { companyId, total: scheduleIds.length })
  })().catch((err) => {
    console.error("[admin/resend-failed] erro inesperado no processo em segundo plano", err)
  })

  return NextResponse.json({
    started: true,
    total: scheduleIds.length,
    interval_minutes: RESEND_INTERVAL_MS / 60000,
    estimated_minutes: Math.round((scheduleIds.length * RESEND_INTERVAL_MS) / 60000),
  })
}
