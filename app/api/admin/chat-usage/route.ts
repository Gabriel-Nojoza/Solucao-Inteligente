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

export type ChatUsageRow = {
  companyId: string
  companyName: string
  mes: string
  perguntas: number
}

export type ChatUsageResponse = {
  rows: ChatUsageRow[]
  meses: string[]
}

export async function GET() {
  await requireAdminContext()

  const supabase = getAdminClient()

  const { data, error } = await supabase
    .from("chat_logs")
    .select("company_id, created_at, companies(name)")
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const map = new Map<string, ChatUsageRow>()

  for (const row of data ?? []) {
    const companyId = row.company_id as string
    const companyName = (row.companies as { name: string } | null)?.name ?? companyId
    const date = new Date(row.created_at as string)
    const mes = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
    const key = `${companyId}::${mes}`

    if (!map.has(key)) {
      map.set(key, { companyId, companyName, mes, perguntas: 0 })
    }
    map.get(key)!.perguntas++
  }

  const rows = Array.from(map.values()).sort((a, b) =>
    b.mes.localeCompare(a.mes) || a.companyName.localeCompare(b.companyName)
  )

  const meses = [...new Set(rows.map((r) => r.mes))].sort((a, b) => b.localeCompare(a))

  return NextResponse.json<ChatUsageResponse>({ rows, meses })
}
