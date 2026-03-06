"use client"

import { useState } from "react"
import useSWR from "swr"
import {
  FileBarChart2,
  ExternalLink,
  Search,
  Download,
} from "lucide-react"
import { PageHeader } from "@/components/dashboard/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
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

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function ReportsPage() {
  const { data: reports, isLoading } = useSWR<(Report & { workspace_name: string })[]>(
    "/api/reports",
    fetcher
  )
  const { data: workspaces } = useSWR<Workspace[]>("/api/workspaces", fetcher)
  const [search, setSearch] = useState("")
  const [wsFilter, setWsFilter] = useState("all")

  const filtered = (reports ?? []).filter((r) => {
    const matchSearch = r.name.toLowerCase().includes(search.toLowerCase())
    const matchWs = wsFilter === "all" || r.workspace_id === wsFilter
    return matchSearch && matchWs
  })

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
              {(workspaces ?? []).map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>
                  {ws.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-12">
                <FileBarChart2 className="size-12 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Nenhum relatorio encontrado</p>
                  <p className="text-sm text-muted-foreground">
                    Sincronize os workspaces do Power BI para ver os relatorios aqui.
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
                          <span className="font-medium">{report.name}</span>
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
                        <div className="flex items-center justify-end gap-1">
                          {report.web_url && (
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
