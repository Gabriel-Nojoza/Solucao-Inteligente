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

export async function PUT(request: NextRequest) {
  try {
    await requireAdminContext()
    const supabase = getAdminClient()

    const body = await request.json() as {
      companyId?: string
      reportLimit?: number | null
      chatLimit?: number | null
      reportExcessPrice?: number | null
      chatExcessPrice?: number | null
    }

    const companyId = String(body.companyId ?? "").trim()
    if (!companyId) {
      return NextResponse.json({ error: "companyId obrigatorio" }, { status: 400 })
    }

    const reportLimit = body.reportLimit === null ? null : (body.reportLimit !== undefined ? Number(body.reportLimit) : undefined)
    const chatLimit = body.chatLimit === null ? null : (body.chatLimit !== undefined ? Number(body.chatLimit) : undefined)
    const reportExcessPrice = body.reportExcessPrice === null ? null : (body.reportExcessPrice !== undefined ? Number(body.reportExcessPrice) : undefined)
    const chatExcessPrice = body.chatExcessPrice === null ? null : (body.chatExcessPrice !== undefined ? Number(body.chatExcessPrice) : undefined)

    if (reportLimit !== null && reportLimit !== undefined && (isNaN(reportLimit) || reportLimit < 0)) {
      return NextResponse.json({ error: "reportLimit invalido" }, { status: 400 })
    }
    if (chatLimit !== null && chatLimit !== undefined && (isNaN(chatLimit) || chatLimit < 0)) {
      return NextResponse.json({ error: "chatLimit invalido" }, { status: 400 })
    }
    if (reportExcessPrice !== null && reportExcessPrice !== undefined && (isNaN(reportExcessPrice) || reportExcessPrice < 0)) {
      return NextResponse.json({ error: "reportExcessPrice invalido" }, { status: 400 })
    }
    if (chatExcessPrice !== null && chatExcessPrice !== undefined && (isNaN(chatExcessPrice) || chatExcessPrice < 0)) {
      return NextResponse.json({ error: "chatExcessPrice invalido" }, { status: 400 })
    }

    // Busca valor atual para mesclar campos
    const { data: existing } = await supabase
      .from("company_settings")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", "usage_limits")
      .maybeSingle()

    const current = (existing?.value ?? {}) as Record<string, unknown>

    const value = {
      report_limit: reportLimit !== undefined ? (reportLimit ?? null) : (current.report_limit ?? null),
      chat_limit: chatLimit !== undefined ? (chatLimit ?? null) : (current.chat_limit ?? null),
      report_excess_price: reportExcessPrice !== undefined ? (reportExcessPrice ?? null) : (current.report_excess_price ?? null),
      chat_excess_price: chatExcessPrice !== undefined ? (chatExcessPrice ?? null) : (current.chat_excess_price ?? null),
    }

    const { error } = await supabase
      .from("company_settings")
      .upsert(
        { company_id: companyId, key: "usage_limits", value },
        { onConflict: "company_id,key" }
      )

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao salvar limites:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar limites" },
      { status: 500 }
    )
  }
}
