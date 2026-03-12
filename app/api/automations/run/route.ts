import { NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getAccessToken, executeDAXQuery } from "@/lib/powerbi"
import { getCatalogMap, getExecutionTarget } from "@/lib/automation-catalog"
import { buildCsvContent, buildHtmlReport, buildTextReport } from "@/lib/report-export"
import { BRAND_LOGO_PATH } from "@/lib/branding"
import { buildDAXQuery } from "@/lib/dax-builder"
import { resolveRequestCompanyContext } from "@/lib/n8n-auth"
import { normalizeContactForResponse } from "@/lib/contact-compat"
import { normalizeFilters } from "@/lib/query-filters"
import {
  getStoredAutomationById,
  isMissingAutomationRelationError,
  listContactsByIds,
  touchStoredAutomationLastRunAt,
} from "@/lib/automation-storage"
import type { QueryFilter, SelectedColumn, SelectedMeasure } from "@/lib/types"

type ContactRecord = {
  id: string
  name: string
  phone: string | null
  type?: string | null
  whatsapp_group_id?: string | null
  is_active?: boolean | null
}

function applyTemplate(template: string | null | undefined, values: Record<string, string | number>): string {
  const source = template?.trim() || "Segue o relatorio {name}."
  return source.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""))
}

function normalizeSelectedColumns(input: unknown): SelectedColumn[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const tableName = typeof record.tableName === "string" ? record.tableName.trim() : ""
    const columnName = typeof record.columnName === "string" ? record.columnName.trim() : ""
    return tableName && columnName ? [{ tableName, columnName }] : []
  })
}

function normalizeSelectedMeasures(input: unknown): SelectedMeasure[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const tableName = typeof record.tableName === "string" ? record.tableName.trim() : ""
    const measureName = typeof record.measureName === "string" ? record.measureName.trim() : ""
    return tableName && measureName ? [{ tableName, measureName }] : []
  })
}

function buildSelectedItems(
  selectedColumns: SelectedColumn[],
  selectedMeasures: SelectedMeasure[]
) {
  return [
    ...selectedColumns.map((column) => `${column.tableName}.${column.columnName}`),
    ...selectedMeasures.map((measure) => measure.measureName),
  ]
}

function getRequestOrigin(request: Request) {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    request.headers.get("origin")?.trim() ||
    new URL(request.url).origin
  )
}

