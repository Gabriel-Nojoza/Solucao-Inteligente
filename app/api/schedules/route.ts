import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"
import {
  isMissingAutomationRelationError,
  loadStoredAutomations,
} from "@/lib/automation-storage"

function isMissingSchedulesUpdatedAtColumn(message?: string | null) {
  return (
    typeof message === "string" &&
    message.includes("updated_at") &&
    message.includes("schedules")
  )
}

const nullableTrimmedString = z.preprocess((value) => {
  if (typeof value !== "string") return value

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}, z.string().min(1).nullable().optional())

const scheduleSchema = z.object({
  name: z.string().min(1),
  report_id: z.string().uuid(),
  pbi_page_name: nullableTrimmedString,
  cron_expression: z.string().min(1),
  export_format: z
    .enum(["PDF", "PNG", "PPTX", "table", "csv", "pdf"])
    .default("PDF"),
  message_template: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  contact_ids: z.array(z.string().uuid()).optional(),
})

const scheduleUpdateSchema = scheduleSchema.partial().extend({
  id: z.string().uuid(),
})

export async function GET() {
  const { companyId } = await getRequestContext()
  const supabase = createClient()

  const { data: schedules, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const reportIds = Array.from(
    new Set((schedules ?? []).map((schedule) => schedule.report_id).filter(Boolean))
  )

  let reportMap = new Map<string, string>()
  if (reportIds.length > 0) {
    const { data: reports } = await supabase
      .from("reports")
      .select("id, name")
      .eq("company_id", companyId)
      .in("id", reportIds)

    reportMap = new Map((reports ?? []).map((report) => [report.id, report.name]))
  }

  let automationMap = new Map<string, string>()
  if (reportIds.length > 0) {
    const { data: automations, error: automationsError } = await supabase
      .from("automations")
      .select("id, name")
      .eq("company_id", companyId)
      .in("id", reportIds)

    if (automationsError) {
      if (!isMissingAutomationRelationError(automationsError)) {
        return NextResponse.json({ error: automationsError.message }, { status: 500 })
      }

      const storedAutomations = await loadStoredAutomations(supabase, companyId)
      automationMap = new Map(
        storedAutomations
          .filter((automation) => reportIds.includes(automation.id))
          .map((automation) => [automation.id, automation.name])
      )
    } else {
      automationMap = new Map(
        (automations ?? []).map((automation) => [automation.id, automation.name])
      )
    }
  }

  const enriched = await Promise.all(
    (schedules ?? []).map(async (schedule) => {
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

      return {
        ...schedule,
        report_name:
          reportMap.get(schedule.report_id) ??
          automationMap.get(schedule.report_id) ??
          "Desconhecido",
        report_source: reportMap.has(schedule.report_id)
          ? "powerbi"
          : automationMap.has(schedule.report_id)
            ? "created"
            : "unknown",
        contacts,
      }
    })
  )

  return NextResponse.json(enriched)
}

export async function POST(request: NextRequest) {
  const { companyId } = await getRequestContext()
  const supabase = createClient()
  const body = await request.json()
  const parsed = scheduleSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { contact_ids, ...scheduleData } = parsed.data

  const { data: schedule, error } = await supabase
    .from("schedules")
    .insert({ ...scheduleData, company_id: companyId })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (contact_ids && contact_ids.length > 0) {
    const links = contact_ids.map((cid) => ({
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
  const { companyId } = await getRequestContext()
  const supabase = createClient()
  const body = await request.json()
  const parsed = scheduleUpdateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { id, contact_ids, ...updates } = parsed.data

  const scheduleUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  )

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
    return NextResponse.json({ error: result.error.message }, { status: 500 })
  }

  if (contact_ids !== undefined) {
    const { error: deleteContactsError } = await supabase
      .from("schedule_contacts")
      .delete()
      .eq("schedule_id", id)

    if (deleteContactsError) {
      return NextResponse.json({ error: deleteContactsError.message }, { status: 500 })
    }

    if (contact_ids.length > 0) {
      const links = contact_ids.map((cid) => ({
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
  const { companyId } = await getRequestContext()
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
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
