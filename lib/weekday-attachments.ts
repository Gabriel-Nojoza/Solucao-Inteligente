// Anexos por dia da semana (chave "Por dia da semana" no campo Anexos da rotina).
// Cada dia (0 = domingo ... 6 = sabado) tem as suas imagens/PDFs. Em cada horario
// da rotina vao os anexos do dia, toda semana, ate o usuario remover.
// Este arquivo nao acessa banco: e usado na tela, na API e no disparo.

export const WEEKDAY_ATTACHMENT_DAYS = [
  { day: 1, short: "Seg", long: "segunda-feira" },
  { day: 2, short: "Ter", long: "terca-feira" },
  { day: 3, short: "Qua", long: "quarta-feira" },
  { day: 4, short: "Qui", long: "quinta-feira" },
  { day: 5, short: "Sex", long: "sexta-feira" },
  { day: 6, short: "Sab", long: "sabado" },
  { day: 0, short: "Dom", long: "domingo" },
] as const

export const MAX_ATTACHMENTS_PER_DAY = 10

export type WeekdayAttachments = {
  enabled: boolean
  // chave "0".."6" -> links dos anexos daquele dia
  days: Record<string, string[]>
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value.trim())
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

// Le o que esta salvo na rotina (jsonb) e descarta o que nao faz sentido.
export function normalizeWeekdayAttachments(value: unknown): WeekdayAttachments | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const rawDays = record.days && typeof record.days === "object" && !Array.isArray(record.days)
    ? (record.days as Record<string, unknown>)
    : {}

  const days: Record<string, string[]> = {}
  for (const { day } of WEEKDAY_ATTACHMENT_DAYS) {
    const list = rawDays[String(day)]
    if (!Array.isArray(list)) continue
    const urls = [...new Set(list.filter(isHttpUrl).map((url) => url.trim()))].slice(0, MAX_ATTACHMENTS_PER_DAY)
    if (urls.length > 0) days[String(day)] = urls
  }

  return { enabled: record.enabled === true, days }
}

export function countWeekdayAttachments(value: WeekdayAttachments | null) {
  if (!value) return 0
  return Object.values(value.days).reduce((total, urls) => total + urls.length, 0)
}

// Tem anexo valendo? So conta com a chave ligada.
export function hasActiveWeekdayAttachments(value: WeekdayAttachments | null) {
  return value?.enabled === true && countWeekdayAttachments(value) > 0
}

export function getAttachmentsForWeekday(value: WeekdayAttachments | null, weekday: number) {
  return value?.days[String(weekday)] ?? []
}

export function getWeekdayLongName(weekday: number) {
  return WEEKDAY_ATTACHMENT_DAYS.find((item) => item.day === weekday)?.long ?? "hoje"
}

// Anexo da rotina: PDF (relatorio anexado) ou imagem
export function isPdfAttachmentUrl(url: string) {
  return /\.pdf$/i.test(url.split("?")[0])
}

export function getAttachmentFileName(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "arquivo.pdf")
  } catch {
    return "arquivo.pdf"
  }
}
