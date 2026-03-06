import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .order("key")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const settings: Record<string, unknown> = {}
  for (const row of data ?? []) {
    settings[row.key] = row.value
  }

  return NextResponse.json(settings)
}

export async function PUT(request: NextRequest) {
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
    .from("settings")
    .update({ value, updated_at: new Date().toISOString() })
    .eq("key", key)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
