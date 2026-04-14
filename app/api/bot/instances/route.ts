import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"
import {
  getCompanyWhatsAppBotInstance,
  isMissingWhatsAppBotInstancesTableError,
  listCompanyWhatsAppBotInstances,
  normalizeBotInstanceForResponse,
} from "@/lib/whatsapp-bot-instances"
import { readWhatsAppBotRuntimeState } from "@/lib/whatsapp-bot"

const instanceSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatorio"),
  manual_qr_code_url: z.string().trim().optional().nullable(),
  is_default: z.boolean().optional(),
})

const updateInstanceSchema = instanceSchema.partial().extend({
  id: z.string().uuid(),
})

export async function GET() {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const instances = await listCompanyWhatsAppBotInstances(supabase, companyId)

    return NextResponse.json(instances)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nao foi possivel listar os WhatsApps"
    const status = message.includes("20260328_whatsapp_bot_instances.sql") ? 500 : 401
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const body = await request.json()
    const parsed = instanceSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const existingInstances = await listCompanyWhatsAppBotInstances(supabase, companyId).catch(
      (error) => {
        if (isMissingWhatsAppBotInstancesTableError(error)) {
          throw new Error(
            "O banco ainda nao suporta varios WhatsApps por empresa. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase."
          )
        }

        throw error
      }
    )

    const shouldBeDefault = parsed.data.is_default === true || existingInstances.length === 0

    if (shouldBeDefault) {
      await supabase
        .from("whatsapp_bot_instances")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
    }

    const { data, error } = await supabase
      .from("whatsapp_bot_instances")
      .insert({
        company_id: companyId,
        name: parsed.data.name,
        manual_qr_code_url: parsed.data.manual_qr_code_url || null,
        is_default: shouldBeDefault,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single()

    if (error) {
      if (isMissingWhatsAppBotInstancesTableError(error)) {
        return NextResponse.json(
          {
            error:
              "O banco ainda nao suporta varios WhatsApps por empresa. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase.",
          },
          { status: 500 }
        )
      }

      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const runtimeState = await readWhatsAppBotRuntimeState(data.id).catch(() => null)
    return NextResponse.json(normalizeBotInstanceForResponse(data, runtimeState), {
      status: 201,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao autorizado" },
      { status: 401 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const body = await request.json()
    const parsed = updateInstanceSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    if (parsed.data.is_default === true) {
      await supabase
        .from("whatsapp_bot_instances")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
    }

    const payload = Object.fromEntries(
      Object.entries({
        name: parsed.data.name,
        manual_qr_code_url:
          parsed.data.manual_qr_code_url === undefined
            ? undefined
            : parsed.data.manual_qr_code_url || null,
        is_default: parsed.data.is_default,
        updated_at: new Date().toISOString(),
      }).filter(([, value]) => value !== undefined)
    )

    const { data, error } = await supabase
      .from("whatsapp_bot_instances")
      .update(payload)
      .eq("company_id", companyId)
      .eq("id", parsed.data.id)
      .select("*")
      .single()

    if (error) {
      if (isMissingWhatsAppBotInstancesTableError(error)) {
        return NextResponse.json(
          {
            error:
              "O banco ainda nao suporta varios WhatsApps por empresa. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase.",
          },
          { status: 500 }
        )
      }

      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const instance = await getCompanyWhatsAppBotInstance(supabase, companyId, data.id)
    return NextResponse.json(instance ?? data)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao autorizado" },
      { status: 401 }
    )
  }
}
