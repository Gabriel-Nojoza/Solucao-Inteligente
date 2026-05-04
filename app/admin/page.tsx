"use client"

import useSWR, { mutate } from "swr"
import Link from "next/link"
import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { AdminFloatingChat } from "@/components/admin-floating-chat"
import { RecentDispatches } from "@/components/dashboard/recent-dispatches"
import { UpcomingDispatches } from "@/components/dashboard/upcoming-dispatches"
import {
  Users, Settings, Activity, Shield, UserPlus, ChevronRight,
  BarChart3, Zap, FileText, MessageSquare, CheckCircle2, XCircle,
  Clock, ArrowRightLeft, Loader2, Pencil, Save, X, Plus,
} from "lucide-react"
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend, CartesianGrid,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { PageHeader } from "@/components/dashboard/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { CompanyStatItem, CompanyStatsResponse } from "@/app/api/admin/company-stats/route"
import type { AdminOperationalSummaryResponse, AdminUpcomingDispatchItem } from "@/app/api/admin/operational-summary/route"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const CHART_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
  "#ef4444", "#06b6d4", "#f97316", "#84cc16",
]

const STAT_CARDS = [
  { key: "totalUsers", title: "Total de Usuarios", icon: Users, description: "Usuarios cadastrados", accent: "border-l-blue-500", iconColor: "text-blue-500", iconBg: "bg-blue-500/10" },
  { key: "activeUsers", title: "Usuarios Ativos", icon: Activity, description: "Logaram nos ultimos 7 dias", accent: "border-l-emerald-500", iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10" },
  { key: "adminUsers", title: "Administradores", icon: Shield, description: "Com acesso admin", accent: "border-l-amber-500", iconColor: "text-amber-500", iconBg: "bg-amber-500/10" },
  { key: "settingsCount", title: "Configuracoes", icon: Settings, description: "Itens configurados", accent: "border-l-purple-500", iconColor: "text-purple-500", iconBg: "bg-purple-500/10" },
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

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; color: string; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: <span className="font-semibold">{p.value}</span></p>
      ))}
    </div>
  )
}

function PieCustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; percent?: number; payload: { percent?: number } }> }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  const percent = p.percent ?? p.payload?.percent
  const percentLabel = typeof percent === "number" && isFinite(percent) ? `${Math.round(percent * 100)}%` : ""
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{p.name}</p>
      <p className="text-muted-foreground">{p.value} disparos{percentLabel ? ` (${percentLabel})` : ""}</p>
    </div>
  )
}

