type TimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

const WEEKDAY_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

const WEEKDAY_LABELS: Record<number, string> = {
  0: "Dom",
  1: "Seg",
  2: "Ter",
  3: "Qua",
  4: "Qui",
  5: "Sex",
  6: "Sab",
}

const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

function getFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  })
}

export function getTimePartsInTimeZone(date: Date, timeZone: string): TimeParts {
  const parts = getFormatter(timeZone).formatToParts(date)
  const map = new Map(parts.map((part) => [part.type, part.value]))
  const weekdayLabel = (map.get("weekday") || "").toLowerCase()

  return {
    year: Number(map.get("year") || 0),
    month: Number(map.get("month") || 0),
    day: Number(map.get("day") || 0),
    hour: Number(map.get("hour") || 0),
    minute: Number(map.get("minute") || 0),
    weekday: WEEKDAY_MAP[weekdayLabel] ?? 0,
  }
}

export function splitCronExpressions(cronValue: string) {
  return cronValue
    .split(/\r?\n/)
    .map((expression) => expression.trim())
    .filter(Boolean)
}

function normalizeCronValue(value: string, field: "month" | "weekday" | "default") {
  const normalized = value.trim().toLowerCase()

  if (field === "weekday") {
    if (normalized in WEEKDAY_MAP) {
      return WEEKDAY_MAP[normalized]
    }
    const numeric = Number(normalized)
    if (Number.isInteger(numeric)) {
      return numeric === 7 ? 0 : numeric
    }
    return Number.NaN
  }

  if (field === "month") {
    const months = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ]
    const monthIndex = months.indexOf(normalized)
    if (monthIndex >= 0) {
      return monthIndex + 1
    }
  }

  return Number(normalized)
}

function expandSegment(
  segment: string,
  min: number,
  max: number,
  field: "month" | "weekday" | "default"
) {
  const trimmed = segment.trim()
  if (!trimmed) return []

  const [base, stepText] = trimmed.split("/")
  const step = stepText ? Number(stepText) : 1
  if (!Number.isInteger(step) || step <= 0) {
    return []
  }

  let rangeStart = min
  let rangeEnd = max

  if (base !== "*") {
    const [startText, endText] = base.split("-")
    const parsedStart = normalizeCronValue(startText, field)
    const parsedEnd =
      typeof endText === "string" ? normalizeCronValue(endText, field) : parsedStart

    if (!Number.isInteger(parsedStart) || !Number.isInteger(parsedEnd)) {
      return []
    }

    rangeStart = parsedStart
    rangeEnd = parsedEnd
  }

  if (rangeEnd < rangeStart) {
    return []
  }

  const values: number[] = []
  for (let value = rangeStart; value <= rangeEnd; value += step) {
    const normalizedValue = field === "weekday" && value === 7 ? 0 : value
    if (normalizedValue >= min && normalizedValue <= max) {
      values.push(normalizedValue)
    }
  }

  return values
}

function fieldMatches(
  expression: string,
  value: number,
  min: number,
  max: number,
  field: "month" | "weekday" | "default" = "default"
) {
  const normalized = expression.trim()
  if (normalized === "*") {
    return true
  }

  const values = normalized
    .split(",")
    .flatMap((segment) => expandSegment(segment, min, max, field))

  if (values.length === 0) {
    return false
  }

  if (field === "weekday" && value === 0) {
    return values.includes(0) || values.includes(7)
  }

  return values.includes(value)
}

export function isValidCronExpression(cronExpression: string) {
  return cronExpression.trim().split(/\s+/).length === 5
}

export function isValidCronValue(cronValue: string) {
  const expressions = splitCronExpressions(cronValue)
  return expressions.length > 0 && expressions.every((expression) => isValidCronExpression(expression))
}

export function matchesCronExpression(
  cronExpression: string,
  date: Date,
  timeZone: string
) {
  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) {
    return false
  }

  const [minuteExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = parts
  const current = getTimePartsInTimeZone(date, timeZone)

  return (
    fieldMatches(minuteExpr, current.minute, 0, 59) &&
    fieldMatches(hourExpr, current.hour, 0, 23) &&
    fieldMatches(dayExpr, current.day, 1, 31) &&
    fieldMatches(monthExpr, current.month, 1, 12, "month") &&
    fieldMatches(weekdayExpr, current.weekday, 0, 6, "weekday")
  )
}

export function matchesCronValue(
  cronValue: string,
  date: Date,
  timeZone: string
) {
  const expressions = splitCronExpressions(cronValue)

  return expressions.some((expression) => matchesCronExpression(expression, date, timeZone))
}

export function extractHoursFromCronValue(cronValue: string) {
  const hours = new Set<number>()

  for (const expression of splitCronExpressions(cronValue)) {
    const parts = expression.trim().split(/\s+/)

    if (parts.length !== 5) {
      continue
    }

    const hourPart = parts[1]?.trim()

    if (!hourPart) {
      continue
    }

    if (
      hourPart.includes(",") ||
      hourPart.includes("-") ||
      hourPart.includes("/") ||
      hourPart === "*"
    ) {
      continue
    }

    const hour = Number(hourPart)

    if (!Number.isNaN(hour) && hour >= 0 && hour <= 23) {
      hours.add(hour)
    }
  }

  return [...hours]
}

export function describeCronExpression(cronExpression: string) {
  const parts = cronExpression.trim().split(/\s+/)

  if (parts.length !== 5) {
    return cronExpression
  }

  const [minuteExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = parts
  const minute = Number(minuteExpr)
  const hour = Number(hourExpr)

  if (Number.isNaN(minute) || Number.isNaN(hour)) {
    return cronExpression
  }

  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`

  if (dayExpr === "*" && monthExpr === "*" && weekdayExpr === "*") {
    return `Todos os dias às ${time}`
  }

  if (dayExpr === "*" && monthExpr === "*" && weekdayExpr !== "*") {
    const labels = WEEKDAY_DISPLAY_ORDER.filter((weekday) =>
      fieldMatches(weekdayExpr, weekday, 0, 6, "weekday")
    )
      .map((weekday) => WEEKDAY_LABELS[weekday])
      .filter(Boolean)
      .join(", ")

    return `${labels || "Semanal"} às ${time}`
  }

  if (dayExpr !== "*" && monthExpr === "*" && weekdayExpr === "*") {
    return `Dia ${dayExpr} de cada mes às ${time}`
  }

  return cronExpression
}

export function describeCronValue(cronValue: string) {
  return splitCronExpressions(cronValue).map((expression) => describeCronExpression(expression))
}

export function isSameMinuteInTimeZone(
  firstDate: Date,
  secondDate: Date,
  timeZone: string
) {
  const first = getTimePartsInTimeZone(firstDate, timeZone)
  const second = getTimePartsInTimeZone(secondDate, timeZone)

  return (
    first.year === second.year &&
    first.month === second.month &&
    first.day === second.day &&
    first.hour === second.hour &&
    first.minute === second.minute
  )
}
