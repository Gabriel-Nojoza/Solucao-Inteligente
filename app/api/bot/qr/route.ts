import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"
import { controlWhatsAppBot, readWhatsAppBotRuntimeState } from "@/lib/whatsapp-bot"
import {
  getCompanyWhatsAppBotInstance,
  isMissingWhatsAppBotInstancesTableError,
  normalizeBotInstanceForResponse,
} from "@/lib/whatsapp-bot-instances"

function getInstanceIdFromRequest(request: NextRequest) {
  return new URL(request.url).searchParams.get("instance_id")
}

function getMissingMigrationResponse() {
  return NextResponse.json(
    {
      error:
        "O banco ainda nao suporta varios WhatsApps por empresa. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase.",
    },
    { status: 500 }
  )
}

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const instanceId = getInstanceIdFromRequest(request)
    const instance = await getCompanyWhatsAppBotInstance(supabase, companyId, instanceId)

    if (!instance) {
      return NextResponse.json(
        { error: "Nenhum WhatsApp configurado para esta empresa" },
        { status: 404 }
      )
    }

    return NextResponse.json(instance)
  } catch (error) {
    if (isMissingWhatsAppBotInstancesTableError(error)) {
      return getMissingMigrationResponse()
    }

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
    const instanceId = getInstanceIdFromRequest(request)
    const body = await request.json()
    const qrCodeUrl =
      typeof body?.qr_code_url === "string" ? body.qr_code_url.trim() : ""

    const instance = await getCompanyWhatsAppBotInstance(supabase, companyId, instanceId)
    if (!instance) {
      return NextResponse.json(
        { error: "WhatsApp nao encontrado para esta empresa" },
        { status: 404 }
      )
    }

    const { data, error } = await supabase
      .from("whatsapp_bot_instances")
      .update({
        manual_qr_code_url: qrCodeUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("id", instance.id)
      .select("*")
      .single()

    if (error) {
      if (isMissingWhatsAppBotInstancesTableError(error)) {
        return getMissingMigrationResponse()
      }

      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const runtimeState = await readWhatsAppBotRuntimeState(data.id).catch(() => null)
    return NextResponse.json(normalizeBotInstanceForResponse(data, runtimeState))
  } catch (error) {
    if (isMissingWhatsAppBotInstancesTableError(error)) {
      return getMissingMigrationResponse()
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao autorizado" },
      { status: 401 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const body = await request.json()
    const action =
      body?.action === "disconnect" ||
      body?.action === "restart" ||
      body?.action === "switch_phone"
        ? body.action
        : null
    const instanceId =
      typeof body?.instance_id === "string" && body.instance_id.trim()
        ? body.instance_id.trim()
        : getInstanceIdFromRequest(request)

    if (!action) {
      return NextResponse.json({ error: "Acao invalida" }, { status: 400 })
    }

    const instance = await getCompanyWhatsAppBotInstance(supabase, companyId, instanceId)
    if (!instance) {
      return NextResponse.json(
        { error: "WhatsApp nao encontrado para esta empresa" },
        { status: 404 }
      )
    }

    const runtimeState = await controlWhatsAppBot(action, instance.id)
    return NextResponse.json(normalizeBotInstanceForResponse(instance, runtimeState))
  } catch (error) {
    if (isMissingWhatsAppBotInstancesTableError(error)) {
      return getMissingMigrationResponse()
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao foi possivel controlar o bot" },
      { status: 500 }
    )
  }
}
