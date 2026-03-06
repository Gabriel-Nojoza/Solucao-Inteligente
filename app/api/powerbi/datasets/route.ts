import { NextResponse } from "next/server"
import { getAccessToken, listDatasets } from "@/lib/powerbi"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get("workspaceId")

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId obrigatorio" },
        { status: 400 }
      )
    }

    const token = await getAccessToken()
    const datasets = await listDatasets(token, workspaceId)

    return NextResponse.json(datasets)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    )
  }
}
