const DAY_IN_MS = 24 * 60 * 60 * 1000

export type ChatIASettingsRecord = {
  enabled?: boolean
  workspace_id?: string | null
  dataset_id?: string | null
  dataset_name?: string | null
  webhook_url?: string | null
  trial_days?: number | string | null
  trial_started_at?: string | null
  trial_ends_at?: string | null
}

export type NormalizedChatIASettings = {
  enabled: boolean
  workspaceId: string
  datasetId: string
  datasetName: string
  webhookUrl: string
  trialDays: number | null
  trialStartedAt: string
  trialEndsAt: string
  isExpired: boolean
  effectiveEnabled: boolean
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function normalizeChatIATrialDays(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }

  return null
}

export function calculateChatIATrialEndsAt(trialDays: number, now = new Date()) {
  return new Date(now.getTime() + trialDays * DAY_IN_MS).toISOString()
}

export function normalizeChatIASettings(
  value: unknown,
  now = new Date()
): NormalizedChatIASettings {
  const settings =
    value && typeof value === "object" ? (value as ChatIASettingsRecord) : {}

  const trialEndsAt = normalizeString(settings.trial_ends_at)
  const trialEndsAtMs = trialEndsAt ? Date.parse(trialEndsAt) : Number.NaN
  const isExpired = Number.isFinite(trialEndsAtMs) && trialEndsAtMs <= now.getTime()
  const enabled = settings.enabled === true

  return {
    enabled,
    workspaceId: normalizeString(settings.workspace_id),
    datasetId: normalizeString(settings.dataset_id),
    datasetName: normalizeString(settings.dataset_name),
    webhookUrl: normalizeString(settings.webhook_url),
    trialDays: normalizeChatIATrialDays(settings.trial_days),
    trialStartedAt: normalizeString(settings.trial_started_at),
    trialEndsAt,
    isExpired,
    effectiveEnabled: enabled && !isExpired,
  }
}

export function buildChatIASettingsValue(
  input: unknown,
  existing?: unknown,
  now = new Date()
) {
  const next =
    input && typeof input === "object" ? (input as ChatIASettingsRecord) : {}
  const current =
    existing && typeof existing === "object"
      ? (existing as ChatIASettingsRecord)
      : {}

  const hasEnabled = Object.prototype.hasOwnProperty.call(next, "enabled")
  const hasWorkspaceId = Object.prototype.hasOwnProperty.call(next, "workspace_id")
  const hasDatasetId = Object.prototype.hasOwnProperty.call(next, "dataset_id")
  const hasDatasetName = Object.prototype.hasOwnProperty.call(next, "dataset_name")
  const hasWebhookUrl = Object.prototype.hasOwnProperty.call(next, "webhook_url")
  const hasTrialDays = Object.prototype.hasOwnProperty.call(next, "trial_days")

  const trialDays = hasTrialDays
    ? normalizeChatIATrialDays(next.trial_days)
    : normalizeChatIATrialDays(current.trial_days)
  let trialStartedAt = ""
  let trialEndsAt = ""

  if (trialDays) {
    const currentTrialDays = normalizeChatIATrialDays(current.trial_days)
    const currentTrialStartedAt = normalizeString(current.trial_started_at)
    const currentTrialEndsAt = normalizeString(current.trial_ends_at)

    if (currentTrialDays === trialDays && currentTrialEndsAt) {
      trialStartedAt = currentTrialStartedAt || now.toISOString()
      trialEndsAt = currentTrialEndsAt
    } else {
      trialStartedAt = now.toISOString()
      trialEndsAt = calculateChatIATrialEndsAt(trialDays, now)
    }
  }

  return {
    enabled: hasEnabled ? next.enabled === true : current.enabled === true,
    workspace_id: hasWorkspaceId
      ? normalizeString(next.workspace_id)
      : normalizeString(current.workspace_id),
    dataset_id: hasDatasetId
      ? normalizeString(next.dataset_id)
      : normalizeString(current.dataset_id),
    dataset_name: hasDatasetName
      ? normalizeString(next.dataset_name)
      : normalizeString(current.dataset_name),
    webhook_url: hasWebhookUrl
      ? normalizeString(next.webhook_url)
      : normalizeString(current.webhook_url),
    trial_days: trialDays,
    trial_started_at: trialStartedAt,
    trial_ends_at: trialEndsAt,
  }
}

export function buildDisabledExpiredChatIASettingsValue(value: unknown) {
  const normalized = normalizeChatIASettings(value)

  return {
    enabled: false,
    workspace_id: normalized.workspaceId,
    dataset_id: normalized.datasetId,
    dataset_name: normalized.datasetName,
    webhook_url: normalized.webhookUrl,
    trial_days: normalized.trialDays,
    trial_started_at: normalized.trialStartedAt,
    trial_ends_at: normalized.trialEndsAt,
  }
}
