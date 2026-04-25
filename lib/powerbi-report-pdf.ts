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