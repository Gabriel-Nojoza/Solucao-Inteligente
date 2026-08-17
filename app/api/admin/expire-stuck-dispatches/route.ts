import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"

const STUCK_TIMEOUT_MINUTES = 5

export async function GET(request: NextRequest) {
  try {
    const platformSecret = process.env.PLATFORM_SCHEDULER_SECRET?.trim()
    if (!platformSecret) {
      return NextResponse.json({ error: "Endpoint nao configurado" }, { status: 503 })
    }

    const { searchParams } = new URL(request.url)
    const headerSecret = request.headers.get("x-callback-secret")?.trim()
    const querySecret = searchParams.get("secret")?.trim()
    const incomingSecret = headerSecret || querySecret || ""

    if (incomingSecret !== platformSecret) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 })
    }

    const supabase = createClient()

    const cutoff = new Date(Date.now() - STUCK_TIMEOUT_MINUTES * 60 * 1000).toISOString()

    const { data: expired, error } = await supabase
      .from("dispatch_logs")
      .update({
        status: "failed",
        error_message: `Timeout de entrega — sem confirmacao do bot apos ${STUCK_TIMEOUT_MINUTES} minutos. Relatorio sera reenviado no proximo horario.`,
        completed_at: new Date().toISOString(),
      })
      .in("status", ["sending", "pending"])
      .lt("created_at", cutoff)
      .select("id, company_id, schedule_id")

    if (error) {
      console.error("[expire-stuck-dispatches] erro ao expirar logs:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const count = expired?.length ?? 0

    if (count > 0) {
      console.log(`[expire-stuck-dispatches] expirou ${count} dispatch(es) travados`)
    }

    return NextResponse.json({
      expired: count,
      timeout_minutes: STUCK_TIMEOUT_MINUTES,
      cutoff,
    })
  } catch (err) {
    console.error("[expire-stuck-dispatches] erro inesperado:", err)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
