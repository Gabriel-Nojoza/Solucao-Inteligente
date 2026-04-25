import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminContext } from "@/lib/tenant"

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: NextRequest) {
  try {
    await requireAdminContext()
    const supabase = getAdminClient()

    const body = await request.json() as { sourceCompanyId?: string; targetCompanyId?: string }
    const sourceId = String(body.sourceCompanyId ?? "").trim()
    const targetId = String(body.targetCompanyId ?? "").trim()

    if (!sourceId || !targetId) {
      return NextResponse.json({ error: "Empresa de origem e destino sao obrigatorias" }, { status: 400 })
    }

    if (sourceId === targetId) {
      return NextResponse.json({ error: "Origem e destino nao podem ser a mesma empresa" }, { status: 400 })
    }

    // Verifica se as empresas existem
    const { data: companies, error: companiesError } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", [sourceId, targetId])

    if (companiesError) throw companiesError

    const source = companies?.find((c) => c.id === sourceId)
    const target = companies?.find((c) => c.id === targetId)

    if (!source) return NextResponse.json({ error: "Empresa de origem nao encontrada" }, { status: 404 })
    if (!target) return NextResponse.json({ error: "Empresa de destino nao encontrada" }, { status: 404 })

    // Busca workspaces da origem
    const { data: sourceWorkspaces, error: wsError } = await supabase
      .from("workspaces")
      .select("*")
      .eq("company_id", sourceId)
      .eq("is_active", true)

    if (wsError) throw wsError
    if (!sourceWorkspaces || sourceWorkspaces.length === 0) {
      return NextResponse.json({ error: "Nenhum workspace encontrado na empresa de origem" }, { status: 404 })
    }

    // Busca relatórios da origem
    const { data: sourceReports, error: rpError } = await supabase
      .from("reports")
      .select("*")
      .eq("company_id", sourceId)
      .eq("is_active", true)

    if (rpError) throw rpError

    // Mapa: workspace_id antigo → novo id
    const workspaceIdMap = new Map<string, string>()
    let copiedWorkspaces = 0
    let copiedReports = 0

    // Copia workspaces para a empresa destino (evita duplicar pelo pbi_workspace_id)
    for (const ws of sourceWorkspaces) {
      const { id: _oldId, created_at: _ca, updated_at: _ua, ...wsData } = ws

      // Se já existe workspace com mesmo pbi_workspace_id na empresa destino, reutiliza
      const { data: existing } = await supabase
        .from("workspaces")
        .select("id")
        .eq("company_id", targetId)
        .eq("pbi_workspace_id", ws.pbi_workspace_id)
        .maybeSingle()

      let newWorkspaceId: string

      if (existing?.id) {
        newWorkspaceId = existing.id
      } else {
        const { data: inserted, error: insertWsError } = await supabase
          .from("workspaces")
          .insert({ ...wsData, company_id: targetId })
          .select("id")
          .single()

        if (insertWsError) throw insertWsError
        newWorkspaceId = inserted.id
        copiedWorkspaces++
      }

      workspaceIdMap.set(ws.id, newWorkspaceId)
    }

    // Copia relatórios para a empresa destino (evita duplicar pelo pbi_report_id)
    for (const report of sourceReports ?? []) {
      const { id: _oldId, created_at: _ca, synced_at: _sa, ...reportData } = report

      const newWorkspaceId = workspaceIdMap.get(report.workspace_id)
      if (!newWorkspaceId) continue

      // Se já existe relatório com mesmo pbi_report_id na empresa destino, pula
      const { data: existing } = await supabase
        .from("reports")
        .select("id")
        .eq("company_id", targetId)
        .eq("pbi_report_id", report.pbi_report_id)
        .maybeSingle()

      if (existing?.id) continue

      const { error: insertRpError } = await supabase
        .from("reports")
        .insert({ ...reportData, company_id: targetId, workspace_id: newWorkspaceId })

      if (insertRpError) throw insertRpError
      copiedReports++
    }

    return NextResponse.json({
      success: true,
      sourceName: source.name,
      targetName: target.name,
      copiedWorkspaces,
      copiedReports,
    })
  } catch (error) {
    console.error("Erro ao transferir relatorios:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao transferir relatorios" },
      { status: 500 }
    )
  }
}
