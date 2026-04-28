import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"
import {
  getScheduleAccessMaps,
  isScheduleAccessible,
} from "@/lib/schedule-access"
import {
  getPrimaryScheduleReportConfig,
  getScheduleReportIds,
  normalizeScheduleReportConfigs,
  resolveScheduleReportConfigs,
} from "@/lib/schedule-report-configs"
import { normalizeSchedulePageNames } from "@/lib/schedule-pages"
import { getWorkspaceAccessScope } from "@/lib/workspace-access"
import { normalizeDispatchSettings } from "@/lib/dispatch-config"
import {
  getCompanyWhatsAppBotInstance,
  isMissingBotInstanceIdColumnError,
  isMissingWhatsAppBotInstancesTableError,
} from "@/lib/whatsapp-bot-instances"

function isMissingSchedulesUpdatedAtColumn(message?: string | null) {
  return (
    typeof message === "string" &&
    message.includes("updated_at") &&
    message.includes("schedules")
  )
}

function isMissingSchedulePageNamesColumn(message?: string | null) {
  return (
    typeof message === "string" &&
    message.includes("pbi_page_names") &&
    message.includes("schedules")
  )
}

function isMissingScheduleReportConfigsColumn(message?: string | null) {
  return (
    typeof message === "string" &&
    message.includes("report_configs") &&
    message.includes("schedules")
  )
}

function hasAccessToScheduleReports(
  reportIds: string[],
  visibleTargetIds: Set<string>
) {
  return reportIds.length > 0 && reportIds.every((reportId) => visibleTargetIds.has(reportId))
}

function getScheduleAccessErrorResponse() {
  return NextResponse.json(
    { error: "Voce nao tem acesso a um ou mais relatorios desta rotina." },
    { status: 403 }
  )
}

const nullableTrimmedString = z.preprocess((value) => {
  if (typeof value !== "string") return value

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}, z.string().min(1).nullable().optional())

const pageNamesSchema = z.preprocess(
  (value) => {
    if (value === undefined) {
      return undefined
    }

    return normalizeSchedulePageNames(value)
  },
  z.array(z.string().min(1)).optional()
)

const reportConfigsSchema = z.preprocess(
  (value) => {
    if (value === undefined) {
      return undefined
    }

    return normalizeScheduleReportConfigs(value)
  },
  z
    .array(
      z.object({
        report_id: z.string().uuid(),
        pbi_page_name: nullableTrimmedString,
        pbi_page_names: pageNamesSchema,
      })
    )
    .optional()
)

function validateScheduleReports(
  value: {
    report_configs?: unknown
    report_id?: unknown
    pbi_page_name?: unknown
    pbi_page_names?: unknown
  },
  ctx: z.RefinementCtx
) {
  const reportConfigs = resolveScheduleReportConfigs(value)

  if (reportConfigs.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Selecione ao menos 1 relatorio.",
      path: ["report_configs"],
    })
  }
}

const baseScheduleSchema = z.object({
  name: z.string().min(1),
  report_id: z.string().uuid().optional(),
  bot_instance_id: z.string().uuid().nullable().optional(),
  report_configs: reportConfigsSchema,
  pbi_page_name: nullableTrimmedString,
  pbi_page_names: pageNamesSchema,
  cron_expression: z.string().min(1),
  export_format: z
    .enum(["PDF", "PNG", "PPTX", "table", "csv", "pdf"])
    .default("PDF"),
  message_template: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  contact_ids: z.array(z.string().trim().min(1)).optional(),
})

const scheduleSchema = baseScheduleSchema.superRefine(validateScheduleReports)

const scheduleUpdateSchema = baseScheduleSchema
  .partial()
  .extend({
    id: z.string().uuid(),
  })
  .superRefine(validateScheduleReports)

async function checkDispatchExpiry(supabase: ReturnType<typeof createClient>, companyId: string) {
  const { data } = await supabase
    .from("company_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", "dispatch_settings")
    .maybeSingle()
  if (!data?.value) return false
  const cfg = normalizeDispatchSettings(data.value)
  return !cfg.effectiveEnabled
}

