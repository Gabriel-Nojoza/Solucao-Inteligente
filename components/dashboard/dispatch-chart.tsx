"use client"

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

interface ChartDataPoint {
  date: string
  delivered: number
  failed: number
}

export function DispatchChart({ data }: { data: ChartDataPoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Disparos - Ultimos 7 dias</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="fillDelivered" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-chart-1)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-chart-1)"
                    stopOpacity={0}
                  />
                </linearGradient>
                <linearGradient id="fillFailed" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-destructive)"
                    stopOpacity={0.3}
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
                stroke="var(--color-chart-1)"
                strokeWidth={2}
                fill="url(#fillDelivered)"
                name="Entregues"
              />
              <Area
                type="monotone"
                dataKey="failed"
                stroke="var(--color-destructive)"
                strokeWidth={2}
                fill="url(#fillFailed)"
                name="Falharam"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
