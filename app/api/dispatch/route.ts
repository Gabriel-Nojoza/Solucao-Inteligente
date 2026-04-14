// Cache bust 1
import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { resolveRequestCompanyContext } from "@/lib/n8n-auth"
import { normalizeContactForResponse } from "@/lib/contact-compat"
import { getScheduleAccessMaps, isScheduleAccessible } from "@/lib/schedule-access"
import {
  getStoredAutomationById,
  isMissingAutomationRelationError,
} from "@/lib/automation-storage"
import {
  buildDispatchTargets,
  buildN8nCallbackHeaders,
  buildN8nEndpointUrls,
  normalizeN8nSettings,
} from "@/lib/n8n-webhook"
import {
  getPrimaryScheduleReportConfig,
  getScheduleReportIds,
  resolveScheduleReportConfigs,
} from "@/lib/schedule-report-configs"
import { getRequestContext } from "@/lib/tenant"
import {
  exportPowerBIReportDocument,
  sanitizeFileName,
} from "@/lib/powerbi-report-pdf"
import { getAccessToken } from "@/lib/powerbi"
import { getWorkspaceAccessScope } from "@/lib/workspace-access"
import { sendWhatsAppBotMessage } from "@/lib/whatsapp-bot"
import { getCompanyWhatsAppBotInstance } from "@/lib/whatsapp-bot-instances"

function getDispatchLogTarget(contact: {
  phone?: string | null
  whatsapp_group_id?: string | null
  name?: string | null
}) {
  return contact.phone || contact.whatsapp_group_id || contact.name || "destino-desconhecido"
}

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

function getPageAttachmentLabel(pageName: string, index: number) {
  const withoutPrefix = pageName.replace(/^ReportSection/i, "").trim()
  const normalizedLabel =
    withoutPrefix && !/^[0-9a-f-]+$/i.test(withoutPrefix)
      ? withoutPrefix
      : `pagina-${index + 1}`

  return sanitizeFileName(normalizedLabel) || `pagina-${index + 1}`
}

function buildPageAttachmentFileName(
  reportName: string,
  pageName: string,
  index: number,
  extension = "pdf"
) {
  const safeReportName = sanitizeFileName(reportName || "relatorio") || "relatorio"
  const pageLabel = getPageAttachmentLabel(pageName, index)
  return `${safeReportName}-${pageLabel}.${extension}`
}

function buildReportAttachmentFileName(reportName: string, extension = "pdf") {
  return `${sanitizeFileName(reportName || "relatorio") || "relatorio"}.${extension}`
}

function applyMessageTemplate(template: string | null | undefined, reportName: string) {
  const source = template?.trim() || "Segue o relatorio {report_name} em anexo."
  return source.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (key === "report_name" || key === "name") {
      return reportName
    }

    return ""
  })
}