function PriceEditor({ value, onSave, loading }: {
  value: number | null
  onSave: (val: number | null) => void
  loading: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState(value !== null ? value.toFixed(2) : "")

  function handleSave() {
    if (input.trim() === "") { onSave(null); setEditing(false); return }
    const parsed = parseFloat(input.replace(",", "."))
    if (isNaN(parsed) || parsed < 0) return
    onSave(Math.round(parsed * 100) / 100)
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSave()
    if (e.key === "Escape") setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 justify-center">
        <span className="text-xs text-muted-foreground">R$</span>
        <Input
          className="h-7 w-20 text-xs text-center px-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="0,00"
          autoFocus
        />
        <button
          onClick={handleSave}
          disabled={loading}
          className="flex items-center justify-center size-6 rounded bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 transition-colors"
        >
          {loading ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="flex items-center justify-center size-6 rounded bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-3" />
        </button>
      </div>
    )
  }

  if (value !== null) {
    return (
      <button
        onClick={() => { setInput(value.toFixed(2)); setEditing(true) }}
        className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-muted/40 hover:bg-muted/70 text-xs font-medium transition-colors"
      >
        <span>R$ {value.toFixed(2).replace(".", ",")}</span>
        <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    )
  }

  return (
    <button
      onClick={() => { setInput(""); setEditing(true) }}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
    >
      <Plus className="size-3" />
      <span>Definir</span>
    </button>
  )
}

function LimitEditor({ value, onSave, loading }: {
  value: number | null
  onSave: (val: number | null) => void
  loading: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState(value?.toString() ?? "")

  function handleSave() {
    const parsed = input.trim() === "" ? null : parseInt(input, 10)
    if (input.trim() !== "" && (isNaN(parsed!) || parsed! < 0)) return
    onSave(parsed)
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSave()
    if (e.key === "Escape") setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 justify-center">
        <Input
          className="h-7 w-24 text-xs text-center px-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Sem limite"
          type="number"
          min={0}
          autoFocus
        />
        <button
          onClick={handleSave}
          disabled={loading}
          className="flex items-center justify-center size-6 rounded bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 transition-colors"
        >
          {loading ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="flex items-center justify-center size-6 rounded bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-3" />
        </button>
      </div>
    )
  }

  if (value !== null) {
    return (
      <button
        onClick={() => { setInput(value.toString()); setEditing(true) }}
        className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-muted/40 hover:bg-muted/70 text-xs font-medium transition-colors"
      >
        <span>{value.toLocaleString("pt-BR")}</span>
        <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    )
  }

  return (
    <button
      onClick={() => { setInput(""); setEditing(true) }}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
    >
      <Plus className="size-3" />
      <span>Definir</span>
    </button>
  )
}

export default function AdminDashboardPage() {
  const { data: stats, isLoading: statsLoading } = useSWR("/api/admin/stats", fetcher)
  const { data: usersRaw, isLoading: usersLoading } = useSWR("/api/admin/users", fetcher)
  const { data: companyStatsRaw, isLoading: companyLoading } = useSWR<CompanyStatsResponse>(
    "/api/admin/company-stats", fetcher
  )
  const { data: operationalData, isLoading: operationalLoading } =
    useSWR<AdminOperationalSummaryResponse>("/api/admin/operational-summary", fetcher)

  const recentUsers: AdminUser[] = Array.isArray(usersRaw) ? usersRaw.slice(0, 6) : []
  const companies: CompanyStatItem[] = companyStatsRaw?.companies ?? []
  const dailyChart = companyStatsRaw?.dailyChart ?? []
  const showOperationalCompanyColumn =
    (operationalData?.companyCount ?? companies.length) > 1

  const searchParams = useSearchParams()
  const selectedOperationalCompany = searchParams.get("empresa") ?? "all"

  const filteredRecentLogs = selectedOperationalCompany === "all"
    ? (operationalData?.recentLogs ?? [])
    : (operationalData?.recentLogs ?? []).filter((l) => l.company_id === selectedOperationalCompany)

  const filteredNextDispatches = selectedOperationalCompany === "all"
    ? (operationalData?.nextDispatches ?? [])
    : (operationalData?.nextDispatches ?? []).filter((d) => d.companyId === selectedOperationalCompany)

  // Estado do modal de transferência
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferSource, setTransferSource] = useState("")
  const [transferTarget, setTransferTarget] = useState("")
  const [transferLoading, setTransferLoading] = useState(false)
  const [transferResult, setTransferResult] = useState<{ success?: boolean; message?: string } | null>(null)
  const [savingLimitFor, setSavingLimitFor] = useState<string | null>(null)

  async function handleTransfer() {
    if (!transferSource || !transferTarget) return
    setTransferLoading(true)
    setTransferResult(null)
    try {
      const res = await fetch("/api/admin/transfer-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceCompanyId: transferSource, targetCompanyId: transferTarget }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTransferResult({ success: false, message: data.error ?? "Erro ao transferir" })
      } else {
        setTransferResult({
          success: true,
          message: `Transferencia concluida: ${data.copiedWorkspaces} workspace(s) e ${data.copiedReports} relatorio(s) copiados para "${data.targetName}".`,
        })
      }
    } catch {
      setTransferResult({ success: false, message: "Erro de conexao. Tente novamente." })
    } finally {
      setTransferLoading(false)
    }
  }

  async function saveLimit(companyId: string, fields: {
    reportLimit?: number | null
    chatLimit?: number | null
    reportExcessPrice?: number | null
    chatExcessPrice?: number | null
  }) {
    setSavingLimitFor(companyId)
    try {
      await fetch("/api/admin/company-limits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, ...fields }),
      })
      await mutate("/api/admin/company-stats")
    } finally {
      setSavingLimitFor(null)
    }
  }

  function openTransfer() {
    setTransferSource("")
    setTransferTarget("")
    setTransferResult(null)
    setTransferOpen(true)
  }

  const pieTotalData = companies
    .filter((c) => c.dispatchesThisMonth > 0)
    .map((c, i) => ({ name: c.companyName, value: c.dispatchesThisMonth, color: CHART_COLORS[i % CHART_COLORS.length] }))

  const chatBarData = companies
    .map((c, i) => ({
      name: c.companyName.length > 14 ? c.companyName.slice(0, 14) + "…" : c.companyName,
      perguntas: c.chatUsageThisMonth,
      color: c.chatUsageThisMonth > 0
        ? CHART_COLORS[i % CHART_COLORS.length]
        : "hsl(var(--muted-foreground))",
    }))

  if (statsLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="Painel Administrativo" description="Gerencie usuarios e configuracoes do sistema" />
        <div className="flex flex-col gap-6 p-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
          <Skeleton className="h-56 rounded-xl" />
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
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={openTransfer}>
              <ArrowRightLeft className="mr-2 size-4" />
              Transferir Relatorios
            </Button>
            <Button asChild size="sm">
              <Link href="/admin/users">
                <UserPlus className="mr-2 size-4" />
                Novo Usuario
              </Link>
            </Button>
          </div>
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

        {/* Grafico onda - disparos diarios */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Disparos nos Ultimos 30 Dias</CardTitle>
            <CardDescription className="text-xs">Volume diario de relatorios enviados por todas as empresas</CardDescription>
          </CardHeader>
          <CardContent>
            {companyLoading ? (
              <Skeleton className="h-48 w-full rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={dailyChart} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradDelivered" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="delivered" name="Entregues" stroke="#10b981" strokeWidth={2} fill="url(#gradDelivered)" dot={false} />
                  <Area type="monotone" dataKey="failed" name="Falhas" stroke="#ef4444" strokeWidth={2} fill="url(#gradFailed)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Monitoramento operacional</h2>
            <p className="text-sm text-muted-foreground">
              Ultimos disparos e proximas rotinas das empresas visiveis no painel admin.
            </p>
          </div>

          {operationalLoading ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <Skeleton className="h-[420px] rounded-xl" />
              <Skeleton className="h-[420px] rounded-xl" />
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              <RecentDispatches
                logs={filteredRecentLogs}
                mode="table"
                showCompanyColumn={showOperationalCompanyColumn}
              />
              <UpcomingDispatches
                items={filteredNextDispatches}
                showCompanyColumn={showOperationalCompanyColumn}
              />
            </div>
          )}
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
                    const role = user.user_metadata?.role ?? "client"
                    return (
                      <div key={user.id} className="flex items-center gap-3 px-2 py-2.5 hover:bg-muted/40 rounded-lg transition-colors">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {getUserInitials(name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-none truncate">{name}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{user.email ?? ""}</p>
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

        {/* Alerta de cobranca por excedente */}
        {(() => {
          const reportOverages = companies.filter(c => c.reportOverageCharge !== null)
          const chatOverages = companies.filter(c => c.chatOverageCharge !== null)
          const totalReport = reportOverages.reduce((s, c) => s + (c.reportOverageCharge ?? 0), 0)
          const totalChat = chatOverages.reduce((s, c) => s + (c.chatOverageCharge ?? 0), 0)
          const totalGeral = totalReport + totalChat
          if (totalGeral === 0) return null
          return (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-500">
                  <span className="text-base font-bold">!</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-500">Excedente a cobrar este mês</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1">
                    {reportOverages.map(c => (
                      <span key={c.companyId} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{c.companyName}</span>
                        {" — "}+{c.reportOverage} relatórios
                        {c.reportOverageCharge !== null && (
                          <span className="ml-1 font-semibold text-amber-500">R$ {c.reportOverageCharge.toFixed(2).replace(".", ",")}</span>
                        )}
                      </span>
                    ))}
                    {chatOverages.map(c => (
                      <span key={`chat-${c.companyId}`} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{c.companyName}</span>
                        {" — "}+{c.chatOverage} perguntas
                        {c.chatOverageCharge !== null && (
                          <span className="ml-1 font-semibold text-amber-500">R$ {c.chatOverageCharge.toFixed(2).replace(".", ",")}</span>
                        )}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-sm font-bold text-amber-500">
                    Total a cobrar: R$ {totalGeral.toFixed(2).replace(".", ",")}
                  </p>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Relatorios por Empresa */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-500/10 p-2">
                  <FileText className="size-4 text-blue-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Relatorios por Empresa</CardTitle>
                  <CardDescription className="text-xs">Uso mensal vs limite configurado — clique no limite para editar</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {companyLoading ? (
                <div className="space-y-2 px-4 pb-4">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
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
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Este Mês</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Limite/mês</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">R$/excedente</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-36">Uso</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Excedente</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">A cobrar</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Taxa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {companies.map((c) => {
                        const isOverLimit = c.reportLimit !== null && c.dispatchesThisMonth > c.reportLimit
                        return (
                          <tr key={c.companyId} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-medium">{c.companyName}</td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex flex-col items-center leading-tight gap-0.5">
                                <span className={`font-bold text-sm ${isOverLimit ? "text-red-500" : ""}`}>{c.deliveredThisMonth + c.failedThisMonth}</span>
                                <div className="flex items-center gap-1.5 text-xs">
                                  <span className="text-emerald-500">{c.deliveredThisMonth}✓</span>
                                  {c.failedThisMonth > 0 && <span className="text-red-400">{c.failedThisMonth} erros</span>}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <LimitEditor
                                value={c.reportLimit}
                                loading={savingLimitFor === c.companyId}
                                onSave={(val) => saveLimit(c.companyId, { reportLimit: val })}
                              />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <PriceEditor
                                value={c.reportExcessPrice}
                                loading={savingLimitFor === c.companyId}
                                onSave={(val) => saveLimit(c.companyId, { reportExcessPrice: val })}
                              />
                            </td>
                            <td className="px-4 py-3">
                              {c.reportLimit !== null ? (
                                <div className="space-y-1">
                                  <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>{c.dispatchesThisMonth}/{c.reportLimit}</span>
                                    <span>{Math.min(c.reportLimitPercent ?? 0, 100)}%</span>
                                  </div>
                                  <Progress
                                    value={Math.min(c.reportLimitPercent ?? 0, 100)}
                                    className={`h-1.5 ${isOverLimit ? "[&>div]:bg-red-500" : (c.reportLimitPercent ?? 0) >= 70 ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500"}`}
                                  />
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">Sem limite</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {c.reportOverage > 0
                                ? <Badge variant="destructive" className="text-xs">+{c.reportOverage}</Badge>
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3 text-center font-medium">
                              {c.reportOverageCharge !== null
                                ? <span className="text-red-500 text-xs">R$ {c.reportOverageCharge.toFixed(2).replace(".", ",")}</span>
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Badge
                                variant={c.successRate >= 80 ? "default" : c.successRate >= 50 ? "secondary" : "destructive"}
                                className="text-xs"
                              >
                                {c.successRate}%
                              </Badge>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/40">
                        <td className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Total</td>
                        <td className="px-4 py-2.5 text-center">
                          <div className="flex flex-col items-center leading-tight gap-0.5">
                            <span className="font-bold text-sm">{companies.reduce((s, c) => s + c.deliveredThisMonth + c.failedThisMonth, 0)}</span>
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="text-emerald-500">{companies.reduce((s, c) => s + c.deliveredThisMonth, 0)}✓</span>
                              {companies.reduce((s, c) => s + c.failedThisMonth, 0) > 0 && (
                                <span className="text-red-400">{companies.reduce((s, c) => s + c.failedThisMonth, 0)} erros</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td colSpan={6} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pizza */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Distribuicao de Disparos</CardTitle>
              <CardDescription className="text-xs">Percentual por empresa (este mes)</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-center pb-4">
              {companyLoading ? (
                <Skeleton className="h-52 w-52 rounded-full" />
              ) : pieTotalData.length === 0 ? (
                <div className="flex h-52 items-center justify-center">
                  <p className="text-xs text-muted-foreground">Sem dados</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={pieTotalData} cx="50%" cy="45%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                      {pieTotalData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={<PieCustomTooltip />} />
                    <Legend iconType="circle" iconSize={8}
                      formatter={(v) => <span className="text-xs text-foreground">{String(v).length > 16 ? String(v).slice(0, 16) + "…" : v}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Chat SIL por Empresa */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-purple-500/10 p-2">
                  <MessageSquare className="size-4 text-purple-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Chat SIL por Empresa</CardTitle>
                  <CardDescription className="text-xs">Trial e limite de perguntas — clique no limite para editar</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {companyLoading ? (
                <div className="space-y-2 px-4 pb-4">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Empresa</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Chat IA</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">
                          <span className="flex items-center justify-center gap-1"><Clock className="size-3" /> Trial</span>
                        </th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Limite Perguntas</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">R$/excedente</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-36">Uso este mes</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Excedente</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">A cobrar</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Expiracao</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {companies.map((c) => {
                        const chatIsOver = c.chatLimit !== null && c.chatUsageThisMonth > c.chatLimit
                        return (
                        <tr key={c.companyId} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-medium">{c.companyName}</td>
                          <td className="px-4 py-3 text-center">
                            {c.chatEnabled
                              ? <CheckCircle2 className="mx-auto size-4 text-emerald-500" />
                              : <XCircle className="mx-auto size-4 text-muted-foreground" />}
                          </td>
                          <td className="px-4 py-3 text-center font-semibold">
                            {c.chatTrialDays !== null ? c.chatTrialDays : "—"}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <LimitEditor
                              value={c.chatLimit}
                              loading={savingLimitFor === c.companyId}
                              onSave={(val) => saveLimit(c.companyId, { chatLimit: val })}
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <PriceEditor
                              value={c.chatExcessPrice}
                              loading={savingLimitFor === c.companyId}
                              onSave={(val) => saveLimit(c.companyId, { chatExcessPrice: val })}
                            />
                          </td>
                          <td className="px-4 py-3 min-w-[120px]">
                            {c.chatLimit !== null ? (
                              <div className="space-y-1">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                  <span>{c.chatUsageThisMonth}/{c.chatLimit}</span>
                                  <span>{Math.min(c.chatLimitPercent ?? 0, 100)}%</span>
                                </div>
                                <Progress
                                  value={Math.min(c.chatLimitPercent ?? 0, 100)}
                                  className={`h-1.5 ${chatIsOver ? "[&>div]:bg-red-500" : (c.chatLimitPercent ?? 0) >= 70 ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500"}`}
                                />
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">{c.chatUsageThisMonth > 0 ? c.chatUsageThisMonth : "—"}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {c.chatOverage > 0
                              ? <Badge variant="destructive" className="text-xs">+{c.chatOverage}</Badge>
                              : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center font-medium">
                            {c.chatOverageCharge !== null
                              ? <span className="text-red-500 text-xs">R$ {c.chatOverageCharge.toFixed(2).replace(".", ",")}</span>
                              : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center text-muted-foreground text-xs">
                            {formatDate(c.chatTrialEndsAt)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {!c.chatEnabled && c.chatTrialDays === null
                              ? <Badge variant="outline" className="text-xs">Nao configurado</Badge>
                              : c.chatTrialExpired
                                ? <Badge variant="destructive" className="text-xs">Expirado</Badge>
                                : c.chatEnabled
                                  ? <Badge className="bg-emerald-500 text-xs hover:bg-emerald-600">Ativo</Badge>
                                  : <Badge variant="secondary" className="text-xs">Desativado</Badge>}
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Chat usage chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Uso do Chat este Mes</CardTitle>
              <CardDescription className="text-xs">Perguntas feitas por empresa</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-center pb-4">
              {companyLoading ? (
                <Skeleton className="h-52 w-full rounded-lg" />
              ) : chatBarData.length === 0 ? (
                <div className="flex h-52 items-center justify-center">
                  <p className="text-xs text-muted-foreground">Sem dados</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(180, chatBarData.length * 36)}>
                  <BarChart data={chatBarData} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
                    <Bar dataKey="perguntas" name="Perguntas" radius={[0, 4, 4, 0]}>
                      {chatBarData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

      </div>

      {/* Chat flutuante admin */}
      <AdminFloatingChat />

      {/* Modal de transferência */}
      <Dialog open={transferOpen} onOpenChange={(open) => { setTransferOpen(open); if (!open) setTransferResult(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="size-4" />
              Transferir Relatorios
            </DialogTitle>
            <DialogDescription>
              Copia os workspaces e relatorios de uma empresa para outra sem remover os dados da origem.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label>Empresa de origem</Label>
              <Select value={transferSource} onValueChange={(v) => { setTransferSource(v); setTransferResult(null) }}>
                <SelectTrigger><SelectValue placeholder="Selecione a empresa de origem" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.companyId} value={c.companyId} disabled={c.companyId === transferTarget}>{c.companyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-center">
              <ArrowRightLeft className="size-4 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Empresa de destino</Label>
              <Select value={transferTarget} onValueChange={(v) => { setTransferTarget(v); setTransferResult(null) }}>
                <SelectTrigger><SelectValue placeholder="Selecione a empresa de destino" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.companyId} value={c.companyId} disabled={c.companyId === transferSource}>{c.companyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {transferResult && (
              <Alert variant={transferResult.success ? "default" : "destructive"}>
                <AlertDescription className="text-xs">{transferResult.message}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTransferOpen(false)} disabled={transferLoading}>
              {transferResult?.success ? "Fechar" : "Cancelar"}
            </Button>
            {!transferResult?.success && (
              <Button onClick={handleTransfer} disabled={!transferSource || !transferTarget || transferLoading}>
                {transferLoading ? <><Loader2 className="mr-2 size-4 animate-spin" />Transferindo...</> : <><ArrowRightLeft className="mr-2 size-4" />Transferir</>}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
