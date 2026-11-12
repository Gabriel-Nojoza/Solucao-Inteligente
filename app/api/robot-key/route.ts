// Chave do robo de relatorios (Admin > Configuracoes). GET diz se existe; POST
// gera uma nova, que aparece uma vez so. Ver lib/robot-key.ts.
import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAdminContext } from "@/lib/tenant"
import { createRobotKey, getRobotKeyInfo } from "@/lib/robot-key"

export async function GET() {
  let companyId: string
  try {
    ;({ companyId } = await requireAdminContext())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nao autorizado" }, { status: 401 })
  }

  return NextResponse.json(await getRobotKeyInfo(createServiceClient(), companyId))
}

export async function POST() {
  let companyId: string
  try {
    ;({ companyId } = await requireAdminContext())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nao autorizado" }, { status: 401 })
  }

  try {
    const created = await createRobotKey(createServiceClient(), companyId)
    return NextResponse.json(created, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao foi possivel gerar a chave" },
      { status: 500 }
    )
  }
}
