import { PowerBIReportViewer } from "@/components/reports/powerbi-report-viewer"

export default async function ReportViewerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return <PowerBIReportViewer reportId={id} />
}
