// Recebe o relatorio que o robo do computador do cliente encontrou na pasta
// (ex.: exportado do WinThor) e guarda no bucket privado. A rotina que escolheu
// essa pasta envia o mais recente no horario (ver lib/robot-attachments.ts),
// sozinho ou junto com o relatorio do Power BI.
//
// Autenticacao: so a chave do robo (lib/robot-key.ts), no cabecalho
// x-robot-key. Nao aceita a chave na URL, que iria parar nos registros do
// servidor, nem o Callback Secret do n8n.
import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getCompanyIdFromRobotKey } from "@/lib/robot-key"
import {
  FOLDER_REPORT_MAX_BYTES,
  detectFolderReportFile,
  folderKeyToPathSegment,
  isCompletePdf,
  normalizeFolderKey,
  sanitizeFolderName,
  sanitizeFolderReportFileName,
  type FolderReportRecord,
} from "@/lib/folder-reports"
import {
  FOLDER_REPORTS_BUCKET,
  FOLDER_REPORTS_MIGRATION_HINT,
  FOLDER_REPORT_COLUMNS,
  cleanupOldFolderReports,
  ensureFolderReportsBucket,
  isMissingFolderReportsTableError,
} from "@/lib/folder-reports-server"

export const runtime = "nodejs"

const MAX_MB_LABEL = `${Math.round(FOLDER_REPORT_MAX_BYTES / (1024 * 1024))} MB`
// Folga para os campos do formulario alem do arquivo.
const MAX_REQUEST_BYTES = FOLDER_REPORT_MAX_BYTES + 256 * 1024
// Relogio do computador do cliente adiantado: alem disso, usa a hora do servidor.
const MAX_CLOCK_AHEAD_MS = 5 * 60 * 1000

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function getRobotKeyFromHeaders(request: NextRequest) {
  const headerKey = request.headers.get("x-robot-key")?.trim()
  if (headerKey) return headerKey

  const authHeader = request.headers.get("authorization")?.trim()
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim()
  }

  return ""
}

function resolveSavedAt(value: FormDataEntryValue | null, now: Date) {
  const parsed = typeof value === "string" && value.trim() ? new Date(value.trim()) : null

  if (!parsed || Number.isNaN(parsed.getTime())) return now
  if (parsed.getTime() > now.getTime() + MAX_CLOCK_AHEAD_MS) return now

  return parsed
}

