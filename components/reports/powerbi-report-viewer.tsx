"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import Script from "next/script"
import { AlertCircle, ExternalLink, Loader2, RefreshCcw } from "lucide-react"
import { PageHeader } from "@/components/dashboard/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { toast } from "sonner"

type EmbedPayload = {
  id: string
  name: string
  workspace_name: string
  pbi_workspace_id: string
  pbi_report_id: string
  web_url: string | null
  embed_url: string
  embed_token: string
}

type ReportPage = {
  name: string
  displayName: string
  order: number
}

type EmbeddedPowerBIReport = {
  on: (eventName: string, handler: (event?: unknown) => void) => void
  off?: (eventName: string) => void
  getPages?: () => Promise<
    Array<{
      name: string
      displayName: string
      isActive?: boolean
      setActive?: () => Promise<void>
    }>
  >
}

declare global {
  interface Window {
    powerbi?: {
      embed: (element: HTMLElement, config: Record<string, unknown>) => EmbeddedPowerBIReport
      reset?: (element: HTMLElement) => void
    }
    "powerbi-client"?: {
      models: {
        TokenType: { Embed: number }
        Permissions: { Read: number }
        BackgroundType: { Transparent: number }
      }
    }
  }
}

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error || "Falha ao carregar relatorio")
  }

  return data as EmbedPayload
}

const fetchPages = async (reportId: string) => {
  const response = await fetch(`/api/reports/${reportId}/pages`, { cache: "no-store" })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error || "Falha ao carregar paginas do relatorio")
  }

  return Array.isArray(data?.pages) ? (data.pages as ReportPage[]) : []
}

interface PowerBIReportViewerProps {
  reportId: string
}

