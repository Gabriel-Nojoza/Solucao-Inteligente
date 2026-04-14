import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { z } from "zod"
import { getRequestContext } from "@/lib/tenant"
import {
  buildContactWritePayload,
  contactsSupportWhatsappGroupId,
  normalizeContactForResponse,
} from "@/lib/contact-compat"
import {
  getCompanyWhatsAppBotInstance,
  isMissingBotInstanceIdColumnError,
  isMissingWhatsAppBotInstancesTableError,
} from "@/lib/whatsapp-bot-instances"

const contactSchema = z.object({
  name: z.string().min(1, "Nome obrigatorio"),
  phone: z.string().nullable().optional(),
  type: z.enum(["individual", "group"]).default("individual"),
  whatsapp_group_id: z.string().nullable().optional(),
  bot_instance_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().default(true),
})

export async function GET(request: NextRequest) {
  const { companyId } = await getRequestContext()
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const type = searchParams.get("type")
  const botInstanceId = searchParams.get("bot_instance_id")

  let query = supabase
    .from("contacts")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })

  if (type && type !== "all") {
    query = query.eq("type", type)
  }

   if (botInstanceId) {
    query = query.eq("bot_instance_id", botInstanceId)
  }

  const { data, error } = await query

  if (error) {
    if (isMissingBotInstanceIdColumnError(error, "contacts")) {
      return NextResponse.json(
        {
          error:
            "O banco ainda nao suporta contatos por numero de WhatsApp. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase.",
        },
        { status: 500 }
      )
    }

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

  if (parsed.data.bot_instance_id) {
    const instance = await getCompanyWhatsAppBotInstance(
      supabase,
      companyId,
      parsed.data.bot_instance_id
    ).catch((error) => {
      if (isMissingWhatsAppBotInstancesTableError(error)) {
        throw new Error(
          "O banco ainda nao suporta varios WhatsApps por empresa. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase."
        )
      }

      throw error
    })

    if (!instance) {
      return NextResponse.json(
        { error: "WhatsApp selecionado nao encontrado para esta empresa" },
        { status: 400 }
      )
    }
  }

  const supportsWhatsappGroupId = await contactsSupportWhatsappGroupId(supabase)
  const payload = buildContactWritePayload(
    {
      ...parsed.data,
      company_id: companyId,
      bot_instance_id: parsed.data.bot_instance_id ?? null,
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
    if (isMissingBotInstanceIdColumnError(error, "contacts")) {
      return NextResponse.json(
        {
          error:
            "O banco ainda nao suporta contatos por numero de WhatsApp. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase.",
        },
        { status: 500 }
      )
    }

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

  const normalizedBotInstanceId =
    typeof updates.bot_instance_id === "string" && updates.bot_instance_id.trim()
      ? updates.bot_instance_id.trim()
      : updates.bot_instance_id === null
        ? null
        : undefined

  if (normalizedBotInstanceId) {
    const instance = await getCompanyWhatsAppBotInstance(
      supabase,
      companyId,
      normalizedBotInstanceId
    ).catch((error) => {
      if (isMissingWhatsAppBotInstancesTableError(error)) {
        throw new Error(
          "O banco ainda nao suporta varios WhatsApps por empresa. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase."
        )
      }

      throw error
    })

    if (!instance) {
      return NextResponse.json(
        { error: "WhatsApp selecionado nao encontrado para esta empresa" },
        { status: 400 }
      )
    }
  }

  const supportsWhatsappGroupId = await contactsSupportWhatsappGroupId(supabase)
  const payload = buildContactWritePayload(
    {
      bot_instance_id: normalizedBotInstanceId,
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
    if (isMissingBotInstanceIdColumnError(error, "contacts")) {
      return NextResponse.json(
        {
          error:
            "O banco ainda nao suporta contatos por numero de WhatsApp. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase.",
        },
        { status: 500 }
      )
    }

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
