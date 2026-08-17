import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"

const CANCELLABLE_STATUSES = ["pending", "exporting", "sending"]

export async function POST(request: NextRequest) {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const body = await request.json().catch(() => null)
    const dispatchLogId =
      typeof body?.dispatch_log_id === "string" ? body.dispatch_log_id.trim() : ""

    if (!dispatchLogId) {
      return NextResponse.json({ error: "dispatch_log_id obrigatorio" }, { status: 400 })
    }

    const { data: log, error: fetchError } = await supabase
      .from("dispatch_logs")
      .select("id, status")
      .eq("company_id", companyId)
      .eq("id", dispatchLogId)
      .single()

    if (fetchError || !log) {
      return NextResponse.json({ error: "Log nao encontrado" }, { status: 404 })
    }

    if (!CANCELLABLE_STATUSES.includes(log.status)) {
      return NextResponse.json(
        { error: "Esse envio ja foi concluido e nao pode mais ser cancelado." },
        { status: 400 }
      )
    }

    const { error: updateError } = await supabase
      .from("dispatch_logs")
      .update({
        status: "failed",
        error_message: "Cancelado pelo usuario.",
        completed_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("id", dispatchLogId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (isAuthContextError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Nao autenticado" },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno ao cancelar envio" },
      { status: 500 }
    )
  }
}