export function PowerBIReportViewer({ reportId }: PowerBIReportViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const embeddedReportRef = useRef<EmbeddedPowerBIReport | null>(null)
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [embedData, setEmbedData] = useState<EmbedPayload | null>(null)
  const [pages, setPages] = useState<ReportPage[]>([])
  const [pagesLoading, setPagesLoading] = useState(false)
  const [activePageName, setActivePageName] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const pageDescription = useMemo(() => {
    if (!embedData) {
      return "Abrindo a visualizacao real do relatorio sincronizado do Power BI"
    }

    return `Workspace ${embedData.workspace_name} | Visualizacao real do relatorio no Power BI`
  }, [embedData])

  useEffect(() => {
    let cancelled = false

    async function loadEmbedConfig() {
      setLoading(true)
      setError(null)
      setPagesLoading(true)

      try {
        const [payload, reportPages] = await Promise.all([
          fetcher(`/api/reports/${reportId}/embed`),
          fetchPages(reportId),
        ])

        if (!cancelled) {
          setEmbedData(payload)
          setPages(reportPages)
          setActivePageName(reportPages[0]?.name ?? null)
        }
      } catch (nextError) {
        if (!cancelled) {
          setEmbedData(null)
          setPages([])
          setActivePageName(null)
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Nao foi possivel carregar o relatorio"
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setPagesLoading(false)
        }
      }
    }

    void loadEmbedConfig()

    return () => {
      cancelled = true
    }
  }, [reportId, reloadKey])

  useEffect(() => {
    if (!scriptLoaded || !embedData || !containerRef.current) {
      return
    }

    const powerbi = window.powerbi
    const models = window["powerbi-client"]?.models

    if (!powerbi || !models) {
      setError("Nao foi possivel carregar o cliente de visualizacao do Power BI.")
      return
    }

    if (powerbi.reset) {
      powerbi.reset(containerRef.current)
    }

    setRendering(true)
    setError(null)

    const embeddedReport = powerbi.embed(containerRef.current, {
      type: "report",
      id: embedData.pbi_report_id,
      embedUrl: embedData.embed_url,
      accessToken: embedData.embed_token,
      tokenType: models.TokenType.Embed,
      permissions: models.Permissions.Read,
      settings: {
        filterPaneEnabled: false,
        navContentPaneEnabled: false,
        panes: {
          filters: { visible: false },
          pageNavigation: { visible: false },
        },
        background: models.BackgroundType.Transparent,
      },
    })

    embeddedReportRef.current = embeddedReport

    embeddedReport.on("loaded", () => {
      setRendering(false)
      void embeddedReport
        .getPages?.()
        .then((reportPages) => {
          const currentActivePage =
            Array.isArray(reportPages) && reportPages.length
              ? reportPages.find((page) => page.isActive) ?? reportPages[0]
              : null

          setActivePageName(currentActivePage?.name ?? null)
        })
        .catch(() => {
          // If the Power BI client does not expose pages for this embed,
          // we keep using the list loaded from the API.
        })
    })

    embeddedReport.on("rendered", () => {
      setRendering(false)
    })

    embeddedReport.on("error", (event) => {
      const nextMessage =
        event &&
        typeof event === "object" &&
        "detail" in event &&
        event.detail &&
        typeof event.detail === "object" &&
        "message" in event.detail &&
        typeof event.detail.message === "string"
          ? event.detail.message
          : "Erro ao renderizar o relatorio do Power BI."

      setRendering(false)
      setError(nextMessage)
      toast.error(nextMessage)
    })

    return () => {
      embeddedReportRef.current = null
    }
  }, [embedData, scriptLoaded])

  async function handleSelectPage(pageName: string) {
    if (!pageName || activePageName === pageName || !embeddedReportRef.current?.getPages) {
      return
    }

    setRendering(true)

    try {
      const reportPages = await embeddedReportRef.current.getPages()
      const targetPage = reportPages.find((page) => page.name === pageName)

      if (!targetPage?.setActive) {
        throw new Error("Nao foi possivel localizar a pagina selecionada no Power BI.")
      }

      await targetPage.setActive()
      setActivePageName(pageName)
    } catch (nextError) {
      const nextMessage =
        nextError instanceof Error
          ? nextError.message
          : "Nao foi possivel trocar a pagina do relatorio."

      setRendering(false)
      toast.error(nextMessage)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-1rem)] flex-col">
      <Script
        src="https://cdn.jsdelivr.net/npm/powerbi-client@2.23.1/dist/powerbi.min.js"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onError={() => {
          setError("Nao foi possivel carregar a biblioteca do Power BI.")
          setScriptLoaded(false)
        }}
      />

      <PageHeader
        title={embedData?.name || "Visualizador de Relatorio"}
        description={pageDescription}
        action={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/reports">Voltar</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setReloadKey((current) => current + 1)}
              disabled={loading}
            >
              <RefreshCcw className="size-4" />
              Atualizar
            </Button>
            {embedData?.web_url ? (
              <Button size="sm" className="gap-1.5" asChild>
                <a href={embedData.web_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                  Abrir no Power BI
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          {embedData?.workspace_name ? (
            <Badge variant="outline">Workspace: {embedData.workspace_name}</Badge>
          ) : null}
          {embedData?.name ? <Badge variant="secondary">Relatorio: {embedData.name}</Badge> : null}
        </div>

        {!loading && !error ? (
          <Card className="border-border/70">
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Paginas do relatorio</p>
                  <p className="text-xs text-muted-foreground">
                    Selecione uma pagina para navegar dentro do embed.
                  </p>
                </div>
                {pages.length > 0 ? (
                  <Badge variant="outline">
                    {pages.length} {pages.length === 1 ? "pagina" : "paginas"}
                  </Badge>
                ) : null}
              </div>

              {pagesLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Carregando paginas...
                </div>
              ) : pages.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {pages.map((page) => {
                    const isActive = activePageName === page.name

                    return (
                      <Button
                        key={page.name}
                        type="button"
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        onClick={() => void handleSelectPage(page.name)}
                        disabled={rendering && !isActive}
                      >
                        {page.displayName || page.name}
                      </Button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma pagina foi retornada para este relatorio.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card className="relative flex flex-1 overflow-hidden border-border/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.9),rgba(241,245,249,0.7))]">
          <CardContent className="flex flex-1 p-0">
            {loading ? (
              <div className="flex w-full flex-1 items-center justify-center">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  Carregando configuracao do relatorio...
                </div>
              </div>
            ) : error ? (
              <div className="flex w-full flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertCircle className="size-10 text-destructive" />
                <div>
                  <p className="font-medium">Nao foi possivel abrir o relatorio</p>
                  <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                </div>
              </div>
            ) : (
              <div className="relative flex min-h-[78vh] w-full flex-1 bg-[#eef2f7] p-3 sm:p-4">
                {rendering ? (
                  <div className="pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background/95 px-4 py-2 text-xs text-muted-foreground shadow-sm">
                    <Loader2 className="size-3.5 animate-spin" />
                    Carregando a visualizacao real do Power BI...
                  </div>
                ) : null}

                <div className="flex w-full flex-1 overflow-hidden rounded-2xl border border-border/60 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
                  <div
                    ref={containerRef}
                    className="min-h-[74vh] w-full flex-1"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
