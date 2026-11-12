// Relatorios da pasta: arquivos que o robo instalado no computador do cliente
// sobe para a plataforma (ex.: relatorio exportado do WinThor). A rotina envia
// o mais recente de cada pasta no horario programado.
//
// Este arquivo nao acessa banco nem storage, para poder ser usado tambem na
// tela e testado sozinho. O acesso ao Supabase fica em folder-reports-server.ts.
import { getTimePartsInTimeZone } from "@/lib/schedule-cron"

export const FOLDER_REPORT_FORMATS = ["PDF", "PNG"] as const
export type FolderReportFormat = (typeof FOLDER_REPORT_FORMATS)[number]

export const FOLDER_REPORT_MAX_BYTES = 9 * 1024 * 1024
export const FOLDER_REPORT_KEEP_DAYS = 30
export const FOLDER_REPORT_MAX_NAME_LENGTH = 80

export const FOLDER_REPORT_MIMETYPES: Record<FolderReportFormat, string> = {
  PDF: "application/pdf",
  PNG: "image/png",
}

export type FolderReportConfig = {
  folder_key: string
  folder_name: string
  formats: FolderReportFormat[]
}

export type FolderReportRecord = {
  id: string
  folder_key: string
  folder_name: string
  format: FolderReportFormat
  file_name: string
  mimetype: string
  size_bytes: number
  storage_path: string
  file_saved_at: string
  received_at: string
}

// Uma pasta que o robo ja enviou, com o ultimo arquivo de cada formato
// (GET /api/folder-reports, usado na tela de rotinas).
export type FolderReportFolderSummary = {
  folder_key: string
  folder_name: string
  latest: Partial<
    Record<FolderReportFormat, { file_name: string; file_saved_at: string; received_at: string }>
  >
}

export type FolderReportDecision =
  | { ok: true; report: FolderReportRecord }
  | { ok: false; reason: string }

// Nome da pasta como aparece no computador, sem caracteres que confundem
// caminho de arquivo. Devolve null quando nao sobra nada.
export function sanitizeFolderName(value: unknown): string | null {
  if (typeof value !== "string") return null

  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FOLDER_REPORT_MAX_NAME_LENGTH)
    .trim()

  return cleaned || null
}

// Chave usada para achar a pasta: "Vendas", "vendas" e "VENDAS " sao a mesma.
export function normalizeFolderKey(value: unknown): string | null {
  const name = sanitizeFolderName(value)
  if (!name) return null

  return name
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
}

// Trecho seguro para usar no caminho do storage.
export function folderKeyToPathSegment(folderKey: string) {
  const slug = folderKey.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return slug || "pasta"
}

// Procura um texto ASCII dentro dos bytes, sem depender de Buffer (o arquivo
// tambem e usado na tela).
function bytesInclude(bytes: Uint8Array, text: string) {
  const pattern = Array.from(text, (char) => char.charCodeAt(0))

  for (let start = 0; start + pattern.length <= bytes.length; start++) {
    let matches = true
    for (let offset = 0; offset < pattern.length; offset++) {
      if (bytes[start + offset] !== pattern[offset]) {
        matches = false
        break
      }
    }
    if (matches) return true
  }

  return false
}

// O formato vem do conteudo, nao do nome: um .pdf renomeado nao engana.
export function detectFolderReportFormat(buffer: Uint8Array): FolderReportFormat | null {
  if (bytesInclude(buffer.subarray(0, 1024), "%PDF-")) {
    return "PDF"
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (buffer.length >= pngSignature.length && pngSignature.every((byte, index) => buffer[index] === byte)) {
    return "PNG"
  }

  return null
}

// Um PDF inteiro termina com %%EOF. Sem isso, o arquivo foi cortado no meio.
export function isCompletePdf(buffer: Uint8Array) {
  return bytesInclude(buffer.subarray(Math.max(0, buffer.length - 1024)), "%%EOF")
}

export function sanitizeFolderReportFileName(value: unknown, format: FolderReportFormat) {
  const extension = format === "PDF" ? ".pdf" : ".png"
  const raw = typeof value === "string" ? value : ""
  const base = raw
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\.(pdf|png)$/i, "")
    .trim()
    .slice(0, 120)
    .trim()

  return `${base || "relatorio"}${extension}`
}

