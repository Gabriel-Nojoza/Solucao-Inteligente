"use client"

import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"
import { useMounted } from "@/hooks/use-mounted"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type UpcomingDispatch = {
  id: string
  scheduleName: string
  reportName: string
  exportFormat: string
  recurrence: string
  nextRunAt: string
  nextRunLabel: string
}

function formatTimeRemaining(nextRunAt: string, mounted = false) {
  if (!mounted) {
    return "-"
  }

  const parsed = new Date(nextRunAt)
  if (Number.isNaN(parsed.getTime())) {
    return "-"
  }

  return formatDistanceToNow(parsed, {
    addSuffix: true,
    locale: ptBR,
  })
}

export function UpcomingDispatches({ items }: { items: UpcomingDispatch[] }) {
  const mounted = useMounted()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Proximos Disparos</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum disparo agendado no momento.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rotina</TableHead>
                <TableHead>Relatorio</TableHead>
                <TableHead>Formato</TableHead>
                <TableHead>Recorrencia</TableHead>
                <TableHead className="text-right">Proximo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.scheduleName}</TableCell>
                  <TableCell className="max-w-[240px] truncate">{item.reportName}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.exportFormat}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[260px] text-muted-foreground">
                    <span className="line-clamp-2">{item.recurrence}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{item.nextRunLabel}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimeRemaining(item.nextRunAt, mounted)}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
