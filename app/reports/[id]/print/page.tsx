import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import { generateReportEmbedToken, getAccessToken } from "@/lib/powerbi"

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
  const embedToken = await generateReportEmbedToken(
    token,
    workspace.pbi_workspace_id,
    report.pbi_report_id
  )

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
            overflow: visible;
          }

          #report-container {
            width: 100%;
            min-height: 2200px;
            height: auto;
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
                const reportShell = document.querySelector(".report-shell");
                const statusNode = document.getElementById("status");
                const readyMarker = document.getElementById("report-ready-marker");
                const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

                const modelsSource = window["powerbi-client"];
                const models = modelsSource && modelsSource.models;
                const powerbi = window.powerbi;
                let finished = false;
                let settlingRender = false;
                let lastVisualRenderedAt = 0;

                if (!reportContainer || !models || !powerbi) {
                  if (statusNode) statusNode.textContent = "Erro ao carregar Power BI.";
                  return;
                }

                function markReady() {
                  if (finished) {
                    return;
                  }

                  finished = true;

                  if (statusNode) {
                    statusNode.classList.add("hidden");
                  }

                  if (readyMarker) {
                    readyMarker.setAttribute("data-report-ready", "true");
                  }
                }

                function markError(message) {
                  finished = true;

                  if (statusNode) {
                    statusNode.classList.remove("hidden");
                    statusNode.textContent = message || "Erro ao renderizar relatorio.";
                  }

                  if (readyMarker) {
                    readyMarker.setAttribute("data-report-ready", "false");
                  }
                }

                async function syncReportHeight() {
                  try {
                    const pages = await report.getPages();
                    const activePage =
                      Array.isArray(pages) && pages.length
                        ? pages.find((page) => page.isActive) || pages[0]
                        : null;

                    const pageWidth = Number(
                      activePage && activePage.defaultSize && activePage.defaultSize.width
                    );
                    const pageHeight = Number(
                      activePage && activePage.defaultSize && activePage.defaultSize.height
                    );

                    if (
                      !Number.isFinite(pageWidth) ||
                      !Number.isFinite(pageHeight) ||
                      pageWidth <= 0 ||
                      pageHeight <= 0
                    ) {
                      return;
                    }

                    const shellWidth =
                      (reportShell && reportShell.clientWidth) ||
                      reportContainer.clientWidth ||
                      window.innerWidth;

                    if (!shellWidth) {
                      return;
                    }

                    const nextHeight = Math.max(
                      2200,
                      Math.ceil(shellWidth * (pageHeight / pageWidth))
                    );

                    reportContainer.style.height = nextHeight + "px";

                    if (reportShell) {
                      reportShell.style.minHeight = nextHeight + "px";
                    }

                    document.documentElement.style.minHeight = nextHeight + "px";
                    document.body.style.minHeight = nextHeight + "px";
                  } catch {
                    // Mantem a altura minima padrao quando a pagina ativa nao puder ser lida.
                  }
                }

                async function waitForVisualStability() {
                  const startedAt = Date.now();
                  const fallbackDelayMs = 9000;
                  const quietPeriodMs = 3200;
                  const maxWaitMs = 25000;

                  while (Date.now() - startedAt < maxWaitMs) {
                    if (finished) {
                      return false;
                    }

                    await syncReportHeight();

                    if (lastVisualRenderedAt > 0) {
                      if (Date.now() - lastVisualRenderedAt >= quietPeriodMs) {
                        await wait(1200);
                        return true;
                      }
                    } else if (Date.now() - startedAt >= fallbackDelayMs) {
                      await wait(1200);
                      return true;
                    }

                    await wait(500);
                  }

                  return true;
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
                    visualRenderedEvents: true,
                    layoutType: models.LayoutType.Custom,
                    customLayout: {
                      displayOption: models.DisplayOption.FitToWidth
                    },
                    navContentPaneEnabled: false,
                    filterPaneEnabled: false,
                    background: models.BackgroundType.Transparent
                  }
                };

                const report = powerbi.embed(reportContainer, config);

                report.on("loaded", async function () {
                  if (statusNode) {
                    statusNode.textContent = "Renderizando relatorio...";
                  }

                  await syncReportHeight();
                  await wait(1500);
                });

                report.on("visualRendered", function () {
                  lastVisualRenderedAt = Date.now();
                });

                report.on("rendered", function () {
                  if (settlingRender || finished) {
                    return;
                  }

                  settlingRender = true;

                  window.setTimeout(async () => {
                    if (statusNode) {
                      statusNode.textContent = "Relatorio carregado. Finalizando renderizacao...";
                    }

                    const visualsSettled = await waitForVisualStability();
                    if (!visualsSettled) {
                      settlingRender = false;
                      return;
                    }

                    await syncReportHeight();
                    await wait(1500);
                    markReady();
                    settlingRender = false;
                  }, 1500);
                });

                report.on("error", function (event) {
                  markError(event?.detail?.message || "Erro ao renderizar relatorio.");
                });

                window.setTimeout(() => {
                  if (!finished) {
                    markReady();
                  }
                }, 60000);

                window.addEventListener("resize", () => {
                  window.setTimeout(() => {
                    void syncReportHeight();
                  }, 120);
                });
              })();
            `,
          }}
        />
      </body>
    </html>
  )
}
