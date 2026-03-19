"use client"

import { useMemo, useState } from "react"
import useSWR, { mutate } from "swr"
import {
  Plus,
  Clock,
  Trash2,
  Pencil,
  Play,
  Loader2,
  RefreshCw,
  Search,
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
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import type { Schedule, Report, Contact, ScheduleExportFormat } from "@/lib/types"
import { describeCronValue, isValidCronValue } from "@/lib/schedule-cron"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type BotQrStatus = {
  status: "starting" | "awaiting_qr" | "connected" | "reconnecting" | "offline" | "error"
}

type ScheduleReportOption = {
  id: string
  name: string
  defaultFormat: ScheduleExportFormat
}

const POWERBI_FORMATS: ScheduleExportFormat[] = ["PDF", "PNG", "PPTX"]

function formatLabel(format: ScheduleExportFormat) {
  if (format === "table") return "Tabela (texto)"
  return format.toUpperCase()
}

function normalizeScheduleFormat(format: ScheduleExportFormat): ScheduleExportFormat {
  if (format === "pdf") {
    return "PDF"
  }

  return format
}

function extractApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const error = (payload as { error?: unknown }).error

  if (typeof error === "string" && error.trim()) {
    return error.trim()
  }

  if (!error || typeof error !== "object") {
    return null
  }

  for (const value of Object.values(error as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }

    if (Array.isArray(value)) {
      const firstMessage = value.find(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      )

      if (firstMessage) {
        return firstMessage.trim()
      }
    }
  }

  return null
}

function mapApiFieldErrors(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object") {
    return {}
  }

  const error = (payload as { error?: unknown }).error

  if (!error || typeof error !== "object") {
    return {}
  }

  const mappedEntries = Object.entries(error as Record<string, unknown>)
    .map(([key, value]) => {
      const message = Array.isArray(value)
        ? value.find(
            (item): item is string => typeof item === "string" && item.trim().length > 0
          ) ?? ""
        : typeof value === "string"
          ? value
          : ""

      if (!message.trim()) {
        return null
      }

      const fieldKey =
        key === "report_id"
          ? "report"
          : key === "cron_expression"
            ? "cron"
            : key === "contact_ids"
              ? "contacts"
              : key === "name"
                ? "name"
                : key

      return [fieldKey, message.trim()] as const
    })
    .filter((entry): entry is readonly [string, string] => entry !== null)

  return Object.fromEntries(mappedEntries)
}

