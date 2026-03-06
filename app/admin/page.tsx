"use client"

import useSWR from "swr"
import { Users, Settings, Activity, Shield } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/dashboard/page-header"
import { Skeleton } from "@/components/ui/skeleton"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function AdminDashboardPage() {
  const { data: stats, isLoading } = useSWR("/api/admin/stats", fetcher)

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="Painel Administrativo" />
        <div className="grid gap-4 p-6 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const cards = [
    {
      title: "Total de Usuarios",
      value: stats?.totalUsers ?? 0,
      icon: Users,
      description: "Usuarios cadastrados",
    },
    {
      title: "Usuarios Ativos",
      value: stats?.activeUsers ?? 0,
      icon: Activity,
      description: "Logaram nos ultimos 7 dias",
    },
    {
      title: "Administradores",
      value: stats?.adminUsers ?? 0,
      icon: Shield,
      description: "Com acesso admin",
    },
    {
      title: "Configuracoes",
      value: stats?.settingsCount ?? 0,
      icon: Settings,
      description: "Itens configurados",
    },
  ]

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Painel Administrativo"
        description="Gerencie usuarios e configuracoes do sistema"
      />
      <div className="flex flex-col gap-6 p-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.title}
                </CardTitle>
                <card.icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
                <p className="text-xs text-muted-foreground">{card.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
