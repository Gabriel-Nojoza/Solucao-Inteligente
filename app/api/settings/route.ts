import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { requireAdminContext } from "@/lib/tenant"

export async function GET() {
  try {
    const { companyId } = await requireAdminContext()
    const supabase = createClient()

    const { data, error } = await supabase
      .from("company_settings")
      .select("*")
      .eq("company_id", companyId)
      .order("key")

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const settings: Record<string, unknown> = {}
    for (const row of data ?? []) {
      settings[row.key] = row.value
    }

    return NextResponse.json(settings)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao autorizado" },
      { status: 401 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { companyId } = await requireAdminContext()
    const supabase = createClient()
    const body = await request.json()
    const { key, value } = body

    if (!key || !value) {
      return NextResponse.json(
        { error: "key e value obrigatorios" },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from("company_settings")
      .upsert(
        {
          company_id: companyId,
          key,
          value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,key" }
      )
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao autorizado" },
      { status: 401 }
    )
  }
}
