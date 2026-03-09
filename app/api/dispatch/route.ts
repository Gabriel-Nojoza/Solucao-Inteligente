import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"

export async function POST(request: NextRequest) {
  const { companyId } = await getRequestContext()
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
    .single()

  if (!report) {
    return NextResponse.json({ error: "Relatorio nao encontrado" }, { status: 404 })
  }

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

  if (!contacts || contacts.length === 0) {
    return NextResponse.json({ error: "Nenhum contato ativo vinculado" }, { status: 400 })
  }

  // Get N8N webhook URL from settings
  const { data: n8nSettings } = await supabase
    .from("company_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", "n8n")
    .single()

  const webhookUrl = (n8nSettings?.value as Record<string, string>)?.webhook_url
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "URL do webhook N8N nao configurada" },
      { status: 400 }
    )
  }

  // Create dispatch logs
  const logs = contacts.map((c) => ({
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
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.headers.get("origin") ?? ""

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        report_name: report.name,
        report_id: report.pbi_report_id,
        workspace_id: (report as Record<string, unknown>).workspaces
          ? ((report as Record<string, unknown>).workspaces as Record<string, string>).pbi_workspace_id
          : "",
        export_format: schedule.export_format,
        contacts: contacts.map((c) => ({
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
    // Mark logs as failed
    for (const log of insertedLogs ?? []) {
      await supabase
        .from("dispatch_logs")
        .update({
          status: "failed",
          error_message: error instanceof Error ? error.message : "Erro no webhook",
          completed_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .eq("id", log.id)
    }
  }

  return NextResponse.json({ success: true, logs_created: (insertedLogs ?? []).length })
}
