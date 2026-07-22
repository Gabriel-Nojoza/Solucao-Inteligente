import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId } = await params
    const ctx = await getRequestContext()
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from("campaign_sends")
      .select("id, client_name, client_phone, message, status, error_message, sent_at, created_at")
      .eq("execution_id", executionId)
      .eq("company_id", ctx.companyId)
      .order("created_at", { ascending: true })

    if (error) throw error
    return NextResponse.json(data ?? [])
  } catch (error) {
    if (isAuthContextError(error)) {
      return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
    }
    return NextResponse.json({ error: "Erro ao buscar envios" }, { status: 500 })
  }
}
