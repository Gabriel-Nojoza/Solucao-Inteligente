"use client"

import {
  CheckCircle,
  FileBarChart2,
  Link2,
  Send,
  Users,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

type WhatsAppStatus =
  | "starting"
  | "awaiting_qr"
  | "connected"
  | "reconnecting"
  | "offline"
  | "error"

interface StatsData {
  totalReports: number
  activeContacts: number
  whatsappConnected?: boolean
  whatsappStatus?: WhatsAppStatus
  whatsappPhoneNumber?: string | null
  whatsappDisplayName?: string | null
  dispatchesToday: number
  deliveredToday: number
  failedToday: number
  inProgressToday: number
  successRate: number | null
  completedDispatches30d: number
  pbiConfigured?: boolean
  n8nConfigured?: boolean
}

function getWhatsAppStatus(status?: WhatsAppStatus) {
  switch (status) {
    case "connected":
      return { label: "WhatsApp ok", ok: true, icon: Wifi }
    case "awaiting_qr":
      return { label: "Aguardando QR", ok: false, icon: Zap }
    case "reconnecting":
      return { label: "Reconectando", ok: false, icon: Zap }
    case "starting":
      return { label: "Iniciando", ok: false, icon: Zap }
    case "error":
      return { label: "Erro no bot", ok: false, icon: WifiOff }
    default:
      return { label: "Offline", ok: false, icon: WifiOff }
  }
}

function getDispatchDescription(data: StatsData) {
  if (data.dispatchesToday === 0) {
    return "Nenhum envio registrado hoje"
  }

  const parts = [`${data.deliveredToday} enviados`, `${data.failedToday} falhos`]

  if (data.inProgressToday > 0) {
    parts.push(`${data.inProgressToday} em andamento`)
  }

  return parts.join(", ")
}

export function StatsCards({ data }: { data: StatsData }) {
  const whatsappStatus = getWhatsAppStatus(data.whatsappStatus)
  const whatsappDescription = data.whatsappConnected
    ? data.whatsappDisplayName || data.whatsappPhoneNumber || "WhatsApp conectado"
    : data.activeContacts > 0
      ? `${data.activeContacts} contatos sincronizados no sistema`
      : "Conecte o WhatsApp para sincronizar contatos"

  const stats = [
    {
      title: "Relatorios",
      value: data.totalReports,
      icon: FileBarChart2,
      description:
        data.totalReports === 1
          ? "1 relatorio ativo sincronizado"
          : `${data.totalReports} relatorios ativos sincronizados`,
      status: data.pbiConfigured
        ? { label: "Power BI ok", ok: true, icon: Link2 }
        : { label: "Configurar Power BI", ok: false, icon: Zap },
    },
    {
      title: "Contatos Ativos",
      value: data.activeContacts,
      icon: Users,
      description: whatsappDescription,
      status: whatsappStatus,
    },
    {
      title: "Disparos Hoje",
      value: data.dispatchesToday,
      icon: Send,
      description: getDispatchDescription(data),
      status: data.n8nConfigured
        ? { label: "N8N ok", ok: true, icon: Link2 }
        : { label: "N8N pendente", ok: false, icon: Zap },
    },
    {
      title: "Taxa de Sucesso",
      value: data.successRate === null ? "--" : `${data.successRate}%`,
      icon: CheckCircle,
      description:
        data.completedDispatches30d > 0
          ? `${data.completedDispatches30d} disparo(s) concluidos nos ultimos 30 dias`
          : "Sem disparos concluidos nos ultimos 30 dias",
      status: null,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {stat.title}
            </CardTitle>
            <stat.icon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-bold">{stat.value}</div>
            <p className="min-h-8 text-xs text-muted-foreground">{stat.description}</p>
            {stat.status ? (
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
                  <stat.status.icon className="size-2.5" />
                )}
                {stat.status.label}
              </Badge>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
