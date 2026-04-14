import { NextResponse } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import { getRequestContext } from "@/lib/tenant"
import {
  createStoredAutomation,
  getStoredAutomationById,
  deleteStoredAutomation,
  isMissingAutomationRelationError,
  listStoredAutomationsWithContacts,
  updateStoredAutomation,
} from "@/lib/automation-storage"
import {
  getWorkspaceAccessScope,
  isDatasetAllowed,
  isWorkspaceAllowed,
} from "@/lib/workspace-access"

type AutomationRow = Record<string, unknown>
type NormalizedAutomationRow = AutomationRow & {
  selected_columns: unknown[]
  selected_measures: unknown[]
  filters: unknown[]
  dax_query: string | null
  cron_expression: string | null
  export_format: string
  message_template: string | null
  is_active: boolean
}

function isAutomationVisible(
  scope: {
    workspaceRestricted: boolean
    datasetRestricted: boolean
    workspaceIds: string[]
    pbiWorkspaceIds: string[]
    datasetIds: string[]
  },
  automation: {
    dataset_id?: unknown
    workspace_id?: unknown
  }
) {
  const datasetId =
    typeof automation.dataset_id === "string" && automation.dataset_id.trim()
      ? automation.dataset_id
      : null
  const workspaceId =
    typeof automation.workspace_id === "string" && automation.workspace_id.trim()
      ? automation.workspace_id
      : null

  return (
    isDatasetAllowed(scope, datasetId) &&
    isWorkspaceAllowed(scope, { workspaceId })
  )
}

const OPTIONAL_AUTOMATION_COLUMNS = new Set([
  "workspace_id",
  "selected_columns",
  "selected_measures",
  "filters",
  "dax_query",
  "cron_expression",
  "export_format",
  "message_template",
])

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>
    if (typeof record.message === "string" && record.message) {
      return record.message
    }
    if (typeof record.error === "string" && record.error) {
      return record.error
    }
    if (typeof record.details === "string" && record.details) {
      return record.details
    }
  }

  return "Erro desconhecido"
}

function extractMissingColumnName(message: string) {
  const schemaCacheMatch = message.match(/Could not find the '([^']+)' column/i)
  if (schemaCacheMatch?.[1]) return schemaCacheMatch[1]

  const relationMatch = message.match(/column "([^"]+)" of relation/i)
  if (relationMatch?.[1]) return relationMatch[1]

  return null
}

function isInvalidExportFormatError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes("export_format") && normalized.includes("invalid input value")
}

function getExportFormatCandidates(value: string) {
  const candidates = [value]
  if (value.toLowerCase() !== value) candidates.push(value.toLowerCase())
  if (value.toUpperCase() !== value) candidates.push(value.toUpperCase())
  return [...new Set(candidates.filter(Boolean))]
}

function normalizeAutomationRecord(automation: AutomationRow): NormalizedAutomationRow {
  return {
    ...automation,
    selected_columns: Array.isArray(automation.selected_columns) ? automation.selected_columns : [],
    selected_measures: Array.isArray(automation.selected_measures) ? automation.selected_measures : [],
    filters: Array.isArray(automation.filters) ? automation.filters : [],
    dax_query: typeof automation.dax_query === "string" ? automation.dax_query : null,
    cron_expression:
      typeof automation.cron_expression === "string" && automation.cron_expression.trim()
        ? automation.cron_expression
        : null,
    export_format:
      typeof automation.export_format === "string" && automation.export_format.trim()
        ? automation.export_format.toLowerCase()
        : "csv",
    message_template:
      typeof automation.message_template === "string" ? automation.message_template : null,
    is_active: typeof automation.is_active === "boolean" ? automation.is_active : true,
  }
}

async function insertAutomationWithFallback(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>
): Promise<NormalizedAutomationRow> {
  let currentPayload = { ...payload }
  let exportFormatVariants = (() => {
    const current = typeof payload.export_format === "string" ? payload.export_format : ""
    return getExportFormatCandidates(current)
  })()

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data, error } = await supabase
      .from("automations")
      .insert(currentPayload)
      .select()
      .single()

    if (!error && data) {
      return normalizeAutomationRecord(data as AutomationRow)
    }

    const message = getErrorMessage(error)
    const missingColumn = extractMissingColumnName(message)

    if (
      missingColumn &&
      OPTIONAL_AUTOMATION_COLUMNS.has(missingColumn) &&
      Object.prototype.hasOwnProperty.call(currentPayload, missingColumn)
    ) {
      const nextPayload = { ...currentPayload }
      delete nextPayload[missingColumn]
      currentPayload = nextPayload
      continue
    }

    if (isInvalidExportFormatError(message) && Object.prototype.hasOwnProperty.call(currentPayload, "export_format")) {
      const currentValue =
        typeof currentPayload.export_format === "string" ? currentPayload.export_format : ""
      const nextVariant = exportFormatVariants.find((variant) => variant !== currentValue)

      if (nextVariant) {
        currentPayload = { ...currentPayload, export_format: nextVariant }
        exportFormatVariants = exportFormatVariants.filter((variant) => variant !== nextVariant)
        continue
      }

      const nextPayload = { ...currentPayload }
      delete nextPayload.export_format
      currentPayload = nextPayload
      continue
    }

    throw new Error(message)
  }

  throw new Error("Nao foi possivel salvar a automacao com o schema atual do banco")
}

