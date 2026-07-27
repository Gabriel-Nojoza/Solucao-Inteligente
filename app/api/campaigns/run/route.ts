import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { isAuthContextError } from "@/lib/tenant"
import { resolveRequestCompanyContext } from "@/lib/n8n-auth"
import { getAccessToken, executeDAXQuery } from "@/lib/powerbi"
import { buildCampaignDaxQuery } from "@/lib/campaign-dax"
import { sendWhatsAppBotMessage } from "@/lib/whatsapp-bot"
import { retryAsync } from "@/lib/utils"
import type { CampaignClient } from "@/lib/types"

function formatValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    return value.toLocaleString("pt-BR")
  }
  if (typeof value === "string") {
    const num = parseFloat(value.replace(",", "."))
    if (!isNaN(num) && /^[\d.,]+$/.test(value.trim())) {
      if (value.includes(".") || value.includes(",")) {
        return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      }
      if (num >= 1000) return num.toLocaleString("pt-BR")
    }
  }
  return String(value)
}

function resolveMessage(template: string, row: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => formatValue(row[key]))
}

function normalizePhone(raw: unknown): string | null {
  if (!raw) return null
  // Remove todos os caracteres nao numericos (-, ;, ., (, ), +, espacos, etc.)
  let phone = String(raw).replace(/\D/g, "")

  // Remove codigo do pais 55 para normalizar o tamanho
  if (phone.startsWith("55") && phone.length >= 12) {
    phone = phone.slice(2)
  }

  // Adiciona o 9 para numeros moveis antigos de 8 digitos (DDD 2 + numero 8)
  if (phone.length === 10) {
    phone = phone.slice(0, 2) + "9" + phone.slice(2)
  }

  if (phone.length < 8) return null

  // Garante codigo do pais Brasil
  return `55${phone}`
}

export async function POST(request: NextRequest) {
  let executionId: string | null = null
  let supabase: ReturnType<typeof createServiceClient> | null = null

  try {
    const { companyId } = await resolveRequestCompanyContext(request, { allowCallbackSecret: true })
    const ctx = { companyId }
    supabase = createServiceClient()

    const body = await request.json()
    const campaignId = typeof body?.campaign_id === "string" ? body.campaign_id.trim() : ""
    if (!campaignId) {
      return NextResponse.json({ error: "campaign_id obrigatorio" }, { status: 400 })
    }

    // selected_clients allows the caller (dispatch dialog) to pass pre-filtered rows
    const selectedClients: CampaignClient[] | null = Array.isArray(body?.selected_clients)
      ? (body.selected_clients as CampaignClient[])
      : null

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("company_id", ctx.companyId)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json({ error: "Campanha nao encontrada" }, { status: 404 })
    }

    let clients: CampaignClient[]

    if (selectedClients !== null) {
      // Use the pre-selected list from the dispatch dialog
      clients = selectedClients
    } else {
      // Execute DAX query to get full list
      const daxQuery = buildCampaignDaxQuery(campaign)

      if (!daxQuery) {
        return NextResponse.json({ error: "Campanha sem consulta configurada" }, { status: 422 })
      }

      const token = await getAccessToken(ctx.companyId)
      const queryResult = await executeDAXQuery(token, campaign.dataset_id, daxQuery)
      const rows = queryResult.rows ?? []

      clients = rows.map((row) => ({
        name: row["nome"] != null ? String(row["nome"]) : null,
        phone: normalizePhone(row["telefone"]),
        data: row,
      }))
    }

    const { data: execRow, error: execError } = await supabase
      .from("campaign_executions")
      .insert({
        campaign_id: campaignId,
        company_id: ctx.companyId,
        status: "running",
        total_clients: clients.length,
      })
      .select()
      .single()

    if (execError || !execRow) throw new Error("Erro ao criar execucao")
    executionId = execRow.id

    let sentCount = 0
    let failedCount = 0
    let skippedCount = 0

    const imageUrl: string | null = campaign.image_url ?? null
    const isImageMessage = !!imageUrl

    for (const client of clients) {
      const phone = client.phone
      const message = resolveMessage(campaign.message_template, client.data)

      if (!phone) {
        skippedCount++
        await supabase.from("campaign_sends").insert({
          campaign_id: campaignId,
          execution_id: executionId,
          company_id: ctx.companyId,
          client_name: client.name,
          client_phone: null,
          client_data: client.data,
          message,
          status: "failed",
          error_message: "Telefone nao disponivel",
        })
        continue
      }

      try {
        await retryAsync(() => sendWhatsAppBotMessage({
          instance_id: campaign.bot_instance_id ?? null,
          phone,
          ...(isImageMessage
            ? { document_url: imageUrl, caption: message, mimetype: "image/jpeg" }
            : { message }),
        }))

        sentCount++
        await supabase.from("campaign_sends").insert({
          campaign_id: campaignId,
          execution_id: executionId,
          company_id: ctx.companyId,
          client_name: client.name,
          client_phone: phone,
          client_data: client.data,
          message,
          status: "sent",
          sent_at: new Date().toISOString(),
        })
      } catch (sendError) {
        failedCount++
        await supabase.from("campaign_sends").insert({
          campaign_id: campaignId,
          execution_id: executionId,
          company_id: ctx.companyId,
          client_name: client.name,
          client_phone: phone,
          client_data: client.data,
          message,
          status: "failed",
          error_message: sendError instanceof Error ? sendError.message : "Erro no envio",
        })
      }
    }

    await supabase
      .from("campaign_executions")
      .update({
        status: "completed",
        sent_count: sentCount,
        failed_count: failedCount,
        skipped_count: skippedCount,
        completed_at: new Date().toISOString(),
      })
      .eq("id", executionId)

    await supabase
      .from("campaigns")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", campaignId)

    return NextResponse.json({
      ok: true,
      execution_id: executionId,
      total: clients.length,
      sent: sentCount,
      failed: failedCount,
      skipped: skippedCount,
    })
  } catch (error) {
    if (isAuthContextError(error) || (error instanceof Error && error.message === "Callback secret invalido")) {
      return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
    }

    if (executionId && supabase) {
      void supabase
        .from("campaign_executions")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", executionId)
    }

    const message = error instanceof Error ? error.message : "Erro ao executar campanha"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
