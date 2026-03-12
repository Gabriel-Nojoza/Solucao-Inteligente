import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"
import { controlWhatsAppBot, readWhatsAppBotRuntimeState } from "@/lib/whatsapp-bot"

const BOT_QR_SETTINGS_KEY = "whatsapp_bot"

export async function GET() {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const { data, error } = await supabase
      .from("company_settings")
      .select("value, updated_at")
      .eq("company_id", companyId)
      .eq("key", BOT_QR_SETTINGS_KEY)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const value = (data?.value as Record<string, unknown> | null) ?? null
    const runtimeState = await readWhatsAppBotRuntimeState()
    const manualQrCodeUrl =
      value && typeof value.qr_code_url === "string" ? value.qr_code_url : ""
    const runtimeQrCodeUrl = runtimeState?.qr_code_data_url ?? ""

    return NextResponse.json({
      qr_code_url: runtimeQrCodeUrl || manualQrCodeUrl,
      manual_qr_code_url: manualQrCodeUrl,
      runtime_qr_code_url: runtimeQrCodeUrl,
      updated_at: runtimeState?.updated_at ?? data?.updated_at ?? null,
      manual_updated_at: data?.updated_at ?? null,
      connected_at: runtimeState?.connected_at ?? null,
      status: runtimeState?.status ?? "offline",
      last_error: runtimeState?.last_error ?? null,
      phone_number: runtimeState?.phone_number ?? null,
      display_name: runtimeState?.display_name ?? null,
      jid: runtimeState?.jid ?? null,
      source: runtimeQrCodeUrl ? "runtime" : manualQrCodeUrl ? "manual" : "none",
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
    const qrCodeUrl =
      typeof body?.qr_code_url === "string" ? body.qr_code_url.trim() : ""

    const { data, error } = await supabase
      .from("company_settings")
      .upsert(
        {
          company_id: companyId,
          key: BOT_QR_SETTINGS_KEY,
          value: {
            qr_code_url: qrCodeUrl,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,key" }
      )
      .select("value, updated_at")
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const value = (data?.value as Record<string, unknown> | null) ?? null
    const runtimeState = await readWhatsAppBotRuntimeState()
    const manualQrCodeUrl =
      value && typeof value.qr_code_url === "string" ? value.qr_code_url : ""
    const runtimeQrCodeUrl = runtimeState?.qr_code_data_url ?? ""

    return NextResponse.json({
      qr_code_url: runtimeQrCodeUrl || manualQrCodeUrl,
      manual_qr_code_url: manualQrCodeUrl,
      runtime_qr_code_url: runtimeQrCodeUrl,
      updated_at: runtimeState?.updated_at ?? data?.updated_at ?? null,
      manual_updated_at: data?.updated_at ?? null,
      connected_at: runtimeState?.connected_at ?? null,
      status: runtimeState?.status ?? "offline",
      last_error: runtimeState?.last_error ?? null,
      phone_number: runtimeState?.phone_number ?? null,
      display_name: runtimeState?.display_name ?? null,
      jid: runtimeState?.jid ?? null,
      source: runtimeQrCodeUrl ? "runtime" : manualQrCodeUrl ? "manual" : "none",
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao autorizado" },
      { status: 401 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    await getRequestContext()
    const body = await request.json()
    const action =
      body?.action === "disconnect" || body?.action === "restart" ? body.action : null

    if (!action) {
      return NextResponse.json({ error: "Acao invalida" }, { status: 400 })
    }

    const runtimeState = await controlWhatsAppBot(action)

    return NextResponse.json({
      qr_code_url: runtimeState.qr_code_data_url,
      manual_qr_code_url: "",
      runtime_qr_code_url: runtimeState.qr_code_data_url,
      updated_at: runtimeState.updated_at,
      manual_updated_at: null,
      connected_at: runtimeState.connected_at,
      status: runtimeState.status,
      last_error: runtimeState.last_error,
      phone_number: runtimeState.phone_number,
      display_name: runtimeState.display_name,
      jid: runtimeState.jid,
      source: runtimeState.qr_code_data_url ? "runtime" : "none",
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao foi possivel controlar o bot" },
      { status: 500 }
    )
  }
}
