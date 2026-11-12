import { createServiceClient } from "@/lib/supabase/server"
import { sendWhatsAppBotMessage, type WhatsAppBotSendPayload } from "@/lib/whatsapp-bot"
import { getTimePartsInTimeZone } from "@/lib/schedule-cron"
import {
  getAttachmentsForWeekday,
  getWeekdayLongName,
  normalizeWeekdayAttachments,
} from "@/lib/weekday-attachments"
import { getRobotAttachmentsForLog } from "@/lib/robot-attachments"
import { getCompanyTimeZone } from "@/lib/company-timezone"

type ServiceClient = ReturnType<typeof createServiceClient>

// Quando o relatorio chega pelo n8n, a narracao (audio/texto) pode vir logo
// depois dele com o mesmo log. Esperar um pouco faz o anexo chegar por ultimo.
const ATTACHMENTS_AFTER_REPORT_DELAY_MS = Number(
  process.env.ATTACHMENTS_AFTER_REPORT_DELAY_MS || "15000"
)

// Anexo pronto para enviar. Os do campo "Anexos" sao so o link (nome e tipo
// vem do link); os do robo ja trazem o nome e o tipo do arquivo.
export type ScheduleAttachment = {
  url: string
  file_name?: string
  mimetype?: string
}

export type AttachmentTarget = {
  instance_id: string | null
  jid: string | null
  whatsapp_group_id: string | null
}

const IMAGE_TYPES_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
}

// Anexo da rotina (campo "Anexos"): imagem, como sempre foi, ou PDF (relatorio
// anexado). O PDF sai com o nome original e o tipo certo; sem isso ia como
// "imagem.jpg" e nao abria no celular de quem recebe.
export function describeScheduleAttachment(url: string) {
  let pathname = url
  try {
    pathname = decodeURIComponent(new URL(url).pathname)
  } catch {
    // URL invalida: trata como imagem, como antes
  }

  if (/\.pdf$/i.test(pathname)) {
    return { file_name: pathname.split("/").pop() || "relatorio.pdf", mimetype: "application/pdf" }
  }

  // Imagem sai com a extensao real (PNG chega como "imagem.png"). O bot manda
  // como documento, entao o celular de quem recebe abre pelo nome do arquivo.
  const ext = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? ""
  const imageType = IMAGE_TYPES_BY_EXTENSION[ext]
  if (imageType) {
    return { file_name: `imagem.${ext === "jpeg" ? "jpg" : ext}`, mimetype: imageType }
  }

  return { file_name: "imagem.jpg", mimetype: "image/jpeg" }
}

// Lista normal do campo "Anexos" (image_urls, ou o image_url antigo).
export function getScheduleAttachmentList(schedule: Record<string, unknown>): string[] {
  if (Array.isArray(schedule.image_urls)) {
    return (schedule.image_urls as unknown[]).filter(
      (url): url is string => typeof url === "string" && url.trim().length > 0
    )
  }

  return typeof schedule.image_url === "string" && schedule.image_url.trim()
    ? [schedule.image_url.trim()]
    : []
}

export type ScheduleAttachmentsForNow =
  | { byWeekday: false; urls: string[] }
  | { byWeekday: true; urls: string[]; weekdayName: string }

// O que a rotina anexa agora: com "Por dia da semana" ligado, so os anexos do
// dia de hoje (no fuso da empresa); senao, a lista normal.
export async function resolveScheduleAttachmentsForNow(
  supabase: ServiceClient,
  companyId: string,
  schedule: Record<string, unknown>
): Promise<ScheduleAttachmentsForNow> {
  const weekdayAttachments = normalizeWeekdayAttachments(schedule.weekday_attachments)

  if (!weekdayAttachments?.enabled) {
    return { byWeekday: false, urls: getScheduleAttachmentList(schedule) }
  }

  const timeZone = await getCompanyTimeZone(supabase, companyId)
  const todayWeekday = getTimePartsInTimeZone(new Date(), timeZone).weekday

  return {
    byWeekday: true,
    urls: getAttachmentsForWeekday(weekdayAttachments, todayWeekday),
    weekdayName: getWeekdayLongName(todayWeekday),
  }
}

// Manda os anexos, um de cada vez, para um contato ou grupo. Uma falha nao
// impede os proximos; volta quantos foram e o motivo de cada falha.
export async function sendScheduleAttachments(
  items: Array<string | ScheduleAttachment>,
  target: AttachmentTarget,
  send: (payload: WhatsAppBotSendPayload) => Promise<unknown> = sendWhatsAppBotMessage
) {
  let sent = 0
  const errors: string[] = []

  for (const item of items) {
    const url = typeof item === "string" ? item : item.url
    const described = describeScheduleAttachment(url)
    const anexo = {
      file_name: (typeof item !== "string" && item.file_name) || described.file_name,
      mimetype: (typeof item !== "string" && item.mimetype) || described.mimetype,
    }
    try {
      await send({
        instance_id: target.instance_id,
        jid: target.jid,
        whatsapp_group_id: target.whatsapp_group_id,
        message: null,
        document_url: url,
        file_name: anexo.file_name,
        mimetype: anexo.mimetype,
      })
      sent++
    } catch (error) {
      errors.push(`${anexo.file_name}: ${error instanceof Error ? error.message : "falha ao enviar"}`)
    }
  }

  return { sent, errors }
}

// Relatorio do Power BI entregue pelo n8n (via /api/bot/send): manda os anexos
// da rotina logo depois, para o mesmo contato ou grupo. Primeiro a imagem do
// robo escolhida neste envio (se houver), depois os do campo "Anexos".
export async function sendScheduleAttachmentsAfterReport(input: {
  companyId: string
  scheduleId: string
  dispatchLogId?: string | null
  target: AttachmentTarget
}) {
  // Espera antes de ler a rotina: a narracao chega primeiro e o anexo por ultimo.
  if (ATTACHMENTS_AFTER_REPORT_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, ATTACHMENTS_AFTER_REPORT_DELAY_MS))
  }

  const supabase = createServiceClient()
  const { data: schedule } = await supabase
    .from("schedules")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("id", input.scheduleId)
    .maybeSingle()

  if (!schedule) return

  const scheduleRecord = schedule as Record<string, unknown>
  const [robotAttachments, { urls: manualUrls }] = await Promise.all([
    getRobotAttachmentsForLog(supabase, input.companyId, scheduleRecord, input.dispatchLogId).catch((error) => {
      console.error("[schedule-attachments] falha ao ler a imagem do robo", {
        scheduleId: input.scheduleId,
        error: error instanceof Error ? error.message : error,
      })
      return [] as ScheduleAttachment[]
    }),
    resolveScheduleAttachmentsForNow(supabase, input.companyId, scheduleRecord),
  ])

  const urls: Array<string | ScheduleAttachment> = [...robotAttachments, ...manualUrls]
  if (urls.length === 0) return

  const result = await sendScheduleAttachments(urls, input.target)
  console.log("[schedule-attachments] anexos enviados depois do relatorio", {
    scheduleId: input.scheduleId,
    target: input.target.whatsapp_group_id ?? input.target.jid,
    sent: result.sent,
    failed: result.errors.length,
  })
  if (result.errors.length > 0) {
    console.error("[schedule-attachments] falha ao enviar anexo", {
      scheduleId: input.scheduleId,
      errors: result.errors,
    })
  }
}
