"use client"

import { useMounted } from "@/hooks/use-mounted"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"
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

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Pendente", variant: "secondary" },
  exporting: { label: "Exportando", variant: "outline" },
  sending: { label: "Enviando", variant: "outline" },
  delivered: { label: "Entregue", variant: "default" },
  failed: { label: "Falhou", variant: "destructive" },
}

function formatLogAge(value?: string | null, mounted = false) {
  if (!value) {
    return "-"
  }

  if (!mounted) {
    return "-"
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return "-"
  }

  return formatDistanceToNow(parsed, {
    addSuffix: true,
    locale: ptBR,
  })
}

export function RecentDispatches({ logs }: { logs: DispatchLog[] }) {
  const mounted = useMounted()

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
                <TableHead>Contato</TableHead>
                <TableHead>Formato</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Quando</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const status = statusMap[log.status] ?? statusMap.pending
                return (
                  <TableRow key={log.id}>
                    <TableCell className="font-medium">
                      {log.report_name}
                    </TableCell>
                    <TableCell>{log.contact_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.export_format ?? "-"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatLogAge(log.started_at, mounted)}
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
