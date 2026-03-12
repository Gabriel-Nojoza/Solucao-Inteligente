import type { SupabaseClient } from "@supabase/supabase-js"
import type { Automation, Contact, QueryFilter, SelectedColumn, SelectedMeasure } from "@/lib/types"
import { normalizeContactForResponse } from "@/lib/contact-compat"

const AUTOMATIONS_SETTINGS_KEY = "saved_automations"

export type StoredAutomation = Automation & {
  contact_ids: string[]
}

type StoredAutomationValue = {
  items?: unknown
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>
    if (typeof record.message === "string" && record.message) {
      return record.message
    }
  }

  return "Erro desconhecido"
}

export function isMissingAutomationRelationError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : ""
  const message = getErrorMessage(error).toLowerCase()

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("public.automations") ||
    message.includes("automation_contacts") ||
    message.includes("relation \"automations\"") ||
    message.includes("relation \"automation_contacts\"")
  )
}

function normalizeSelectedColumns(input: unknown): SelectedColumn[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const tableName = typeof record.tableName === "string" ? record.tableName.trim() : ""
    const columnName = typeof record.columnName === "string" ? record.columnName.trim() : ""
    return tableName && columnName ? [{ tableName, columnName }] : []
  })
}

function normalizeSelectedMeasures(input: unknown): SelectedMeasure[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const tableName = typeof record.tableName === "string" ? record.tableName.trim() : ""
    const measureName = typeof record.measureName === "string" ? record.measureName.trim() : ""
    return tableName && measureName ? [{ tableName, measureName }] : []
  })
}

function normalizeFilters(input: unknown): QueryFilter[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const tableName = typeof record.tableName === "string" ? record.tableName.trim() : ""
    const columnName = typeof record.columnName === "string" ? record.columnName.trim() : ""
    if (!tableName || !columnName) return []

    const operator =
      record.operator === "neq" ||
      record.operator === "gt" ||
      record.operator === "lt" ||
      record.operator === "gte" ||
      record.operator === "lte" ||
      record.operator === "contains" ||
      record.operator === "startswith"
        ? record.operator
        : "eq"

    return [
      {
        id:
          typeof record.id === "string" && record.id.trim()
            ? record.id.trim()
            : crypto.randomUUID(),
        tableName,
        columnName,
        operator,
        value: typeof record.value === "string" ? record.value : "",
        valueTo: typeof record.valueTo === "string" ? record.valueTo : undefined,
        dataType: typeof record.dataType === "string" ? record.dataType : "String",
      },
    ]
  })
}

