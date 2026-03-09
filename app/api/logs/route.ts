import { NextRequest, NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const { searchParams } = new URL(request.url)

    const status = searchParams.get("status")
    const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10)
    const rawOffset = parseInt(searchParams.get("offset") ?? "0", 10)

    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 200)
      : 50
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0

    const buildQuery = (orderColumn: "created_at" | "id") => {
      let query = supabase
        .from("dispatch_logs")
        .select("*", { count: "exact" })
        .eq("company_id", companyId)
        .order(orderColumn, { ascending: false })
        .range(offset, offset + limit - 1)

      if (status && status !== "all") {
        query = query.eq("status", status)
      }

      return query
    }

    let { data, error, count } = await buildQuery("created_at")

    // Fallback for projects where dispatch_logs has no created_at column.
    if (error?.code === "42703") {
      ;({ data, error, count } = await buildQuery("id"))
    }

    if (error) {
      console.error("GET /api/logs Supabase error:", error)
      return NextResponse.json(
        { error: "Erro ao buscar logs no banco de dados." },
        { status: 500 }
      )
    }

    return NextResponse.json({ data: data ?? [], count: count ?? 0 })
  } catch (error) {
    console.error("GET /api/logs unexpected error:", error)
    return NextResponse.json(
      { error: "Erro interno inesperado ao buscar logs." },
      { status: 500 }
    )
  }
}
