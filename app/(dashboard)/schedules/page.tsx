"use client"

import { useState } from "react"
import useSWR, { mutate } from "swr"
import {
  Plus,
  Clock,
  Trash2,
  Pencil,
  Play,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { CronBuilder } from "@/components/schedules/cron-builder"
import type { Schedule, Report, Contact } from "@/lib/types"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function SchedulesPage() {
  const { data: schedules, isLoading } = useSWR<
    (Schedule & { report_name: string; contacts: { id: string; name: string }[] })[]
  >("/api/schedules", fetcher)
  const { data: reports } = useSWR<Report[]>("/api/reports", fetcher)
  const { data: contacts } = useSWR<Contact[]>("/api/contacts", fetcher)
  const scheduleList = Array.isArray(schedules) ? schedules : []
  const reportList = Array.isArray(reports) ? reports : []
  const contactList = Array.isArray(contacts) ? contacts : []

  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null)
  const [dispatching, setDispatching] = useState<string | null>(null)

  // Form
  const [formName, setFormName] = useState("")
  const [formReportId, setFormReportId] = useState("")
  const [formCron, setFormCron] = useState("0 8 * * 1-5")
  const [formFormat, setFormFormat] = useState<"PDF" | "PNG" | "PPTX">("PDF")
  const [formMessage, setFormMessage] = useState(
    "Segue o relatorio {report_name} em anexo."
  )
  const [formContactIds, setFormContactIds] = useState<string[]>([])
  const [formActive, setFormActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  function openCreate() {
    setEditSchedule(null)
    setFormName("")
    setFormReportId("")
    setFormCron("0 8 * * 1-5")
    setFormFormat("PDF")
    setFormMessage("Segue o relatorio {report_name} em anexo.")
    setFormContactIds([])
    setFormActive(true)
    setFormErrors({})
    setDialogOpen(true)
  }

  function openEdit(schedule: Schedule & { contacts: { id: string; name: string }[] }) {
    setEditSchedule(schedule)
    setFormName(schedule.name)
    setFormReportId(schedule.report_id)
    setFormCron(schedule.cron_expression)
    setFormFormat(schedule.export_format)
    setFormMessage(schedule.message_template ?? "")
    setFormContactIds(schedule.contacts?.map((c) => c.id) ?? [])
    setFormActive(schedule.is_active)
    setFormErrors({})
    setDialogOpen(true)
  }

  function validateScheduleForm(): boolean {
    const errors: Record<string, string> = {}
    if (!formName.trim()) errors.name = "Nome obrigatorio"
    if (!formReportId) errors.report = "Selecione um relatorio"
    if (!formCron.trim()) errors.cron = "Frequencia obrigatoria"
    if (formCron.trim().split(/\s+/).length !== 5)
      errors.cron = "Expressao CRON deve ter 5 campos"
    if (formContactIds.length === 0) errors.contacts = "Selecione ao menos 1 contato"
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSave() {
    if (!validateScheduleForm()) return
    setSaving(true)
    try {
      const payload = {
        ...(editSchedule ? { id: editSchedule.id } : {}),
        name: formName.trim(),
        report_id: formReportId,
        cron_expression: formCron,
        export_format: formFormat,
        message_template: formMessage || null,
        contact_ids: formContactIds,
        is_active: formActive,
      }

      const res = await fetch("/api/schedules", {
        method: editSchedule ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) throw new Error()
      toast.success(editSchedule ? "Rotina atualizada!" : "Rotina criada!")
      setDialogOpen(false)
      mutate("/api/schedules")
    } catch {
      toast.error("Erro ao salvar rotina")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      const res = await fetch(`/api/schedules?id=${deleteId}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("Rotina excluida!")
      mutate("/api/schedules")
    } catch {
      toast.error("Erro ao excluir")
    } finally {
      setDeleteId(null)
    }
  }

  async function handleDispatch(scheduleId: string) {
    setDispatching(scheduleId)
    try {
      const res = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule_id: scheduleId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`Disparo iniciado! ${data.logs_created} logs criados.`)
      mutate("/api/logs?limit=10")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro no disparo")
    } finally {
      setDispatching(null)
    }
  }

  function toggleContact(id: string) {
    setFormContactIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )
    setFormErrors((prev) => ({ ...prev, contacts: "" }))
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Rotinas de Disparo"
        description="Agende envios automaticos de relatorios"
      >
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-1 size-4" />
          Nova Rotina
        </Button>
      </PageHeader>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded" />
                ))}
              </div>
            ) : scheduleList.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-12">
                <Clock className="size-12 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Nenhuma rotina configurada</p>
                  <p className="text-sm text-muted-foreground">
                    Crie uma rotina para agendar envios automaticos.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead className="hidden sm:table-cell">Relatorio</TableHead>
                    <TableHead className="hidden lg:table-cell">Formato</TableHead>
                    <TableHead className="hidden md:table-cell">Frequencia</TableHead>
                    <TableHead className="hidden md:table-cell">Contatos</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Acoes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scheduleList.map((schedule) => (
                    <TableRow key={schedule.id}>
                      <TableCell className="font-medium">{schedule.name}</TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {schedule.report_name}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Badge variant="outline">{schedule.export_format}</Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                          {schedule.cron_expression}
                        </code>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="secondary">
                          {schedule.contacts?.length ?? 0} contato(s)
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={schedule.is_active}
                          onCheckedChange={async (checked) => {
                            await fetch("/api/schedules", {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                id: schedule.id,
                                is_active: checked,
                              }),
                            })
                            mutate("/api/schedules")
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDispatch(schedule.id)}
                            disabled={dispatching === schedule.id}
                            title="Disparar agora"
                          >
                            {dispatching === schedule.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Play className="size-4" />
                            )}
                            <span className="sr-only">Disparar</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(schedule)}
                          >
                            <Pencil className="size-4" />
                            <span className="sr-only">Editar</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(schedule.id)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                            <span className="sr-only">Excluir</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editSchedule ? "Editar Rotina" : "Nova Rotina"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-2">
              <Label>Nome da Rotina</Label>
              <Input
                value={formName}
                onChange={(e) => {
                  setFormName(e.target.value)
                  setFormErrors((prev) => ({ ...prev, name: "" }))
                }}
                placeholder="Ex: Vendas diario"
                className={formErrors.name ? "border-destructive" : ""}
              />
              {formErrors.name && (
                <p className="text-xs text-destructive">{formErrors.name}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Relatorio</Label>
              <Select
                value={formReportId}
                onValueChange={(v) => {
                  setFormReportId(v)
                  setFormErrors((prev) => ({ ...prev, report: "" }))
                }}
              >
                <SelectTrigger className={formErrors.report ? "border-destructive" : ""}>
                  <SelectValue placeholder="Selecionar relatorio" />
                </SelectTrigger>
                <SelectContent>
                  {reportList.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formErrors.report && (
                <p className="text-xs text-destructive">{formErrors.report}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Formato de Exportacao</Label>
              <Select
                value={formFormat}
                onValueChange={(v) => setFormFormat(v as "PDF" | "PNG" | "PPTX")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PDF">PDF</SelectItem>
                  <SelectItem value="PNG">PNG</SelectItem>
                  <SelectItem value="PPTX">PPTX</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <CronBuilder value={formCron} onChange={setFormCron} />

            <div className="flex flex-col gap-2">
              <Label>Mensagem Template</Label>
              <Textarea
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                placeholder="Use {report_name} para o nome do relatorio"
                rows={3}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Contatos ({formContactIds.length} selecionado(s))</Label>
              <div className={`max-h-[160px] overflow-y-auto rounded-lg border p-3 ${formErrors.contacts ? "border-destructive" : ""}`}>
                {contactList.filter((c) => c.is_active).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum contato ativo. Crie contatos primeiro.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {contactList
                      .filter((c) => c.is_active)
                      .map((c) => (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent"
                        >
                          <Checkbox
                            checked={formContactIds.includes(c.id)}
                            onCheckedChange={() => toggleContact(c.id)}
                          />
                          <span className="text-sm">{c.name}</span>
                          <Badge variant="outline" className="ml-auto text-xs">
                            {c.type === "group" ? "Grupo" : "Individual"}
                          </Badge>
                        </label>
                      ))}
                  </div>
                )}
              </div>
              {formErrors.contacts && (
                <p className="text-xs text-destructive">{formErrors.contacts}</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={formActive}
                onCheckedChange={setFormActive}
                id="schedule-active"
              />
              <Label htmlFor="schedule-active">Ativa</Label>
            </div>

            <Button
              onClick={handleSave}
              disabled={saving || !formName || !formReportId || !formCron}
            >
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir rotina?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao nao pode ser desfeita. A rotina e seus vinculos serao
              removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
