"use client"

import useSWR from "swr"
import Link from "next/link"
import {
  Users,
  Settings,
  Activity,
  Shield,
  UserPlus,
  ChevronRight,
  BarChart3,
  Zap,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { PageHeader } from "@/components/dashboard/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const STAT_CARDS = [
  {
    key: "totalUsers",
    title: "Total de Usuarios",
    icon: Users,
    description: "Usuarios cadastrados",
    accent: "border-l-blue-500",
    iconColor: "text-blue-500",
    iconBg: "bg-blue-500/10",
  },
  {
    key: "activeUsers",
    title: "Usuarios Ativos",
    icon: Activity,
    description: "Logaram nos ultimos 7 dias",
    accent: "border-l-emerald-500",
    iconColor: "text-emerald-500",
    iconBg: "bg-emerald-500/10",
  },
  {
    key: "adminUsers",
    title: "Administradores",
    icon: Shield,
    description: "Com acesso admin",
    accent: "border-l-amber-500",
    iconColor: "text-amber-500",
    iconBg: "bg-amber-500/10",
  },
  {
    key: "settingsCount",
    title: "Configuracoes",
    icon: Settings,
    description: "Itens configurados",
    accent: "border-l-purple-500",
    iconColor: "text-purple-500",
    iconBg: "bg-purple-500/10",
  },
]

const QUICK_ACTIONS = [
  {
    label: "Gerenciar Usuarios",
    href: "/admin/users",
    icon: UserPlus,
    iconColor: "text-blue-500",
  },
  {
    label: "Configuracoes do Sistema",
    href: "/admin/settings",
    icon: Settings,
    iconColor: "text-purple-500",
  },
  {
    label: "Integracao Power BI",
    href: "/admin/settings",
    icon: BarChart3,
    iconColor: "text-emerald-500",
  },
  {
    label: "Automacoes N8N",
    href: "/admin/settings",
    icon: Zap,
    iconColor: "text-amber-500",
  },
]

type AdminUser = {
  id: string
  email?: string
  created_at?: string
  user_metadata?: { name?: string; role?: string }
}

function getUserInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export default function AdminDashboardPage() {
  const { data: stats, isLoading: statsLoading } = useSWR("/api/admin/stats", fetcher)
  const { data: usersRaw, isLoading: usersLoading } = useSWR("/api/admin/users", fetcher)

  const recentUsers: AdminUser[] = Array.isArray(usersRaw) ? usersRaw.slice(0, 6) : []

  if (statsLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader
          title="Painel Administrativo"
          description="Gerencie usuarios e configuracoes do sistema"
        />
        <div className="flex flex-col gap-6 p-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-72 rounded-xl lg:col-span-2" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Painel Administrativo"
        description="Gerencie usuarios e configuracoes do sistema"
        action={
          <Button asChild size="sm">
            <Link href="/admin/users">
              <UserPlus className="mr-2 size-4" />
              Novo Usuario
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-6 p-6">
        {/* Stat Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STAT_CARDS.map((card) => (
            <Card key={card.key} className={`border-l-4 ${card.accent}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.title}
                </CardTitle>
                <div className={`rounded-lg p-2 ${card.iconBg}`}>
                  <card.icon className={`size-4 ${card.iconColor}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tracking-tight">
                  {stats?.[card.key] ?? 0}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Bottom section */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Recent Users */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">Usuarios Recentes</CardTitle>
                <CardDescription className="text-xs">
                  Ultimos usuarios cadastrados no sistema
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild className="text-xs">
                <Link href="/admin/users">
                  Ver todos
                  <ChevronRight className="ml-1 size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {usersLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-10 w-full rounded-lg" />
                  ))}
                </div>
              ) : recentUsers.length === 0 ? (
                <div className="flex h-32 items-center justify-center">
                  <p className="text-sm text-muted-foreground">Nenhum usuario cadastrado</p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {recentUsers.map((user) => {
                    const name = user.user_metadata?.name || user.email || "Sem nome"
                    const email = user.email ?? ""
                    const role = user.user_metadata?.role ?? "client"
                    const initials = getUserInitials(name)

                    return (
                      <div
                        key={user.id}
                        className="flex items-center gap-3 px-2 py-2.5 hover:bg-muted/40 rounded-lg transition-colors"
                      >
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-none truncate">{name}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{email}</p>
                        </div>
                        <Badge
                          variant={role === "admin" ? "default" : "secondary"}
                          className="shrink-0 text-xs"
                        >
                          {role === "admin" ? "Admin" : "Cliente"}
                        </Badge>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Acoes Rapidas</CardTitle>
              <CardDescription className="text-xs">
                Atalhos para as funcoes principais
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-4 pb-4">
              {QUICK_ACTIONS.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  className="w-full justify-start gap-3 text-sm"
                  asChild
                >
                  <Link href={action.href}>
                    <action.icon className={`size-4 ${action.iconColor}`} />
                    {action.label}
                  </Link>
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
