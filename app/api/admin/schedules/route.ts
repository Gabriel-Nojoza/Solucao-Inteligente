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

export async function GET(request: NextRequest) {
  const context = await requireAdminContext()
  const supabase = getAdminClient()
  const companyId = new URL(request.url).searchParams.get("company_id")

  let query = supabase
    .from("schedules")
    .select("id, name, is_active, cron_expression, send_mode, export_format, company_id, companies(name)")
    .order("name")

  if (companyId) {
    query = query.eq("company_id", companyId)
  } else if (!context.isPlatformAdmin) {
    query = query.eq("company_id", context.companyId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}

export async function PATCH(request: NextRequest) {
  await requireAdminContext()
  const supabase = getAdminClient()
  const body = await request.json()
  const { id, send_mode, export_format } = body

  if (!id) {
    return NextResponse.json({ error: "id obrigatorio" }, { status: 400 })
  }

  const update: Record<string, string> = {}

  if (send_mode !== undefined) {
    if (!["none", "audio", "text"].includes(send_mode)) {
      return NextResponse.json({ error: "send_mode invalido" }, { status: 400 })
    }
    update.send_mode = send_mode
  }

  if (export_format !== undefined) {
    if (!["PDF", "PNG"].includes(export_format)) {
      return NextResponse.json({ error: "export_format invalido" }, { status: 400 })
    }
    update.export_format = export_format
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nada para atualizar" }, { status: 400 })
  }

  const { error } = await supabase
    .from("schedules")
    .update(update)
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
