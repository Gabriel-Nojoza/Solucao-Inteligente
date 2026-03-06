import { NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("automations")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) throw error

    // Fetch contacts for each automation
    const automationsWithContacts = await Promise.all(
      (data || []).map(async (automation) => {
        const { data: contactData } = await supabase
          .from("automation_contacts")
          .select("contact_id, contacts(*)")
          .eq("automation_id", automation.id)

        return {
          ...automation,
          contacts: contactData?.map((ac: Record<string, unknown>) => ac.contacts) || [],
        }
      })
    )

    return NextResponse.json(automationsWithContacts)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createClient()
    const body = await request.json()

    const {
      name,
      dataset_id,
      workspace_id,
      selected_columns,
      selected_measures,
      filters,
      dax_query,
      cron_expression,
      export_format,
      message_template,
      contact_ids,
    } = body

    if (!name || !dataset_id) {
      return NextResponse.json(
        { error: "name e dataset_id sao obrigatorios" },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from("automations")
      .insert({
        name,
        dataset_id,
        workspace_id: workspace_id || null,
        selected_columns: selected_columns || [],
        selected_measures: selected_measures || [],
        filters: filters || [],
        dax_query: dax_query || null,
        cron_expression: cron_expression || null,
        export_format: export_format || "table",
        message_template: message_template || null,
      })
      .select()
      .single()

    if (error) throw error

    // Link contacts
    if (contact_ids && contact_ids.length > 0 && data) {
      const links = contact_ids.map((cid: string) => ({
        automation_id: data.id,
        contact_id: cid,
      }))
      await supabase.from("automation_contacts").insert(links)
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createClient()
    const body = await request.json()
    const { id, contact_ids, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: "id obrigatorio" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("automations")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    // Update contacts if provided
    if (contact_ids !== undefined && data) {
      await supabase
        .from("automation_contacts")
        .delete()
        .eq("automation_id", id)

      if (contact_ids.length > 0) {
        const links = contact_ids.map((cid: string) => ({
          automation_id: id,
          contact_id: cid,
        }))
        await supabase.from("automation_contacts").insert(links)
      }
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "id obrigatorio" }, { status: 400 })
    }

    const { error } = await supabase.from("automations").delete().eq("id", id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    )
  }
}
