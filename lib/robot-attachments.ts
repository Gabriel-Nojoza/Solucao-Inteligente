// "Imagem automatica do robo": o robo instalado no computador do cliente sobe
// o relatorio exportado (ex.: PNG do WinThor) para a plataforma
// (/api/folder-reports/upload). A rotina que escolheu aquela pasta manda o
// arquivo mais novo junto com os anexos: sozinho ou logo depois do relatorio
// do Power BI.
//
// Regra (Gabriel, 2026-11-09, mantida em 2026-11-12): so vai o arquivo salvo
// hoje que esta rotina ainda nao enviou. Se a funcionaria esquecer de baixar,
// nao sai a imagem de ontem: o historico mostra a falha com o motivo.
//
// A escolha e feita uma vez por envio (claimRobotAttachmentsForRun) e fica
// gravada em schedules.folder_last_sent:
//   { "vendas|PNG": "<folder_reports.id>", "_run": { at, report_ids, log_ids } }
// O "_run" serve para o envio pelo n8n: quando o n8n entrega o relatorio de
// um contato (/api/bot/send com o dispatch_log_id), a plataforma ve que aquele
// log e deste envio e manda os mesmos arquivos (getRobotAttachmentsForLog).
import type { createServiceClient } from "@/lib/supabase/server"
import {
  decideFolderReport,
  folderSentKey,
  normalizeFolderLastSent,
  normalizeFolderReportConfigs,
  type FolderReportFormat,
  type FolderReportRecord,
} from "@/lib/folder-reports"
import {
  createFolderReportSignedUrl,
  getFolderReportsByIds,
  getLatestFolderReport,
} from "@/lib/folder-reports-server"
import { sendTelegramNotification } from "@/lib/telegram-notify"
import { getCompanyTimeZone } from "@/lib/company-timezone"
import type { ScheduleAttachment } from "@/lib/schedule-attachments"

type ServiceClient = ReturnType<typeof createServiceClient>

type RunMarker = { at: string; report_ids: string[]; log_ids: string[] }

export type RobotMissingFile = {
  folder_name: string
  format: FolderReportFormat
  reason: string
}

export type RobotRunClaim = {
  hasConfig: boolean
  attachments: ScheduleAttachment[]
  missing: RobotMissingFile[]
  // Desfaz a marcacao de "enviado" quando nada chegou a sair (ex.: n8n fora
  // do ar), para um novo envio manual no mesmo dia ainda levar o arquivo.
  rollback: () => Promise<void>
}

const noop = async () => {}

function readRunMarker(value: unknown): RunMarker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const run = (value as Record<string, unknown>)._run as Record<string, unknown> | undefined
  if (!run || typeof run !== "object") return null

  const strings = (list: unknown) =>
    Array.isArray(list) ? list.filter((item): item is string => typeof item === "string" && item.length > 0) : []

  return {
    at: typeof run.at === "string" ? run.at : "",
    report_ids: strings(run.report_ids),
    log_ids: strings(run.log_ids),
  }
}

export function scheduleHasRobotAttachments(schedule: Record<string, unknown>) {
  return normalizeFolderReportConfigs(schedule.folder_report_configs).length > 0
}

async function toAttachments(supabase: ServiceClient, reports: FolderReportRecord[]) {
  const attachments: ScheduleAttachment[] = []
  const failures: RobotMissingFile[] = []

  for (const report of reports) {
    try {
      attachments.push({
        url: await createFolderReportSignedUrl(supabase, report.storage_path),
        file_name: report.file_name,
        mimetype: report.mimetype,
      })
    } catch (error) {
      failures.push({
        folder_name: report.folder_name,
        format: report.format,
        reason: error instanceof Error ? error.message : "Nao foi possivel preparar o arquivo do robo",
      })
    }
  }

  return { attachments, failures }
}