export function isFolderReportFormat(value: unknown): value is FolderReportFormat {
  return typeof value === "string" && (FOLDER_REPORT_FORMATS as readonly string[]).includes(value)
}

// Le o que esta salvo na rotina (jsonb) e descarta o que nao faz sentido.
// Pastas repetidas viram uma so, juntando os formatos.
export function normalizeFolderReportConfigs(value: unknown): FolderReportConfig[] {
  if (!Array.isArray(value)) return []

  const byKey = new Map<string, FolderReportConfig>()

  for (const item of value) {
    if (!item || typeof item !== "object") continue

    const record = item as Record<string, unknown>
    const folderName = sanitizeFolderName(record.folder_name ?? record.folder_key)
    const folderKey = normalizeFolderKey(record.folder_key ?? record.folder_name)
    const formats = Array.isArray(record.formats)
      ? FOLDER_REPORT_FORMATS.filter((format) => (record.formats as unknown[]).includes(format))
      : []

    if (!folderName || !folderKey || formats.length === 0) continue

    const existing = byKey.get(folderKey)
    if (existing) {
      existing.formats = FOLDER_REPORT_FORMATS.filter(
        (format) => existing.formats.includes(format) || formats.includes(format)
      )
    } else {
      byKey.set(folderKey, { folder_key: folderKey, folder_name: folderName, formats })
    }
  }

  return [...byKey.values()]
}

export function folderSentKey(folderKey: string, format: FolderReportFormat) {
  return `${folderKey}|${format}`
}

export function normalizeFolderLastSent(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0
    )
  )
}

function getDateKey(date: Date, timeZone: string) {
  const parts = getTimePartsInTimeZone(date, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
}

export function formatFolderReportDate(value: string, timeZone: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "data desconhecida"

  const parts = getTimePartsInTimeZone(date, timeZone)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} as ${pad(parts.hour)}:${pad(parts.minute)}`
}

// A regra combinada com o Gabriel (2026-11-09): so envia o relatorio mais
// recente se ele foi salvo hoje e esta rotina ainda nao o enviou. Assim, se o
// funcionario esquecer de salvar o relatorio da tarde, a rotina da erro em vez
// de mandar de novo o da manha (ou o de ontem).
export function decideFolderReport(input: {
  config: FolderReportConfig
  format: FolderReportFormat
  newest: FolderReportRecord | null
  lastSentId: string | null | undefined
  now: Date
  timeZone: string
}): FolderReportDecision {
  const label = `"${input.config.folder_name}" (${input.format})`

  if (!input.newest) {
    return {
      ok: false,
      reason: `Relatorio da pasta ${label} nao chegou: nenhum arquivo foi recebido do computador ate agora.`,
    }
  }

  const savedAt = formatFolderReportDate(input.newest.file_saved_at, input.timeZone)
  const savedAtDate = new Date(input.newest.file_saved_at)

  if (
    Number.isNaN(savedAtDate.getTime()) ||
    getDateKey(savedAtDate, input.timeZone) !== getDateKey(input.now, input.timeZone)
  ) {
    return {
      ok: false,
      reason: `Relatorio da pasta ${label} de hoje nao chegou. O ultimo recebido foi salvo em ${savedAt}.`,
    }
  }

  if (input.lastSentId && input.lastSentId === input.newest.id) {
    return {
      ok: false,
      reason: `Relatorio da pasta ${label} nao chegou: o ultimo recebido (salvo em ${savedAt}) ja foi enviado por esta rotina.`,
    }
  }

  return { ok: true, report: input.newest }
}
