import {
  renderHtmlToPng,
  renderScreenshotPayloadsToPdf,
} from "@/lib/browser-pdf";
import {
  exportReport,
  generateReportEmbedToken,
  getExportFile,
  getExportStatus,
} from "@/lib/powerbi";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function buildPowerBICaptureHtml(input: {
  reportName: string;
  reportId: string;
  embedUrl: string;
  embedToken: string;
  pageName?: string | null;
}) {
  const title = escapeHtml(input.reportName);
  const config = JSON.stringify({
    reportId: input.reportId,
    embedUrl: input.embedUrl,
    accessToken: input.embedToken,
    pageName:
      typeof input.pageName === "string" && input.pageName.trim()
        ? input.pageName.trim()
        : null,
  });

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
      height: auto;
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
      height: 2000px;
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
      window.__REPORT_CAPTURE__ = true
      window.__REPORT_READY__ = null
      window.__REPORT_ERROR__ = null

      window.addEventListener("error", (event) => {
        const message =
          event && typeof event.message === "string" && event.message.trim()
            ? event.message.trim()
            : "Erro inesperado ao preparar a captura do relatorio."

        window.__REPORT_ERROR__ = message
      })

      window.addEventListener("unhandledrejection", (event) => {
        const reason =
          event && "reason" in event ? event.reason : "Erro inesperado"
        const message =
          typeof reason === "string"
            ? reason
            : reason && typeof reason.message === "string"
              ? reason.message
              : "Erro inesperado ao preparar a captura do relatorio."

        window.__REPORT_ERROR__ = message
      })

      const config = ${config}
      const statusNode = document.getElementById("status")
      const errorNode = document.getElementById("error")
      const reportContainer = document.getElementById("report-container")
      const frameNode = document.querySelector(".frame")
      const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))
      let finished = false
      let settlingRender = false
      let lastVisualRenderedAt = 0

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
          visualRenderedEvents: true,
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

      const selectedPageName =
        typeof config.pageName === "string" && config.pageName.trim()
          ? config.pageName.trim()
          : ""

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

      async function ensureSelectedPageIsActive() {
        if (!selectedPageName) {
          return true
        }

        try {
          const pages = await report.getPages()
          const targetPage =
            Array.isArray(pages) && pages.length
              ? pages.find(
                  (page) =>
                    page.name === selectedPageName ||
                    page.displayName === selectedPageName
                ) || null
              : null

          if (!targetPage) {
            markError("A pagina selecionada nao foi encontrada neste relatorio.")
            return false
          }

          if (!targetPage.isActive) {
            statusNode.textContent =
              "Relatorio carregado. Abrindo a pagina selecionada..."
            await targetPage.setActive()
            await wait(1500)
          }

          return true
        } catch {
          markError("Nao foi possivel abrir a pagina selecionada do relatorio.")
          return false
        }
      }

      async function waitForVisualStability() {
        const startedAt = Date.now()
        const fallbackDelayMs = 15000
        const quietPeriodMs = 8000
        const maxWaitMs = 90000

        while (Date.now() - startedAt < maxWaitMs) {
          if (finished) {
            return false
          }

          await syncFrameToActivePage()

          if (lastVisualRenderedAt > 0) {
            if (Date.now() - lastVisualRenderedAt >= quietPeriodMs) {
              await wait(1200)
              return true
            }
          } else if (Date.now() - startedAt >= fallbackDelayMs) {
            await wait(1200)
            return true
          }

          await wait(500)
        }

        return true
      }

      report.on("loaded", async () => {
        statusNode.textContent = selectedPageName
          ? "Relatorio carregado. Abrindo a pagina selecionada..."
          : "Relatorio carregado. Finalizando renderizacao..."

        const pageReady = await ensureSelectedPageIsActive()
        if (!pageReady) {
          return
        }

        await syncFrameToActivePage()
        await wait(1500)
      })

      report.on("visualRendered", () => {
        lastVisualRenderedAt = Date.now()
      })

      report.on("rendered", () => {
        if (settlingRender || finished) {
          return
        }

        settlingRender = true

        window.setTimeout(async () => {
          if (selectedPageName) {
            try {
              const pages = await report.getPages()
              const activePage =
                Array.isArray(pages) && pages.length
                  ? pages.find((page) => page.isActive) || pages[0]
                  : null

              if (
                !activePage ||
                (activePage.name !== selectedPageName &&
                  activePage.displayName !== selectedPageName)
              ) {
                const pageReady = await ensureSelectedPageIsActive()
                if (pageReady) {
                  settlingRender = false
                  return
                }
                settlingRender = false
                return
              }
            } catch {
              markError("Nao foi possivel confirmar a pagina selecionada.")
              settlingRender = false
              return
            }
          }

          statusNode.textContent = "Relatorio carregado. Finalizando renderizacao..."
          const visualsSettled = await waitForVisualStability()
          if (!visualsSettled) {
            settlingRender = false
            return
          }

          await syncFrameToActivePage()

          if (frameNode) {
            const frameHeight = frameNode.offsetHeight
            if (frameHeight > 2000) {
              const scrollStep = 1500
              for (let y = scrollStep; y < frameHeight; y += scrollStep) {
                window.scrollTo(0, y)
                await wait(800)
              }
              window.scrollTo(0, 0)
              await wait(2000)
            }
          }

          await wait(1500)
          markReady("rendered")
          settlingRender = false
        }, 3500)
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
      }, 150000)

      window.addEventListener("resize", () => {
        window.setTimeout(() => {
          void syncFrameToActivePage()
        }, 120)
      })
    })()
  </script>
