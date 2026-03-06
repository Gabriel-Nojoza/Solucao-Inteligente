"use client"

import {
  FileBarChart2,
  Users,
  Send,
  CheckCircle,
  Zap,
  Link2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface StatsData {
  totalReports: number
  activeContacts: number
  dispatchesToday: number
  successRate: number
  pbiConfigured?: boolean
  n8nConfigured?: boolean
}

export function StatsCards({ data }: { data: StatsData }) {
  const stats = [
    {
      title: "Relatorios",
      value: data.totalReports,
      icon: FileBarChart2,
      description: "Sincronizados do Power BI",
      status: data.pbiConfigured
        ? { label: "Conectado", ok: true }
        : { label: "Desconectado", ok: false },
    },
    {
      title: "Contatos Ativos",
      value: data.activeContacts,
      icon: Users,
      description: "WhatsApp",
      status: null,
    },
    {
      title: "Disparos Hoje",
      value: data.dispatchesToday,
      icon: Send,
      description: "Envios realizados",
      status: data.n8nConfigured
        ? { label: "N8N ok", ok: true }
        : { label: "N8N pendente", ok: false },
    },
    {
      title: "Taxa de Sucesso",
      value: `${data.successRate}%`,
      icon: CheckCircle,
      description: "Ultimos 30 dias",
      status: null,
    },
  ]

  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {stat.title}
            </CardTitle>
            <stat.icon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stat.value}</div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                {stat.description}
              </p>
              {stat.status && (
                <Badge
                  variant={stat.status.ok ? "outline" : "secondary"}
                  className={`gap-1 text-[10px] leading-tight ${
                    stat.status.ok
                      ? "border-emerald-500/30 text-emerald-500"
                      : "text-muted-foreground"
                  }`}
                >
                  {stat.status.ok ? (
                    <Link2 className="size-2.5" />
                  ) : (
                    <Zap className="size-2.5" />
                  )}
                  {stat.status.label}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