export async function GET() {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()

    if (await checkDispatchExpiry(supabase, companyId)) {
      return NextResponse.json(
        { error: "O periodo de teste para envio de relatorios expirou." },
        { status: 403 }
      )
    }

    const scope = await getWorkspaceAccessScope(supabase, context)

    if (scope.datasetRestricted && scope.datasetIds.length === 0) {
      return NextResponse.json([])
    }

    const { data: schedules, error } = await supabase
      .from("schedules")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const accessMaps = await getScheduleAccessMaps(supabase, companyId, scope)
    const visibleSchedules = (schedules ?? []).filter((schedule) =>
      isScheduleAccessible(schedule, accessMaps)
    )

    const enriched = await Promise.all(
      visibleSchedules.map(async (schedule) => {
        const { data: scContacts } = await supabase
          .from("schedule_contacts")
          .select("contact_id")
          .eq("schedule_id", schedule.id)

        const contactIds = (scContacts ?? []).map((sc) => sc.contact_id)

        let contacts: Array<{ id: string; name: string }> = []

        if (contactIds.length > 0) {
          const { data } = await supabase
            .from("contacts")
            .select("id, name")
            .eq("company_id", companyId)
            .in("id", contactIds)

          contacts = data ?? []
        }

        const reportConfigs = resolveScheduleReportConfigs(schedule).map((reportConfig) => {
          const reportName =
            accessMaps.reportNames.get(reportConfig.report_id) ??
            accessMaps.automationNames.get(reportConfig.report_id) ??
            "Desconhecido"
          const reportSource = accessMaps.reportNames.has(reportConfig.report_id)
            ? "powerbi"
            : accessMaps.automationNames.has(reportConfig.report_id)
              ? "created"
              : "unknown"

          return {
            ...reportConfig,
            report_name: reportName,
            report_source: reportSource,
          }
        })

        const reportNames = reportConfigs.map((reportConfig) => reportConfig.report_name)
        const primaryReportName = reportNames[0] ?? "Desconhecido"

        return {
          ...schedule,
          report_configs: reportConfigs,
          report_names: reportNames,
          report_name:
            reportNames.length > 1
              ? `${primaryReportName} +${reportNames.length - 1}`
              : primaryReportName,
          report_source: reportConfigs[0]?.report_source ?? "unknown",
          contacts,
        }
      })
    )

    return NextResponse.json(enriched)
  } catch (error) {
    if (isAuthContextError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Nao autenticado" },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno inesperado" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const context = await getRequestContext()
  const { companyId } = context
  const supabase = createClient()

  if (await checkDispatchExpiry(supabase, companyId)) {
    return NextResponse.json(
      { error: "O periodo de teste para envio de relatorios expirou." },
      { status: 403 }
    )
  }

  const scope = await getWorkspaceAccessScope(supabase, context)
  const accessMaps = await getScheduleAccessMaps(supabase, companyId, scope)
  const body = await request.json()
  const parsed = scheduleSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { contact_ids, report_configs: _reportConfigs, ...scheduleData } = parsed.data
  const normalizedContactIds = [...new Set((contact_ids ?? []).map((id) => id.trim()).filter(Boolean))]
  const reportConfigs = resolveScheduleReportConfigs(parsed.data)
  const primaryReportConfig = getPrimaryScheduleReportConfig(reportConfigs)
  const scheduleReportIds = getScheduleReportIds(reportConfigs)

  if (!hasAccessToScheduleReports(scheduleReportIds, accessMaps.visibleTargetIds)) {
    return getScheduleAccessErrorResponse()
  }

  if (!primaryReportConfig) {
    return NextResponse.json(
      {
        error: {
          report_configs: ["Selecione ao menos 1 relatorio."],
        },
      },
      { status: 400 }
    )
  }

  if (
    scheduleData.export_format !== "PDF" &&
    (reportConfigs.length > 1 ||
      reportConfigs.some((reportConfig) => reportConfig.pbi_page_names.length > 1))
  ) {
    return NextResponse.json(
      {
        error: {
          report_configs: [
            "Selecione varios relatorios ou varias paginas apenas quando o formato de exportacao for PDF.",
          ],
        },
      },
      { status: 400 }
    )
  }

  const selectedBotInstance = await getCompanyWhatsAppBotInstance(
    supabase,
    companyId,
    parsed.data.bot_instance_id
  ).catch((error) => {
    if (isMissingWhatsAppBotInstancesTableError(error)) {
      throw new Error(
        "O banco ainda nao suporta varios WhatsApps por empresa. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase."
      )
    }

    throw error
  })

  if (!selectedBotInstance) {
    return NextResponse.json(
      {
        error: {
          bot_instance_id: ["Selecione um WhatsApp valido para esta rotina."],
        },
      },
      { status: 400 }
    )
  }

  if (normalizedContactIds.length > 0) {
    const { data: linkedContacts, error: contactsError } = await supabase
      .from("contacts")
      .select("id")
      .eq("company_id", companyId)
      .eq("bot_instance_id", selectedBotInstance.id)
      .in("id", normalizedContactIds)

    if (contactsError) {
      if (isMissingBotInstanceIdColumnError(contactsError, "contacts")) {
        return NextResponse.json(
          {
            error:
              "O banco ainda nao suporta contatos por numero de WhatsApp. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase.",
          },
          { status: 500 }
        )
      }

      return NextResponse.json({ error: contactsError.message }, { status: 500 })
    }

    if ((linkedContacts ?? []).length !== normalizedContactIds.length) {
      return NextResponse.json(
        {
          error: {
            contacts: ["Selecione apenas contatos do WhatsApp escolhido."],
          },
        },
        { status: 400 }
      )
    }
  }

  const { data: schedule, error } = await supabase
    .from("schedules")
    .insert({
      ...scheduleData,
      report_id: primaryReportConfig.report_id,
      bot_instance_id: selectedBotInstance.id,
      company_id: companyId,
      pbi_page_name: primaryReportConfig.pbi_page_name,
      pbi_page_names:
        primaryReportConfig.pbi_page_names.length > 0
          ? primaryReportConfig.pbi_page_names
          : null,
      report_configs: reportConfigs,
    })
    .select()
    .single()

  if (error) {
    if (isMissingBotInstanceIdColumnError(error, "schedules")) {
      return NextResponse.json(
        {
          error:
            "O banco ainda nao suporta rotinas por numero de WhatsApp. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase.",
        },
        { status: 500 }
      )
    }

    if (isMissingScheduleReportConfigsColumn(error.message)) {
      return NextResponse.json(
        {
          error:
            "O banco ainda nao suporta varios relatorios por rotina. Execute a migration 20260328_schedule_report_configs.sql no Supabase.",
        },
        { status: 500 }
      )
    }

    if (isMissingSchedulePageNamesColumn(error.message)) {
      return NextResponse.json(
        {
          error:
            "O banco ainda nao suporta varias paginas por rotina. Execute a migration 20260324_schedule_page_names.sql no Supabase.",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (normalizedContactIds.length > 0) {
    const links = normalizedContactIds.map((cid) => ({
      schedule_id: schedule.id,
      contact_id: cid,
    }))

    const { error: insertContactsError } = await supabase
      .from("schedule_contacts")
      .insert(links)

    if (insertContactsError) {
      return NextResponse.json({ error: insertContactsError.message }, { status: 500 })
    }
  }

  return NextResponse.json(schedule, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const context = await getRequestContext()
  const { companyId } = context
  const supabase = createClient()
  const scope = await getWorkspaceAccessScope(supabase, context)
  const accessMaps = await getScheduleAccessMaps(supabase, companyId, scope)
  const body = await request.json()
  const parsed = scheduleUpdateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { id, contact_ids, ...updates } = parsed.data
  const normalizedContactIds =
    contact_ids === undefined
      ? undefined
      : [...new Set(contact_ids.map((contactId) => contactId.trim()).filter(Boolean))]
  const isUpdatingReportSelection =
    Object.prototype.hasOwnProperty.call(parsed.data, "report_configs") ||
    Object.prototype.hasOwnProperty.call(parsed.data, "report_id") ||
    Object.prototype.hasOwnProperty.call(parsed.data, "pbi_page_name") ||
    Object.prototype.hasOwnProperty.call(parsed.data, "pbi_page_names")

  const { data: existingSchedule, error: existingScheduleError } = await supabase
    .from("schedules")
    .select("id, export_format, report_id, report_configs, pbi_page_name, pbi_page_names, bot_instance_id")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle()

  if (existingScheduleError) {
    if (isMissingBotInstanceIdColumnError(existingScheduleError, "schedules")) {
      return NextResponse.json(
        {
          error:
            "O banco ainda nao suporta rotinas por numero de WhatsApp. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase.",
        },
        { status: 500 }
      )
    }

    if (isMissingScheduleReportConfigsColumn(existingScheduleError.message)) {
      return NextResponse.json(
        {
          error:
            "O banco ainda nao suporta varios relatorios por rotina. Execute a migration 20260328_schedule_report_configs.sql no Supabase.",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ error: existingScheduleError.message }, { status: 500 })
  }

  if (!existingSchedule) {
    return NextResponse.json({ error: "Rotina nao encontrada" }, { status: 404 })
  }

  if (!isScheduleAccessible(existingSchedule, accessMaps)) {
    return NextResponse.json({ error: "Rotina nao encontrada" }, { status: 404 })
  }

  const reportConfigs = isUpdatingReportSelection
    ? resolveScheduleReportConfigs({
        report_configs: parsed.data.report_configs ?? existingSchedule.report_configs,
        report_id: parsed.data.report_id ?? existingSchedule.report_id,
        pbi_page_name:
          Object.prototype.hasOwnProperty.call(parsed.data, "pbi_page_name")
            ? parsed.data.pbi_page_name
            : existingSchedule.pbi_page_name,
        pbi_page_names:
          Object.prototype.hasOwnProperty.call(parsed.data, "pbi_page_names")
            ? parsed.data.pbi_page_names
            : existingSchedule.pbi_page_names,
      })
    : resolveScheduleReportConfigs(existingSchedule)
  const scheduleReportIds = getScheduleReportIds(reportConfigs)
  const effectiveExportFormat = parsed.data.export_format ?? existingSchedule.export_format
  const selectedBotInstance = await getCompanyWhatsAppBotInstance(
    supabase,
    companyId,
    parsed.data.bot_instance_id ?? existingSchedule.bot_instance_id
  ).catch((error) => {
    if (isMissingWhatsAppBotInstancesTableError(error)) {
      throw new Error(
        "O banco ainda nao suporta varios WhatsApps por empresa. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase."
      )
    }

    throw error
  })

  if (
    reportConfigs.length === 0
  ) {
    return NextResponse.json(
      {
        error: {
          report_configs: ["Selecione ao menos 1 relatorio."],
        },
      },
      { status: 400 }
    )
  }

  if (!hasAccessToScheduleReports(scheduleReportIds, accessMaps.visibleTargetIds)) {
    return getScheduleAccessErrorResponse()
  }

  if (
    effectiveExportFormat !== "PDF" &&
    (reportConfigs.length > 1 ||
      reportConfigs.some((reportConfig) => reportConfig.pbi_page_names.length > 1))
  ) {
    return NextResponse.json(
      {
        error: {
          report_configs: [
            "Selecione varios relatorios ou varias paginas apenas quando o formato de exportacao for PDF.",
          ],
        },
      },
      { status: 400 }
    )
  }

  if (!selectedBotInstance) {
    return NextResponse.json(
      {
        error: {
          bot_instance_id: ["Selecione um WhatsApp valido para esta rotina."],
        },
      },
      { status: 400 }
    )
  }

  if (normalizedContactIds !== undefined && normalizedContactIds.length > 0) {
    const { data: linkedContacts, error: contactsError } = await supabase
      .from("contacts")
      .select("id")
      .eq("company_id", companyId)
      .eq("bot_instance_id", selectedBotInstance.id)
      .in("id", normalizedContactIds)

    if (contactsError) {
      if (isMissingBotInstanceIdColumnError(contactsError, "contacts")) {
        return NextResponse.json(
          {
            error:
              "O banco ainda nao suporta contatos por numero de WhatsApp. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase.",
          },
          { status: 500 }
        )
      }

      return NextResponse.json({ error: contactsError.message }, { status: 500 })
    }

    if ((linkedContacts ?? []).length !== normalizedContactIds.length) {
      return NextResponse.json(
        {
          error: {
            contacts: ["Selecione apenas contatos do WhatsApp escolhido."],
          },
        },
        { status: 400 }
      )
    }
  }

  const scheduleUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  )

  scheduleUpdates.bot_instance_id = selectedBotInstance.id

  if (isUpdatingReportSelection) {
    const primaryReportConfig = getPrimaryScheduleReportConfig(reportConfigs)

    scheduleUpdates.report_id = primaryReportConfig?.report_id ?? null
    scheduleUpdates.pbi_page_name = primaryReportConfig?.pbi_page_name ?? null
    scheduleUpdates.pbi_page_names =
      primaryReportConfig && primaryReportConfig.pbi_page_names.length > 0
        ? primaryReportConfig.pbi_page_names
        : null
    scheduleUpdates.report_configs = reportConfigs
  }

  const updateSchedule = async (payload: Record<string, unknown>) =>
    supabase
      .from("schedules")
      .update(payload)
      .eq("company_id", companyId)
      .eq("id", id)
      .select()
      .single()

  let result = await updateSchedule({
    ...scheduleUpdates,
    updated_at: new Date().toISOString(),
  })

  if (result.error && isMissingSchedulesUpdatedAtColumn(result.error.message)) {
    result = await updateSchedule(scheduleUpdates)
  }

  if (result.error) {
    if (isMissingBotInstanceIdColumnError(result.error, "schedules")) {
      return NextResponse.json(
        {
          error:
            "O banco ainda nao suporta rotinas por numero de WhatsApp. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase.",
        },
        { status: 500 }
      )
    }

    if (isMissingScheduleReportConfigsColumn(result.error.message)) {
      return NextResponse.json(
        {
          error:
            "O banco ainda nao suporta varios relatorios por rotina. Execute a migration 20260328_schedule_report_configs.sql no Supabase.",
        },
        { status: 500 }
      )
    }

    if (isMissingSchedulePageNamesColumn(result.error.message)) {
      return NextResponse.json(
        {
          error:
            "O banco ainda nao suporta varias paginas por rotina. Execute a migration 20260324_schedule_page_names.sql no Supabase.",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ error: result.error.message }, { status: 500 })
  }

  if (normalizedContactIds !== undefined) {
    const { error: deleteContactsError } = await supabase
      .from("schedule_contacts")
      .delete()
      .eq("schedule_id", id)

    if (deleteContactsError) {
      return NextResponse.json({ error: deleteContactsError.message }, { status: 500 })
    }

    if (normalizedContactIds.length > 0) {
      const links = normalizedContactIds.map((cid) => ({
        schedule_id: id,
        contact_id: cid,
      }))

      const { error: insertContactsError } = await supabase
        .from("schedule_contacts")
        .insert(links)

      if (insertContactsError) {
        return NextResponse.json({ error: insertContactsError.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json(result.data)
}

export async function DELETE(request: NextRequest) {
  const context = await getRequestContext()
  const { companyId } = context
  const supabase = createClient()
  const scope = await getWorkspaceAccessScope(supabase, context)
  const accessMaps = await getScheduleAccessMaps(supabase, companyId, scope)
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
  }

  const { data: existingSchedule, error: existingScheduleError } = await supabase
    .from("schedules")
    .select("id, report_id, report_configs, pbi_page_name, pbi_page_names")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle()

  if (existingScheduleError) {
    return NextResponse.json({ error: existingScheduleError.message }, { status: 500 })
  }

  if (!existingSchedule || !isScheduleAccessible(existingSchedule, accessMaps)) {
    return NextResponse.json({ error: "Rotina nao encontrada" }, { status: 404 })
  }

  const { error } = await supabase
    .from("schedules")
    .delete()
    .eq("company_id", companyId)
    .eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
