import { NextResponse } from "next/server"
import { getAccessToken, getDatasetMetadata } from "@/lib/powerbi"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const datasetId = searchParams.get("datasetId")

    if (!datasetId) {
      return NextResponse.json(
        { error: "datasetId obrigatorio" },
        { status: 400 }
      )
    }

    const token = await getAccessToken()
    const metadata = await getDatasetMetadata(token, datasetId)

    return NextResponse.json(metadata)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    )
  }
}