export async function GET() {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)

    if (scope.datasetRestricted && scope.datasetIds.length === 0) {
      return NextResponse.json([])
    }

    const { data, error } = await supabase
      .from("automations")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })

    if (error) {
      if (isMissingAutomationRelationError(error)) {
        const storedAutomations = await listStoredAutomationsWithContacts(supabase, companyId)
        return NextResponse.json(
          storedAutomations.filter((automation) => isAutomationVisible(scope, automation))
        )
      }

      throw error
    }

    const visibleAutomations = (data || []).filter((automation) =>
      isAutomationVisible(scope, automation)
    )

    // Fetch contacts for each automation
    const automationsWithContacts = await Promise.all(
      visibleAutomations.map(async (automation) => {
        const { data: contactData, error: contactsError } = await supabase
          .from("automation_contacts")
          .select("contact_id, contacts(*)")
          .eq("automation_id", automation.id)

        if (contactsError && !isMissingAutomationRelationError(contactsError)) {
          throw contactsError
        }

        return {
          ...normalizeAutomationRecord(automation as AutomationRow),
          contacts:
            contactsError && isMissingAutomationRelationError(contactsError)
              ? []
              : contactData?.map((ac: Record<string, unknown>) => ac.contacts) || [],
        }
      })
    )

    return NextResponse.json(automationsWithContacts)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)
    const body = await request.json()

    const {
      name,
      dataset_id,
      workspace_id,
      selected_columns,
      selected_measures,
      filters,
      dax_query,
      cron_expression,
      export_format,
      message_template,
      contact_ids,
    } = body

    if (!name || !dataset_id) {
      return NextResponse.json(
        { error: "name e dataset_id sao obrigatorios" },
        { status: 400 }
      )
    }

    if (!isDatasetAllowed(scope, String(dataset_id))) {
      return NextResponse.json(
        { error: "Dataset nao permitido para este usuario." },
        { status: 403 }
      )
    }

    if (
      workspace_id &&
      !isWorkspaceAllowed(scope, { workspaceId: String(workspace_id) })
    ) {
      return NextResponse.json(
        { error: "Workspace nao permitido para este usuario." },
        { status: 403 }
      )
    }

    let data: NormalizedAutomationRow | Awaited<ReturnType<typeof createStoredAutomation>>

    try {
      data = await insertAutomationWithFallback(supabase, {
        company_id: companyId,
        name,
        dataset_id,
        workspace_id: workspace_id || null,
        selected_columns: selected_columns || [],
        selected_measures: selected_measures || [],
        filters: filters || [],
        dax_query: dax_query || null,
        cron_expression: cron_expression || null,
        export_format: export_format || "csv",
        message_template: message_template || null,
      })
    } catch (error) {
      if (!isMissingAutomationRelationError(error)) {
        throw error
      }

      data = await createStoredAutomation(supabase, companyId, {
        name,
        dataset_id,
        workspace_id: workspace_id || null,
        selected_columns: selected_columns || [],
        selected_measures: selected_measures || [],
        filters: filters || [],
        dax_query: dax_query || null,
        cron_expression: cron_expression || null,
        export_format: export_format || "csv",
        message_template: message_template || null,
        contact_ids: Array.isArray(contact_ids) ? contact_ids : [],
      })
    }

    // Link contacts
    if (contact_ids && contact_ids.length > 0 && data) {
      const links = contact_ids.map((cid: string) => ({
        automation_id: data.id,
        contact_id: cid,
      }))
      const { error: contactsError } = await supabase.from("automation_contacts").insert(links)
      if (contactsError && !isMissingAutomationRelationError(contactsError)) {
        throw contactsError
      }
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("Error creating automation:", error)
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)
    const body = await request.json()
    const { id, contact_ids, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: "id obrigatorio" }, { status: 400 })
    }

    const nextDatasetId =
      typeof updates.dataset_id === "string" ? updates.dataset_id.trim() : ""
    const nextWorkspaceId =
      typeof updates.workspace_id === "string" ? updates.workspace_id.trim() : ""

    if (nextDatasetId && !isDatasetAllowed(scope, nextDatasetId)) {
      return NextResponse.json(
        { error: "Dataset nao permitido para este usuario." },
        { status: 403 }
      )
    }

    if (nextWorkspaceId && !isWorkspaceAllowed(scope, { workspaceId: nextWorkspaceId })) {
      return NextResponse.json(
        { error: "Workspace nao permitido para este usuario." },
        { status: 403 }
      )
    }

    let data: Record<string, unknown> | null = null
    let usingStoredAutomation = false

    const { data: existingAutomation, error: existingAutomationError } = await supabase
      .from("automations")
      .select("id, dataset_id, workspace_id")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle()

    if (existingAutomationError && !isMissingAutomationRelationError(existingAutomationError)) {
      throw existingAutomationError
    }

    if (existingAutomation) {
      if (
        !isDatasetAllowed(scope, String(existingAutomation.dataset_id ?? "")) ||
        !isWorkspaceAllowed(scope, {
          workspaceId: typeof existingAutomation.workspace_id === "string"
            ? existingAutomation.workspace_id
            : null,
        })
      ) {
        return NextResponse.json(
          { error: "Automacao nao permitida para este usuario." },
          { status: 403 }
        )
      }
    }

    const { data: dbData, error } = await supabase
      .from("automations")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", id)
      .select()
      .single()

    if (error) {
      if (!isMissingAutomationRelationError(error)) {
        throw error
      }

      usingStoredAutomation = true
      const storedAutomation = await getStoredAutomationById(supabase, companyId, id)
      if (!storedAutomation) {
        return NextResponse.json({ error: "Automacao nao encontrada" }, { status: 404 })
      }

      if (
        !isDatasetAllowed(scope, storedAutomation.dataset_id) ||
        !isWorkspaceAllowed(scope, { workspaceId: storedAutomation.workspace_id })
      ) {
        return NextResponse.json(
          { error: "Automacao nao permitida para este usuario." },
          { status: 403 }
        )
      }

      data = (await updateStoredAutomation(supabase, companyId, id, {
        ...updates,
        ...(contact_ids !== undefined ? { contact_ids } : {}),
      })) as Record<string, unknown> | null

      if (!data) {
        return NextResponse.json({ error: "Automacao nao encontrada" }, { status: 404 })
      }
    } else {
      data = dbData as Record<string, unknown>
    }

    // Update contacts if provided
    if (!usingStoredAutomation && contact_ids !== undefined && data) {
      const { error: deleteContactsError } = await supabase
        .from("automation_contacts")
        .delete()
        .eq("automation_id", id)

      if (deleteContactsError && !isMissingAutomationRelationError(deleteContactsError)) {
        throw deleteContactsError
      }

      if (contact_ids.length > 0) {
        const links = contact_ids.map((cid: string) => ({
          automation_id: id,
          contact_id: cid,
        }))
        const { error: insertContactsError } = await supabase.from("automation_contacts").insert(links)
        if (insertContactsError && !isMissingAutomationRelationError(insertContactsError)) {
          throw insertContactsError
        }
      }
    }

    return NextResponse.json(normalizeAutomationRecord(data as AutomationRow))
  } catch (error) {
    console.error("Error updating automation:", error)
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await getRequestContext()
    const { companyId } = context
    const supabase = createClient()
    const scope = await getWorkspaceAccessScope(supabase, context)
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "id obrigatorio" }, { status: 400 })
    }

    const { data: existingAutomation, error: existingAutomationError } = await supabase
      .from("automations")
      .select("id, dataset_id, workspace_id")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle()

    if (existingAutomationError && !isMissingAutomationRelationError(existingAutomationError)) {
      throw existingAutomationError
    }

    if (existingAutomation) {
      if (
        !isDatasetAllowed(scope, String(existingAutomation.dataset_id ?? "")) ||
        !isWorkspaceAllowed(scope, {
          workspaceId: typeof existingAutomation.workspace_id === "string"
            ? existingAutomation.workspace_id
            : null,
        })
      ) {
        return NextResponse.json(
          { error: "Automacao nao permitida para este usuario." },
          { status: 403 }
        )
      }
    }

    const { error } = await supabase.from("automations").delete().eq("company_id", companyId).eq("id", id)
    if (error) {
      if (!isMissingAutomationRelationError(error)) {
        throw error
      }

      const storedAutomation = await getStoredAutomationById(supabase, companyId, id)
      if (!storedAutomation) {
        return NextResponse.json({ error: "Automacao nao encontrada" }, { status: 404 })
      }

      if (
        !isDatasetAllowed(scope, storedAutomation.dataset_id) ||
        !isWorkspaceAllowed(scope, { workspaceId: storedAutomation.workspace_id })
      ) {
        return NextResponse.json(
          { error: "Automacao nao permitida para este usuario." },
          { status: 403 }
        )
      }

      const deleted = await deleteStoredAutomation(supabase, companyId, id)
      if (!deleted) {
        return NextResponse.json({ error: "Automacao nao encontrada" }, { status: 404 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting automation:", error)
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    )
  }
}
