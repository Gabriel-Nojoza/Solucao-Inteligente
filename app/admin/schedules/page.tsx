"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import useSWR, { mutate } from "swr"
import { toast } from "sonner"
import { PageHeader } from "@/components/dashboard/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface AdminSchedule {
  id: string
  name: string
  is_active: boolean
  cron_expression: string | null
  export_format: string | null
  company_id: string
  companies: { name: string } | null
}

interface FailedEntry {
  report_name: string
  time: string
  count: number
}

interface FailedSummary {
  total_failed: number
  schedules: Array<{ schedule_id: string; report_name: string; count: number }>
  by_period: {
    manha: FailedEntry[]
    tarde: FailedEntry[]
    noite: FailedEntry[]
  }
}

const PERIOD_LABELS: Record<keyof FailedSummary["by_period"], string> = {
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
}

interface CompanyNarration {
  send_mode: "none" | "audio" | "text"
}

interface NarrationLimit {
  daily_limit: number
  used_today: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function AdminSchedulesPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("empresa")
  const [resending, setResending] = useState(false)

  const schedulesUrl = companyId
    ? `/api/admin/schedules?company_id=${companyId}`
    : "/api/admin/schedules"

  const narrationUrl = companyId
    ? `/api/admin/company-narration?company_id=${companyId}`
    : null

  const narrationLimitUrl = companyId
    ? `/api/admin/narration-limit?company_id=${companyId}`
    : null

  const [limitInput, setLimitInput] = useState("")
  const [savingLimit, setSavingLimit] = useState(false)

  const failedUrl = companyId
    ? `/api/admin/resend-failed?company_id=${companyId}`
    : null

  const { data: schedules, isLoading } = useSWR<AdminSchedule[]>(
    companyId ? schedulesUrl : null,
    fetcher
  )

  const { data: narration, isLoading: narrationLoading } = useSWR<CompanyNarration>(
    narrationUrl,
    fetcher
  )

  const { data: failedSummary, isLoading: failedLoading } = useSWR<FailedSummary>(
    failedUrl,
    fetcher
  )

  const { data: narrationLimit, isLoading: narrationLimitLoading } = useSWR<NarrationLimit>(
    narrationLimitUrl,
    fetcher,
    {
      onSuccess: (data) => setLimitInput(String(data.daily_limit)),
    }
  )

