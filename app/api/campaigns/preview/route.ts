import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"
import { getAccessToken, executeDAXQuery } from "@/lib/powerbi"

function normalizePhone(raw: unknown): string | null {
  if (!raw) return null
  const phone = String(raw).replace(/\D/g, "")
  return phone.length >= 8 ? phone : null
}

function buildPreviewDaxQuery(
  customerTable: string,
  dateColumn: string | null,
  daysInactive: number | null,
  nameColumn: string,
  phoneColumn: string
): string {
  const addCols = `  "nome", '${customerTable}'[${nameColumn}],\n  "telefone", '${customerTable}'[${phoneColumn}]`
  if (dateColumn && daysInactive) {
    return [
      "EVALUATE",
      "ADDCOLUMNS(",
      "  FILTER(",
      `    '${customerTable}',`,
      `    NOT ISBLANK('${customerTable}'[${dateColumn}])`,
      `      && DATEDIFF('${customerTable}'[${dateColumn}], TODAY(), DAY) >= ${daysInactive}`,
      "  ),",
      addCols,
      ")",
    ].join("\n")
  }
  return [
    "EVALUATE",
    "ADDCOLUMNS(",
    `  '${customerTable}',`,
    addCols,
    ")",
  ].join("\n")
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getRequestContext()

    const { data: featuresRow } = await createServiceClient()
      .from("company_settings")
      .select("value")
      .eq("company_id", ctx.companyId)
      .eq("key", "features")
      .maybeSingle()

    const features = (featuresRow?.value ?? {}) as Record<string, unknown>
    if (features.campaign_client_preview !== true) {
      return NextResponse.json({ error: "Funcionalidade nao habilitada" }, { status: 403 })
    }

    const body = await request.json()
    const { dataset_id, customer_table, date_column, days_inactive, name_column, phone_column } = body

    if (!dataset_id || !customer_table || !name_column || !phone_column) {
      return NextResponse.json({ error: "Campos obrigatorios ausentes" }, { status: 400 })
    }

    const daysNum = days_inactive ? Number(days_inactive) : null
    if (daysNum !== null && (isNaN(daysNum) || daysNum <= 0)) {
      return NextResponse.json({ error: "days_inactive invalido" }, { status: 400 })
    }

    const daxQuery = buildPreviewDaxQuery(customer_table, date_column ?? null, daysNum, name_column, phone_column)
    const token = await getAccessToken(ctx.companyId)
    const result = await executeDAXQuery(token, dataset_id, daxQuery)
    const rows = result.rows ?? []

    const clients = rows.map((row) => ({
      name: row["nome"] != null ? String(row["nome"]) : null,
      phone: normalizePhone(row["telefone"]),
      data: row,
    }))

    return NextResponse.json({ clients, total: clients.length })
  } catch (error) {
    if (isAuthContextError(error)) {
      return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
    }
    const message = error instanceof Error ? error.message : "Erro ao buscar clientes"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
