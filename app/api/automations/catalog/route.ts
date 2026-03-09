import { NextRequest, NextResponse } from "next/server"
import { getRequestContext } from "@/lib/tenant"
import { getCatalogMap, isValidCatalog, saveCatalogEntry } from "@/lib/automation-catalog"

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await getRequestContext()
    const { searchParams } = new URL(request.url)
    const datasetId = searchParams.get("datasetId")

    if (!datasetId) {
      return NextResponse.json(
        { error: "datasetId obrigatorio" },
        { status: 400 }
      )
    }

    const catalogs = await getCatalogMap(companyId)
    const entry = catalogs[datasetId]

    if (!entry || !isValidCatalog(entry.catalog)) {
      return NextResponse.json({ catalog: null, updated_at: null })
    }

    return NextResponse.json({
      catalog: entry.catalog,
      updated_at: entry.updated_at ?? null,
      workspace_id: entry.workspace_id ?? null,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar catalogo" },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { companyId } = await getRequestContext()
    const body = await request.json()
    const datasetId = String(body?.datasetId ?? "").trim()
    const workspaceId = String(body?.workspaceId ?? "").trim()
    const catalog = body?.catalog

    if (!datasetId) {
      return NextResponse.json(
        { error: "datasetId obrigatorio" },
        { status: 400 }
      )
    }

    if (!isValidCatalog(catalog)) {
      return NextResponse.json(
        { error: "catalog invalido: esperado { tables: [], columns: [], measures: [] }" },
        { status: 400 }
      )
    }

    const catalogs = await saveCatalogEntry(companyId, datasetId, {
      workspace_id: workspaceId || null,
      updated_at: new Date().toISOString(),
      catalog,
    })

    return NextResponse.json({ success: true, catalog: catalogs[datasetId] })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar catalogo" },
      { status: 500 }
    )
  }
}