export async function POST(request: Request) {
  try {
    const { companyId } = await resolveRequestCompanyContext(request, {
      allowCallbackSecret: true,
    })
    const supabase = createClient()
    const body = await request.json()

    const automationId = typeof body.automation_id === "string" ? body.automation_id : ""
    const adHocDatasetId = typeof body.dataset_id === "string" ? body.dataset_id : ""
    const adHocExecutionDatasetId =
      typeof body.execution_dataset_id === "string" ? body.execution_dataset_id : ""
    const adHocQuery = typeof body.dax_query === "string" ? body.dax_query : ""
    const hasExportFormatOverride =
      typeof body.export_format === "string" && body.export_format.trim().length > 0
    const adHocExportFormat =
      typeof body.export_format === "string" ? body.export_format : "csv"
    const hasMessageOverride = Object.prototype.hasOwnProperty.call(body, "message")
    const adHocMessage = typeof body.message === "string" ? body.message : null
    const hasContactOverrides = Array.isArray(body.contact_ids)
    const adHocContactIds = Array.isArray(body.contact_ids)
      ? body.contact_ids.filter((value: unknown): value is string => typeof value === "string")
      : []
    const scheduleIdOverride =
      typeof body.schedule_id === "string" && body.schedule_id.trim()
        ? body.schedule_id
        : null
    const hasFilterOverrides = Object.prototype.hasOwnProperty.call(body, "filters")
    const overrideFilters = normalizeFilters(body.filters)

    let datasetId = ""
    let query = ""
    let exportFormat = adHocExportFormat
    let messageTemplate: string | null = adHocMessage
    let automationName = "Consulta Personalizada"
    let contacts: ContactRecord[] = []
    let selectedItems: string[] = []
    let reportFilters: QueryFilter[] = []
    const catalogs = await getCatalogMap(companyId)

    if (automationId) {
      let automation: Record<string, unknown> | null = null
      let usingStoredAutomation = false

      const { data: dbAutomation, error: autoErr } = await supabase
        .from("automations")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", automationId)
        .single()

      if (autoErr) {
        if (!isMissingAutomationRelationError(autoErr)) {
          throw new Error(autoErr.message)
        }

        const storedAutomation = await getStoredAutomationById(supabase, companyId, automationId)
        if (!storedAutomation) {
          return NextResponse.json({ error: "Automacao nao encontrada" }, { status: 404 })
        }

        automation = storedAutomation as unknown as Record<string, unknown>
        usingStoredAutomation = true
      } else if (!dbAutomation) {
        return NextResponse.json({ error: "Automacao nao encontrada" }, { status: 404 })
      } else {
        automation = dbAutomation as Record<string, unknown>
      }

      datasetId = String(automation.dataset_id)
      exportFormat = hasExportFormatOverride
        ? adHocExportFormat
        : String(automation.export_format || "csv")
      messageTemplate = hasMessageOverride
        ? adHocMessage
        : automation.message_template
          ? String(automation.message_template)
          : null
      automationName = String(automation.name || "Automacao")
      const savedSelectedColumns = normalizeSelectedColumns(automation.selected_columns)
      const savedSelectedMeasures = normalizeSelectedMeasures(automation.selected_measures)
      const savedFilters = normalizeFilters(automation.filters)
      const effectiveFilters = hasFilterOverrides ? overrideFilters : savedFilters
      reportFilters = effectiveFilters
      selectedItems = buildSelectedItems(savedSelectedColumns, savedSelectedMeasures)
      const canRebuildQuery = savedSelectedColumns.length > 0 || savedSelectedMeasures.length > 0

      if (!automation.dax_query && !canRebuildQuery) {
        return NextResponse.json(
          { error: "Automacao sem query DAX definida e sem campos suficientes para reconstruir a consulta" },
          { status: 400 }
        )
      }

      if (hasFilterOverrides || !automation.dax_query) {
        query = buildDAXQuery(savedSelectedColumns, savedSelectedMeasures, effectiveFilters)
        if (!query || query.startsWith("--")) {
          return NextResponse.json(
            { error: "Nao foi possivel reconstruir a query da automacao com os filtros informados" },
            { status: 400 }
          )
        }
      } else {
        query = String(automation.dax_query)
      }

      const lastRunAt = new Date().toISOString()
      if (usingStoredAutomation) {
        await touchStoredAutomationLastRunAt(supabase, companyId, automationId, lastRunAt)
      } else {
        await supabase
          .from("automations")
          .update({ last_run_at: lastRunAt })
          .eq("company_id", companyId)
          .eq("id", automationId)
      }

      if (hasContactOverrides) {
        if (adHocContactIds.length === 0) {
          contacts = []
        } else {
          const { data: selectedContacts } = await supabase
            .from("contacts")
            .select("*")
            .eq("company_id", companyId)
            .in("id", adHocContactIds)
            .eq("is_active", true)

          contacts = (selectedContacts || []).map((contact) =>
            normalizeContactForResponse(contact as ContactRecord)
          ) as ContactRecord[]
        }
      } else {
        if (usingStoredAutomation) {
          contacts = (await listContactsByIds(
            supabase,
            companyId,
            Array.isArray((automation as { contact_ids?: unknown[] }).contact_ids)
              ? ((automation as { contact_ids?: unknown[] }).contact_ids as string[])
              : []
          )) as ContactRecord[]
        } else {
          const { data: contactLinks, error: contactLinksError } = await supabase
            .from("automation_contacts")
            .select("contacts(*)")
            .eq("automation_id", automationId)

          if (contactLinksError) {
            if (!isMissingAutomationRelationError(contactLinksError)) {
              throw new Error(contactLinksError.message)
            }
          } else {
            contacts = (
              contactLinks
                ?.map((item: Record<string, unknown>) => item.contacts)
                .filter(Boolean)
                .map((contact) => normalizeContactForResponse(contact as ContactRecord)) || []
            ) as ContactRecord[]
          }
        }
      }
    } else {
      if (!adHocDatasetId || !adHocQuery) {
        return NextResponse.json(
          { error: "automation_id ou dataset_id + dax_query sao obrigatorios" },
          { status: 400 }
        )
      }

      const { data: report } = await supabase
        .from("reports")
        .select("id")
        .eq("company_id", companyId)
        .eq("dataset_id", adHocDatasetId)
        .limit(1)
        .maybeSingle()

      if (!report && !catalogs[adHocDatasetId]) {
        return NextResponse.json(
          { error: "Dataset nao pertence a empresa do usuario" },
          { status: 403 }
        )
      }

      datasetId = adHocDatasetId
      query = adHocQuery
      reportFilters = overrideFilters
      selectedItems = Array.isArray(body?.selectedItems)
        ? body.selectedItems.filter((item: unknown): item is string => typeof item === "string")
        : []

      if (adHocContactIds.length > 0) {
        const { data: selectedContacts } = await supabase
          .from("contacts")
          .select("*")
          .eq("company_id", companyId)
          .in("id", adHocContactIds)
          .eq("is_active", true)

        contacts = (selectedContacts || []).map((contact) =>
          normalizeContactForResponse(contact as ContactRecord)
        ) as ContactRecord[]
      }
    }

    const executionTarget = getExecutionTarget(catalogs[datasetId], datasetId)
    const executionDatasetId = adHocExecutionDatasetId || executionTarget.datasetId
    const token = await getAccessToken()
    const result = await executeDAXQuery(token, executionDatasetId, query)
    const rowCount = result.rows.length
    const generatedAt = new Date()
    const reportTitle = automationName
    const csvContent = buildCsvContent(result)
    const textReport = buildTextReport(result)
    const htmlReport = buildHtmlReport({
      title: reportTitle,
      subtitle:
        executionDatasetId === datasetId
          ? `Dataset ${datasetId}`
          : `Dataset origem ${datasetId} | Execucao ${executionDatasetId}`,
      generatedAt,
      selectedItems,
      filters: reportFilters,
      brandLogoUrl: new URL(BRAND_LOGO_PATH, request.url).toString(),
      result,
    })

    if (contacts.length > 0) {
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

      const logEntries = contacts.map((contact) => ({
        company_id: companyId,
        schedule_id: scheduleIdOverride,
        report_name: reportTitle,
        contact_name: String(contact.name || ""),
        contact_phone: contact.phone ? String(contact.phone) : null,
        status: "sending",
        export_format: exportFormat,
      }))

      const { data: logs } = await supabase
        .from("dispatch_logs")
        .insert(logEntries)
        .select("id")

      const appUrl = getRequestOrigin(request)
      const message = applyTemplate(messageTemplate, {
        name: reportTitle,
        row_count: rowCount,
        format: exportFormat,
      })

      let webhookErrorMessage: string | null = null

      try {
        const webhookResponse = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            automation_name: reportTitle,
            dataset_id: datasetId,
            execution_dataset_id: executionDatasetId,
            export_format: exportFormat,
            row_count: rowCount,
            generated_at: generatedAt.toISOString(),
            columns: result.columns,
            rows: result.rows,
            data_csv: csvContent,
            report_text: textReport,
            report_html: htmlReport,
            contacts,
            message,
            callback_url: `${appUrl}/api/webhook/n8n-callback`,
            dispatch_log_ids: logs?.map((log) => log.id) || [],
          }),
        })
        if (!webhookResponse.ok) {
          const responseText = await webhookResponse.text().catch(() => "")
          throw new Error(responseText || `Webhook N8N retornou ${webhookResponse.status}`)
        }
      } catch (error) {
        webhookErrorMessage =
          error instanceof Error ? error.message : "Erro ao enviar para o webhook N8N"

        for (const log of logs ?? []) {
          await supabase
            .from("dispatch_logs")
            .update({
              status: "failed",
              error_message: webhookErrorMessage,
              completed_at: new Date().toISOString(),
            })
            .eq("company_id", companyId)
            .eq("id", log.id)
        }
      }

      if (webhookErrorMessage) {
        return NextResponse.json({ error: webhookErrorMessage }, { status: 502 })
      }
    }

    return NextResponse.json({
      success: true,
      rowCount,
      result,
      report: {
        title: reportTitle,
        generated_at: generatedAt.toISOString(),
        export_format: exportFormat,
        executed_dataset_id: executionDatasetId,
        csv: csvContent,
        text: textReport,
        html: htmlReport,
      },
      contacts_notified: contacts.length,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    )
  }
}