// Decide, uma vez por envio, quais arquivos do robo vao e marca como enviados.
// logIds: os dispatch_logs deste envio (vazio no envio so de anexos).
export async function claimRobotAttachmentsForRun(input: {
  supabase: ServiceClient
  companyId: string
  schedule: Record<string, unknown> & { id: string }
  logIds: string[]
  now?: Date
}): Promise<RobotRunClaim> {
  const { supabase, companyId, schedule } = input
  const configs = normalizeFolderReportConfigs(schedule.folder_report_configs)

  if (configs.length === 0) {
    return { hasConfig: false, attachments: [], missing: [], rollback: noop }
  }

  const now = input.now ?? new Date()
  const timeZone = await getCompanyTimeZone(supabase, companyId)
  const previousValue = schedule.folder_last_sent ?? null
  const lastSent = normalizeFolderLastSent(previousValue)
  const newLastSent: Record<string, string> = { ...lastSent }
  const ready: FolderReportRecord[] = []
  const missing: RobotMissingFile[] = []

  for (const config of configs) {
    for (const format of config.formats) {
      try {
        const newest = await getLatestFolderReport(supabase, companyId, config.folder_key, format)
        const decision = decideFolderReport({
          config,
          format,
          newest,
          lastSentId: lastSent[folderSentKey(config.folder_key, format)],
          now,
          timeZone,
        })

        if (decision.ok) {
          ready.push(decision.report)
          newLastSent[folderSentKey(config.folder_key, format)] = decision.report.id
        } else {
          missing.push({ folder_name: config.folder_name, format, reason: decision.reason })
        }
      } catch (error) {
        missing.push({
          folder_name: config.folder_name,
          format,
          reason: error instanceof Error ? error.message : "Nao foi possivel ler os arquivos do robo",
        })
      }
    }
  }

  if (ready.length === 0) {
    return { hasConfig: true, attachments: [], missing, rollback: noop }
  }

  const marker: RunMarker = {
    at: now.toISOString(),
    report_ids: ready.map((report) => report.id),
    log_ids: input.logIds,
  }

  const { error: claimError } = await supabase
    .from("schedules")
    .update({ folder_last_sent: { ...newLastSent, _run: marker } })
    .eq("company_id", companyId)
    .eq("id", schedule.id)

  if (claimError) {
    // Sem a marcacao, o proximo horario mandaria de novo o mesmo arquivo.
    // Melhor nao mandar agora e avisar.
    return {
      hasConfig: true,
      attachments: [],
      missing: [
        ...missing,
        ...ready.map((report) => ({
          folder_name: report.folder_name,
          format: report.format,
          reason: `Nao foi possivel registrar o envio do arquivo do robo: ${claimError.message}`,
        })),
      ],
      rollback: noop,
    }
  }

  const { attachments, failures } = await toAttachments(supabase, ready)

  return {
    hasConfig: true,
    attachments,
    missing: [...missing, ...failures],
    rollback: async () => {
      const { error } = await supabase
        .from("schedules")
        .update({ folder_last_sent: previousValue })
        .eq("company_id", companyId)
        .eq("id", schedule.id)
      if (error) {
        console.error("[robot-attachments] nao foi possivel desfazer a marcacao", {
          scheduleId: schedule.id,
          error: error.message,
        })
      }
    },
  }
}

// Relatorio entregue pelo n8n para um contato: os arquivos do robo escolhidos
// no envio a que esse log pertence. Log de outro envio (ou sem robo): nada.
export async function getRobotAttachmentsForLog(
  supabase: ServiceClient,
  companyId: string,
  schedule: Record<string, unknown>,
  dispatchLogId: string | null | undefined
): Promise<ScheduleAttachment[]> {
  if (!dispatchLogId) return []

  const run = readRunMarker(schedule.folder_last_sent)
  if (!run || run.report_ids.length === 0 || !run.log_ids.includes(dispatchLogId)) return []

  const reports = await getFolderReportsByIds(supabase, companyId, run.report_ids)
  const { attachments, failures } = await toAttachments(supabase, reports)

  if (failures.length > 0) {
    console.error("[robot-attachments] arquivo do robo nao preparado", { dispatchLogId, failures })
  }

  return attachments
}

// Arquivo do robo que nao foi: uma linha de falha no historico por contato
// (aparece em "nao enviados", com o motivo) e um aviso no Telegram.
export async function recordMissingRobotFiles(input: {
  supabase: ServiceClient
  companyId: string
  companyName: string
  schedule: { id: string; name?: string | null }
  contacts: Array<{ name: string; target: string }>
  missing: RobotMissingFile[]
}) {
  if (input.missing.length === 0) return

  const completedAt = new Date().toISOString()
  const rows = input.contacts.flatMap((contact) =>
    input.missing.map((item) => ({
      company_id: input.companyId,
      schedule_id: input.schedule.id,
      report_name: item.folder_name,
      contact_name: contact.name,
      contact_phone: contact.target,
      status: "failed" as const,
      export_format: item.format,
      error_message: item.reason,
      completed_at: completedAt,
    }))
  )

  if (rows.length > 0) {
    const { error } = await input.supabase.from("dispatch_logs").insert(rows)
    if (error) {
      console.error("[robot-attachments] nao foi possivel registrar a falha no historico", error.message)
    }
  }

  void sendTelegramNotification(
    [
      "🤖⚠️ Imagem do robo nao enviada",
      `Empresa: ${input.companyName}`,
      `Rotina: ${input.schedule.name ?? input.schedule.id}`,
      "",
      ...input.missing.map((item) => `- ${item.reason}`),
    ].join("\n")
  )
}
