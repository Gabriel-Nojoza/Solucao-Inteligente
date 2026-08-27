import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminContext } from "@/lib/tenant"
import { resolveCompanyByName } from "@/lib/company-lookup"

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

const TIME_ZONE = "America/Sao_Paulo"

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

const hourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
})

type Period = "manha" | "tarde" | "noite"

// Manha: 00h-11h59, Tarde: 12h-17h59, Noite: 18h-23h59 (horario de Brasilia).
function getPeriod(hour: number): Period {
  if (hour < 12) return "manha"
  if (hour < 18) return "tarde"
  return "noite"
}

function sortByTime(entries: { report_name: string; time: string; count: number }[]) {
  return entries.sort((a, b) => a.time.localeCompare(b.time))
}

// Lista, por empresa, quantos disparos falharam nas ultimas 24h (agrupado por rotina e por horario/periodo do dia).
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
    .select("schedule_id, report_name, dispatched_at, created_at")
    .eq("company_id", companyId)
    .eq("status", "failed")
    .gte("created_at", since)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bySchedule = new Map<string, { schedule_id: string; report_name: string; count: number }>()
  const byPeriod: Record<Period, Map<string, { report_name: string; time: string; count: number }>> = {
    manha: new Map(),
    tarde: new Map(),
    noite: new Map(),
  }

  for (const row of data ?? []) {
    const reportName = row.report_name ?? "Desconhecido"

    if (row.schedule_id) {
      const existing = bySchedule.get(row.schedule_id)
      if (existing) {
        existing.count += 1
      } else {
        bySchedule.set(row.schedule_id, { schedule_id: row.schedule_id, report_name: reportName, count: 1 })
      }
    }

    const timestamp = row.dispatched_at ?? row.created_at
    if (!timestamp) continue
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) continue

    const hour = Number(hourFormatter.format(date))
    const time = timeFormatter.format(date)
    const period = getPeriod(hour)
    const key = `${reportName}|${time}`

    const existingEntry = byPeriod[period].get(key)
    if (existingEntry) {
      existingEntry.count += 1
    } else {
      byPeriod[period].set(key, { report_name: reportName, time, count: 1 })
    }
  }

  return NextResponse.json({
    total_failed: data?.length ?? 0,
    schedules: Array.from(bySchedule.values()),
    by_period: {
      manha: sortByTime(Array.from(byPeriod.manha.values())),
      tarde: sortByTime(Array.from(byPeriod.tarde.values())),
      noite: sortByTime(Array.from(byPeriod.noite.values())),
    },
  })
}

// Reenvia todas as rotinas que tiveram falha nas ultimas 24h para a empresa.
// Autenticacao: login de admin OU secret da plataforma (header x-callback-secret
// ou ?secret=), para permitir que o bot do Telegram / n8n dispare o reenvio.
export async function POST(request: NextRequest) {
  const platformSecret = process.env.PLATFORM_SCHEDULER_SECRET?.trim()
  const incomingSecret =
    request.headers.get("x-callback-secret")?.trim() ||
    new URL(request.url).searchParams.get("secret")?.trim() ||
    ""
  const viaSecret = !!platformSecret && incomingSecret === platformSecret

  if (!viaSecret) {
    try {
      await requireAdminContext()
    } catch {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 })
    }
  }

  if (!platformSecret) {
    return NextResponse.json({ error: "PLATFORM_SCHEDULER_SECRET nao configurado" }, { status: 500 })
  }

  const supabase = getAdminClient()
  const body = await request.json().catch(() => null)

  let companyId = typeof body?.company_id === "string" ? body.company_id.trim() : ""
  let companyName = ""

  // Alternativa a company_id: trecho do nome da empresa (fuzzy).
  if (!companyId && typeof body?.company === "string" && body.company.trim()) {
    const companyInput = body.company.trim()
    const resolved = await resolveCompanyByName(supabase, companyInput)
    if (resolved.candidates) {
      return NextResponse.json(
        {
          error: "ambiguous_company",
          message: `"${companyInput}" casa com mais de uma empresa. Seja mais especifico.`,
          candidates: resolved.candidates,
        },
        { status: 409 }
      )
    }
    if (!resolved.match) {
      return NextResponse.json(
        {
          error: "company_not_found",
          message: `Nenhuma empresa encontrada para "${companyInput}".`,
        },
        { status: 404 }
      )
    }
    companyId = resolved.match.id
    companyName = resolved.match.name
  }

  if (!companyId) {
    return NextResponse.json({ error: "company_id ou company obrigatorio" }, { status: 400 })
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
    return NextResponse.json({
      started: false,
      total: 0,
      company_id: companyId,
      company_name: companyName || undefined,
    })
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
    company_id: companyId,
    company_name: companyName || undefined,
    total: scheduleIds.length,
    interval_minutes: RESEND_INTERVAL_MS / 60000,
    estimated_minutes: Math.round((scheduleIds.length * RESEND_INTERVAL_MS) / 60000),
  })
}
