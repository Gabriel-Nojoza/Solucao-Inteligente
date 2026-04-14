type DispatchLogLike = {
  status?: unknown
  error_message?: unknown
  created_at?: unknown
  started_at?: unknown
  completed_at?: unknown
}

export type DispatchLogOutcome = "delivered" | "failed" | "ongoing"
type DispatchLogOutcomeLike = DispatchLogLike & {
  outcome?: unknown
}

export type DispatchLogBadgeStatus = {
  label: string
  variant: "default" | "secondary" | "destructive" | "outline"
  className?: string
}

function toValidDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function getDispatchLogEffectiveDate(log: DispatchLogLike) {
  return (
    toValidDate(log.created_at) ??
    toValidDate(log.started_at) ??
    toValidDate(log.completed_at)
  )
}

export function getDispatchLogOutcome(log: DispatchLogLike) {
  const status = typeof log.status === "string" ? log.status.trim().toLowerCase() : ""
  const hasError =
    typeof log.error_message === "string" && log.error_message.trim().length > 0
  const completedAt = toValidDate(log.completed_at)

  if (status === "delivered") {
    return "delivered" as const
  }

  if (status === "failed" || hasError) {
    return "failed" as const
  }

  if (completedAt) {
    return "delivered" as const
  }

  return "ongoing" as const
}

export function countDispatchLogOutcomes(logs: DispatchLogOutcomeLike[]) {
  return logs.reduce(
    (counts, log) => {
      const outcome =
        log.outcome === "delivered" ||
        log.outcome === "failed" ||
        log.outcome === "ongoing"
          ? log.outcome
          : getDispatchLogOutcome(log)
      counts[outcome] += 1
      return counts
    },
    {
      delivered: 0,
      failed: 0,
      ongoing: 0,
    } as Record<DispatchLogOutcome, number>
  )
}

const dispatchLogStatusConfig: Record<string, DispatchLogBadgeStatus> = {
  pending: {
    label: "Em andamento",
    variant: "outline",
    className: "border-warning/40 bg-warning/10 text-warning",
  },
  exporting: {
    label: "Em andamento",
    variant: "outline",
    className: "border-warning/40 bg-warning/10 text-warning",
  },
  sending: {
    label: "Em andamento",
    variant: "outline",
    className: "border-warning/40 bg-warning/10 text-warning",
  },
  delivered: {
    label: "Enviado",
    variant: "outline",
    className: "border-success/30 bg-success/10 text-success",
  },
  failed: {
    label: "Erro",
    variant: "outline",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
}

export function getDispatchLogDisplayStatus(log: DispatchLogLike): DispatchLogBadgeStatus {
  const outcome = getDispatchLogOutcome(log)

  if (outcome === "delivered") {
    return dispatchLogStatusConfig.delivered
  }

  if (outcome === "failed") {
    return dispatchLogStatusConfig.failed
  }

  const status = typeof log.status === "string" ? log.status.trim().toLowerCase() : ""

  return dispatchLogStatusConfig[status] ?? dispatchLogStatusConfig.pending
}
