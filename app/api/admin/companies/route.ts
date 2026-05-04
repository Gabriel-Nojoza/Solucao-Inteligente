import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminContext } from "@/lib/tenant"

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export type CompanyListItem = { id: string; name: string }

export async function GET() {
  const context = await requireAdminContext()
  const supabase = getAdminClient()

  const query = supabase.from("companies").select("id, name").order("name")
  if (!context.isPlatformAdmin) {
    query.eq("id", context.companyId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}