  async function handleNarrationChange(send_mode: string) {
    if (!companyId) return
    try {
      const res = await fetch("/api/admin/company-narration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, send_mode }),
      })
      if (!res.ok) throw new Error("Erro ao salvar")
      toast.success("Narração da empresa atualizada")
      mutate(narrationUrl)
    } catch {
      toast.error("Erro ao atualizar narração")
    }
  }

  async function handleSaveLimit() {
    if (!companyId) return
    const dailyLimit = Number(limitInput)
    if (!Number.isFinite(dailyLimit) || dailyLimit <= 0) {
      toast.error("Informe um numero valido maior que zero")
      return
    }
    setSavingLimit(true)
    try {
      const res = await fetch("/api/admin/narration-limit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, daily_limit: dailyLimit }),
      })
      if (!res.ok) throw new Error("Erro ao salvar")
      toast.success("Limite diario de narracao atualizado")
      mutate(narrationLimitUrl)
    } catch {
      toast.error("Erro ao atualizar limite")
    } finally {
      setSavingLimit(false)
    }
  }

  async function handleFormatChange(scheduleId: string, export_format: string) {
    try {
      const res = await fetch("/api/admin/schedules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: scheduleId, export_format }),
      })
      if (!res.ok) throw new Error("Erro ao salvar")
      toast.success(`Formato alterado para ${export_format}`)
      mutate(schedulesUrl)
    } catch {
      toast.error("Erro ao atualizar formato")
    }
  }

  async function handleResendFailed() {
    if (!companyId) return
    setResending(true)
    try {
      const res = await fetch("/api/admin/resend-failed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "Erro ao reenviar")
      if (!json.started) {
        toast.info("Nenhum envio com falha para reenviar.")
      } else {
        toast.success(
          `Reenvio iniciado: ${json.total} rotina(s), 3 min entre cada — leva cerca de ${json.estimated_minutes} min no total.`
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao reenviar falhas")
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Rotinas"
        description="Gerencie narração em áudio ou texto por empresa"
      />

      {!companyId && (
        <p className="text-sm text-muted-foreground">
          Selecione uma empresa no filtro lateral para ver as rotinas.
        </p>
      )}

      {companyId && (
        <>
          <div className="flex items-center gap-4 rounded-md border p-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Narração habilitada</span>
              <span className="text-xs text-muted-foreground">
                Liga ou desliga narração para esta empresa. O cliente escolhe áudio ou texto no painel dele.
              </span>
            </div>
            <div className="ml-auto">
              {narrationLoading ? (
                <Skeleton className="h-6 w-11" />
              ) : (
                <Switch
                  checked={narration?.send_mode !== "none"}
                  onCheckedChange={(checked) =>
                    handleNarrationChange(checked ? "text" : "none")
                  }
                />
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-md border p-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Limite diario de narracao (Gemini)</span>
              <span className="text-xs text-muted-foreground">
                {narrationLimitLoading
                  ? "Verificando..."
                  : narrationLimit
                    ? `Hoje: ${narrationLimit.used_today} de ${narrationLimit.daily_limit} usados. Ao atingir o limite, os envios passam a ir sem narracao automaticamente.`
                    : "Quantidade maxima de relatorios com narracao por dia para esta empresa."}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                className="w-24"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={savingLimit}
                onClick={handleSaveLimit}
              >
                {savingLimit ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-md border p-4">
            <div className="flex items-center gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Reenviar relatórios falhados</span>
                <span className="text-xs text-muted-foreground">
                  {failedLoading
                    ? "Verificando..."
                    : failedSummary && failedSummary.total_failed > 0
                      ? `${failedSummary.total_failed} envio(s) com falha nas últimas 24h, em ${failedSummary.schedules.length} rotina(s).`
                      : "Nenhum envio com falha nas últimas 24h."}
                </span>
              </div>
              <div className="ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resending || !failedSummary || failedSummary.total_failed === 0}
                  onClick={handleResendFailed}
                >
                  {resending ? "Reenviando..." : "Reenviar falhas"}
                </Button>
              </div>
            </div>

            {failedSummary && failedSummary.total_failed > 0 && (
              <div className="grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-3">
                {(Object.keys(PERIOD_LABELS) as Array<keyof FailedSummary["by_period"]>).map((period) => {
                  const entries = failedSummary.by_period[period]
                  return (
                    <div key={period} className="flex flex-col gap-2">
                      <span className="text-xs font-semibold uppercase text-muted-foreground">
                        {PERIOD_LABELS[period]} ({entries.length})
                      </span>
                      {entries.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Sem falhas</span>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {entries.map((entry) => (
                            <li
                              key={`${entry.report_name}-${entry.time}`}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="truncate" title={entry.report_name}>
                                {entry.report_name}
                              </span>
                              <span className="shrink-0 text-muted-foreground">
                                {entry.time}
                                {entry.count > 1 ? ` (x${entry.count})` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Formato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    </TableRow>
                  ))
                )}
                {!isLoading && (!schedules || schedules.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      Nenhuma rotina encontrada
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && schedules?.map((schedule) => {
                  const isPng = (schedule.export_format ?? "PDF").toUpperCase() === "PNG"
                  return (
                    <TableRow key={schedule.id}>
                      <TableCell className="font-medium">{schedule.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {schedule.companies?.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        {schedule.is_active
                          ? <Badge variant="default">Ativa</Badge>
                          : <Badge variant="outline">Inativa</Badge>
                        }
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">PDF</span>
                          <Switch
                            checked={isPng}
                            onCheckedChange={(checked) =>
                              handleFormatChange(schedule.id, checked ? "PNG" : "PDF")
                            }
                          />
                          <span className="text-xs text-muted-foreground">PNG</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
