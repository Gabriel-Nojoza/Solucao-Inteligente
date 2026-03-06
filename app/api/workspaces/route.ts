import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = createClient()

  const { data: workspaces, error } = await supabase
    .from("workspaces")
    .select("*")
    .order("name")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get report counts
  const enriched = await Promise.all(
    (workspaces ?? []).map(async (ws) => {
      const { count } = await supabase
        .from("reports")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws.id)

      return { ...ws, report_count: count ?? 0 }
    })
  )

  return NextResponse.json(enriched)
}

export async function PUT(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()
  const { id, ...updates } = body

  if (!id) {
    return NextResponse.json({ error: "ID obrigatorio" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("workspaces")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
