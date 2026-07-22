import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ctx = await getRequestContext()
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from("campaign_executions")
      .select("*")
      .eq("campaign_id", id)
      .eq("company_id", ctx.companyId)
      .order("started_at", { ascending: false })
      .limit(30)

    if (error) throw error
    return NextResponse.json(data ?? [])
  } catch (error) {
    if (isAuthContextError(error)) {
      return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
    }
    return NextResponse.json({ error: "Erro ao buscar historico" }, { status: 500 })
  }
}
