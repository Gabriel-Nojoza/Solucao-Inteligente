"use client"

import { isValid } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { DispatchLog } from "@/lib/types"
import { formatShortDateTimePtBr } from "@/lib/datetime"
import { cn } from "@/lib/utils"

const statusConfig: Record<
  string,
  {
    label: string
    variant: "default" | "secondary" | "destructive" | "outline"
    className?: string
  }
> = {
  pending: { label: "Em andamento", variant: "secondary" },
  exporting: {
    label: "Exportando",
    variant: "outline",
    className: "border-chart-1/40 text-chart-1",
  },
  sending: {
    label: "Enviando",
    variant: "outline",
    className: "border-warning/40 text-warning",
  },
  delivered: {
    label: "Enviado",
    variant: "default",
    className: "bg-success text-success-foreground",
  },
  failed: { label: "Nao enviado", variant: "destructive" },
}

function getLogDate(log: DispatchLog) {
  const candidates = [log.created_at, log.started_at, log.completed_at]

  for (const value of candidates) {
    if (!value) {
      continue
    }

    const parsed = new Date(value)
    if (isValid(parsed)) {
      return parsed
    }
  }

  return null
}

function getDisplayStatus(log: DispatchLog) {
  if (log.status === "delivered") {
    return statusConfig.delivered
  }

  if (log.status === "failed" || !!log.error_message) {
    return statusConfig.failed
  }

  if (log.status === "sending") {
    return statusConfig.sending
  }

  if (log.status === "exporting") {
    return statusConfig.exporting
  }

  return statusConfig.pending
}

function formatLogDate(log: DispatchLog) {
  const parsed = getLogDate(log)
  return parsed ? formatShortDateTimePtBr(parsed) : "-"
}

export function RecentDispatches({ logs }: { logs: DispatchLog[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ultimos Disparos</CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum disparo realizado ainda.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Relatorio</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead>Formato</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const status = getDisplayStatus(log)

                return (
                  <TableRow key={log.id}>
                    <TableCell className="font-medium">{log.report_name}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p>{log.contact_name}</p>
                        {log.contact_phone && log.contact_phone !== log.contact_name ? (
                          <p className="text-xs text-muted-foreground">{log.contact_phone}</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.export_format ?? "-"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant} className={cn(status.className)}>
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatLogDate(log)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
