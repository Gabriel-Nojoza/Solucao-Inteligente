const DAY_IN_MS = 24 * 60 * 60 * 1000

export type DispatchSettingsRecord = {
  enabled?: boolean
  trial_days?: number | string | null
  trial_started_at?: string | null
  trial_ends_at?: string | null
}

export type NormalizedDispatchSettings = {
  enabled: boolean
  trialDays: number | null
  trialStartedAt: string
  trialEndsAt: string
  isExpired: boolean
  effectiveEnabled: boolean
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function normalizeDispatchTrialDays(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return null
}

export function calculateDispatchTrialEndsAt(trialDays: number, now = new Date()) {
  return new Date(now.getTime() + trialDays * DAY_IN_MS).toISOString()
}

export function normalizeDispatchSettings(
  value: unknown,
  now = new Date()
): NormalizedDispatchSettings {
  const settings =
    value && typeof value === "object" ? (value as DispatchSettingsRecord) : {}

  const trialEndsAt = normalizeString(settings.trial_ends_at)
  const trialEndsAtMs = trialEndsAt ? Date.parse(trialEndsAt) : Number.NaN
  const isExpired = Number.isFinite(trialEndsAtMs) && trialEndsAtMs <= now.getTime()
  const enabled = settings.enabled === true

  return {
    enabled,
    trialDays: normalizeDispatchTrialDays(settings.trial_days),
    trialStartedAt: normalizeString(settings.trial_started_at),
    trialEndsAt,
    isExpired,
    effectiveEnabled: enabled && !isExpired,
  }
}

export function buildDispatchSettingsValue(
  input: unknown,
  existing?: unknown,
  now = new Date()
) {
  const next =
    input && typeof input === "object" ? (input as DispatchSettingsRecord) : {}
  const current =
    existing && typeof existing === "object"
      ? (existing as DispatchSettingsRecord)
      : {}

  const hasEnabled = Object.prototype.hasOwnProperty.call(next, "enabled")
  const hasTrialDays = Object.prototype.hasOwnProperty.call(next, "trial_days")

  const trialDays = hasTrialDays
    ? normalizeDispatchTrialDays(next.trial_days)
    : normalizeDispatchTrialDays(current.trial_days)

  let trialStartedAt = ""
  let trialEndsAt = ""

  if (trialDays) {
    const currentTrialDays = normalizeDispatchTrialDays(current.trial_days)
    const currentTrialStartedAt = normalizeString(current.trial_started_at)
    const currentTrialEndsAt = normalizeString(current.trial_ends_at)

    if (currentTrialDays === trialDays && currentTrialEndsAt) {
      trialStartedAt = currentTrialStartedAt || now.toISOString()
      trialEndsAt = currentTrialEndsAt
    } else {
      trialStartedAt = now.toISOString()
      trialEndsAt = calculateDispatchTrialEndsAt(trialDays, now)
    }
  }

  return {
    enabled: hasEnabled ? next.enabled === true : current.enabled === true,
    trial_days: trialDays,
    trial_started_at: trialStartedAt,
    trial_ends_at: trialEndsAt,
  }
}
