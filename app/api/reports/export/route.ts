// Cache bust 1
import { NextRequest } from "next/server"
import { createServiceClient as createClient } from "@/lib/supabase/server"
import {
  exportReport,
  getAccessToken,
  getExportFile,
  getExportStatus,
  isPowerBiEntityNotFoundError,
  isPowerBiFeatureNotAvailableError,
} from "@/lib/powerbi"
import {
  exportPowerBIReportDocument,
  sanitizeFileName,
} from "@/lib/powerbi-report-pdf"
import {
  getPrimarySchedulePageName,
  resolveSchedulePageNames,
} from "@/lib/schedule-pages"

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido"
}

function jsonError(error: string, status = 500) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function getMissingReportMessage() {
  return "Este relatorio nao existe mais no Power BI ou nao esta mais acessivel neste workspace. Sincronize os relatorios do Power BI para atualizar a lista."
}

async function deactivateMissingReport(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  reportId: string
) {
  const { error } = await supabase
    .from("reports")
    .update({
      is_active: false,
      synced_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("id", reportId)

  if (error) {
    console.error("Nao foi possivel desativar relatorio ausente do Power BI", error)
  }
}

function getSecretFromRequest(request: NextRequest, body: any) {
  const url = new URL(request.url)
  const querySecret = url.searchParams.get("secret")?.trim()
  const headerSecret = request.headers.get("x-callback-secret")?.trim()
  const authHeader = request.headers.get("authorization")?.trim()

  const bearerSecret =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null

  const bodySecret =
    typeof body?.callback_secret === "string"
      ? body.callback_secret.trim()
      : ""

  return querySecret || headerSecret || bearerSecret || bodySecret || ""
}

async function resolveCompanyIdByCallbackSecret(
  supabase: ReturnType<typeof createClient>,
  secret: string
) {
  if (!secret) return null

  const { data, error } = await supabase
    .from("company_settings")
    .select("company_id, value")
    .eq("key", "n8n")

  if (error) {
    throw new Error(error.message)
  }

  const match = (data ?? []).find((row) => {
    const value = row.value as Record<string, unknown> | null
    return (
      typeof value?.callback_secret === "string" &&
      value.callback_secret.trim() === secret
    )
  })

  return match?.company_id ?? null
}

function detectPdfProfile(
  profile: unknown,
  userAgent: string | null
): "desktop" | "mobile" {
  const normalizedProfile =
    typeof profile === "string" ? profile.trim().toLowerCase() : ""

  if (normalizedProfile === "desktop" || normalizedProfile === "mobile") {
    return normalizedProfile
  }

  const normalizedUserAgent = (userAgent ?? "").toLowerCase()

  return /android|iphone|ipad|ipod|mobile/i.test(normalizedUserAgent)
    ? "mobile"
    : "desktop"
}

async function exportFileFromPowerBi(input: {
  token: string
  workspaceId: string
  reportId: string
  format: "PDF" | "PNG" | "PPTX"
  pageNames: string[]
}) {
  const exportJob = await exportReport(
    input.token,
    input.workspaceId,
    input.reportId,
    input.format,
    { pageNames: input.pageNames }
  )

  let finalStatus: Awaited<ReturnType<typeof getExportStatus>> | null = null

  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(2000)

    const status = await getExportStatus(
      input.token,
      input.workspaceId,
      input.reportId,
      exportJob.id
    )

    if (status.status === "Succeeded") {
      finalStatus = status
      break
    }

    if (status.status === "Failed") {
      throw new Error("Falha ao exportar relatorio no Power BI")
    }
  }

  if (!finalStatus) {
    throw new Error("Tempo limite ao exportar relatorio")
  }

  return getExportFile(
    input.token,
    input.workspaceId,
    input.reportId,
    exportJob.id
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = createClient()

    const callbackSecret = getSecretFromRequest(request, body)
    const requestOrigin = request.headers.get("origin")?.trim() || null
    const requestHost = request.headers.get("host")?.trim() || null

    if (!callbackSecret) {
      return jsonError("callback_secret obrigatorio", 401)
    }

    const companyId = await resolveCompanyIdByCallbackSecret(
      supabase,
      callbackSecret
    )

    if (!companyId) {
      return jsonError("Callback secret invalido", 401)
    }

    const reportId = String(body?.report_id ?? "").trim()
    const format = String(body?.format ?? "PDF").trim().toUpperCase()
    const pbiPageNames = resolveSchedulePageNames(body ?? {})
    const pbiPageName = getPrimarySchedulePageName(pbiPageNames)

    const pdfProfile = detectPdfProfile(
      body?.pdf_profile,
      request.headers.get("user-agent")
    )

    console.log("[reports/export] request received", {
      requestUrl: request.url,
      requestHost,
      requestOrigin,
      reportId,
      format,
      pbiPageNames,
      pdfProfile,
      companyId,
    })

    // Forcando o uso da captura de navegador para que as edicoes feitas entrem em efeito
    const preferNativePowerBiExport = false

    if (!reportId) {
      return new Response(JSON.stringify({ error: "report_id obrigatorio" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (!["PDF", "PNG", "PPTX"].includes(format)) {
      return new Response(
        JSON.stringify({ error: "Formato invalido. Use PDF, PNG ou PPTX." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      )
    }

    if (format !== "PDF" && pbiPageNames.length > 1) {
      return new Response(
        JSON.stringify({
          error:
            "Selecione varias paginas apenas quando o formato de exportacao for PDF.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      )
    }

    const { data: report, error } = await supabase
      .from("reports")
      .select("id, name, pbi_report_id, workspace_id, embed_url, is_active")
      .eq("company_id", companyId)
      .eq("id", reportId)
      .eq("is_active", true)
      .single()

    if (error || !report) {
      return new Response(
        JSON.stringify({ error: "Relatorio nao encontrado" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      )
    }

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .select("id, pbi_workspace_id, is_active")
      .eq("company_id", companyId)
      .eq("id", report.workspace_id)
      .eq("is_active", true)
      .single()

    if (workspaceError || !workspace?.pbi_workspace_id) {
      return new Response(
        JSON.stringify({ error: "Workspace do relatorio nao encontrado" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      )
    }

    const token = await getAccessToken(companyId)
    const safeName = sanitizeFileName(report.name || "relatorio")
    let browserPdfErrorMessage: string | null = null
    let nativePdfError: unknown = null

    if (format === "PDF" && !preferNativePowerBiExport) {
      try {
        console.log("[reports/export] generating PDF via browser capture", {
          reportId: report.id,
          reportName: report.name,
          workspaceId: workspace.pbi_workspace_id,
          pbiReportId: report.pbi_report_id,
          pbiPageNames,
          pdfProfile,
        })

        const exportedFile = await exportPowerBIReportDocument({
          token,
          workspaceId: workspace.pbi_workspace_id,
          reportId: report.pbi_report_id,
          reportName: report.name,
          embedUrl: report.embed_url,
          pageNames: pbiPageNames,
          pageName: pbiPageName,
          pdfProfile,
        })

        return new Response(exportedFile.buffer, {
          status: 200,
          headers: {
            "Content-Type": exportedFile.contentType,
            "Content-Disposition": `inline; filename="${safeName}.${exportedFile.extension}"`,
            "Cache-Control": "no-store",
          },
        })
      } catch (browserPdfError) {
        if (isPowerBiEntityNotFoundError(browserPdfError)) {
          await deactivateMissingReport(supabase, companyId, report.id)
          return jsonError(getMissingReportMessage(), 404)
        }

        browserPdfErrorMessage = getErrorMessage(browserPdfError)
        console.error(
          "Captura da pagina do sistema falhou, tentando ExportTo",
          browserPdfError
        )
      }
    }

    try {
      console.log("[reports/export] falling back to native Power BI export", {
        reportId: report.id,
        reportName: report.name,
        workspaceId: workspace.pbi_workspace_id,
        pbiReportId: report.pbi_report_id,
        format,
        pbiPageNames,
      })

      const fileBuffer = await exportFileFromPowerBi({
        token,
        workspaceId: workspace.pbi_workspace_id,
        reportId: report.pbi_report_id,
        format: format as "PDF" | "PNG" | "PPTX",
        pageNames: pbiPageNames,
      })

      const extension =
        format === "PDF" ? "pdf" : format === "PNG" ? "png" : "pptx"

      const contentType =
        format === "PDF"
          ? "application/pdf"
          : format === "PNG"
            ? "image/png"
            : "application/vnd.openxmlformats-officedocument.presentationml.presentation"

      return new Response(fileBuffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="${safeName}.${extension}"`,
          "Cache-Control": "no-store",
        },
      })
    } catch (exportError) {
      if (isPowerBiEntityNotFoundError(exportError)) {
        await deactivateMissingReport(supabase, companyId, report.id)
        return jsonError(getMissingReportMessage(), 404)
      }

      if (format === "PDF" && preferNativePowerBiExport) {
        nativePdfError = exportError
        console.error(
          "ExportTo do Power BI falhou, tentando captura da pagina do sistema",
          exportError
        )

        try {
          const exportedFile = await exportPowerBIReportDocument({
            token,
            workspaceId: workspace.pbi_workspace_id,
            reportId: report.pbi_report_id,
            reportName: report.name,
            embedUrl: report.embed_url,
            pageNames: pbiPageNames,
            pageName: pbiPageName,
            pdfProfile,
          })

          return new Response(exportedFile.buffer, {
            status: 200,
            headers: {
              "Content-Type": exportedFile.contentType,
              "Content-Disposition": `inline; filename="${safeName}.${exportedFile.extension}"`,
              "Cache-Control": "no-store",
            },
          })
        } catch (browserPdfError) {
          if (isPowerBiEntityNotFoundError(browserPdfError)) {
            await deactivateMissingReport(supabase, companyId, report.id)
            return jsonError(getMissingReportMessage(), 404)
          }

          browserPdfErrorMessage = getErrorMessage(browserPdfError)
          console.error(
            "Captura da pagina do sistema falhou apos erro no ExportTo",
            browserPdfError
          )
        }
      }

      if (
        format === "PDF" &&
        pbiPageNames.length > 1 &&
        isPowerBiFeatureNotAvailableError(exportError) &&
        !browserPdfErrorMessage
      ) {
        return jsonError(
          "Nao foi possivel gerar um unico PDF com varias paginas neste ambiente porque o ExportTo nativo do Power BI nao esta disponivel para este relatorio.",
          500
        )
      }

      if (format === "PDF" && browserPdfErrorMessage) {
        const errorMessage =
          nativePdfError && isPowerBiFeatureNotAvailableError(nativePdfError)
            ? "Nao foi possivel gerar o PDF automaticamente neste ambiente. O ExportTo nativo do Power BI nao esta disponivel e a captura da pagina falhou."
            : !preferNativePowerBiExport &&
                isPowerBiFeatureNotAvailableError(exportError)
              ? "Nao foi possivel gerar o PDF automaticamente neste ambiente. A captura da pagina falhou e o ExportTo nativo do Power BI nao esta disponivel para este relatorio."
              : "Nao foi possivel gerar o PDF deste relatorio agora. Tente novamente."

        return jsonError(errorMessage, 500)
      }

      throw exportError
    }
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Erro ao exportar relatorio",
      500
    )
  }
}
