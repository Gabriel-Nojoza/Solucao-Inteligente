import { renderHtmlScreenshotToPdf } from "@/lib/browser-pdf"
import { generateReportEmbedToken } from "@/lib/powerbi"

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function sanitizeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
}

function buildPowerBICaptureHtml(input: {
  reportName: string
  reportId: string
  embedUrl: string
  embedToken: string
}) {
  const title = escapeHtml(input.reportName)
  const config = JSON.stringify({
    reportId: input.reportId,
    embedUrl: input.embedUrl,
    accessToken: input.embedToken,
  })

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light;
      --canvas-bg: #ffffff;
      --frame-bg: #ffffff;
      --status-bg: rgba(15, 23, 42, 0.82);
      --status-text: #f8fafc;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      width: 100%;
      min-height: 100%;
      background: var(--canvas-bg);
      font-family: "Segoe UI", Tahoma, sans-serif;
    }

    body {
      padding: 0;
    }

    .canvas {
      width: 100%;
      min-height: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .frame {
      position: relative;
      width: 100%;
      height: 1100px;
      overflow: hidden;
      border-radius: 0;
      background: var(--frame-bg);
      box-shadow: none;
    }

    #report-container {
      width: 100%;
      height: 100%;
    }

    .status {
      position: absolute;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2;
      border-radius: 999px;
      background: var(--status-bg);
      color: var(--status-text);
      padding: 10px 16px;
      font-size: 13px;
      line-height: 1;
      letter-spacing: 0.01em;
      box-shadow: 0 14px 30px rgba(15, 23, 42, 0.18);
    }

    .status[hidden] {
      display: none;
    }

    .status.error {
      background: rgba(153, 27, 27, 0.92);
    }
  </style>
</head>
<body>
  <div class="canvas">
    <div class="frame">
      <div id="status" class="status">Carregando o relatorio do Power BI...</div>
      <div id="error" class="status error" hidden></div>
      <div id="report-container"></div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/powerbi-client@2.23.1/dist/powerbi.min.js"></script>
  <script>
    (() => {
      const config = ${config}
      const statusNode = document.getElementById("status")
      const errorNode = document.getElementById("error")
      const reportContainer = document.getElementById("report-container")
      const frameNode = document.querySelector(".frame")
      let finished = false

      function markReady(reason) {
        if (finished) return
        finished = true
        statusNode.hidden = true
        window.__REPORT_READY__ = reason || "rendered"
      }

      function markError(message) {
        if (finished) return
        finished = true
        statusNode.hidden = true
        errorNode.hidden = false
        errorNode.textContent = message
        window.__REPORT_ERROR__ = message
      }

      const client = window.powerbi
      const modelsSource = window["powerbi-client"]
      const models = modelsSource && modelsSource.models

      if (!client || !models) {
        markError("Nao foi possivel carregar o cliente do Power BI.")
        return
      }

      const report = client.embed(reportContainer, {
        type: "report",
        id: config.reportId,
        embedUrl: config.embedUrl,
        accessToken: config.accessToken,
        tokenType: models.TokenType.Embed,
        permissions: models.Permissions.Read,
        settings: {
          filterPaneEnabled: false,
          navContentPaneEnabled: false,
          layoutType: models.LayoutType.Custom,
          customLayout: {
            displayOption: models.DisplayOption.FitToWidth
          },
          panes: {
            filters: { visible: false },
            pageNavigation: { visible: false }
          },
          background: models.BackgroundType.Transparent
        }
      })

      async function syncFrameToActivePage() {
        if (!frameNode || !reportContainer) return

        try {
          const pages = await report.getPages()
          const activePage =
            Array.isArray(pages) && pages.length
              ? pages.find((page) => page.isActive) || pages[0]
              : null

          const pageWidth = Number(
            activePage && activePage.defaultSize && activePage.defaultSize.width
          )
          const pageHeight = Number(
            activePage && activePage.defaultSize && activePage.defaultSize.height
          )

          if (
            !Number.isFinite(pageWidth) ||
            !Number.isFinite(pageHeight) ||
            pageWidth <= 0 ||
            pageHeight <= 0
          ) {
            return
          }

          const frameWidth = frameNode.clientWidth || reportContainer.clientWidth

          if (!frameWidth) {
            return
          }

          const nextHeight = Math.max(
            920,
            Math.ceil(frameWidth * (pageHeight / pageWidth))
          )

          frameNode.style.height = nextHeight + "px"
        } catch {
          // Se nao conseguir ler a pagina ativa, mantemos a altura padrao.
        }
      }

      report.on("loaded", async () => {
        statusNode.textContent = "Relatorio carregado. Finalizando renderizacao..."
        await syncFrameToActivePage()
      })

      report.on("rendered", () => {
        window.setTimeout(async () => {
          await syncFrameToActivePage()
          markReady("rendered")
        }, 1800)
      })

      report.on("error", (event) => {
        const message =
          event &&
          event.detail &&
          typeof event.detail.message === "string" &&
          event.detail.message.trim()
            ? event.detail.message.trim()
            : "Erro ao renderizar o relatorio do Power BI."

        markError(message)
      })

      window.setTimeout(() => {
        if (!finished) {
          markReady("timeout")
        }
      }, 45000)

      window.addEventListener("resize", () => {
        window.setTimeout(() => {
          void syncFrameToActivePage()
        }, 120)
      })
    })()
  </script>
</body>
</html>`
}

export type PowerBiPdfProfile = "desktop" | "mobile"

function getPowerBiPdfPreset(profile: PowerBiPdfProfile) {
  if (profile === "mobile") {
    return {
      viewportWidth: 2304,
      viewportHeight: 1536,
      deviceScaleFactor: 3,
      pageWidthMm: 2378,
      pageHeightMm: 1682,
      pageMarginMm: 5,
    }
  }

  return {
    viewportWidth: 2560,
    viewportHeight: 1703,
    deviceScaleFactor: 3,
    pageWidthMm: 2378,
    pageHeightMm: 1682,
    pageMarginMm: 5,
  }
}

export async function exportPowerBIReportPdf(input: {
  token: string
  workspaceId: string
  reportId: string
  reportName: string
  embedUrl: string | null
  pdfProfile?: PowerBiPdfProfile
}) {
  const embedUrl = typeof input.embedUrl === "string" ? input.embedUrl.trim() : ""

  if (!embedUrl) {
    throw new Error(
      "Relatorio sem embed_url salvo. Sincronize novamente os relatorios do Power BI."
    )
  }

  const embedToken = await generateReportEmbedToken(
    input.token,
    input.workspaceId,
    input.reportId
  )

  const html = buildPowerBICaptureHtml({
    reportName: input.reportName,
    reportId: input.reportId,
    embedUrl,
    embedToken,
  })

  const preset = getPowerBiPdfPreset(input.pdfProfile ?? "desktop")

  return renderHtmlScreenshotToPdf(html, {
    pngTimeoutMs: 70000,
    pdfTimeoutMs: 60000,
    captureWidth: preset.viewportWidth,
    captureHeight: preset.viewportHeight,
    deviceScaleFactor: preset.deviceScaleFactor,
    pageWidthMm: preset.pageWidthMm,
    pageHeightMm: preset.pageHeightMm,
    pageMarginMm: preset.pageMarginMm,
    screenshotScale: 3.5,
  })
}