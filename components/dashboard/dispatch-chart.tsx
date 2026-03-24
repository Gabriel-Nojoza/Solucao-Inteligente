"use client"

import { useMemo } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface ChartDataPoint {
  date: string
  total: number
  delivered: number
  failed: number
  inProgress: number
}

export function DispatchChart({ data }: { data: ChartDataPoint[] }) {
  const summary = useMemo(
    () =>
      data.reduce(
        (accumulator, item) => ({
          total: accumulator.total + item.total,
          delivered: accumulator.delivered + item.delivered,
          failed: accumulator.failed + item.failed,
          inProgress: accumulator.inProgress + item.inProgress,
        }),
        { total: 0, delivered: 0, failed: 0, inProgress: 0 }
      ),
    [data]
  )

  const hasActivity = summary.total > 0

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <CardTitle className="text-base">Disparos - Ultimos 7 dias</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Total {summary.total}</Badge>
          <Badge className="border-success/30 bg-success/10 text-success" variant="outline">
            Enviados {summary.delivered}
          </Badge>
          <Badge variant="outline" className="border-warning/40 text-warning">
            Em andamento {summary.inProgress}
          </Badge>
          <Badge variant="destructive">Falhos {summary.failed}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {!hasActivity ? (
          <div className="flex h-[300px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
            Nenhum disparo registrado nos ultimos 7 dias.
          </div>
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="fillDelivered" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fillInProgress" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-warning)" stopOpacity={0.24} />
                    <stop offset="95%" stopColor="var(--color-warning)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fillFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-destructive)"
                      stopOpacity={0.24}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-destructive)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-border"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  className="text-xs"
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  className="text-xs"
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-lg)",
                    color: "var(--color-popover-foreground)",
                    fontSize: 13,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="delivered"
                  stroke="var(--color-success)"
                  strokeWidth={2}
                  fill="url(#fillDelivered)"
                  name="Enviados"
                />
                <Area
                  type="monotone"
                  dataKey="inProgress"
                  stroke="var(--color-warning)"
                  strokeWidth={2}
                  fill="url(#fillInProgress)"
                  name="Em andamento"
                />
                <Area
                  type="monotone"
                  dataKey="failed"
                  stroke="var(--color-destructive)"
                  strokeWidth={2}
                  fill="url(#fillFailed)"
                  name="Falhos"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
