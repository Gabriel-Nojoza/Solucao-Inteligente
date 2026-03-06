import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { z } from "zod"

const contactSchema = z.object({
  name: z.string().min(1, "Nome obrigatorio"),
  phone: z.string().nullable().optional(),
  type: z.enum(["individual", "group"]).default("individual"),
  whatsapp_group_id: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
})

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const type = searchParams.get("type")

  let query = supabase
    .from("contacts")
    .select("*")
    .order("created_at", { ascending: false })

  if (type && type !== "all") {
    query = query.eq("type", type)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createClient()

  const body = await request.json()
  const parsed = contactSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()
  const { id, ...updates } = body

  if (!id) {
    return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("contacts")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
  }

  const { error } = await supabase.from("contacts").delete().eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
