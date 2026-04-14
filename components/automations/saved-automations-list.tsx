"use client"

import { useState } from "react"
import useSWR, { mutate } from "swr"
import {
  Play,
  Trash2,
  Clock,
  Database,
  Loader2,
  ListFilter,
  Workflow,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatShortDateTimePtBr } from "@/lib/datetime"
import { describeCronValue } from "@/lib/schedule-cron"

interface Automation {
  id: string
  name: string
  dataset_id: string
  workspace_id: string | null
  selected_columns: { tableName: string; columnName: string }[]
  selected_measures: { tableName: string; measureName: string }[]
  filters: unknown[]
  dax_query: string | null
  cron_expression: string | null
  export_format: string
  message_template: string | null
  is_active: boolean
  created_at: string
  contacts: { id: string; name: string; phone: string | null }[]
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function describeExportFormat(format: string): string {
  if (format === "table") return "Tabela"
  return format.toUpperCase()
}

export function SavedAutomationsList() {
  const { data: automations, isLoading } = useSWR<Automation[]>(
    "/api/automations",
    fetcher
  )
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)

  async function handleRun(automation: Automation) {
    setRunningId(automation.id)
    try {
      const res = await fetch("/api/automations/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automation_id: automation.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(
        `Automacao executada: ${data.rowCount ?? 0} linhas retornadas.`
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao executar automacao"
      )
    } finally {
      setRunningId(null)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      const res = await fetch(`/api/automations?id=${deleteId}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error()
      toast.success("Automacao excluida!")
      mutate("/api/automations")
    } catch {
      toast.error("Erro ao excluir automacao")
    } finally {
      setDeleteId(null)
    }
  }

  async function handleToggleActive(id: string, currentActive: boolean) {
    try {
      const res = await fetch("/api/automations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_active: !currentActive }),
      })
      if (!res.ok) throw new Error()
      mutate("/api/automations")
    } catch {
      toast.error("Erro ao atualizar")
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Workflow className="size-4" />
            Automacoes Salvas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </CardContent>
      </Card>
    )
  }

  const list = automations ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Workflow className="size-4" />
          Automacoes Salvas ({list.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <ListFilter className="size-10 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Nenhuma automacao salva
              </p>
              <p className="text-xs text-muted-foreground/70">
                Selecione tabelas e medidas, execute a query e salve como
                automacao.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {list.map((auto) => (
              <div
                key={auto.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/50"
              >
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{auto.name}</span>
                    <Badge
                      variant={auto.is_active ? "default" : "secondary"}
                      className="cursor-pointer text-[10px]"
                      onClick={() =>
                        handleToggleActive(auto.id, auto.is_active)
                      }
                    >
                      {auto.is_active ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {describeExportFormat(auto.export_format)}
                    </Badge>
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Database className="size-2.5" />
                      {auto.selected_columns?.length ?? 0} colunas,{" "}
                      {auto.selected_measures?.length ?? 0} medidas
                    </Badge>
                    {auto.cron_expression && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Clock className="size-2.5" />
                        {describeCronValue(auto.cron_expression).join(" | ")}
                      </Badge>
                    )}
                    {!auto.cron_expression && (
                      <Badge variant="outline" className="text-[10px]">
                        Sob demanda
                      </Badge>
                    )}
                    {auto.contacts?.length > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {auto.contacts.length} contato(s)
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatShortDateTimePtBr(auto.created_at)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => handleRun(auto)}
                          disabled={runningId === auto.id}
                        >
                          {runningId === auto.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Play className="size-3.5" />
                          )}
                          <span className="sr-only">Executar</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Executar agora</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setDeleteId(auto.id)}
                        >
                          <Trash2 className="size-3.5 text-destructive" />
                          <span className="sr-only">Excluir</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Excluir</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir automacao?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao nao pode ser desfeita. A automacao e seus vinculos serao
              removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
