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
  FileText,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { PageHeader } from "@/components/dashboard/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { CompanyStatItem } from "@/app/api/admin/company-stats/route"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// Paleta de cores para graficos
const CHART_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
  "#ef4444", "#06b6d4", "#f97316", "#84cc16",
]

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
  { label: "Gerenciar Usuarios", href: "/admin/users", icon: UserPlus, iconColor: "text-blue-500" },
  { label: "Configuracoes do Sistema", href: "/admin/settings", icon: Settings, iconColor: "text-purple-500" },
  { label: "Integracao Power BI", href: "/admin/settings", icon: BarChart3, iconColor: "text-emerald-500" },
  { label: "Automacoes N8N", href: "/admin/settings", icon: Zap, iconColor: "text-amber-500" },
]

type AdminUser = {
  id: string
  email?: string
  user_metadata?: { name?: string; role?: string }
}

function getUserInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

function formatDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

// Tooltip customizado para os graficos
function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number; color: string; name: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium text-foreground">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

function PieCustomTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; payload: { percent: number } }>
}) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{p.name}</p>
      <p className="text-muted-foreground">
        {p.value} disparos ({Math.round(p.payload.percent * 100)}%)
      </p>
    </div>
  )
}

export default function AdminDashboardPage() {
  const { data: stats, isLoading: statsLoading } = useSWR("/api/admin/stats", fetcher)
  const { data: usersRaw, isLoading: usersLoading } = useSWR("/api/admin/users", fetcher)
  const { data: companyStats, isLoading: companyLoading } = useSWR<CompanyStatItem[]>(
    "/api/admin/company-stats",
    fetcher
  )

  const recentUsers: AdminUser[] = Array.isArray(usersRaw) ? usersRaw.slice(0, 6) : []
  const companies: CompanyStatItem[] = Array.isArray(companyStats) ? companyStats : []

  // Dados para o grafico de barras (relatorios por empresa)
  const reportBarData = companies.map((c, i) => ({
    name: c.companyName.length > 14 ? c.companyName.slice(0, 14) + "…" : c.companyName,
    fullName: c.companyName,
    disparos: c.dispatches30d,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }))

  // Dados para o grafico de pizza (distribuicao de disparos)
  const pieTotalData = companies
    .filter((c) => c.dispatches30d > 0)
    .map((c, i) => ({
      name: c.companyName,
      value: c.dispatches30d,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }))

  // Dados para o grafico de chat (trial por empresa)
  const chatBarData = companies
    .filter((c) => c.chatTrialDays !== null)
    .map((c, i) => ({
      name: c.companyName.length > 14 ? c.companyName.slice(0, 14) + "…" : c.companyName,
      fullName: c.companyName,
      dias: c.chatTrialDays ?? 0,
      color: c.chatTrialExpired ? "#ef4444" : CHART_COLORS[i % CHART_COLORS.length],
    }))

  if (statsLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="Painel Administrativo" description="Gerencie usuarios e configuracoes do sistema" />
        <div className="flex flex-col gap-6 p-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-72 rounded-xl lg:col-span-2" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
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
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                <div className={`rounded-lg p-2 ${card.iconBg}`}>
                  <card.icon className={`size-4 ${card.iconColor}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tracking-tight">{stats?.[card.key] ?? 0}</div>
                <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Usuarios recentes + Acoes rapidas */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">Usuarios Recentes</CardTitle>
                <CardDescription className="text-xs">Ultimos usuarios cadastrados</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild className="text-xs">
                <Link href="/admin/users">Ver todos <ChevronRight className="ml-1 size-3.5" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {usersLoading ? (
                <div className="space-y-3">{[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
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
                    return (
                      <div key={user.id} className="flex items-center gap-3 px-2 py-2.5 hover:bg-muted/40 rounded-lg transition-colors">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {getUserInitials(name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-none truncate">{name}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{email}</p>
                        </div>
                        <Badge variant={role === "admin" ? "default" : "secondary"} className="shrink-0 text-xs">
                          {role === "admin" ? "Admin" : "Cliente"}
                        </Badge>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Acoes Rapidas</CardTitle>
              <CardDescription className="text-xs">Atalhos para as funcoes principais</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-4 pb-4">
              {QUICK_ACTIONS.map((action) => (
                <Button key={action.label} variant="outline" className="w-full justify-start gap-3 text-sm" asChild>
                  <Link href={action.href}>
                    <action.icon className={`size-4 ${action.iconColor}`} />
                    {action.label}
                  </Link>
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* ============================
            RELATORIOS POR EMPRESA
        ============================= */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Tabela de relatorios */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-500/10 p-2">
                  <FileText className="size-4 text-blue-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Relatorios por Empresa</CardTitle>
                  <CardDescription className="text-xs">Disparos realizados nos ultimos 30 dias</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {companyLoading ? (
                <div className="space-y-2 px-4 pb-4">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : companies.length === 0 ? (
                <div className="flex h-32 items-center justify-center">
                  <p className="text-sm text-muted-foreground">Nenhuma empresa encontrada</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Empresa</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Total</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">30 dias</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">
                          <span className="flex items-center justify-center gap-1">
                            <CheckCircle2 className="size-3 text-emerald-500" /> Entregues
                          </span>
                        </th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">
                          <span className="flex items-center justify-center gap-1">
                            <XCircle className="size-3 text-red-500" /> Falhas
                          </span>
                        </th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Taxa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {companies.map((c) => (
                        <tr key={c.companyId} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-medium">{c.companyName}</td>
                          <td className="px-4 py-3 text-center text-muted-foreground">{c.totalDispatches}</td>
                          <td className="px-4 py-3 text-center font-semibold">{c.dispatches30d}</td>
                          <td className="px-4 py-3 text-center text-emerald-600 dark:text-emerald-400">{c.deliveredDispatches}</td>
                          <td className="px-4 py-3 text-center text-red-600 dark:text-red-400">{c.failedDispatches}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge
                              variant={c.successRate >= 80 ? "default" : c.successRate >= 50 ? "secondary" : "destructive"}
                              className="text-xs"
                            >
                              {c.successRate}%
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Grafico de pizza - distribuicao de disparos */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Distribuicao de Disparos</CardTitle>
              <CardDescription className="text-xs">Percentual por empresa (30 dias)</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-center pb-4">
              {companyLoading ? (
                <Skeleton className="h-52 w-52 rounded-full" />
              ) : pieTotalData.length === 0 ? (
                <div className="flex h-52 items-center justify-center">
                  <p className="text-xs text-muted-foreground">Sem dados de disparos</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={pieTotalData}
                      cx="50%"
                      cy="45%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieTotalData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieCustomTooltip />} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) => (
                        <span className="text-xs text-foreground">
                          {String(value).length > 16 ? String(value).slice(0, 16) + "…" : value}
                        </span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Grafico de barras - relatorios */}
        {!companyLoading && reportBarData.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Volume de Disparos por Empresa</CardTitle>
              <CardDescription className="text-xs">Quantidade de relatorios enviados nos ultimos 30 dias</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={reportBarData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
                  <Bar dataKey="disparos" name="Disparos" radius={[4, 4, 0, 0]}>
                    {reportBarData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* ============================
            CHAT SIL POR EMPRESA
        ============================= */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Tabela de chat */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-purple-500/10 p-2">
                  <MessageSquare className="size-4 text-purple-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Chat SIL por Empresa</CardTitle>
                  <CardDescription className="text-xs">Situacao do trial e acesso ao assistente IA</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {companyLoading ? (
                <div className="space-y-2 px-4 pb-4">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : companies.length === 0 ? (
                <div className="flex h-32 items-center justify-center">
                  <p className="text-sm text-muted-foreground">Nenhuma empresa encontrada</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Empresa</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Chat IA</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">
                          <span className="flex items-center justify-center gap-1">
                            <Clock className="size-3" /> Dias de Trial
                          </span>
                        </th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Expiracao</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {companies.map((c) => (
                        <tr key={c.companyId} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-medium">{c.companyName}</td>
                          <td className="px-4 py-3 text-center">
                            {c.chatEnabled ? (
                              <CheckCircle2 className="mx-auto size-4 text-emerald-500" />
                            ) : (
                              <XCircle className="mx-auto size-4 text-muted-foreground" />
                            )}
                          </td>
                          <td className="px-4 py-3 text-center font-semibold">
                            {c.chatTrialDays !== null ? c.chatTrialDays : "—"}
                          </td>
                          <td className="px-4 py-3 text-center text-muted-foreground text-xs">
                            {formatDate(c.chatTrialEndsAt)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {!c.chatEnabled && c.chatTrialDays === null ? (
                              <Badge variant="outline" className="text-xs">Nao configurado</Badge>
                            ) : c.chatTrialExpired ? (
                              <Badge variant="destructive" className="text-xs">Expirado</Badge>
                            ) : c.chatEnabled ? (
                              <Badge className="bg-emerald-500 text-xs hover:bg-emerald-600">Ativo</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">Desativado</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Grafico de trial de chat */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Trial do Chat SIL</CardTitle>
              <CardDescription className="text-xs">Dias de trial configurados por empresa</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-center pb-4">
              {companyLoading ? (
                <Skeleton className="h-52 w-full rounded-lg" />
              ) : chatBarData.length === 0 ? (
                <div className="flex h-52 items-center justify-center">
                  <p className="text-xs text-muted-foreground">Nenhuma empresa com trial configurado</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chatBarData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
                    <Bar dataKey="dias" name="Dias de trial" radius={[0, 4, 4, 0]}>
                      {chatBarData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  )
}
