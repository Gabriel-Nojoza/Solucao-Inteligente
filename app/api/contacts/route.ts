import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { z } from "zod"
import { getRequestContext } from "@/lib/tenant"
import {
  buildContactWritePayload,
  contactsSupportWhatsappGroupId,
  normalizeContactForResponse,
} from "@/lib/contact-compat"

const contactSchema = z.object({
  name: z.string().min(1, "Nome obrigatorio"),
  phone: z.string().nullable().optional(),
  type: z.enum(["individual", "group"]).default("individual"),
  whatsapp_group_id: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
})

export async function GET(request: NextRequest) {
  const { companyId } = await getRequestContext()
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const type = searchParams.get("type")

  let query = supabase
    .from("contacts")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })

  if (type && type !== "all") {
    query = query.eq("type", type)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json((data ?? []).map((contact) => normalizeContactForResponse(contact)))
}

export async function POST(request: NextRequest) {
  const { companyId } = await getRequestContext()
  const supabase = createClient()

  const body = await request.json()
  const parsed = contactSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const supportsWhatsappGroupId = await contactsSupportWhatsappGroupId(supabase)
  const payload = buildContactWritePayload(
    {
      ...parsed.data,
      company_id: companyId,
      phone: parsed.data.phone ?? null,
      whatsapp_group_id: parsed.data.whatsapp_group_id ?? null,
      is_active: parsed.data.is_active,
    },
    supportsWhatsappGroupId
  )

  const { data, error } = await supabase
    .from("contacts")
    .insert(payload)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(normalizeContactForResponse(data), { status: 201 })
}

export async function PUT(request: NextRequest) {
  const { companyId } = await getRequestContext()
  const supabase = createClient()
  const body = await request.json()
  const { id, ...updates } = body

  if (!id) {
    return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
  }

  const supportsWhatsappGroupId = await contactsSupportWhatsappGroupId(supabase)
  const payload = buildContactWritePayload(
    {
      name: typeof updates.name === "string" ? updates.name : "",
      phone: typeof updates.phone === "string" ? updates.phone : null,
      type: updates.type === "group" ? "group" : "individual",
      whatsapp_group_id:
        typeof updates.whatsapp_group_id === "string" ? updates.whatsapp_group_id : null,
      is_active: typeof updates.is_active === "boolean" ? updates.is_active : true,
      updated_at: new Date().toISOString(),
    },
    supportsWhatsappGroupId
  )

  const { data, error } = await supabase
    .from("contacts")
    .update(payload)
    .eq("company_id", companyId)
    .eq("id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(normalizeContactForResponse(data))
}

export async function DELETE(request: NextRequest) {
  const { companyId } = await getRequestContext()
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
  }

  const { error } = await supabase.from("contacts").delete().eq("company_id", companyId).eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
