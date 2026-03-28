"use client"

import { useState, useCallback } from "react"
import useSWR from "swr"
import { format, isValid } from "date-fns"
import { ptBR } from "date-fns/locale"
import {
  ScrollText,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Download,
} from "lucide-react"
import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "sonner"
import type { DispatchLog } from "@/lib/types"
import { formatShortDateTimePtBr } from "@/lib/datetime"
import { getDispatchLogDisplayStatus } from "@/lib/dispatch-log"

const PAGE_SIZE = 20
const fetcher = (url: string) => fetch(url).then((r) => r.json())

function getLogDate(log: DispatchLog) {
  const candidates = [log.created_at, log.started_at, log.completed_at]

  for (const value of candidates) {
    if (!value) continue

    const parsed = new Date(value)
    if (isValid(parsed)) {
      return parsed
    }
  }

  return null
}

function formatLogDate(log: DispatchLog) {
  const parsed = getLogDate(log)
  if (!parsed) {
    return "-"
  }

  return formatShortDateTimePtBr(parsed)
}

export default function LogsPage() {
  const [statusFilter, setStatusFilter] = useState("all")
  const [page, setPage] = useState(0)

  const offset = page * PAGE_SIZE
  const url = `/api/logs?limit=${PAGE_SIZE}&offset=${offset}${
    statusFilter !== "all" ? `&status=${statusFilter}` : ""
  }`

  const {
    data,
    isLoading,
    mutate: refreshLogs,
  } = useSWR<{
    data: DispatchLog[]
    count: number
  }>(url, fetcher, { refreshInterval: 15000 })

  const logs = data?.data ?? []
  const total = data?.count ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Export CSV
  const handleExportCSV = useCallback(async () => {
    try {
      // Fetch all logs for current filter (no pagination)
      const exportUrl = `/api/logs?limit=10000&offset=0${
        statusFilter !== "all" ? `&status=${statusFilter}` : ""
      }`
      const res = await fetch(exportUrl)
      const json = await res.json()
      const allLogs: DispatchLog[] = json.data ?? []

      if (allLogs.length === 0) {
        toast.error("Nenhum log para exportar.")
        return
      }

      const headers = [
        "Data/Hora",
        "Relatorio",
        "Contato",
        "Telefone",
        "Formato",
        "Status",
        "Erro",
      ]
      const rows = allLogs.map((log) => {
        const logDate = getLogDate(log)

        return [
          logDate
            ? format(logDate, "dd/MM/yyyy HH:mm:ss", {
                locale: ptBR,
              })
            : "-",
          log.report_name,
          log.contact_name,
          log.contact_phone ?? "",
          log.export_format ?? "",
          getDispatchLogDisplayStatus(log).label,
          log.error_message ?? "",
        ]
      })

      const csvContent = [
        headers.join(";"),
        ...rows.map((r) =>
          r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")
        ),
      ].join("\n")

      const blob = new Blob(["\ufeff" + csvContent], {
        type: "text/csv;charset=utf-8;",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `logs-solucao-inteligente-${format(new Date(), "yyyy-MM-dd")}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`${allLogs.length} log(s) exportado(s) para CSV.`)
    } catch {
      toast.error("Erro ao exportar CSV.")
    }
  }, [statusFilter])

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Logs de Disparo"
        description={`${total} registro(s) encontrado(s)`}
      >
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <Download className="mr-1 size-4" />
            <span className="hidden sm:inline">Exportar CSV</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => refreshLogs()}>
            <RefreshCw className="mr-1 size-4" />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        </div>
      </PageHeader>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v)
              setPage(0)
            }}
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Em andamento</SelectItem>
              <SelectItem value="exporting">Em andamento</SelectItem>
              <SelectItem value="sending">Em andamento</SelectItem>
              <SelectItem value="delivered">Enviado</SelectItem>
              <SelectItem value="failed">Erro</SelectItem>
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
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-12">
                <ScrollText className="size-12 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Nenhum log encontrado.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data/Hora</TableHead>
                      <TableHead>Relatorio</TableHead>
                      <TableHead className="hidden sm:table-cell">
                        Contato
                      </TableHead>
                      <TableHead className="hidden md:table-cell">
                        Telefone
                      </TableHead>
                      <TableHead className="hidden md:table-cell">
                        Formato
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Erro
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => {
                      const status = getDispatchLogDisplayStatus(log)
                      return (
                        <TableRow key={log.id}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatLogDate(log)}
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate font-medium">
                            {log.report_name}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {log.contact_name}
                          </TableCell>
                          <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                            {log.contact_phone ?? "-"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Badge variant="outline">
                              {log.export_format ?? "-"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={status.variant}
                              className={status.className}
                            >
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden max-w-[200px] lg:table-cell">
                            {log.error_message ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help truncate text-xs text-destructive">
                                      {log.error_message.slice(0, 40)}...
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    <p className="text-xs">
                                      {log.error_message}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                -
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Pagina {page + 1} de {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
                <span className="sr-only">Anterior</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="size-4" />
                <span className="sr-only">Proximo</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
