import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { resolveRequestCompanyContext } from "@/lib/n8n-auth"

function normalizeDispatchLogIds(body: Record<string, unknown>) {
  if (Array.isArray(body.dispatch_log_ids)) {
    return body.dispatch_log_ids.filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    )
  }

  if (typeof body.dispatch_log_id === "string" && body.dispatch_log_id.trim()) {
    return [body.dispatch_log_id.trim()]
  }

  return []
}

export async function POST(request: NextRequest) {
  try {
    const { companyId } = await resolveRequestCompanyContext(request, {
      allowCallbackSecret: true,
    })
    const supabase = createClient()
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "JSON invalido" }, { status: 400 })
    }

    const ids = normalizeDispatchLogIds(body)
    const status = typeof body.status === "string" ? body.status.trim() : ""
    const errorMessage =
      typeof body.error_message === "string" && body.error_message.trim()
        ? body.error_message.trim()
        : null
    const n8nExecutionId =
      typeof body.n8n_execution_id === "string" && body.n8n_execution_id.trim()
        ? body.n8n_execution_id.trim()
        : null

    if (ids.length === 0) {
      return NextResponse.json({ error: "dispatch_log_id(s) obrigatorio(s)" }, { status: 400 })
    }

    const validStatus = ["delivered", "failed"]
    if (!validStatus.includes(status)) {
      return NextResponse.json({ error: "Status invalido" }, { status: 400 })
    }

    for (const id of ids) {
      await supabase
        .from("dispatch_logs")
        .update({
          status,
          error_message: status === "failed" ? errorMessage : null,
          n8n_execution_id: n8nExecutionId,
          completed_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .eq("id", id)
    }

    return NextResponse.json({ success: true, updated: ids.length })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nao foi possivel atualizar o callback do N8N"
    const status =
      message === "Callback secret invalido" || message.toLowerCase().includes("nao autorizado")
        ? 401
        : message.toLowerCase().includes("json")
          ? 400
          : 500

    return NextResponse.json({ error: message }, { status })
  }
}
