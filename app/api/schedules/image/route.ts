import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getRequestContext, isAuthContextError } from "@/lib/tenant"

// Anexos da rotina (campo "Anexos"): imagens e, desde 2026-11-10, PDF (ex.:
// relatorio baixado do WinThor). O PDF vai do mesmo jeito que a imagem: em todo
// horario da rotina, ate ser removido.
const BUCKET = "campaign-images"
const MAX_SIZE_MB = 10
const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]

// Nome do PDF guardado no caminho, para chegar no WhatsApp com o nome original.
function safePdfName(original: string) {
  const base = (original.split(/[\\/]/).pop() || "relatorio")
    .replace(/\.pdf$/i, "")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim()
  return `${base || "relatorio"}.pdf`
}

async function ensureBucketExists(supabase: ReturnType<typeof createServiceClient>) {
  const { data: buckets } = await supabase.storage.listBuckets()
  const exists = buckets?.some((b) => b.name === BUCKET)
  if (!exists) {
    await supabase.storage.createBucket(BUCKET, { public: true })
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getRequestContext()

    const formData = await request.formData()
    const file = formData.get("file")

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Arquivo nao enviado" }, { status: 400 })
    }

    const blob = file as File
    const sizeInMB = blob.size / (1024 * 1024)

    if (sizeInMB > MAX_SIZE_MB) {
      return NextResponse.json(
        { error: `Arquivo muito grande. Limite: ${MAX_SIZE_MB}MB` },
        { status: 413 }
      )
    }

    const isPdf = blob.type === "application/pdf" || /\.pdf$/i.test(blob.name)
    if (!IMAGE_TYPES.includes(blob.type) && !isPdf) {
      return NextResponse.json(
        { error: "Formato nao suportado. Use JPG, PNG, WEBP, GIF ou PDF" },
        { status: 400 }
      )
    }

    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Confere pelo conteudo: um arquivo qualquer renomeado para .pdf nao passa.
    if (isPdf && !buffer.subarray(0, 1024).includes("%PDF-")) {
      return NextResponse.json({ error: "O arquivo nao e um PDF valido" }, { status: 400 })
    }

    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const ext = blob.name.split(".").pop()?.toLowerCase() ?? "jpg"
    const fileName = isPdf
      ? `${ctx.companyId}/schedules/${unique}/${safePdfName(blob.name)}`
      : `${ctx.companyId}/schedules/${unique}.${ext}`

    const supabase = createServiceClient()
    await ensureBucketExists(supabase)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, buffer, {
        contentType: isPdf ? "application/pdf" : blob.type,
        upsert: false,
      })

    if (uploadError) {
      throw uploadError
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName)

    return NextResponse.json({ url: publicUrlData.publicUrl })
  } catch (error) {
    if (isAuthContextError(error)) {
      return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
    }
    const message = error instanceof Error ? error.message : "Erro ao fazer upload do anexo"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
