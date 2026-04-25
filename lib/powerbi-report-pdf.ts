import {
  exportReport,
  getExportFile,
  getExportStatus,
} from "@/lib/powerbi";


export function sanitizeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
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
  const normalizedPageNames = Array.isArray(input.pageNames)
    ? [...new Set(input.pageNames.map((p) => p.trim()).filter(Boolean))]
    : [];

  const selectedPageNames =
    normalizedPageNames.length > 0
      ? normalizedPageNames
      : typeof input.pageName === "string" && input.pageName.trim()
        ? [input.pageName.trim()]
        : [];

  const buffer = await exportFileFromPowerBi({
    token: input.token,
    workspaceId: input.workspaceId,
    reportId: input.reportId,
    format: "PDF",
    pageNames: selectedPageNames,
    pageName: selectedPageNames[0] ?? null,
  });

  return {
    buffer,
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