</body>
</html>`;
}

export type PowerBiPdfProfile = "desktop" | "mobile";

export type PowerBiExportedDocument = {
  buffer: Buffer;
  contentType: "application/pdf" | "image/png";
  extension: "pdf" | "png";
};

type ScreenshotPayloadSummary = {
  isSegmented: boolean;
  segmentCount: number;
  maxTotalHeightPx: number;
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function parsePngDimensions(png: Buffer) {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("A captura do relatorio nao retornou um PNG valido");
  }

  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

function summarizeScreenshotPayload(payload: Buffer): ScreenshotPayloadSummary {
  try {
    const parsed = JSON.parse(payload.toString("utf-8")) as {
      segments?: string[];
      metadata?: Array<{ height?: number; totalHeight?: number }>;
    };
    const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
    const metadata = Array.isArray(parsed.metadata) ? parsed.metadata : [];

    if (segments.length > 0 && metadata.length > 0) {
      const maxTotalHeightPx = metadata.reduce((maxHeight, item) => {
        const nextHeight =
          typeof item.totalHeight === "number" && item.totalHeight > 0
            ? item.totalHeight
            : typeof item.height === "number" && item.height > 0
              ? item.height
              : 0;
        return Math.max(maxHeight, nextHeight);
      }, 0);

      return {
        isSegmented: true,
        segmentCount: segments.length,
        maxTotalHeightPx,
      };
    }
  } catch {
    // Quando vier um PNG unico, a altura eh lida direto do arquivo.
  }

  const dimensions = parsePngDimensions(payload);
  return {
    isSegmented: false,
    segmentCount: 1,
    maxTotalHeightPx: dimensions.height,
  };
}

function shouldUsePngForLargeReport(summary: ScreenshotPayloadSummary) {
  return summary.isSegmented || summary.maxTotalHeightPx >= 9000;
}

function toNodeBuffer(value: ArrayBuffer | Buffer) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

async function exportFileFromPowerBi(input: {
  token: string;
  workspaceId: string;
  reportId: string;
  format: "PDF" | "PNG";
  pageNames: string[];
  pageName?: string | null;
}) {
  const exportJob = await exportReport(
    input.token,
    input.workspaceId,
    input.reportId,
    input.format,
    {
      pageNames: input.pageNames,
      pageName: input.pageName,
    },
  );

  let finalStatus: Awaited<ReturnType<typeof getExportStatus>> | null = null;

  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const status = await getExportStatus(
      input.token,
      input.workspaceId,
      input.reportId,
      exportJob.id,
    );

    if (status.status === "Succeeded") {
      finalStatus = status;
      break;
    }

    if (status.status === "Failed") {
      throw new Error("Falha ao exportar relatorio no Power BI");
    }
  }

  if (!finalStatus) {
    throw new Error("Tempo limite ao exportar relatorio");
  }

  return toNodeBuffer(
    await getExportFile(
      input.token,
      input.workspaceId,
      input.reportId,
      exportJob.id,
    ),
  );
}

function getPowerBiPdfPreset(profile: PowerBiPdfProfile) {
  const envCaptureWidth = Number(process.env.REPORT_PDF_CAPTURE_WIDTH || "");
  const envCaptureHeight = Number(process.env.REPORT_PDF_CAPTURE_HEIGHT || "");
  const envDeviceScaleFactor = Number(process.env.REPORT_PDF_DEVICE_SCALE_FACTOR || "");
  const viewportWidth =
    Number.isFinite(envCaptureWidth) && envCaptureWidth > 0 ? envCaptureWidth : 2560;
  const viewportHeight =
    Number.isFinite(envCaptureHeight) && envCaptureHeight > 0 ? envCaptureHeight : 12000;
  const deviceScaleFactor =
    Number.isFinite(envDeviceScaleFactor) && envDeviceScaleFactor > 0
      ? envDeviceScaleFactor
      : 1;
  if (profile === "mobile") {
    return {
      viewportWidth,
      viewportHeight,
      deviceScaleFactor,
      pageWidthMm: 120,
      pageHeightMm: undefined,
      pageMarginMm: 0,
    };
  }

  return {
    viewportWidth,
    viewportHeight,
    deviceScaleFactor,
    pageWidthMm: 120,
    pageHeightMm: undefined,
    pageMarginMm: 0,
  };
}

function getSafeRetryPowerBiPdfPreset(profile: PowerBiPdfProfile) {
  const base = getPowerBiPdfPreset(profile);

  return {
    ...base,
    viewportWidth: Math.min(base.viewportWidth, 1600),
    viewportHeight: Math.min(base.viewportHeight, 6000),
    deviceScaleFactor: 1,
  };
}

function isBrowserDisconnectError(error: unknown) {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("conexao com o navegador foi encerrada") ||
    message.includes("conexão com o navegador foi encerrada") ||
    message.includes("connection to the browser was closed") ||
    message.includes("target closed") ||
    message.includes("browser has disconnected") ||
    message.includes("pipe closed")
  );
}

export async function exportPowerBIReportDocument(input: {
  token: string;
  workspaceId: string;
  reportId: string;
  reportName: string;
  embedUrl: string | null;
  pageNames?: string[] | null;
  pageName?: string | null;
  pdfProfile?: PowerBiPdfProfile;
  autoUsePngForLargeReports?: boolean;
}) {
  const embedUrl =
    typeof input.embedUrl === "string" ? input.embedUrl.trim() : "";

  if (!embedUrl) {
    throw new Error(
      "Relatorio sem embed_url salvo. Sincronize novamente os relatorios do Power BI.",
    );
  }

  const embedToken = await generateReportEmbedToken(
    input.token,
    input.workspaceId,
    input.reportId,
  );

  const preset = getPowerBiPdfPreset(input.pdfProfile ?? "desktop");
  const normalizedPageNames = Array.isArray(input.pageNames)
    ? [
        ...new Set(
          input.pageNames.map((pageName) => pageName.trim()).filter(Boolean),
        ),
      ]
    : [];

  const selectedPageNames =
    normalizedPageNames.length > 0
      ? normalizedPageNames
      : typeof input.pageName === "string" && input.pageName.trim()
        ? [input.pageName.trim()]
        : [];

  if (selectedPageNames.length <= 1) {
    const html = buildPowerBICaptureHtml({
      reportName: input.reportName,
      reportId: input.reportId,
      embedUrl,
      embedToken,
      pageName: selectedPageNames[0] ?? null,
    });

    const screenshotPayload = await renderHtmlToPng(html, {
      timeoutMs: 180000,
      captureWidth: preset.viewportWidth,
      captureHeight: preset.viewportHeight,
      deviceScaleFactor: preset.deviceScaleFactor,
      screenshotScale: 1,
      forceExpandScrollable: false,
      scrollableSegmentationMode: "segments-only",
    });

    return {
      buffer: await renderScreenshotPayloadsToPdf([screenshotPayload], {
        pdfTimeoutMs: 180000,
        pageWidthMm: preset.pageWidthMm,
        pageMarginMm: preset.pageMarginMm,
        autoGrowPageHeight: true,
        maxPageHeightMm: 80000,
      }),
      contentType: "application/pdf",
      extension: "pdf",
    } satisfies PowerBiExportedDocument;
  }

  const screenshotPayloads: Buffer[] = [];

  for (const pageName of selectedPageNames) {
    const html = buildPowerBICaptureHtml({
      reportName: `${input.reportName} - ${pageName}`,
      reportId: input.reportId,
      embedUrl,
      embedToken,
      pageName,
    });

    const screenshotPayload = await renderHtmlToPng(html, {
      timeoutMs: 180000,
      captureWidth: preset.viewportWidth,
      captureHeight: preset.viewportHeight,
      deviceScaleFactor: preset.deviceScaleFactor,
      screenshotScale: 1,
      forceExpandScrollable: false,
      scrollableSegmentationMode: "segments-only",
    });

    screenshotPayloads.push(screenshotPayload);
  }

  return {
    buffer: await renderScreenshotPayloadsToPdf(screenshotPayloads, {
      pdfTimeoutMs: 180000,
      pageWidthMm: preset.pageWidthMm,
      pageMarginMm: preset.pageMarginMm,
      autoGrowPageHeight: true,
      maxPageHeightMm: 80000,
    }),
    contentType: "application/pdf",
    extension: "pdf",
  } satisfies PowerBiExportedDocument;
}

export async function exportPowerBIReportPdf(input: {
  token: string;
  workspaceId: string;
  reportId: string;
  reportName: string;
  embedUrl: string | null;
  pageNames?: string[] | null;
  pageName?: string | null;
  pdfProfile?: PowerBiPdfProfile;
}) {
  const result = await exportPowerBIReportDocument({
    ...input,
    autoUsePngForLargeReports: false,
  });

  if (result.contentType !== "application/pdf") {
    throw new Error("A exportacao retornou imagem quando PDF era obrigatorio");
  }

  return result.buffer;
}
