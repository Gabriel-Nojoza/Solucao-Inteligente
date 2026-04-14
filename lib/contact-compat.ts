import type { SupabaseClient } from "@supabase/supabase-js"

type ContactLike = {
  id?: string
  name?: string | null
  phone?: string | null
  type?: string | null
  whatsapp_group_id?: string | null
  bot_instance_id?: string | null
  is_active?: boolean | null
}

type ContactWriteInput = {
  company_id?: string
  bot_instance_id?: string | null
  name: string
  phone?: string | null
  type: "individual" | "group"
  whatsapp_group_id?: string | null
  is_active?: boolean
  updated_at?: string
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message) {
      return message
    }
  }

  return ""
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null
}

export function isMissingWhatsappGroupIdColumnError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : ""
  const message = getErrorMessage(error).toLowerCase()

  return (
    code === "42703" ||
    message.includes("whatsapp_group_id") ||
    message.includes("contacts.whatsapp_group_id")
  )
}

export async function contactsSupportWhatsappGroupId(
  supabase: SupabaseClient
) {
  const { error } = await supabase.from("contacts").select("whatsapp_group_id").limit(1)

  if (!error) {
    return true
  }

  if (isMissingWhatsappGroupIdColumnError(error)) {
    return false
  }

  throw new Error(getErrorMessage(error) || "Erro ao validar schema de contatos")
}

export function getEffectiveWhatsAppGroupId(contact: ContactLike) {
  const explicitGroupId = normalizeString(contact.whatsapp_group_id)
  if (explicitGroupId) {
    return explicitGroupId
  }

  if (contact.type === "group") {
    return normalizeString(contact.phone)
  }

  return null
}

export function normalizeContactForResponse<T extends ContactLike>(contact: T) {
  const type = contact.type === "group" ? "group" : "individual"
  const whatsappGroupId = getEffectiveWhatsAppGroupId(contact)
  const phone = type === "group" ? null : normalizeString(contact.phone)

  return {
    ...contact,
    type,
    phone,
    whatsapp_group_id: whatsappGroupId,
    is_active: typeof contact.is_active === "boolean" ? contact.is_active : true,
  }
}

export function buildContactWritePayload(
  input: ContactWriteInput,
  supportsWhatsappGroupId: boolean
) {
  const payload: Record<string, unknown> = {
    name: input.name,
    type: input.type,
    is_active: input.is_active ?? true,
  }

  if (input.company_id) {
    payload.company_id = input.company_id
  }

  if (input.bot_instance_id !== undefined) {
    payload.bot_instance_id = normalizeString(input.bot_instance_id)
  }

  if (input.updated_at) {
    payload.updated_at = input.updated_at
  }

  if (input.type === "group") {
    const groupId = normalizeString(input.whatsapp_group_id)
    // Keep the group JID in `phone` too because some databases still enforce
    // NOT NULL on this column even when `whatsapp_group_id` exists.
    payload.phone = groupId
    if (supportsWhatsappGroupId) {
      payload.whatsapp_group_id = groupId
    }
    return payload
  }

  payload.phone = normalizeString(input.phone)
  if (supportsWhatsappGroupId) {
    payload.whatsapp_group_id = null
  }

  return payload
}
