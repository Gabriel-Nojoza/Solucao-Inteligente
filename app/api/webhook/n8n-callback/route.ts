import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()

  const { dispatch_log_id, dispatch_log_ids, status, error_message, n8n_execution_id } = body

  const ids = dispatch_log_ids ?? (dispatch_log_id ? [dispatch_log_id] : [])

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
        error_message: error_message ?? null,
        n8n_execution_id: n8n_execution_id ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", id)
  }

  return NextResponse.json({ success: true })
}
