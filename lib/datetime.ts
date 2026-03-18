const APP_LOCALE = "pt-BR"
const APP_TIME_ZONE = "America/Sao_Paulo"

const dateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: APP_TIME_ZONE,
})

const dateTimeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIME_ZONE,
})

const shortDateTimeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIME_ZONE,
})

function normalizeDate(value: string | number | Date) {
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDatePtBr(value: string | number | Date) {
  const parsed = normalizeDate(value)
  return parsed ? dateFormatter.format(parsed) : "-"
}

export function formatDateTimePtBr(value: string | number | Date) {
  const parsed = normalizeDate(value)
  return parsed ? dateTimeFormatter.format(parsed) : "-"
}

export function formatShortDateTimePtBr(value: string | number | Date) {
  const parsed = normalizeDate(value)
  return parsed ? shortDateTimeFormatter.format(parsed) : "-"
}
