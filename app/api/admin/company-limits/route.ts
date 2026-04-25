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
    }

    const companyId = String(body.companyId ?? "").trim()
    if (!companyId) {
      return NextResponse.json({ error: "companyId obrigatorio" }, { status: 400 })
    }

    const reportLimit = body.reportLimit === null ? null : Number(body.reportLimit)
    const chatLimit = body.chatLimit === null ? null : Number(body.chatLimit)

    if (reportLimit !== null && (isNaN(reportLimit) || reportLimit < 0)) {
      return NextResponse.json({ error: "reportLimit invalido" }, { status: 400 })
    }
    if (chatLimit !== null && (isNaN(chatLimit) || chatLimit < 0)) {
      return NextResponse.json({ error: "chatLimit invalido" }, { status: 400 })
    }

    const value = {
      report_limit: reportLimit ?? null,
      chat_limit: chatLimit ?? null,
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
