import { NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getAccessToken, executeDAXQuery } from "@/lib/powerbi"
import { getRequestContext } from "@/lib/tenant"

export async function POST(request: Request) {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const body = await request.json()
    const { automation_id } = body

    if (!automation_id) {
      return NextResponse.json(
        { error: "automation_id obrigatorio" },
        { status: 400 }
      )
    }

    // Get automation
    const { data: automation, error: autoErr } = await supabase
      .from("automations")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", automation_id)
      .single()

    if (autoErr || !automation) {
      return NextResponse.json(
        { error: "Automacao nao encontrada" },
        { status: 404 }
      )
    }

    // Execute DAX query
    const token = await getAccessToken()
    const query = automation.dax_query

    if (!query) {
      return NextResponse.json(
        { error: "Automacao sem query DAX definida" },
        { status: 400 }
      )
    }

    const result = await executeDAXQuery(token, automation.dataset_id, query)

    // Update last_run_at
    await supabase
      .from("automations")
      .update({ last_run_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", automation_id)

    // Get contacts for the automation
    const { data: contactLinks } = await supabase
      .from("automation_contacts")
      .select("contact_id, contacts(*)")
      .eq("automation_id", automation_id)

    const contacts = (contactLinks?.map((cl: Record<string, unknown>) => cl.contacts) || []) as Array<Record<string, unknown>>

    // If contacts exist and N8N is configured, send via webhook
    if (contacts.length > 0) {
      const { data: n8nSettings } = await supabase
        .from("company_settings")
        .select("value")
        .eq("company_id", companyId)
        .eq("key", "n8n")
        .single()

      const webhookUrl = (n8nSettings?.value as Record<string, string>)?.webhook_url

      if (webhookUrl) {
        // Convert result to CSV string for sending
        const csvHeader = result.columns.map((c: { name: string }) => c.name).join(",")
        const csvRows = result.rows.map((r: Record<string, unknown>) =>
          result.columns.map((c: { name: string }) => String(r[c.name] ?? "")).join(",")
        )
        const csvContent = [csvHeader, ...csvRows].join("\n")

        // Create dispatch logs
        const logEntries = contacts.map((contact: Record<string, unknown>) => ({
          company_id: companyId,
          schedule_id: null,
          report_name: `Automacao: ${automation.name}`,
          contact_name: String(contact.name || ""),
          contact_phone: contact.phone ? String(contact.phone) : null,
          status: "sending",
          export_format: automation.export_format,
        }))

        const { data: logs } = await supabase
          .from("dispatch_logs")
          .insert(logEntries)
          .select("id")

        // Send to N8N
        try {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              automation_name: automation.name,
              data_csv: csvContent,
              row_count: result.rows.length,
              contacts,
              message:
                automation.message_template?.replace(
                  "{name}",
                  automation.name
                ) || `Dados da automacao ${automation.name}`,
              callback_url: `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/webhook/n8n-callback`,
              dispatch_log_ids: logs?.map((l) => l.id) || [],
            }),
          })
        } catch {
          // Log N8N error but don't fail the whole request
        }
      }
    }

    return NextResponse.json({
      success: true,
      result,
      contacts_notified: contacts.length,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    )
  }
}