export default function SchedulesPage() {
  const { data: schedules, isLoading } = useSWR<
    (Schedule & { report_name: string; contacts: { id: string; name: string }[] })[]
  >("/api/schedules", fetcher)
  const { data: reports } = useSWR<Report[]>("/api/reports", fetcher)
  const { data: contacts } = useSWR<Contact[]>("/api/contacts", fetcher)
  const { data: botQrConfig } = useSWR<BotQrStatus>("/api/bot/qr", fetcher)

  const scheduleList = Array.isArray(schedules) ? schedules : []
  const reportList = Array.isArray(reports) ? reports : []
  const contactList = Array.isArray(contacts) ? contacts : []

  const canShowContacts = botQrConfig?.status === "connected"
  const activeContacts = canShowContacts
    ? contactList.filter((contact) => contact.is_active)
    : []

  const reportOptions = useMemo<ScheduleReportOption[]>(
    () =>
      reportList.map((report) => ({
        id: report.id,
        name: report.name,
        defaultFormat: "PDF" as const,
      })),
    [reportList]
  )

  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null)
  const [dispatching, setDispatching] = useState<string | null>(null)
  const [syncingBotContacts, setSyncingBotContacts] = useState(false)

  const [formName, setFormName] = useState("")
  const [formReportId, setFormReportId] = useState("")
  const [formCron, setFormCron] = useState("0 8 * * 1-5")
  const [formFormat, setFormFormat] = useState<ScheduleExportFormat>("PDF")
  const [formMessage, setFormMessage] = useState(
    "Segue o relatorio {report_name} em anexo."
  )
  const [formContactIds, setFormContactIds] = useState<string[]>([])
  const [formActive, setFormActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [contactSearch, setContactSearch] = useState("")

  const formatOptions = POWERBI_FORMATS

  const filteredContacts = activeContacts.filter((contact) => {
    const search = contactSearch.trim().toLowerCase()
    if (!search) return true

    return (
      contact.name.toLowerCase().includes(search) ||
      (contact.phone ?? "").toLowerCase().includes(search) ||
      (contact.whatsapp_group_id ?? "").toLowerCase().includes(search)
    )
  })

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
    setContactSearch("")
    setDialogOpen(true)

    if (canShowContacts) {
      void syncContactsFromBot(true)
    }
  }

  function openEdit(schedule: Schedule & { contacts: { id: string; name: string }[] }) {
    setEditSchedule(schedule)
    setFormName(schedule.name)
    setFormReportId(schedule.report_id)
    setFormCron(schedule.cron_expression)
    setFormFormat(normalizeScheduleFormat(schedule.export_format))
    setFormMessage(
      schedule.message_template ?? "Segue o relatorio {report_name} em anexo."
    )
    setFormContactIds(schedule.contacts?.map((c) => c.id) ?? [])
    setFormActive(schedule.is_active)
    setFormErrors({})
    setContactSearch("")
    setDialogOpen(true)

    if (canShowContacts) {
      void syncContactsFromBot(true)
    }
  }

  function validateScheduleForm(): boolean {
    const errors: Record<string, string> = {}

    if (!formName.trim()) errors.name = "Nome obrigatorio"
    if (!formReportId) errors.report = "Selecione um relatorio"
    if (!formCron.trim()) errors.cron = "Frequencia obrigatoria"
    if (formCron.trim() && !isValidCronValue(formCron)) {
      errors.cron = "Cada horario deve ter uma expressao CRON valida com 5 campos"
    }

    if (!canShowContacts && formContactIds.length === 0) {
      errors.contacts =
        "Conecte o WhatsApp pela leitura do QR Code para liberar os contatos"
    } else if (formContactIds.length === 0) {
      errors.contacts = "Selecione ao menos 1 contato"
    }

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

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        const apiFieldErrors = mapApiFieldErrors(data)
        if (Object.keys(apiFieldErrors).length > 0) {
          setFormErrors((prev) => ({ ...prev, ...apiFieldErrors }))
        }

        throw new Error(
          extractApiErrorMessage(data) ??
            (editSchedule ? "Erro ao atualizar rotina" : "Erro ao criar rotina")
        )
      }

      toast.success(editSchedule ? "Rotina atualizada!" : "Rotina criada!")
      setDialogOpen(false)
      mutate("/api/schedules")
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Erro ao salvar rotina"
      )
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

  async function syncContactsFromBot(silent = false) {
    if (!canShowContacts) {
      if (!silent) {
        toast.error(
          "Conecte o WhatsApp pela leitura do QR Code antes de sincronizar contatos."
        )
      }
      return
    }

    setSyncingBotContacts(true)

    try {
      const res = await fetch("/api/contacts/sync-bot", {
        method: "POST",
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Erro ao sincronizar contatos do bot")
      }

      await mutate("/api/contacts")

      if (!silent) {
        if ((data.inserted ?? 0) === 0 && (data.updated ?? 0) === 0) {
          toast.success("Contatos do bot ja estao atualizados.")
        } else {
          toast.success(
            `${data.inserted ?? 0} contato(s) novo(s) e ${data.updated ?? 0} atualizado(s).`
          )
        }
      }
    } catch (error) {
      if (!silent) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Erro ao sincronizar contatos do bot"
        )
      }
    } finally {
      setSyncingBotContacts(false)
    }
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
                          <Badge variant="outline">{formatLabel(schedule.export_format)}</Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {describeCronValue(schedule.cron_expression).map((item, index) => (
                              <Badge key={`${schedule.id}-cron-${index}`} variant="outline">
                                {item}
                              </Badge>
                            ))}
                          </div>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          key={editSchedule?.id ?? "new-schedule"}
          className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>{editSchedule ? "Editar Rotina" : "Nova Rotina"}</DialogTitle>
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
                  const option = reportOptions.find((item) => item.id === v)
                  if (option && formFormat !== option.defaultFormat) {
                    setFormFormat(option.defaultFormat)
                  }
                  setFormErrors((prev) => ({ ...prev, report: "" }))
                }}
              >
                <SelectTrigger className={formErrors.report ? "border-destructive" : ""}>
                  <SelectValue placeholder="Selecionar relatorio" />
                </SelectTrigger>
                <SelectContent>
                  {reportList.length > 0 ? (
                    <SelectGroup>
                      <SelectLabel>Relatorios Power BI</SelectLabel>
                      {reportList.map((report) => (
                        <SelectItem key={report.id} value={report.id}>
                          {report.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
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
                onValueChange={(v) => setFormFormat(v as ScheduleExportFormat)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {formatOptions.map((format) => (
                    <SelectItem key={format} value={format}>
                      {formatLabel(format)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <CronBuilder
              key={editSchedule?.id ?? "new-schedule-cron"}
              value={formCron}
              onChange={(value) => {
                setFormCron(value)
                setFormErrors((prev) => ({ ...prev, cron: "" }))
              }}
            />

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
              <div className="flex items-center justify-between gap-3">
                <Label>Contatos ({formContactIds.length} selecionado(s))</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => void syncContactsFromBot(false)}
                  disabled={syncingBotContacts || !canShowContacts}
                >
                  {syncingBotContacts ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Sincronizar do bot
                </Button>
              </div>

              <div
                className={`max-h-[220px] overflow-y-auto rounded-lg border p-3 ${
                  formErrors.contacts ? "border-destructive" : ""
                }`}
              >
                {!canShowContacts ? (
                  <p className="text-sm text-muted-foreground">
                    Os contatos so aparecem depois que o WhatsApp for conectado pela
                    leitura do QR Code.
                  </p>
                ) : syncingBotContacts && activeContacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Buscando contatos e grupos conectados no bot...
                  </p>
                ) : (
                  <>
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)}
                        placeholder="Pesquisar contato ou grupo..."
                        className="pl-9"
                      />
                    </div>

                    {filteredContacts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhum contato ou grupo encontrado para essa pesquisa.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {filteredContacts.map((contact) => (
                          <label
                            key={contact.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent"
                          >
                            <Checkbox
                              checked={formContactIds.includes(contact.id)}
                              onCheckedChange={() => toggleContact(contact.id)}
                            />
                            <span className="text-sm">{contact.name}</span>
                            <Badge variant="outline" className="ml-auto text-xs">
                              {contact.type === "group" ? "Grupo" : "Individual"}
                            </Badge>
                          </label>
                        ))}
                      </div>
                    )}
                  </>
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
              disabled={
                saving ||
                !formName ||
                !formReportId ||
                !formCron ||
                (!canShowContacts && formContactIds.length === 0)
              }
            >
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir rotina?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao nao pode ser desfeita. A rotina e seus vinculos serao removidos.
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
