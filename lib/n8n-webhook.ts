type N8nSettingsRecord = {
  webhook_url?: string | null
  callback_secret?: string | null
}

type DispatchTargetInput = {
  name?: string | null
  phone?: string | null
  type?: string | null
  whatsapp_group_id?: string | null
}

export function normalizeN8nSettings(value: unknown) {
  const settings =
    value && typeof value === "object" ? (value as N8nSettingsRecord) : {}

  return {
    webhookUrl:
      typeof settings.webhook_url === "string" ? settings.webhook_url.trim() : "",
    callbackSecret:
      typeof settings.callback_secret === "string"
        ? settings.callback_secret.trim()
        : "",
  }
}

export function buildN8nCallbackHeaders(callbackSecret: string) {
  return {
    "x-callback-secret": callbackSecret,
  }
}

export function buildN8nEndpointUrls(appUrl: string) {
  const normalizedAppUrl = appUrl.trim().replace(/\/+$/, "")

  return {
    callbackUrl: `${normalizedAppUrl}/api/webhook/n8n-callback`,
    botSendUrl: `${normalizedAppUrl}/api/bot/send`,
  }
}

export function buildDispatchTargets<T extends DispatchTargetInput>(
  contacts: T[],
  dispatchLogIds: string[]
) {
  return contacts.map((contact, index) => ({
    dispatch_log_id: dispatchLogIds[index] ?? null,
    name: contact.name ?? null,
    phone: contact.phone ?? null,
    type: contact.type ?? null,
    whatsapp_group_id: contact.whatsapp_group_id ?? null,
  }))
}
