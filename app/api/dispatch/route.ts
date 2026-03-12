import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { resolveRequestCompanyContext } from "@/lib/n8n-auth"
import { normalizeContactForResponse } from "@/lib/contact-compat"
import {
  getStoredAutomationById,
  isMissingAutomationRelationError,
} from "@/lib/automation-storage"

function normalizeAutomationExportFormat(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (normalized === "table" || normalized === "csv" || normalized === "pdf") {
    return normalized
  }
  if (normalized === "png" || normalized === "pptx") {
    return "pdf"
  }
  return "pdf"
}

function getRequestOrigin(request: NextRequest) {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    request.headers.get("origin") ||
    new URL(request.url).origin
  )
}

export async function POST(request: NextRequest) {
  const { companyId } = await resolveRequestCompanyContext(request, {
    allowCallbackSecret: true,
  })
  const supabase = createClient()
  const body = await request.json()
  const { schedule_id } = body

  if (!schedule_id) {
    return NextResponse.json({ error: "schedule_id obrigatorio" }, { status: 400 })
  }

  // Fetch schedule with report and contacts
  const { data: schedule } = await supabase
    .from("schedules")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", schedule_id)
    .single()

  if (!schedule) {
    return NextResponse.json({ error: "Rotina nao encontrada" }, { status: 404 })
  }

  const { data: report } = await supabase
    .from("reports")
    .select("*, workspaces!inner(pbi_workspace_id)")
    .eq("company_id", companyId)
    .eq("id", schedule.report_id)
    .maybeSingle()

  const { data: scContacts } = await supabase
    .from("schedule_contacts")
    .select("contact_id")
    .eq("schedule_id", schedule_id)

  const contactIds = (scContacts ?? []).map((sc) => sc.contact_id)
  const { data: contacts } = await supabase
    .from("contacts")
    .select("*")
    .eq("company_id", companyId)
    .in("id", contactIds)
    .eq("is_active", true)

  const normalizedContacts = (contacts ?? []).map((contact) =>
    normalizeContactForResponse(contact as Record<string, unknown>)
  )

  if (normalizedContacts.length === 0) {
    return NextResponse.json({ error: "Nenhum contato ativo vinculado" }, { status: 400 })
  }

  if (!report) {
    let automation:
      | { id: string; name: string; export_format?: string | null }
      | null = null

    const { data: dbAutomation, error: automationError } = await supabase
      .from("automations")
      .select("id, name, export_format")
      .eq("company_id", companyId)
      .eq("id", schedule.report_id)
      .maybeSingle()

    if (automationError) {
      if (!isMissingAutomationRelationError(automationError)) {
        return NextResponse.json({ error: automationError.message }, { status: 500 })
      }

      const storedAutomation = await getStoredAutomationById(
        supabase,
        companyId,
        schedule.report_id
      )

      automation = storedAutomation
        ? {
            id: storedAutomation.id,
            name: storedAutomation.name,
            export_format: storedAutomation.export_format,
          }
        : null
    } else {
      automation = dbAutomation
    }

    if (!automation) {
      return NextResponse.json({ error: "Relatorio nao encontrado" }, { status: 404 })
    }

    const runResponse = await fetch(new URL("/api/automations/run", request.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
        ...(request.headers.get("x-callback-secret")
          ? { "x-callback-secret": request.headers.get("x-callback-secret") as string }
          : {}),
        ...(request.headers.get("authorization")
          ? { authorization: request.headers.get("authorization") as string }
          : {}),
      },
      body: JSON.stringify({
        automation_id: automation.id,
        export_format: normalizeAutomationExportFormat(
          schedule.export_format || automation.export_format
        ),
        message: schedule.message_template ?? `Segue o relatorio ${automation.name}.`,
        contact_ids: contactIds,
        schedule_id: schedule.id,
      }),
    })

    const runPayload = await runResponse.json().catch(() => null)
    if (!runResponse.ok) {
      return NextResponse.json(
        { error: runPayload?.error || "Erro ao disparar relatorio salvo" },
        { status: runResponse.status }
      )
    }

    await supabase
      .from("schedules")
      .update({ last_run_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", schedule_id)

    return NextResponse.json({
      success: true,
      logs_created: normalizedContacts.length,
      report_name: automation.name,
      source: "created",
    })
  }

  // Get N8N webhook URL from settings
  const { data: n8nSettings } = await supabase
    .from("company_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", "n8n")
    .single()

  const webhookUrl = String(
    (n8nSettings?.value as Record<string, string> | null)?.webhook_url ||
      process.env.N8N_WEBHOOK_URL ||
      ""
  ).trim()
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "URL do webhook N8N nao configurada" },
      { status: 400 }
    )
  }

  // Create dispatch logs
  const logs = normalizedContacts.map((c) => ({
    company_id: companyId,
    schedule_id: schedule.id,
    report_name: report.name,
    contact_name: c.name,
    contact_phone: c.phone,
    status: "pending" as const,
    export_format: schedule.export_format,
  }))

  const { data: insertedLogs } = await supabase
    .from("dispatch_logs")
    .insert(logs)
    .select()

  // Send webhook to N8N
  let dispatchErrorMessage: string | null = null

  try {
    const appUrl = getRequestOrigin(request)

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        report_name: report.name,
        report_id: report.pbi_report_id,
        workspace_id: (report as Record<string, unknown>).workspaces
          ? ((report as Record<string, unknown>).workspaces as Record<string, string>).pbi_workspace_id
          : "",
        export_format: schedule.export_format,
        contacts: normalizedContacts.map((c) => ({
          name: c.name,
          phone: c.phone,
          type: c.type,
          whatsapp_group_id: c.whatsapp_group_id,
        })),
        message: schedule.message_template ?? `Segue o relatorio ${report.name} em anexo.`,
        dispatch_log_ids: (insertedLogs ?? []).map((l) => l.id),
        callback_url: `${appUrl}/api/webhook/n8n-callback`,
      }),
    })

    if (!webhookResponse.ok) {
      const responseText = await webhookResponse.text().catch(() => "")
      throw new Error(responseText || `Webhook N8N retornou ${webhookResponse.status}`)
    }

    // Update logs to 'sending'
    for (const log of insertedLogs ?? []) {
      await supabase
        .from("dispatch_logs")
        .update({ status: "sending" })
        .eq("company_id", companyId)
        .eq("id", log.id)
    }

    // Update schedule last_run_at
    await supabase
      .from("schedules")
      .update({ last_run_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", schedule_id)

  } catch (error) {
    dispatchErrorMessage =
      error instanceof Error ? error.message : "Erro ao enviar para o webhook N8N"

    // Mark logs as failed
    for (const log of insertedLogs ?? []) {
      await supabase
        .from("dispatch_logs")
        .update({
          status: "failed",
          error_message: dispatchErrorMessage,
          completed_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .eq("id", log.id)
    }
  }

  if (dispatchErrorMessage) {
    return NextResponse.json({ error: dispatchErrorMessage }, { status: 502 })
  }

  return NextResponse.json({ success: true, logs_created: (insertedLogs ?? []).length })
}
