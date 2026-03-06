import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { z } from "zod"

const scheduleSchema = z.object({
  name: z.string().min(1),
  report_id: z.string().uuid(),
  cron_expression: z.string().min(1),
  export_format: z.enum(["PDF", "PNG", "PPTX"]).default("PDF"),
  message_template: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  contact_ids: z.array(z.string().uuid()).optional(),
})

export async function GET() {
  const supabase = createClient()

  const { data: schedules, error } = await supabase
    .from("schedules")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Enrich with report names and contacts
  const enriched = await Promise.all(
    (schedules ?? []).map(async (schedule) => {
      const { data: report } = await supabase
        .from("reports")
        .select("name")
        .eq("id", schedule.report_id)
        .single()

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
          .in("id", contactIds)
        contacts = data ?? []
      }

      return {
        ...schedule,
        report_name: report?.name ?? "Desconhecido",
        contacts,
      }
    })
  )

  return NextResponse.json(enriched)
}

export async function POST(request: NextRequest) {
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
    .insert(scheduleData)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Link contacts
  if (contact_ids && contact_ids.length > 0) {
    const links = contact_ids.map((cid) => ({
      schedule_id: schedule.id,
      contact_id: cid,
    }))
    await supabase.from("schedule_contacts").insert(links)
  }

  return NextResponse.json(schedule, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()
  const { id, contact_ids, ...updates } = body

  if (!id) {
    return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("schedules")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Update contacts if provided
  if (contact_ids !== undefined) {
    await supabase
      .from("schedule_contacts")
      .delete()
      .eq("schedule_id", id)

    if (contact_ids.length > 0) {
      const links = contact_ids.map((cid: string) => ({
        schedule_id: id,
        contact_id: cid,
      }))
      await supabase.from("schedule_contacts").insert(links)
    }
  }

  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
  }

  const { error } = await supabase.from("schedules").delete().eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
