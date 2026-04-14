"use client"

import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  FileBarChart2,
  ExternalLink,
  Search,
  RefreshCcw,
  Loader2,
  Eye,
} from "lucide-react"
import { PageHeader } from "@/components/dashboard/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Report, Workspace } from "@/lib/types"
import { toast } from "sonner"

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error || "Falha ao carregar dados")
  }

  return data
}

export default function ReportsPage() {
  const {
    data: reports,
    isLoading,
    mutate: mutateReports,
  } = useSWR<(Report & { workspace_name: string })[]>("/api/reports", fetcher)

  const {
    data: workspaces,
    mutate: mutateWorkspaces,
  } = useSWR<Workspace[]>("/api/workspaces", fetcher)

  const reportList = Array.isArray(reports) ? reports : []
  const workspaceList = Array.isArray(workspaces) ? workspaces : []

  const [search, setSearch] = useState("")
  const [wsFilter, setWsFilter] = useState("all")
  const [syncingPowerBi, setSyncingPowerBi] = useState(false)

  const filtered = reportList.filter((report) => {
    const matchSearch = report.name.toLowerCase().includes(search.toLowerCase())
    const matchWs = wsFilter === "all" || report.workspace_id === wsFilter
    return matchSearch && matchWs
  })

  async function handleSyncPowerBi() {
    try {
      setSyncingPowerBi(true)

      const response = await fetch("/api/powerbi/sync", {
        method: "POST",
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao sincronizar Power BI")
      }

      await Promise.all([mutateReports(), mutateWorkspaces()])

      const warningCount = Array.isArray(data?.warnings) ? data.warnings.length : 0
      const inactiveWorkspaceCount = Number(data?.inactive_workspaces ?? 0)
      const removedCatalogCount = Number(data?.removed_catalog_datasets ?? 0)
      const baseMessage = `Sincronizacao concluida: ${data.workspaces ?? 0} workspace(s), ${data.reports ?? 0} relatorio(s) e ${data.datasets ?? 0} dataset(s).`

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

        toast.success(`${baseMessage} ${details}.`)
      } else {
        toast.success(baseMessage)
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao sincronizar Power BI"
      )
    } finally {
      setSyncingPowerBi(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Relatorios"
        description="Relatorios sincronizados do Power BI"
      />

      <div className="flex flex-1 flex-col gap-4 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar relatorios..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={wsFilter} onValueChange={setWsFilter}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="Workspace" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Workspaces</SelectItem>
              {workspaceList.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="outline"
            onClick={handleSyncPowerBi}
            disabled={syncingPowerBi}
            className="gap-2"
          >
            {syncingPowerBi ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
            {syncingPowerBi ? "Sincronizando..." : "Sincronizar Power BI"}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileBarChart2 className="size-4 text-primary" />
              Relatorios Power BI
            </CardTitle>
          </CardHeader>

          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 rounded" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-12">
                <FileBarChart2 className="size-12 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Nenhum relatorio encontrado</p>
                  <p className="text-sm text-muted-foreground">
                    Clique em sincronizar para buscar os relatorios do Power BI.
                  </p>
                </div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Acoes</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filtered.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileBarChart2 className="size-4 text-primary" />
                          {report.is_active ? (
                            <Link
                              href={`/reports/${report.id}`}
                              className="font-medium transition-colors hover:text-primary"
                            >
                              {report.name}
                            </Link>
                          ) : (
                            <span className="font-medium text-muted-foreground">{report.name}</span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline">{report.workspace_name}</Badge>
                      </TableCell>

                      <TableCell>
                        <Badge variant={report.is_active ? "default" : "secondary"}>
                          {report.is_active ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {report.is_active ? (
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/reports/${report.id}`} className="gap-1.5">
                                <Eye className="size-4" />
                                Abrir
                              </Link>
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" disabled className="gap-1.5">
                              <Eye className="size-4" />
                              Abrir
                            </Button>
                          )}

                          {report.is_active && report.web_url && (
                            <Button variant="ghost" size="icon" asChild>
                              <a
                                href={report.web_url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="size-4" />
                                <span className="sr-only">Abrir no Power BI</span>
                              </a>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
