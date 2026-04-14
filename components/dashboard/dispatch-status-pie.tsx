"use client"

import { Pie, PieChart, ResponsiveContainer, Tooltip, Cell } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type StatusBreakdownItem = {
  key: string
  label: string
  value: number
}

const STATUS_COLORS: Record<string, string> = {
  delivered: "#10b981",
  failed: "#ef4444",
  ongoing: "#f59e0b",
}

function formatPercentage(value: number, total: number) {
  if (total <= 0) {
    return "0%"
  }

  return `${Math.round((value / total) * 100)}%`
}

export function DispatchStatusPie({ data }: { data: StatusBreakdownItem[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const pieData = data
    .filter((item) => item.value > 0)
    .map((item) => ({
      ...item,
      fill: STATUS_COLORS[item.key] ?? "#64748b",
    }))

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">Status dos Disparos</CardTitle>
        <p className="text-sm text-muted-foreground">
          Ultimos 30 dias com a mesma base da taxa de sucesso
        </p>
      </CardHeader>
      <CardContent className="flex h-[360px] flex-col justify-between gap-3">
        {total === 0 ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border/80 bg-muted/10 text-center text-sm text-muted-foreground">
            Nenhum envio encontrado nos ultimos 30 dias.
          </div>
        ) : (
          <>
            <div className="relative h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${value} envio(s)`,
                      name,
                    ]}
                    contentStyle={{
                      backgroundColor: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-lg)",
                      color: "#ffffff",
                      fontSize: 13,
                    }}
                    itemStyle={{ color: "#ffffff" }}
                    labelStyle={{ color: "#ffffff" }}
                  />
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={72}
                    outerRadius={108}
                    paddingAngle={2}
                    stroke="var(--color-background)"
                    strokeWidth={3}
                    cx="50%"
                    cy="50%"
                  >
                    {pieData.map((item) => (
                      <Cell key={item.key} fill={item.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-semibold">{total}</span>
                <span className="text-sm text-muted-foreground">envios</span>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {data.map((item) => (
                <div
                  key={item.key}
                  className="rounded-lg border border-border/80 bg-muted/10 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[item.key] ?? "#64748b" }}
                      />
                      <span className="truncate text-sm font-medium text-foreground/90">
                        {item.label}
                      </span>
                    </div>
                    <span className="text-base font-semibold">{item.value}</span>
                  </div>
                  <p className="pt-1 text-xs text-muted-foreground">
                    {formatPercentage(item.value, total)} do total
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
