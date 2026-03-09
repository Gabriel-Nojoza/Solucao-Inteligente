import { NextResponse } from "next/server"
import { getAccessToken, executeDAXQuery } from "@/lib/powerbi"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"

export async function POST(request: Request) {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createClient()
    const body = await request.json()
    const { datasetId, query } = body

    if (!datasetId || !query) {
      return NextResponse.json(
        { error: "datasetId e query sao obrigatorios" },
        { status: 400 }
      )
    }

    const { data: report } = await supabase
      .from("reports")
      .select("id")
      .eq("company_id", companyId)
      .eq("dataset_id", datasetId)
      .limit(1)
      .maybeSingle()

    if (!report) {
      return NextResponse.json(
        { error: "Dataset nao pertence a empresa do usuario" },
        { status: 403 }
      )
    }

    const token = await getAccessToken()
    const result = await executeDAXQuery(token, datasetId, query)

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    )
  }
}