function normalizeContactIds(input: unknown) {
  if (!Array.isArray(input)) return []

  return Array.from(
    new Set(
      input
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  )
}

function normalizeExportFormat(value: unknown): Automation["export_format"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (normalized === "table" || normalized === "csv" || normalized === "pdf") {
    return normalized
  }
  return "csv"
}

function normalizeStoredAutomation(input: unknown): StoredAutomation | null {
  if (!input || typeof input !== "object") return null

  const record = input as Record<string, unknown>
  const id = typeof record.id === "string" ? record.id.trim() : ""
  const name = typeof record.name === "string" ? record.name.trim() : ""
  const datasetId = typeof record.dataset_id === "string" ? record.dataset_id.trim() : ""

  if (!id || !name || !datasetId) {
    return null
  }

  const createdAt =
    typeof record.created_at === "string" && record.created_at.trim()
      ? record.created_at
      : new Date().toISOString()
  const updatedAt =
    typeof record.updated_at === "string" && record.updated_at.trim()
      ? record.updated_at
      : createdAt

  return {
    id,
    name,
    dataset_id: datasetId,
    workspace_id:
      typeof record.workspace_id === "string" && record.workspace_id.trim()
        ? record.workspace_id
        : null,
    selected_columns: normalizeSelectedColumns(record.selected_columns),
    selected_measures: normalizeSelectedMeasures(record.selected_measures),
    filters: normalizeFilters(record.filters),
    dax_query:
      typeof record.dax_query === "string" && record.dax_query.trim()
        ? record.dax_query
        : null,
    cron_expression:
      typeof record.cron_expression === "string" && record.cron_expression.trim()
        ? record.cron_expression
        : null,
    export_format: normalizeExportFormat(record.export_format),
    message_template:
      typeof record.message_template === "string" ? record.message_template : null,
    is_active: typeof record.is_active === "boolean" ? record.is_active : true,
    last_run_at:
      typeof record.last_run_at === "string" && record.last_run_at.trim()
        ? record.last_run_at
        : null,
    created_at: createdAt,
    updated_at: updatedAt,
    contact_ids: normalizeContactIds(record.contact_ids),
  }
}

function parseStoredAutomations(value: unknown): StoredAutomation[] {
  const items: unknown[] =
    Array.isArray(value)
      ? value
      : value && typeof value === "object" && Array.isArray((value as StoredAutomationValue).items)
        ? ((value as StoredAutomationValue).items as unknown[])
        : []

  return items
    .map((item: unknown) => normalizeStoredAutomation(item))
    .filter((item: StoredAutomation | null): item is StoredAutomation => item !== null)
    .sort((a: StoredAutomation, b: StoredAutomation) => (a.created_at < b.created_at ? 1 : -1))
}

async function persistStoredAutomations(
  supabase: SupabaseClient,
  companyId: string,
  automations: StoredAutomation[]
) {
  const { error } = await supabase.from("company_settings").upsert(
    {
      company_id: companyId,
      key: AUTOMATIONS_SETTINGS_KEY,
      value: { items: automations },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id,key" }
  )

  if (error) {
    throw new Error(error.message)
  }
}

export async function loadStoredAutomations(
  supabase: SupabaseClient,
  companyId: string
) {
  const { data, error } = await supabase
    .from("company_settings")
    .select("value")
    .eq("company_id", companyId)
    .eq("key", AUTOMATIONS_SETTINGS_KEY)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return parseStoredAutomations(data?.value)
}

export async function listContactsByIds(
  supabase: SupabaseClient,
  companyId: string,
  contactIds: string[]
) {
  const normalizedIds = normalizeContactIds(contactIds)
  if (normalizedIds.length === 0) return []

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("company_id", companyId)
    .in("id", normalizedIds)

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((contact) => normalizeContactForResponse(contact as Contact)) as Contact[]
}

export async function listStoredAutomationsWithContacts(
  supabase: SupabaseClient,
  companyId: string
) {
  const automations = await loadStoredAutomations(supabase, companyId)
  const contacts = await listContactsByIds(
    supabase,
    companyId,
    automations.flatMap((automation: StoredAutomation) => automation.contact_ids)
  )
  const contactMap = new Map(contacts.map((contact) => [contact.id, contact]))

  return automations.map((automation: StoredAutomation) => ({
    ...automation,
    contacts: automation.contact_ids
      .map((contactId: string) => contactMap.get(contactId))
      .filter((contact: Contact | undefined): contact is Contact => Boolean(contact)),
  }))
}

export async function getStoredAutomationById(
  supabase: SupabaseClient,
  companyId: string,
  automationId: string
) {
  const automations = await loadStoredAutomations(supabase, companyId)
  return automations.find((automation: StoredAutomation) => automation.id === automationId) ?? null
}

export async function createStoredAutomation(
  supabase: SupabaseClient,
  companyId: string,
  payload: Partial<StoredAutomation> & {
    name: string
    dataset_id: string
    contact_ids?: string[]
  }
) {
  const current = await loadStoredAutomations(supabase, companyId)
  const now = new Date().toISOString()

  const automation = normalizeStoredAutomation({
    ...payload,
    id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
    is_active: true,
    last_run_at: null,
  })

  if (!automation) {
    throw new Error("Dados invalidos para salvar o relatorio")
  }

  await persistStoredAutomations(supabase, companyId, [automation, ...current])
  return automation
}

export async function updateStoredAutomation(
  supabase: SupabaseClient,
  companyId: string,
  automationId: string,
  updates: Partial<StoredAutomation>
) {
  const current = await loadStoredAutomations(supabase, companyId)
  const index = current.findIndex((automation: StoredAutomation) => automation.id === automationId)

  if (index === -1) {
    return null
  }

  const existing = current[index]
  const merged = normalizeStoredAutomation({
    ...existing,
    ...updates,
    id: existing.id,
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  })

  if (!merged) {
    throw new Error("Dados invalidos para atualizar o relatorio")
  }

  const next = [...current]
  next[index] = merged
  await persistStoredAutomations(supabase, companyId, next)
  return merged
}

export async function deleteStoredAutomation(
  supabase: SupabaseClient,
  companyId: string,
  automationId: string
) {
  const current = await loadStoredAutomations(supabase, companyId)
  const next = current.filter((automation: StoredAutomation) => automation.id !== automationId)

  if (next.length === current.length) {
    return false
  }

  await persistStoredAutomations(supabase, companyId, next)
  return true
}

export async function touchStoredAutomationLastRunAt(
  supabase: SupabaseClient,
  companyId: string,
  automationId: string,
  lastRunAt: string
) {
  const updated = await updateStoredAutomation(supabase, companyId, automationId, {
    last_run_at: lastRunAt,
  })

  if (!updated) {
    throw new Error("Relatorio salvo nao encontrado")
  }
}
