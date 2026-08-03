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
  type PowerBiExportedDocument,
} from "@/lib/powerbi-report-pdf"
import {
  getAccessTokenMasterUser,
  isPowerBiFeatureNotAvailableError,
  getReportPages,
} from "@/lib/powerbi"
import { captureReportAsPdf } from "@/lib/report-pdf"
import { getWorkspaceAccessScope } from "@/lib/workspace-access"
import { normalizeDispatchSettings } from "@/lib/dispatch-config"
import { sendWhatsAppBotMessage } from "@/lib/whatsapp-bot"
import { resolveConnectedBotInstance } from "@/lib/whatsapp-bot-instances"
import { runStoredAutomation } from "@/lib/automation-runner"
import { retryAsync } from "@/lib/utils"

const EXPORT_DELAY_MS = Number(process.env.EXPORT_DELAY_MS || "8000")

async function exportDocumentWithFallback(input: {
  pbiToken: string
  companyId: string
  workspaceId: string
  reportId: string
  reportName: string
  embedUrl: string | null
  pageNames: string[] | null
  pageName: string | null | undefined
}): Promise<PowerBiExportedDocument> {
  try {
    return await exportPowerBIReportDocument({
      token: input.pbiToken,
      workspaceId: input.workspaceId,
      reportId: input.reportId,
      reportName: input.reportName,
      embedUrl: input.embedUrl,
      pageNames: input.pageNames,
      pageName: input.pageName,
    })
  } catch (err) {
    if (!isPowerBiFeatureNotAvailableError(err) || !input.embedUrl) throw err
    console.log("[dispatch] ExportTo indisponivel para este workspace — usando captura via Chrome (AAD)")
    const pdfBuffer = await captureReportAsPdf({
      embedUrl: input.embedUrl,
      embedToken: input.pbiToken,
      reportId: input.reportId,
      pageName: input.pageName ?? null,
      pageNames: input.pageNames,
      tokenType: "Aad",
    })
    return { buffer: pdfBuffer, contentType: "application/pdf", extension: "pdf" }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getDispatchLogTarget(contact: {
  phone?: string | null
  whatsapp_group_id?: string | null
  name?: string | null
}) {
  return contact.phone || contact.whatsapp_group_id || contact.name || "destino-desconhecido"
}

function normalizeAutomationExportFormat(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (normalized === "table" || normalized === "csv" || normalized === "pdf" || normalized === "xlsx") {
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
  try {
    return await handleDispatch(request)
  } catch (error) {
    console.error("[dispatch] unhandled error", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno ao processar rotina" },
      { status: 500 }
    )
  }
}

async function sendWithFallback(
  payload: Parameters<typeof sendWhatsAppBotMessage>[0],
  fallbackInstanceId: string | null
) {
  try {
    await sendWhatsAppBotMessage(payload)
  } catch (err) {
    const notConnected =
      err instanceof Error &&
      (err.message.includes("nao conectado") || err.message.includes("not connected"))
    if (notConnected && payload.instance_id !== fallbackInstanceId && fallbackInstanceId) {
      await sendWhatsAppBotMessage({ ...payload, instance_id: fallbackInstanceId })
    } else {
      throw err
    }
  }
}

async function handleDispatch(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()
  const { schedule_id } = body

  if (!schedule_id) {
    return NextResponse.json({ error: "schedule_id obrigatorio" }, { status: 400 })
  }

  // Read secret from header OR query param (nginx may strip custom headers)
  const headerSecret = (() => {
    const h = request.headers.get("x-callback-secret")?.trim()
    if (h) return h
    try { return new URL(request.url).searchParams.get("secret")?.trim() || "" } catch { return "" }
  })()

  let companyId: string
  let source: string
  let accessMaps: Awaited<ReturnType<typeof getScheduleAccessMaps>> | null = null

  console.log("[dispatch] request received", {
    requestUrl: request.url,
    requestHost: request.headers.get("host")?.trim() || null,
    requestOrigin: request.headers.get("origin")?.trim() || null,
    scheduleId: schedule_id ?? null,
    hasSecret: !!headerSecret,
  })

  if (headerSecret) {
    // Secret present — look up company from schedule then validate secret.
    // This path works even when PLATFORM_SCHEDULER_SECRET is not loaded by the process.
    const { data: scheduleRow } = await supabase
      .from("schedules")
      .select("company_id")
      .eq("id", schedule_id)
      .single()

    if (!scheduleRow) {
      return NextResponse.json({ error: "Rotina nao encontrada" }, { status: 404 })
    }

    const platformSecret = process.env.PLATFORM_SCHEDULER_SECRET?.trim()
    if (platformSecret && headerSecret === platformSecret) {
      companyId = scheduleRow.company_id
      source = "platform"
    } else {
      // Fall back to company-level n8n callback_secret stored in DB
      const { data: n8nRow } = await supabase
        .from("company_settings")
        .select("value")
        .eq("company_id", scheduleRow.company_id)
        .eq("key", "n8n")
        .maybeSingle()

      const companySecret = (n8nRow?.value as Record<string, unknown> | null)?.callback_secret
      if (typeof companySecret === "string" && companySecret.trim() === headerSecret) {
        companyId = scheduleRow.company_id
        source = "n8n_secret"
      } else {
        return NextResponse.json({ error: "Callback secret invalido" }, { status: 401 })
      }
    }
  } else {
    // No secret — require session auth
    const context = await resolveRequestCompanyContext(request, {
      allowCallbackSecret: false,
    })
    companyId = context.companyId
    source = context.source

    if (source === "auth") {
      const reqContext = await getRequestContext()
      const scope = await getWorkspaceAccessScope(supabase, reqContext)
      accessMaps = await getScheduleAccessMaps(supabase, companyId, scope)
    }
  }


  // Verificar se o periodo de teste de disparos expirou
  const { data: dispatchSettingsRow } = await supabase
    .from("company_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", "dispatch_settings")
    .maybeSingle()

  if (dispatchSettingsRow?.value) {
    const dispatchConfig = normalizeDispatchSettings(dispatchSettingsRow.value)
    if (dispatchConfig.enabled && dispatchConfig.isExpired) {
      return NextResponse.json(
        { error: "O periodo de teste para envio de relatorios expirou. Entre em contato com o administrador." },
        { status: 403 }
      )
    }
  }

  // Verificar janela de horário de envio
  const { data: sendingHoursRow } = await supabase
    .from("company_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", "sending_hours")
    .maybeSingle()

  const sendingHours = sendingHoursRow?.value as {
    enabled?: boolean
    mode?: string
    allowed_windows?: Array<{ start_time?: string; end_time?: string }>
    blocked_windows?: Array<{ start_time?: string; end_time?: string }>
  } | null
  if (sendingHours?.enabled) {
    const isBlockedMode = sendingHours.mode === "blocked"
    const windows = isBlockedMode
      ? (sendingHours.blocked_windows ?? [])
      : (sendingHours.allowed_windows ?? [])

    if (windows.length > 0) {
      const nowBr = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
      const currentMinutes = nowBr.getHours() * 60 + nowBr.getMinutes()

      const isInAnyWindow = windows.some((w) => {
        if (!w.start_time || !w.end_time) return false
        const [sh, sm] = w.start_time.split(":").map(Number)
        const [eh, em] = w.end_time.split(":").map(Number)
        return currentMinutes >= sh * 60 + sm && currentMinutes <= eh * 60 + em
      })

      const windowsStr = windows
        .filter((w) => w.start_time && w.end_time)
        .map((w) => `${w.start_time}–${w.end_time}`)
        .join(", ")

      if (isBlockedMode && isInAnyWindow) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: `Horario bloqueado para envio (${windowsStr})`,
        })
      } else if (!isBlockedMode && !isInAnyWindow) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: `Fora dos horarios de envio (${windowsStr})`,
        })
      }
    }
  }

  const [{ data: schedule }, { data: companyRow }] = await Promise.all([
    supabase.from("schedules").select("*").eq("company_id", companyId).eq("id", schedule_id).single(),
    supabase.from("companies").select("name").eq("id", companyId).single(),
  ])
  const companyName: string = companyRow?.name ?? companyId

  if (!schedule) {
    return NextResponse.json({ error: "Rotina nao encontrada" }, { status: 404 })
  }

  if (accessMaps && !isScheduleAccessible(schedule, accessMaps)) {
    return NextResponse.json({ error: "Rotina nao encontrada" }, { status: 404 })
  }

  const originalBotInstanceId = schedule.bot_instance_id ?? null

  // Only resolve to a different instance when the schedule already specifies a preference.
  // When null, leave null so the bot service uses its default connected socket.
  const resolvedBotInstance = originalBotInstanceId
    ? await resolveConnectedBotInstance(supabase, companyId, originalBotInstanceId).catch(() => null)
    : null
  if (resolvedBotInstance) {
    schedule.bot_instance_id = resolvedBotInstance.id
  }

  // ── Narração: rotina tem prioridade, empresa é fallback ──
  const scheduleSendMode: "audio" | "text" | "none" =
    schedule.send_mode === "audio" ? "audio"
    : schedule.send_mode === "text" ? "text"
    : "none"

  let companySendMode: "audio" | "text" | "none" = "none"
  if (scheduleSendMode === "none") {
    const { data: narrationRow } = await supabase
      .from("company_settings")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", "narration_mode")
      .maybeSingle()

    const narrationValue = narrationRow?.value as Record<string, unknown> | null
    companySendMode =
      narrationValue?.send_mode === "audio" ? "audio"
      : narrationValue?.send_mode === "text" ? "text"
      : "none"
  }

  const effectiveSendMode: "audio" | "text" | "none" = scheduleSendMode !== "none" ? scheduleSendMode : companySendMode

  // ── Verificar limite mensal de relatórios ──
  const { data: limitsRow } = await supabase
    .from("company_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", "usage_limits")
    .maybeSingle()

  const limitsValue = limitsRow?.value as Record<string, unknown> | null
  const reportLimit = typeof limitsValue?.report_limit === "number" ? limitsValue.report_limit : null

  if (reportLimit !== null && reportLimit > 0) {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const { count: usedThisMonth } = await supabase
      .from("dispatch_logs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", ["delivered", "failed"])
      .gte("created_at", startOfMonth.toISOString())

    const used = usedThisMonth ?? 0
    if (used >= reportLimit) {
      return NextResponse.json(
        {
          error: `Limite mensal de ${reportLimit} relatórios atingido (${used} enviados). Fale com o administrador para aumentar o limite.`,
          limitReached: true,
        },
        { status: 429 }
      )
    }
  }

  const scheduleReportConfigs = resolveScheduleReportConfigs(schedule)
  const primaryScheduleReportConfig = getPrimaryScheduleReportConfig(scheduleReportConfigs)
  const scheduleImageUrls: string[] = Array.isArray((schedule as Record<string, unknown>).image_urls)
    ? ((schedule as Record<string, unknown>).image_urls as string[]).filter((u) => typeof u === "string" && u.trim())
    : typeof schedule.image_url === "string" && schedule.image_url.trim()
      ? [schedule.image_url.trim()]
      : []

  if (!primaryScheduleReportConfig) {
    if (scheduleImageUrls.length === 0) {
      return NextResponse.json(
        { error: "Rotina sem relatorio configurado" },
        { status: 400 }
      )
    }

    // Envio apenas de imagem — sem relatorio
    const { data: scContacts } = await supabase
      .from("schedule_contacts")
      .select("contact_id")
      .eq("schedule_id", schedule_id)

    const contactIds = (scContacts ?? []).map((sc: { contact_id: string }) => sc.contact_id)
    let contactsQuery = supabase
      .from("contacts")
      .select("*")
      .eq("company_id", companyId)
      .in("id", contactIds)
      .eq("is_active", true)


    const { data: imageContacts } = await contactsQuery
    const normalizedImageContacts = (imageContacts ?? []).map((c) => normalizeContactForResponse(c as Record<string, unknown>))

    if (normalizedImageContacts.length === 0) {
      return NextResponse.json({ error: "Nenhum contato ativo vinculado" }, { status: 400 })
    }

    let sent = 0

    for (const contact of normalizedImageContacts) {
      for (let imgIndex = 0; imgIndex < scheduleImageUrls.length; imgIndex++) {
        const imageUrl = scheduleImageUrls[imgIndex]
        try {
          await sendWithFallback({
            instance_id: schedule.bot_instance_id ?? null,
            phone: contact.phone,
            whatsapp_group_id: contact.whatsapp_group_id,
            message: null,
            document_url: imageUrl,
            file_name: "imagem.jpg",
            mimetype: "image/jpeg",
          }, resolvedBotInstance?.id ?? null)
          if (imgIndex === 0) sent++
        } catch {
          // falha silenciosa por contato/imagem
        }
      }
    }

    await supabase
      .from("schedules")
      .update({ last_run_at: new Date().toISOString(), ...(schedule.disable_after_send ? { is_active: false } : {}) })
      .eq("company_id", companyId)
      .eq("id", schedule_id)

    return NextResponse.json({ success: true, sent, image_only: true })
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

  if (contactIds.length === 0) {
    return NextResponse.json({ error: "Nenhum contato vinculado a esta rotina" }, { status: 400 })
  }

  let contactsQuery = supabase
    .from("contacts")
    .select("*")
    .eq("company_id", companyId)
    .in("id", contactIds)
    .eq("is_active", true)

  const { data: contacts } = await contactsQuery

  const normalizedContacts = (contacts ?? []).map((contact) =>
    normalizeContactForResponse(contact as Record<string, unknown>)
  )

  if (normalizedContacts.length === 0) {
    return NextResponse.json({ error: "Nenhum contato ativo vinculado" }, { status: 400 })
  }

  const powerBiTargets = scheduleReportConfigs.flatMap((reportConfig) => {
    const report = reportMap.get(reportConfig.report_id)
    if (!report) return []
    return [{ config: reportConfig, report }]
  })

  if (powerBiTargets.length !== scheduleReportConfigs.length) {
    // Nao mistura relatorios Power BI com automacoes
    if (powerBiTargets.length > 0) {
      return NextResponse.json(
        { error: "Todos os relatorios da rotina precisam existir no Power BI para o envio conjunto." },
        { status: 404 }
      )
    }

    // Nenhum relatorio encontrado no Power BI — tenta como automacoes
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin
    let totalNotified = 0

    for (const reportConfig of scheduleReportConfigs) {
      let automation: { id: string; name: string; export_format?: string | null } | null = null

      const { data: dbAutomation, error: automationError } = await supabase
        .from("automations")
        .select("id, name, export_format")
        .eq("company_id", companyId)
        .eq("id", reportConfig.report_id)
        .maybeSingle()

      if (automationError) {
        if (!isMissingAutomationRelationError(automationError)) {
          return NextResponse.json({ error: automationError.message }, { status: 500 })
        }
        const stored = await getStoredAutomationById(supabase, companyId, reportConfig.report_id)
        automation = stored ? { id: stored.id, name: stored.name, export_format: stored.export_format } : null
      } else {
        automation = dbAutomation
      }

      if (!automation) {
        return NextResponse.json(
          { error: scheduleReportConfigs.length > 1 ? "Um ou mais relatorios da rotina nao foram encontrados." : "Relatorio nao encontrado" },
          { status: 404 }
        )
      }

      const runResult = await runStoredAutomation({
        companyId,
        automationId: automation.id,
        exportFormat: normalizeAutomationExportFormat(schedule.export_format || automation.export_format),
        messageOverride: schedule.message_template ?? `Segue o relatorio ${automation.name}.`,
        contactIds,
        scheduleId: schedule.id,
        botInstanceId: schedule.bot_instance_id ?? null,
        appBaseUrl,
      })

      totalNotified += runResult.contacts_notified
    }

    await supabase
      .from("schedules")
      .update({ last_run_at: new Date().toISOString(), ...(schedule.disable_after_send ? { is_active: false } : {}) })
      .eq("company_id", companyId)
      .eq("id", schedule_id)

    return NextResponse.json({
      success: true,
      logs_created: totalNotified,
      source: "created",
    })
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
      const pbiToken = await getAccessTokenMasterUser(companyId)
      let exportCount = 0

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

          try {
            await retryAsync(async () => {
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
                  if (exportCount > 0) {
                    await sleep(EXPORT_DELAY_MS)
                  }
                  exportCount++
                  const exportedFile = await exportDocumentWithFallback({
                    pbiToken,
                    companyId,
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

                  await sendWithFallback({
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
                  }, resolvedBotInstance?.id ?? null)
                }
              } else {
                console.log("[dispatch] direct PDF generation", {
                  mode: "single_document",
                  scheduleId: schedule.id,
                  contact: getDispatchLogTarget(contact),
                  reportName: target.report.name,
                  selectedPageNames,
                  pageName: target.config.pbi_page_name,
                  pbiWorkspaceId,
                  pbiReportId,
                })

                // Se nenhuma página foi selecionada, busca todas as páginas visíveis via API
                let resolvedPageNames: string[] | null = selectedPageNames.length > 0 ? selectedPageNames : null
                if (!resolvedPageNames && !target.config.pbi_page_name) {
                  console.log("[dispatch] nenhuma pagina selecionada — buscando paginas via API REST", {
                    pbiWorkspaceId,
                    pbiReportId,
                    hasPbiWorkspaceId: !!pbiWorkspaceId,
                  })
                  if (pbiWorkspaceId) {
                    try {
                      const allPages = await getReportPages(pbiToken, pbiWorkspaceId, pbiReportId)
                      const sorted = [...allPages].sort((a, b) => a.order - b.order)
                      console.log(`[dispatch] getReportPages retornou ${sorted.length} paginas: ${JSON.stringify(sorted.map((p) => ({ name: p.name, displayName: p.displayName, order: p.order })))}`)
                      if (sorted.length > 1) {
                        resolvedPageNames = sorted.map((p) => p.name)
                      } else if (sorted.length === 1) {
                        console.log("[dispatch] relatorio tem apenas 1 pagina — exportando como pagina unica")
                      } else {
                        console.log("[dispatch] getReportPages retornou lista vazia")
                      }
                    } catch (pagesErr) {
                      console.warn("[dispatch] nao foi possivel listar paginas do relatorio:", pagesErr instanceof Error ? pagesErr.message : pagesErr)
                    }
                  } else {
                    console.warn("[dispatch] pbiWorkspaceId vazio — nao e possivel buscar paginas via API")
                  }
                }

                const resolvedEmbedUrl = pbiEmbedUrl ||
                  (pbiWorkspaceId && pbiReportId
                    ? `https://app.powerbi.com/reportEmbed?reportId=${pbiReportId}&groupId=${pbiWorkspaceId}`
                    : null)

                console.log("[dispatch] chamando exportDocumentWithFallback", {
                  resolvedPageNames,
                  pageName: target.config.pbi_page_name,
                  hasEmbedUrl: !!resolvedEmbedUrl,
                })

                const exportedFile = await exportDocumentWithFallback({
                  pbiToken,
                  companyId,
                  workspaceId: pbiWorkspaceId,
                  reportId: pbiReportId,
                  reportName: target.report.name,
                  embedUrl: resolvedEmbedUrl,
                  pageNames: resolvedPageNames,
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

                await sendWithFallback({
                  instance_id: schedule.bot_instance_id ?? null,
                  phone: contact.phone,
                  whatsapp_group_id: contact.whatsapp_group_id,
                  message: reportMessage,
                  document_base64: Buffer.from(exportedFile.buffer).toString("base64"),
                  file_name: buildReportAttachmentFileName(target.report.name, exportedFile.extension),
                  mimetype: exportedFile.contentType,
                }, resolvedBotInstance?.id ?? null)
              }
            })

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
          } catch (sendError) {
            const errMsg = sendError instanceof Error ? sendError.message : "Erro ao exportar ou enviar relatorio"
            console.error("[dispatch] failed after retries", {
              contact: getDispatchLogTarget(contact),
              reportName: target.report.name,
              error: errMsg,
            })
            if (currentLog) {
              await supabase
                .from("dispatch_logs")
                .update({
                  status: "failed",
                  error_message: errMsg,
                  completed_at: new Date().toISOString(),
                })
                .eq("company_id", companyId)
                .eq("id", currentLog.id)
            }
          }
        }
      }

      await supabase
        .from("schedules")
        .update({ last_run_at: new Date().toISOString(), ...(schedule.disable_after_send ? { is_active: false } : {}) })
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
        company_id: companyId,
        company_name: companyName,
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
        send_mode: effectiveSendMode,
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
      .update({ last_run_at: new Date().toISOString(), ...(schedule.disable_after_send ? { is_active: false } : {}) })
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