export async function POST(request: NextRequest) {
  const robotKey = getRobotKeyFromHeaders(request)
  if (!robotKey) {
    return jsonError("Informe a chave do robo no cabecalho x-robot-key.", 401)
  }

  let companyId: string | null
  try {
    companyId = await getCompanyIdFromRobotKey(createServiceClient(), robotKey)
  } catch (error) {
    console.error("[folder-reports/upload] erro ao conferir a chave", error)
    return jsonError("Nao foi possivel conferir a chave agora. Tente de novo.", 500)
  }

  if (!companyId) {
    return jsonError("Chave do robo invalida. Peca uma nova ao administrador da plataforma.", 401)
  }

  const contentLength = Number(request.headers.get("content-length") || 0)
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonError(`Arquivo muito grande. Limite: ${MAX_MB_LABEL}.`, 413)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonError("Envie o arquivo como multipart/form-data, com os campos file, folder e saved_at.", 400)
  }

  const folderName = sanitizeFolderName(form.get("folder"))
  const folderKey = normalizeFolderKey(form.get("folder"))
  if (!folderName || !folderKey) {
    return jsonError("Informe o nome da pasta do relatorio (campo folder).", 400)
  }

  const file = form.get("file")
  if (!file || typeof file === "string") {
    return jsonError("Arquivo nao enviado (campo file).", 400)
  }

  if (file.size === 0) {
    return jsonError("Arquivo vazio.", 400)
  }

  if (file.size > FOLDER_REPORT_MAX_BYTES) {
    return jsonError(`Arquivo muito grande. Limite: ${MAX_MB_LABEL}.`, 413)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  // Tipo real pelo conteudo: PDF, PNG ou JPG (JPG entra no grupo "PNG" = imagem)
  const fileType = detectFolderReportFile(bytes)

  if (!fileType) {
    return jsonError("Formato nao suportado. Envie um relatorio em PDF, PNG ou JPG.", 415)
  }
  const format = fileType.format

  if (format === "PDF" && !isCompletePdf(bytes)) {
    return jsonError("O PDF esta incompleto. Envie de novo depois que o arquivo terminar de salvar.", 422)
  }

  const now = new Date()
  const fileSavedAt = resolveSavedAt(form.get("saved_at"), now)
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex")
  const fileName = sanitizeFolderReportFileName(file.name, format, fileType.extension)
  const mimetype = fileType.mimetype
  const supabase = createServiceClient()

  // O robo pode mandar de novo o mesmo arquivo (ex.: a resposta anterior se
  // perdeu na rede). Conteudo igual nao e guardado duas vezes.
  const { data: existing, error: existingError } = await supabase
    .from("folder_reports")
    .select("id")
    .eq("company_id", companyId)
    .eq("folder_key", folderKey)
    .eq("format", format)
    .eq("sha256", sha256)
    .maybeSingle()

  if (existingError) {
    if (isMissingFolderReportsTableError(existingError)) {
      return jsonError(FOLDER_REPORTS_MIGRATION_HINT, 500)
    }
    return jsonError(existingError.message, 500)
  }

  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true, id: existing.id, folder: folderName, format })
  }

  try {
    await ensureFolderReportsBucket(supabase)
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Erro ao preparar o armazenamento", 500)
  }

  const storagePath = [
    companyId,
    folderKeyToPathSegment(folderKey),
    `${now.getTime()}-${crypto.randomBytes(6).toString("hex")}${fileType.extension}`,
  ].join("/")

  const { error: uploadError } = await supabase.storage
    .from(FOLDER_REPORTS_BUCKET)
    .upload(storagePath, Buffer.from(bytes), { contentType: mimetype, upsert: false })

  if (uploadError) {
    return jsonError(`Nao foi possivel guardar o relatorio: ${uploadError.message}`, 500)
  }

  const { data: inserted, error: insertError } = await supabase
    .from("folder_reports")
    .insert({
      company_id: companyId,
      folder_key: folderKey,
      folder_name: folderName,
      format,
      file_name: fileName,
      mimetype,
      size_bytes: bytes.byteLength,
      sha256,
      storage_path: storagePath,
      file_saved_at: fileSavedAt.toISOString(),
      received_at: now.toISOString(),
    })
    .select(FOLDER_REPORT_COLUMNS)
    .single()

  if (insertError || !inserted) {
    await supabase.storage.from(FOLDER_REPORTS_BUCKET).remove([storagePath])

    // Duas chamadas iguais ao mesmo tempo: a outra ja guardou.
    if (insertError?.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true, folder: folderName, format })
    }

    if (isMissingFolderReportsTableError(insertError)) {
      return jsonError(FOLDER_REPORTS_MIGRATION_HINT, 500)
    }

    return jsonError(insertError?.message ?? "Nao foi possivel registrar o relatorio", 500)
  }

  const record = inserted as FolderReportRecord
  await cleanupOldFolderReports(supabase, companyId, folderKey, format, [record.id])

  console.log("[folder-reports/upload] relatorio recebido", {
    companyId,
    folderKey,
    format,
    fileName,
    sizeBytes: bytes.byteLength,
    fileSavedAt: record.file_saved_at,
  })

  return NextResponse.json(
    {
      ok: true,
      id: record.id,
      folder: folderName,
      format,
      file_name: record.file_name,
      file_saved_at: record.file_saved_at,
    },
    { status: 201 }
  )
}
