import { NextResponse } from "next/server"
import { requireAdminContext } from "@/lib/tenant"
import { listDatasets, listWorkspaces } from "@/lib/powerbi"

async function getPowerBIAccessToken(config: {
  tenant_id: string
  client_id: string
  client_secret: string
}) {
  const tokenUrl = `https://login.microsoftonline.com/${config.tenant_id}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.client_id,
    client_secret: config.client_secret,
    scope: "https://analysis.windows.net/powerbi/api/.default",
  })

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Falha ao obter token Power BI: ${err}`)
  }

  const json = await res.json()
  return String(json.access_token ?? "")
}

export async function POST(request: Request) {
  try {
    await requireAdminContext()
    const body = await request.json()
    const tenantId = String(body?.tenant_id ?? "").trim()
    const clientId = String(body?.client_id ?? "").trim()
    const clientSecret = String(body?.client_secret ?? "").trim()

    if (!tenantId || !clientId || !clientSecret) {
      return NextResponse.json(
        { error: "tenant_id, client_id e client_secret sao obrigatorios" },
        { status: 400 }
      )
    }

    const token = await getPowerBIAccessToken({
      tenant_id: tenantId,
      client_id: clientId,
      client_secret: clientSecret,
    })

    const workspaces = await listWorkspaces(token)
    const workspaceSummaries = await Promise.all(
      workspaces.map(async (ws) => {
        try {
          const datasets = await listDatasets(token, ws.id)
          return {
            id: ws.id,
            name: ws.name,
            dataset_count: datasets.length,
            datasets: datasets.map((dataset) => ({
              id: String(dataset.id ?? ""),
              name: String(dataset.name ?? ""),
            })),
          }
        } catch {
          return {
            id: ws.id,
            name: ws.name,
            dataset_count: 0,
            datasets: [],
          }
        }
      })
    )

    const totalDatasets = workspaceSummaries.reduce(
      (total, ws) => total + ws.dataset_count,
      0
    )

    return NextResponse.json({
      success: true,
      workspace_count: workspaceSummaries.length,
      dataset_count: totalDatasets,
      workspaces: workspaceSummaries,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao validar credenciais" },
      { status: 500 }
    )
  }
}
