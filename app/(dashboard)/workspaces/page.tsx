"use client"

import { useState } from "react"
import useSWR, { mutate } from "swr"
import { RefreshCw, FolderKanban, FileBarChart2, ExternalLink } from "lucide-react"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"
import { useMounted } from "@/hooks/use-mounted"
import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import type { Workspace } from "@/lib/types"

interface WorkspaceWithReports extends Workspace {
  reports: Array<{ id: string; count: number }>
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatWorkspaceSyncAge(value?: string | null, mounted = false) {
  if (!value) {
    return null
  }

  if (!mounted) {
    return null
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return formatDistanceToNow(parsed, {
    addSuffix: true,
    locale: ptBR,
  })
}

export default function WorkspacesPage() {
  const mounted = useMounted()
  const { data: workspaces, isLoading } = useSWR<WorkspaceWithReports[]>(
    "/api/workspaces",
    fetcher
  )
  const [syncing, setSyncing] = useState(false)

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch("/api/powerbi/sync", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const warningCount = Array.isArray(data?.warnings) ? data.warnings.length : 0
      const inactiveWorkspaceCount = Number(data?.inactive_workspaces ?? 0)
      const removedCatalogCount = Number(data?.removed_catalog_datasets ?? 0)
      const baseMessage = `Sincronizado: ${data.workspaces} workspace(s), ${data.reports} relatorio(s) e ${data.datasets ?? 0} dataset(s)`

      if (warningCount > 0 || inactiveWorkspaceCount > 0 || removedCatalogCount > 0) {
        const details = [
          inactiveWorkspaceCount > 0
            ? `${inactiveWorkspaceCount} workspace(s) obsoleto(s) foram desativados`
            : null,
          removedCatalogCount > 0
            ? `${removedCatalogCount} catalogo(s) de dataset obsoleto(s) foram removidos`
            : null,
          warningCount > 0 ? `${warningCount} aviso(s) ocorreram durante a atualizacao` : null,
        ]
          .filter(Boolean)
          .join(". ")

        toast.success(`${baseMessage}. ${details}.`)
      } else {
        toast.success(baseMessage)
      }
      mutate("/api/workspaces")
      mutate("/api/reports")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao sincronizar"
      )
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Workspaces"
        description="Workspaces sincronizados do Power BI"
      >
        <Button onClick={handleSync} disabled={syncing} size="sm">
          <RefreshCw className={`mr-1 size-4 ${syncing ? "animate-spin" : ""}`} />
          Sincronizar Power BI
        </Button>
      </PageHeader>

      <div className="flex flex-1 flex-col gap-4 p-6">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[180px] rounded-xl" />
            ))}
          </div>
        ) : !workspaces || workspaces.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <FolderKanban className="size-12 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">Nenhum workspace encontrado</p>
                <p className="text-sm text-muted-foreground">
                  Configure as credenciais do Power BI em Configuracoes e clique
                  em Sincronizar.
                </p>
              </div>
              <Button onClick={handleSync} disabled={syncing}>
                <RefreshCw
                  className={`mr-1 size-4 ${syncing ? "animate-spin" : ""}`}
                />
                Sincronizar Agora
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((ws) => (
              <Card key={ws.id} className="transition-colors hover:border-primary/30">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-primary/10 p-2">
                      <FolderKanban className="size-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-medium leading-tight">
                        {ws.name}
                      </CardTitle>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {ws.pbi_workspace_id.slice(0, 8)}...
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={ws.is_active}
                    onCheckedChange={async (checked) => {
                      await fetch("/api/workspaces", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: ws.id, is_active: checked }),
                      })
                      mutate("/api/workspaces")
                    }}
                  />
                </CardHeader>
                <CardContent>
                  {(() => {
                    const syncedAgo = formatWorkspaceSyncAge(ws.synced_at, mounted)

                    return (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FileBarChart2 className="size-3.5" />
                      <span>{ws.report_count ?? 0} relatorios</span>
                    </div>
                    {syncedAgo && (
                      <Badge variant="outline" className="text-xs">
                        {syncedAgo}
                      </Badge>
                    )}
                  </div>
                    )
                  })()}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