export async function POST(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()
  const { schedule_id } = body

  if (!schedule_id) {
    return NextResponse.json({ error: "schedule_id obrigatorio" }, { status: 400 })
  }

  // Allow platform scheduler secret to dispatch for any company
  const platformSecret = process.env.PLATFORM_SCHEDULER_SECRET?.trim()
  const headerSecret = request.headers.get("x-callback-secret")?.trim()
  const isPlatformRequest = platformSecret && headerSecret === platformSecret

  let companyId: string
  let source: string
  let accessMaps: Awaited<ReturnType<typeof getScheduleAccessMaps>> | null = null

  console.log("[dispatch] request received", {
    requestUrl: request.url,
    requestHost: request.headers.get("host")?.trim() || null,
    requestOrigin: request.headers.get("origin")?.trim() || null,
    scheduleId: schedule_id ?? null,
  })

  if (isPlatformRequest) {
    const { data: scheduleRow } = await supabase
      .from("schedules")
      .select("company_id")
      .eq("id", schedule_id)
      .single()

    if (!scheduleRow) {
      return NextResponse.json({ error: "Rotina nao encontrada" }, { status: 404 })
    }

    companyId = scheduleRow.company_id
    source = "platform"
  } else {
    const context = await resolveRequestCompanyContext(request, {
      allowCallbackSecret: true,
    })
    companyId = context.companyId
    source = context.source

    if (source === "auth") {
      const reqContext = await getRequestContext()
      const scope = await getWorkspaceAccessScope(supabase, reqContext)
      accessMaps = await getScheduleAccessMaps(supabase, companyId, scope)
    }
  }

  const { data: schedule } = await supabase
    .from("schedules")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", schedule_id)
    .single()

  if (!schedule) {
    return NextResponse.json({ error: "Rotina nao encontrada" }, { status: 404 })
  }

  if (accessMaps && !isScheduleAccessible(schedule, accessMaps)) {
    return NextResponse.json({ error: "Rotina nao encontrada" }, { status: 404 })
  }

  const resolvedBotInstance = await getCompanyWhatsAppBotInstance(
    supabase,
    companyId,
    schedule.bot_instance_id ?? null
  ).catch(() => null)
  if (resolvedBotInstance) {
    schedule.bot_instance_id = resolvedBotInstance.id
  }

  const scheduleReportConfigs = resolveScheduleReportConfigs(schedule)
  const primaryScheduleReportConfig = getPrimaryScheduleReportConfig(scheduleReportConfigs)

  if (!primaryScheduleReportConfig) {
    return NextResponse.json(
      { error: "Rotina sem relatorio configurado" },
      { status: 400 }
    )
  }

  const scheduleReportIds = getScheduleReportIds(scheduleReportConfigs)
  const { data: reports } = await supabase
    .from("reports")
    .select("*, workspaces!inner(pbi_workspace_id)")
    .eq("company_id", companyId)
    .in("id", scheduleReportIds)

  const reportMap = new Map(
    (reports ?? []).map((report) => [report.id, report] as const)
  )
  const primaryReport = reportMap.get(primaryScheduleReportConfig.report_id) ?? null

  const { data: scContacts } = await supabase
    .from("schedule_contacts")
    .select("contact_id")
    .eq("schedule_id", schedule_id)

  const contactIds = (scContacts ?? []).map((sc) => sc.contact_id)
  let contactsQuery = supabase
    .from("contacts")
    .select("*")
    .eq("company_id", companyId)
    .in("id", contactIds)
    .eq("is_active", true)

  if (typeof schedule.bot_instance_id === "string" && schedule.bot_instance_id.trim()) {
    contactsQuery = contactsQuery.eq("bot_instance_id", schedule.bot_instance_id.trim())
  }

  const { data: contacts } = await contactsQuery

  const normalizedContacts = (contacts ?? []).map((contact) =>
    normalizeContactForResponse(contact as Record<string, unknown>)
  )

  if (normalizedContacts.length === 0) {
    return NextResponse.json({ error: "Nenhum contato ativo vinculado" }, { status: 400 })
  }

  if (!primaryReport && scheduleReportConfigs.length === 1) {
    let automation:
      | { id: string; name: string; export_format?: string | null }
      | null = null

    const { data: dbAutomation, error: automationError } = await supabase
      .from("automations")
      .select("id, name, export_format")
      .eq("company_id", companyId)
      .eq("id", primaryScheduleReportConfig.report_id)
      .maybeSingle()

    if (automationError) {
      if (!isMissingAutomationRelationError(automationError)) {
        return NextResponse.json({ error: automationError.message }, { status: 500 })
      }

      const storedAutomation = await getStoredAutomationById(
        supabase,
        companyId,
        primaryScheduleReportConfig.report_id
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
        bot_instance_id: schedule.bot_instance_id ?? null,
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

  const powerBiTargets = scheduleReportConfigs.flatMap((reportConfig) => {
    const report = reportMap.get(reportConfig.report_id)
    if (!report) {
      return []
    }

    return [
      {
        config: reportConfig,
        report,
      },
    ]
  })

  if (powerBiTargets.length !== scheduleReportConfigs.length) {
    return NextResponse.json(
      {
        error:
          scheduleReportConfigs.length > 1
            ? "Todos os relatorios da rotina precisam existir no Power BI para o envio conjunto."
            : "Relatorio nao encontrado",
      },
      { status: 404 }
    )
  }

  const primarySelectedPageNames = primaryScheduleReportConfig.pbi_page_names ?? []
  const primaryPageName = primaryScheduleReportConfig.pbi_page_name
  const normalizedScheduleExportFormat =
    typeof schedule.export_format === "string" && schedule.export_format.trim().toLowerCase() === "pdf"
      ? "PDF"
      : schedule.export_format
  const hasMultipleReports = powerBiTargets.length > 1
  const hasMultiplePagesInAnyReport = powerBiTargets.some(
    ({ config }) => config.pbi_page_names.length > 1
  )

  if (
    normalizedScheduleExportFormat !== "PDF" &&
    (hasMultipleReports || hasMultiplePagesInAnyReport)
  ) {
    return NextResponse.json(
      {
        error:
          "Selecione varios relatorios ou varias paginas apenas quando o formato de exportacao for PDF.",
      },
      { status: 400 }
    )
  }

  const directPdfTargets =
    normalizedScheduleExportFormat === "PDF" ? powerBiTargets : []

  const logs =
      directPdfTargets.length > 0
      ? normalizedContacts.flatMap((contact) =>
          directPdfTargets.map(({ report }) => ({
            company_id: companyId,
            schedule_id: schedule.id,
            report_name: report.name,
            contact_name: contact.name,
            contact_phone: getDispatchLogTarget(contact),
            status: "pending" as const,
            export_format: normalizedScheduleExportFormat,
          }))
        )
      : normalizedContacts.map((contact) => ({
          company_id: companyId,
          schedule_id: schedule.id,
          report_name: primaryReport?.name ?? "Desconhecido",
          contact_name: contact.name,
          contact_phone: getDispatchLogTarget(contact),
          status: "pending" as const,
          export_format: normalizedScheduleExportFormat,
        }))

  const { data: insertedLogs, error: insertLogsError } = await supabase
    .from("dispatch_logs")
    .insert(logs)
    .select()

  if (insertLogsError) {
    return NextResponse.json(
      { error: `Nao foi possivel criar logs do disparo: ${insertLogsError.message}` },
      { status: 500 }
    )
  }

  const message = applyMessageTemplate(
    schedule.message_template,
    primaryReport?.name ?? "relatorio"
  )

  const { data: n8nSettings } = await supabase
    .from("company_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", "n8n")
    .single()

  const normalizedN8nSettings = normalizeN8nSettings(n8nSettings?.value)
  const webhookUrl =
    normalizedN8nSettings.webhookUrl || process.env.N8N_WEBHOOK_URL?.trim() || ""
  const callbackSecret = normalizedN8nSettings.callbackSecret

  let dispatchErrorMessage: string | null = null

  try {
    const appUrl = getRequestOrigin(request)
    const { callbackUrl, botSendUrl } = buildN8nEndpointUrls(appUrl, schedule.bot_instance_id)
    const reportExportUrl = `${appUrl.trim().replace(/\/+$/, "")}/api/reports/export`
    const callbackHeaders = buildN8nCallbackHeaders(callbackSecret)
    const dispatchTargets = buildDispatchTargets(
      normalizedContacts,
      (insertedLogs ?? []).map((log) => log.id)
    )

    console.log("[dispatch] resolved endpoints", {
      source,
      companyId,
      scheduleId: schedule.id,
      appUrl,
      callbackUrl,
      botSendUrl,
      reportExportUrl,
      exportFormat: normalizedScheduleExportFormat,
      reportCount: powerBiTargets.length,
      directPdfTargets: directPdfTargets.length,
      contactCount: normalizedContacts.length,
    })

    if (directPdfTargets.length > 0) {
      const pbiToken = await getAccessToken(companyId)

      for (const [contactIndex, contact] of normalizedContacts.entries()) {
        for (const [reportIndex, target] of directPdfTargets.entries()) {
          const currentLog =
            insertedLogs?.[contactIndex * directPdfTargets.length + reportIndex]
          const pbiReport = target.report as Record<string, unknown>
          const pbiWorkspaceId = pbiReport.workspaces
            ? (pbiReport.workspaces as Record<string, string>).pbi_workspace_id ?? ""
            : ""
          const pbiReportId =
            typeof pbiReport.pbi_report_id === "string" ? pbiReport.pbi_report_id : ""
          const pbiEmbedUrl =
            typeof pbiReport.embed_url === "string" ? pbiReport.embed_url : null
          const selectedPageNames = target.config.pbi_page_names ?? []
          const reportMessage = applyMessageTemplate(
            schedule.message_template,
            target.report.name
          )

          if (currentLog) {
            await supabase
              .from("dispatch_logs")
              .update({ status: "sending" })
              .eq("company_id", companyId)
              .eq("id", currentLog.id)
          }

          if (selectedPageNames.length > 1) {
            for (const [pageIndex, pageName] of selectedPageNames.entries()) {
              console.log("[dispatch] direct PDF generation", {
                mode: "one_pdf_per_page",
                scheduleId: schedule.id,
                contact: getDispatchLogTarget(contact),
                reportName: target.report.name,
                pageName,
                pageIndex,
              })

              const exportedFile = await exportPowerBIReportDocument({
                token: pbiToken,
                workspaceId: pbiWorkspaceId,
                reportId: pbiReportId,
                reportName: target.report.name,
                embedUrl: pbiEmbedUrl,
                pageNames: [pageName],
                pageName,
              })

              console.log("[dispatch] sending document to bot", {
                mode: "direct_pdf",
                scheduleId: schedule.id,
                contact: getDispatchLogTarget(contact),
                reportName: target.report.name,
                fileName: buildPageAttachmentFileName(
                  target.report.name,
                  pageName,
                  pageIndex,
                  exportedFile.extension
                ),
                contentType: exportedFile.contentType,
                byteLength: exportedFile.buffer.byteLength,
              })

              await sendWhatsAppBotMessage({
                instance_id: schedule.bot_instance_id ?? null,
                phone: contact.phone,
                whatsapp_group_id: contact.whatsapp_group_id,
                message: pageIndex === 0 ? reportMessage : null,
                document_base64: Buffer.from(exportedFile.buffer).toString("base64"),
                file_name: buildPageAttachmentFileName(
                  target.report.name,
                  pageName,
                  pageIndex,
                  exportedFile.extension
                ),
                mimetype: exportedFile.contentType,
              })
            }
          } else {
            console.log("[dispatch] direct PDF generation", {
              mode: "single_document",
              scheduleId: schedule.id,
              contact: getDispatchLogTarget(contact),
              reportName: target.report.name,
              selectedPageNames,
              pageName: target.config.pbi_page_name,
            })

            const exportedFile = await exportPowerBIReportDocument({
              token: pbiToken,
              workspaceId: pbiWorkspaceId,
              reportId: pbiReportId,
              reportName: target.report.name,
              embedUrl: pbiEmbedUrl,
              pageNames: selectedPageNames.length > 0 ? selectedPageNames : null,
              pageName: target.config.pbi_page_name,
            })

            console.log("[dispatch] sending document to bot", {
              mode: "direct_pdf",
              scheduleId: schedule.id,
              contact: getDispatchLogTarget(contact),
              reportName: target.report.name,
              fileName: buildReportAttachmentFileName(target.report.name, exportedFile.extension),
              contentType: exportedFile.contentType,
              byteLength: exportedFile.buffer.byteLength,
            })

            await sendWhatsAppBotMessage({
              instance_id: schedule.bot_instance_id ?? null,
              phone: contact.phone,
              whatsapp_group_id: contact.whatsapp_group_id,
              message: reportMessage,
              document_base64: Buffer.from(exportedFile.buffer).toString("base64"),
              file_name: buildReportAttachmentFileName(target.report.name, exportedFile.extension),
              mimetype: exportedFile.contentType,
            })
          }

          if (currentLog) {
            await supabase
              .from("dispatch_logs")
              .update({
                status: "delivered",
                error_message: null,
                completed_at: new Date().toISOString(),
              })
              .eq("company_id", companyId)
              .eq("id", currentLog.id)
          }
        }
      }

      await supabase
        .from("schedules")
        .update({ last_run_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("id", schedule_id)

      return NextResponse.json({
        success: true,
        logs_created: (insertedLogs ?? []).length,
        attachment_mode:
          hasMultipleReports
            ? "multiple_reports"
            : hasMultiplePagesInAnyReport
              ? "one_pdf_per_page"
              : "single_pdf",
      })
    }

    console.log("[dispatch] forwarding to n8n webhook", {
      scheduleId: schedule.id,
      webhookUrl,
      callbackUrl,
      botSendUrl,
      reportExportUrl,
      reportName: primaryReport?.name ?? null,
      selectedPageNames: primarySelectedPageNames,
    })

    if (!webhookUrl) {
      const errMsg = "URL do webhook N8N nao configurada"
      for (const log of insertedLogs ?? []) {
        await supabase
          .from("dispatch_logs")
          .update({ status: "failed", error_message: errMsg, completed_at: new Date().toISOString() })
          .eq("company_id", companyId)
          .eq("id", log.id)
      }
      return NextResponse.json({ error: errMsg }, { status: 400 })
    }

    if (!callbackSecret) {
      const errMsg = "Callback secret do N8N nao configurado"
      for (const log of insertedLogs ?? []) {
        await supabase
          .from("dispatch_logs")
          .update({ status: "failed", error_message: errMsg, completed_at: new Date().toISOString() })
          .eq("company_id", companyId)
          .eq("id", log.id)
      }
      return NextResponse.json({ error: errMsg }, { status: 400 })
    }

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schedule_id: schedule.id,
        schedule_name: schedule.name,
        cron_expression: schedule.cron_expression,
        is_active: schedule.is_active,
        report_name: primaryReport?.name,
        app_report_id: primaryReport?.id,
        report_id: primaryReport?.pbi_report_id,
        workspace_id: (primaryReport as Record<string, unknown> | null)?.workspaces
          ? (((primaryReport as Record<string, unknown>).workspaces as Record<string, string>)
               .pbi_workspace_id
            ?? "")
          : "",
        pbi_page_name: primaryPageName,
        pbi_page_names: primarySelectedPageNames.length > 0 ? primarySelectedPageNames : null,
        page_name: primaryPageName,
        export_format: normalizedScheduleExportFormat,
        report_export_url: reportExportUrl,
        report_export_headers: callbackHeaders,
        report_export_payload: {
          report_id: primaryReport?.id,
          format: normalizedScheduleExportFormat,
          pbi_page_name: primaryPageName,
          pbi_page_names:
            primarySelectedPageNames.length > 0 ? primarySelectedPageNames : null,
          callback_secret: callbackSecret,
        },
        contacts: normalizedContacts.map((contact) => ({
          name: contact.name,
          phone: contact.phone,
          type: contact.type,
          whatsapp_group_id: contact.whatsapp_group_id,
        })),
        bot_instance_id: schedule.bot_instance_id ?? null,
        message,
        dispatch_log_ids: (insertedLogs ?? []).map((log) => log.id),
        dispatch_targets: dispatchTargets,
        callback_url: callbackUrl,
        callback_secret: callbackSecret,
        callback_headers: callbackHeaders,
        bot_send_url: botSendUrl,
        bot_send_headers: callbackHeaders,
      }),
    })

    if (!webhookResponse.ok) {
      const responseText = await webhookResponse.text().catch(() => "")
      throw new Error(responseText || `Webhook N8N retornou ${webhookResponse.status}`)
    }

    for (const log of insertedLogs ?? []) {
      await supabase
        .from("dispatch_logs")
        .update({ status: "sending" })
        .eq("company_id", companyId)
        .eq("id", log.id)
        .eq("status", "pending")
    }

    await supabase
      .from("schedules")
      .update({ last_run_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", schedule_id)
  } catch (error) {
    dispatchErrorMessage =
      error instanceof Error ? error.message : "Erro ao enviar para o webhook N8N"

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
