import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import { getAccessToken } from "@/lib/powerbi"

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ callback_secret?: string }>
}

async function resolveCompanyIdByCallbackSecret(secret: string) {
  if (!secret) return null

  const supabase = createServiceClient()
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

export default async function ReportPrintPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params
  const { callback_secret } = await searchParams

  const secret = typeof callback_secret === "string" ? callback_secret.trim() : ""
  const companyId = await resolveCompanyIdByCallbackSecret(secret)

  if (!companyId) {
    return notFound()
  }

  const supabase = createServiceClient()

  const { data: report, error: reportError } = await supabase
    .from("reports")
    .select("id, name, pbi_report_id, workspace_id, embed_url, is_active")
    .eq("company_id", companyId)
    .eq("id", id)
    .eq("is_active", true)
    .single()

  if (reportError || !report) {
    return notFound()
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, pbi_workspace_id, is_active")
    .eq("company_id", companyId)
    .eq("id", report.workspace_id)
    .eq("is_active", true)
    .single()

  if (workspaceError || !workspace?.pbi_workspace_id) {
    return notFound()
  }

  const token = await getAccessToken(companyId)
  const embedToken = await fetchEmbedToken({
    token,
    workspaceId: workspace.pbi_workspace_id,
    reportId: report.pbi_report_id,
  })

  return (
    <html lang="pt-BR">
      <head>
        <title>{report.name}</title>
        <script src="https://cdn.jsdelivr.net/npm/powerbi-client@2.23.1/dist/powerbi.min.js" />
        <style>{`
          html, body {
            margin: 0;
            padding: 0;
            background: #ffffff;
            font-family: Arial, sans-serif;
          }

          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .page {
            width: 100%;
            min-height: 100vh;
            background: #fff;
            padding: 0;
          }

          .report-shell {
            width: 100%;
            min-height: 100vh;
            background: #fff;
          }

          #report-container {
            width: 100%;
            height: 2200px;
            background: #fff;
          }

          .status {
            position: fixed;
            top: 16px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 50;
            background: rgba(15, 23, 42, 0.88);
            color: white;
            border-radius: 999px;
            padding: 10px 16px;
            font-size: 13px;
          }

          .status.hidden {
            display: none;
          }

          @page {
            size: 320mm 520mm;
            margin: 0;
          }
        `}</style>
      </head>
      <body>
        <div className="page">
          <div id="status" className="status">
            Carregando relatorio...
          </div>
          <div className="report-shell">
            <div id="report-container" />
          </div>
          <div data-report-ready="false" id="report-ready-marker" />
        </div>

        <script
          dangerouslySetInnerHTML={{
            __html: `
              (() => {
                const reportContainer = document.getElementById("report-container");
                const statusNode = document.getElementById("status");
                const readyMarker = document.getElementById("report-ready-marker");

                const modelsSource = window["powerbi-client"];
                const models = modelsSource && modelsSource.models;
                const powerbi = window.powerbi;

                if (!reportContainer || !models || !powerbi) {
                  if (statusNode) statusNode.textContent = "Erro ao carregar Power BI.";
                  return;
                }

                const config = {
                  type: "report",
                  id: ${JSON.stringify(report.pbi_report_id)},
                  embedUrl: ${JSON.stringify(report.embed_url)},
                  accessToken: ${JSON.stringify(embedToken)},
                  tokenType: models.TokenType.Embed,
                  permissions: models.Permissions.Read,
                  settings: {
                    panes: {
                      filters: { visible: false },
                      pageNavigation: { visible: false }
                    },
                    navContentPaneEnabled: false,
                    filterPaneEnabled: false,
                    background: models.BackgroundType.Transparent
                  }
                };

                const report = powerbi.embed(reportContainer, config);

                report.on("loaded", function () {
                  if (statusNode) {
                    statusNode.textContent = "Renderizando relatorio...";
                  }
                });

                report.on("rendered", function () {
                  window.setTimeout(() => {
                    if (statusNode) {
                      statusNode.classList.add("hidden");
                    }
                    if (readyMarker) {
                      readyMarker.setAttribute("data-report-ready", "true");
                    }
                  }, 2500);
                });

                report.on("error", function (event) {
                  if (statusNode) {
                    statusNode.textContent =
                      event?.detail?.message || "Erro ao renderizar relatorio.";
                  }
                });
              })();
            `,
          }}
        />
      </body>
    </html>
  )
}

async function fetchEmbedToken(input: {
  token: string
  workspaceId: string
  reportId: string
}) {
  const response = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${input.workspaceId}/reports/${input.reportId}/GenerateToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accessLevel: "View",
        allowSaveAs: false,
      }),
      cache: "no-store",
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Falha ao gerar embed token: ${errorText}`)
  }

  const data = (await response.json()) as { token?: string | null }
  const embedToken = typeof data.token === "string" ? data.token.trim() : ""

  if (!embedToken) {
    throw new Error("Power BI nao retornou token de exibicao.")
  }

  return embedToken
}
