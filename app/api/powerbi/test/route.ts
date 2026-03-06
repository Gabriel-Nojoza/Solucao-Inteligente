import { NextResponse } from "next/server"
import { getAccessToken } from "@/lib/powerbi"

export async function POST() {
  try {
    const token = await getAccessToken()
    if (token) {
      return NextResponse.json({ success: true, message: "Conexao com Power BI estabelecida com sucesso!" })
    }
    return NextResponse.json({ success: false, message: "Nao foi possivel obter o token" }, { status: 500 })
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Erro de conexao" },
      { status: 500 }
    )
  }
}
