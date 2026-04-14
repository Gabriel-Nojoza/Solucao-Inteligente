import type { SupabaseClient } from "@supabase/supabase-js"
import {
  readWhatsAppBotRuntimeState,
  type WhatsAppBotRuntimeState,
} from "@/lib/whatsapp-bot"

export type WhatsAppBotInstanceRecord = {
  id: string
  company_id: string
  name: string
  manual_qr_code_url?: string | null
  is_default?: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

export type WhatsAppBotInstanceWithRuntime = WhatsAppBotInstanceRecord &
  WhatsAppBotRuntimeState & {
    qr_code_url: string
    manual_qr_code_url: string
    runtime_qr_code_url: string
    source: "runtime" | "manual" | "none"
  }

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return ""
}

export function isMissingWhatsAppBotInstancesTableError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase()
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : ""

  return (
    code === "42P01" ||
    message.includes("whatsapp_bot_instances") ||
    message.includes("relation \"public.whatsapp_bot_instances\" does not exist")
  )
}

export function isMissingBotInstanceIdColumnError(
  error: unknown,
  tableName: "contacts" | "schedules"
) {
  const message = getErrorMessage(error).toLowerCase()
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : ""

  return (
    code === "42703" ||
    (message.includes("bot_instance_id") && message.includes(tableName))
  )
}

export function normalizeBotInstanceForResponse(
  instance: WhatsAppBotInstanceRecord,
  runtimeState: WhatsAppBotRuntimeState | null
): WhatsAppBotInstanceWithRuntime {
  const manualQrCodeUrl =
    typeof instance.manual_qr_code_url === "string" ? instance.manual_qr_code_url.trim() : ""
  const runtimeQrCodeUrl = runtimeState?.qr_code_data_url ?? ""

  return {
    ...instance,
    manual_qr_code_url: manualQrCodeUrl,
    qr_code_data_url: runtimeQrCodeUrl,
    qr_code_url: runtimeQrCodeUrl || manualQrCodeUrl,
    runtime_qr_code_url: runtimeQrCodeUrl,
    updated_at: runtimeState?.updated_at ?? instance.updated_at ?? null,
    connected_at: runtimeState?.connected_at ?? null,
    status: runtimeState?.status ?? "offline",
    last_error: runtimeState?.last_error ?? null,
    phone_number: runtimeState?.phone_number ?? null,
    display_name: runtimeState?.display_name ?? null,
    jid: runtimeState?.jid ?? null,
    source: runtimeQrCodeUrl ? "runtime" : manualQrCodeUrl ? "manual" : "none",
  }
}

export async function listCompanyWhatsAppBotInstances(
  supabase: SupabaseClient,
  companyId: string
): Promise<WhatsAppBotInstanceWithRuntime[]> {
  const { data, error } = await supabase
    .from("whatsapp_bot_instances")
    .select("*")
    .eq("company_id", companyId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })

  if (error) {
    if (isMissingWhatsAppBotInstancesTableError(error)) {
      throw new Error(
        "O banco ainda nao suporta varios WhatsApps por empresa. Execute a migration 20260328_whatsapp_bot_instances.sql no Supabase."
      )
    }

    throw new Error(getErrorMessage(error) || "Erro ao listar instancias de WhatsApp")
  }

  const instances = (data ?? []) as WhatsAppBotInstanceRecord[]

  const runtimeEntries = await Promise.all(
    instances.map(async (instance) => {
      const runtimeState = await readWhatsAppBotRuntimeState(instance.id).catch(() => null)
      return normalizeBotInstanceForResponse(instance, runtimeState)
    })
  )

  return runtimeEntries
}

export async function getCompanyWhatsAppBotInstance(
  supabase: SupabaseClient,
  companyId: string,
  instanceId?: string | null
): Promise<WhatsAppBotInstanceWithRuntime | null> {
  const instances = await listCompanyWhatsAppBotInstances(supabase, companyId)

  if (instances.length === 0) {
    return null
  }

  if (instanceId) {
    return instances.find((instance) => instance.id === instanceId) ?? null
  }

  return instances.find((instance) => instance.is_default) ?? instances[0]
}
