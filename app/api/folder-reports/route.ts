// Lista as pastas que o robo ja enviou, com o ultimo arquivo de cada formato.
// Usado na tela de rotinas, no campo "Imagem automatica do robo". Sem robo
// instalado, a lista vem vazia e o campo nem aparece.
import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"
import { listFolderReportFolders } from "@/lib/folder-reports-server"

export async function GET() {
  try {
    const { companyId } = await getRequestContext()
    const supabase = createServiceClient()

    const folders = await listFolderReportFolders(supabase, companyId)
    return NextResponse.json(folders)
  } catch (error) {
    if (isAuthContextError(error)) {
      return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao listar os relatorios da pasta" },
      { status: 500 }
    )
  }
}
