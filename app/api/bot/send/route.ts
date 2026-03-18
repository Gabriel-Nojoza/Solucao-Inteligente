import { NextRequest, NextResponse } from "next/server"
import {
  sendWhatsAppBotMessage,
  type WhatsAppBotSendPayload,
} from "@/lib/whatsapp-bot"
import { resolveRequestCompanyContext } from "@/lib/n8n-auth"

function toOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeSendPayload(body: unknown): WhatsAppBotSendPayload {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {}

  return {
    jid: toOptionalString(record.jid),
    phone: toOptionalString(record.phone),
    whatsapp_group_id: toOptionalString(record.whatsapp_group_id),
    message: toOptionalString(record.message),
    caption: toOptionalString(record.caption),
    text: toOptionalString(record.text),
    document_base64: toOptionalString(record.document_base64),
    document_url: toOptionalString(record.document_url),
    file_name: toOptionalString(record.file_name),
    mimetype: toOptionalString(record.mimetype),
  }
}

export async function POST(request: NextRequest) {
  try {
    await resolveRequestCompanyContext(request, {
      allowCallbackSecret: true,
    })

    const body = await request.json()
    const payload = normalizeSendPayload(body)

    if (!payload.jid && !payload.phone && !payload.whatsapp_group_id) {
      return NextResponse.json(
        { error: "Informe jid, phone ou whatsapp_group_id" },
        { status: 400 }
      )
    }

    if (
      !payload.message &&
      !payload.caption &&
      !payload.text &&
      !payload.document_base64 &&
      !payload.document_url
    ) {
      return NextResponse.json(
        { error: "Informe uma mensagem, document_base64 ou document_url" },
        { status: 400 }
      )
    }

    const result = await sendWhatsAppBotMessage(payload)
    return NextResponse.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nao foi possivel enviar mensagem pelo bot"
    const status =
      message === "Callback secret invalido" ||
      message.toLowerCase().includes("auth") ||
      message.toLowerCase().includes("session")
        ? 401
        : message.toLowerCase().includes("json")
          ? 400
          : 500

    return NextResponse.json({ error: message }, { status })
  }
}
