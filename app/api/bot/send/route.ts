import { NextRequest, NextResponse } from "next/server"
import {
  sendWhatsAppBotMessage,
  type WhatsAppBotSendPayload,
} from "@/lib/whatsapp-bot"
import { resolveRequestCompanyContext } from "@/lib/n8n-auth"
import { createServiceClient as createClient } from "@/lib/supabase/server"

function toOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeSendPayload(body: unknown): WhatsAppBotSendPayload {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {}

  return {
    instance_id: toOptionalString(record.instance_id),
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

function normalizeDispatchMetadata(body: unknown) {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {}

  return {
    dispatchLogId: toOptionalString(record.dispatch_log_id),
    n8nExecutionId: toOptionalString(record.n8n_execution_id),
  }
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  let companyId: string | null = null
  let dispatchLogId: string | null = null
  let n8nExecutionId: string | null = null

  try {
    const context = await resolveRequestCompanyContext(request, {
      allowCallbackSecret: true,
    })
    companyId = context.companyId

    const body = await request.json()
    const payload = normalizeSendPayload(body)
    const queryInstanceId = toOptionalString(new URL(request.url).searchParams.get("instance_id"))
    if (!payload.instance_id && queryInstanceId) {
      payload.instance_id = queryInstanceId
    }
    const metadata = normalizeDispatchMetadata(body)
    dispatchLogId = metadata.dispatchLogId
    n8nExecutionId = metadata.n8nExecutionId

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

    console.log("[bot/send] request received", {
      requestUrl: request.url,
      requestHost: request.headers.get("host")?.trim() || null,
      requestOrigin: request.headers.get("origin")?.trim() || null,
      companyId,
      dispatchLogId,
      instanceId: payload.instance_id ?? null,
      phone: payload.phone ?? null,
      whatsappGroupId: payload.whatsapp_group_id ?? null,
      hasDocumentBase64: Boolean(payload.document_base64),
      hasDocumentUrl: Boolean(payload.document_url),
      fileName: payload.file_name ?? null,
      mimetype: payload.mimetype ?? null,
    })

    const result = await sendWhatsAppBotMessage(payload)

    if (companyId && dispatchLogId) {
      await supabase
        .from("dispatch_logs")
        .update({
          status: "delivered",
          error_message: null,
          n8n_execution_id: n8nExecutionId,
          completed_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .eq("id", dispatchLogId)
    }

    return NextResponse.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nao foi possivel enviar mensagem pelo bot"

    if (companyId && dispatchLogId && message !== "Callback secret invalido") {
      await supabase
        .from("dispatch_logs")
        .update({
          status: "failed",
          error_message: message,
          n8n_execution_id: n8nExecutionId,
          completed_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .eq("id", dispatchLogId)
    }

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
