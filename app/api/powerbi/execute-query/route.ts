import { NextResponse } from "next/server"
import { getAccessToken, executeDAXQuery } from "@/lib/powerbi"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { datasetId, query } = body

    if (!datasetId || !query) {
      return NextResponse.json(
        { error: "datasetId e query sao obrigatorios" },
        { status: 400 }
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
