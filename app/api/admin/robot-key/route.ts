// Chave do robo de relatorios de uma empresa (painel admin > Relatorios por
// Empresa > Robo). GET ?companyId= diz se existe; POST { companyId } gera uma
// nova, que aparece uma vez so. Ver lib/robot-key.ts.
import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAdminContext } from "@/lib/tenant"
import { createRobotKey, getRobotKeyInfo } from "@/lib/robot-key"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function checkAdmin() {
  try {
    await requireAdminContext()
    return null
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nao autorizado" }, { status: 401 })
  }
}

export async function GET(request: NextRequest) {
  const denied = await checkAdmin()
  if (denied) return denied

  const companyId = request.nextUrl.searchParams.get("companyId")?.trim() ?? ""
  if (!UUID.test(companyId)) {
    return NextResponse.json({ error: "companyId obrigatorio" }, { status: 400 })
  }

  return NextResponse.json(await getRobotKeyInfo(createServiceClient(), companyId))
}

export async function POST(request: NextRequest) {
  const denied = await checkAdmin()
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as { companyId?: unknown }
  const companyId = typeof body.companyId === "string" ? body.companyId.trim() : ""
  if (!UUID.test(companyId)) {
    return NextResponse.json({ error: "companyId obrigatorio" }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: company } = await supabase.from("companies").select("id").eq("id", companyId).maybeSingle()
  if (!company) {
    return NextResponse.json({ error: "Empresa nao encontrada" }, { status: 404 })
  }

  try {
    const created = await createRobotKey(supabase, companyId)
    return NextResponse.json(created, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao foi possivel gerar a chave" },
      { status: 500 }
    )
  }
}
