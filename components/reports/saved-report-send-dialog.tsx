"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR, { mutate as globalMutate } from "swr"
import {
  FilterX,
  Loader2,
  Plus,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import {
  buildQuickFilters,
  getDefaultFilterValue,
  getDefaultFilterValueTo,
  isDateLikeDataType,
} from "@/lib/quick-filters"
import { createId } from "@/lib/id"
import type { Contact, DatasetColumn, QueryFilter } from "@/lib/types"

type CreatedReport = {
  id: string
  name: string
  dataset_id?: string | null
  export_format: string
  message_template: string | null
  filters?: QueryFilter[] | null
}

interface SavedReportSendDialogProps {
  report: CreatedReport
  contacts: Contact[]
  showContacts: boolean
}

function getInputType(dataType: string) {
  const normalized = dataType.toLowerCase()
  if (
    normalized.includes("int") ||
    normalized.includes("double") ||
    normalized.includes("decimal") ||
    normalized.includes("number")
  ) {
    return "number"
  }

  if (normalized.includes("date") || normalized.includes("time")) {
    return "date"
  }

  return "text"
}

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.error || "Erro ao carregar dados do relatorio")
  }
  return data
}

export function SavedReportSendDialog({
  report,
  contacts,
  showContacts,
}: SavedReportSendDialogProps) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exportFormat, setExportFormat] = useState("csv")
  const [message, setMessage] = useState("")
  const [selectedContacts, setSelectedContacts] = useState<string[]>([])
  const [localFilters, setLocalFilters] = useState<QueryFilter[]>([])
  const { data: catalogPayload, isLoading: loadingCatalog } = useSWR<{
    catalog: { columns: DatasetColumn[] } | null
  }>(open && report.dataset_id ? `/api/automations/catalog?datasetId=${report.dataset_id}` : null, fetcher)

  const activeContacts = useMemo(
    () => (showContacts ? contacts.filter((contact) => contact.is_active) : []),
    [contacts, showContacts]
  )
  const fallbackColumns = useMemo(() => {
    const sourceFilters = Array.isArray(report.filters) ? report.filters : []
    const unique = new Map<string, Pick<DatasetColumn, "tableName" | "columnName" | "dataType">>()

    for (const filter of sourceFilters) {
      const key = `${filter.tableName}::${filter.columnName}`
      if (!unique.has(key)) {
        unique.set(key, {
          tableName: filter.tableName,
          columnName: filter.columnName,
          dataType: filter.dataType,
        })
      }
    }

    return [...unique.values()]
  }, [report.filters])
  const availableColumns = useMemo(
    () =>
      Array.isArray(catalogPayload?.catalog?.columns) && catalogPayload.catalog.columns.length > 0
        ? catalogPayload.catalog.columns
        : fallbackColumns,
    [catalogPayload?.catalog?.columns, fallbackColumns]
  )
  const quickFilters = useMemo(
    () => buildQuickFilters(availableColumns, localFilters),
    [availableColumns, localFilters]
  )
  const originalFilters = useMemo(
    () => (Array.isArray(report.filters) ? report.filters : []),
    [report.filters]
  )
  const isDirty = useMemo(
    () =>
      exportFormat !== (report.export_format || "csv") ||
      message !== (report.message_template || `Segue o relatorio ${report.name}.`) ||
      JSON.stringify(localFilters) !== JSON.stringify(originalFilters),
    [exportFormat, localFilters, message, originalFilters, report.export_format, report.message_template, report.name]
  )

  useEffect(() => {
    if (!open) return

    setExportFormat(report.export_format || "csv")
    setMessage(report.message_template || `Segue o relatorio ${report.name}.`)
    setSelectedContacts([])
    setLocalFilters(Array.isArray(report.filters) ? report.filters.map((filter) => ({ ...filter })) : [])
  }, [open, report])

  function toggleContact(id: string) {
    setSelectedContacts((current) =>
      current.includes(id)
        ? current.filter((contactId) => contactId !== id)
        : [...current, id]
    )
  }

  function addQuickFilter(key: string) {
    const quickFilter = quickFilters.find((item) => item.key === key)
    if (!quickFilter?.mapped || !quickFilter.tableName || !quickFilter.columnName) {
      return
    }
    const tableName = quickFilter.tableName
    const columnName = quickFilter.columnName

    const exists = localFilters.some(
      (filter) =>
        filter.tableName === tableName &&
        filter.columnName === columnName
    )

    if (exists) {
      return
    }

    setLocalFilters((current) => [
      ...current,
      {
        id: createId("filter"),
        tableName,
        columnName,
        operator: "eq",
        value: getDefaultFilterValue(quickFilter.dataType),
        valueTo: getDefaultFilterValueTo(quickFilter.dataType),
        dataType: quickFilter.dataType,
      },
    ])
  }

  function updateFilterValue(id: string, field: "value" | "valueTo", value: string) {
    setLocalFilters((current) =>
      current.map((filter) => (filter.id === id ? { ...filter, [field]: value } : filter))
    )
  }

  function removeFilter(id: string) {
    setLocalFilters((current) => current.filter((filter) => filter.id !== id))
  }

  async function handleSaveChanges() {
    if (!isDirty) {
      toast.error("Nenhuma alteracao para salvar")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/automations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: report.id,
          export_format: exportFormat,
          message_template: message,
          filters: localFilters,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Erro ao salvar alteracoes do relatorio")
      }

      await globalMutate("/api/automations")
      toast.success("Alteracoes do relatorio salvas!")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao salvar alteracoes do relatorio"
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleSend() {
    if (!showContacts) {
      toast.error("Leia o QR Code e conecte o WhatsApp na tela de Contatos para liberar os contatos.")
      return
    }

    if (selectedContacts.length === 0) {
      toast.error("Selecione ao menos 1 contato")
      return
    }

    setSending(true)
    try {
      const res = await fetch("/api/automations/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          automation_id: report.id,
          export_format: exportFormat,
          message,
          contact_ids: selectedContacts,
          filters: localFilters,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Erro ao enviar relatorio")
      }

      toast.success("Relatorio enviado com sucesso!")
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao enviar relatorio")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Send className="size-3" />
          Ajustar e Enviar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{report.name}</DialogTitle>
          <DialogDescription>
            Ajuste os filtros salvos deste relatorio antes de enviar para os contatos.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[62vh] pr-4">
          <div className="space-y-4 py-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Formato de exportacao</Label>
                <Select value={exportFormat} onValueChange={setExportFormat}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="table">Tabela (texto)</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                    <SelectItem value="pdf">PDF</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Mensagem</Label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <div>
                <p className="text-sm font-medium">Filtros do relatorio</p>
                <p className="text-xs text-muted-foreground">
                  Use filtros rapidos e ajuste os filtros ativos antes de enviar.
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex size-6 items-center justify-center rounded-md bg-primary/10">
                      <Sparkles className="size-3.5 text-primary" />
                    </div>
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                        Filtros Rapidos
                      </span>
                      <p className="text-[11px] text-muted-foreground">
                        Atalhos para os filtros mais usados
                      </p>
                    </div>
                  </div>

                  {loadingCatalog && availableColumns.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border/60 px-3 py-4 text-xs text-muted-foreground">
                      Carregando mapeamento dos filtros...
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {quickFilters.map((quickFilter) => (
                        <button
                          key={quickFilter.key}
                          type="button"
                          onClick={() => addQuickFilter(quickFilter.key)}
                          disabled={!quickFilter.mapped}
                          className={`rounded-xl border p-3 text-left transition-all ${
                            quickFilter.mapped
                              ? "border-border bg-background/60 hover:border-primary/40 hover:bg-accent/60"
                              : "cursor-not-allowed border-dashed border-border/60 bg-background/20 opacity-60"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-primary">
                              {quickFilter.label}
                            </span>
                            {quickFilter.activeCount > 0 && (
                              <span className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                {quickFilter.activeCount}
                              </span>
                            )}
                            <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {quickFilter.mapped ? quickFilter.dataType : "Sem campo"}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Plus className="size-3" />
                            <span>{quickFilter.description}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex size-6 items-center justify-center rounded-md bg-primary/10">
                        <Search className="size-3.5 text-primary" />
                      </div>
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                          Filtros Ativos
                        </span>
                        <p className="text-[11px] text-muted-foreground">
                          Ajuste os valores que vao no envio
                        </p>
                      </div>
                    </div>
                    {localFilters.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLocalFilters([])}
                        className="h-7 text-xs text-destructive hover:text-destructive"
                      >
                        Limpar
                      </Button>
                    )}
                  </div>

                  {localFilters.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/30 px-4 py-8 text-center text-muted-foreground">
                      <FilterX className="mb-2 size-8 opacity-40" />
                      <p className="text-xs font-medium">Nenhum filtro ativo</p>
                      <p className="mt-1 text-[11px]">
                        Use os filtros rapidos ao lado para adicionar um recorte.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {localFilters.map((filter) => {
                        const isDateFilter = isDateLikeDataType(filter.dataType)

                        return (
                        <div
                          key={filter.id}
                          className="rounded-xl border border-border bg-background/50 p-3 shadow-sm"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="block truncate text-xs font-semibold text-primary">
                                {filter.columnName}
                              </span>
                              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                                {filter.tableName}
                              </span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              onClick={() => removeFilter(filter.id)}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                          {isDateFilter ? (
                            <div className="space-y-2">
                              <div className="grid gap-2 sm:grid-cols-2">
                                <div className="space-y-1">
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    Data inicial
                                  </span>
                                  <Input
                                    type="date"
                                    value={filter.value}
                                    onChange={(e) => updateFilterValue(filter.id, "value", e.target.value)}
                                    className="h-9"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    Data final
                                  </span>
                                  <Input
                                    type="date"
                                    value={filter.valueTo ?? filter.value}
                                    onChange={(e) => updateFilterValue(filter.id, "valueTo", e.target.value)}
                                    className="h-9"
                                  />
                                </div>
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                Deixe uma das datas vazia para usar intervalo aberto.
                              </p>
                            </div>
                          ) : (
                            <Input
                              type={getInputType(filter.dataType)}
                              value={filter.value}
                              onChange={(e) => updateFilterValue(filter.id, "value", e.target.value)}
                              placeholder="Valor do filtro"
                              className="h-9"
                            />
                          )}
                          <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Tipo: {filter.dataType}
                          </div>
                        </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <div>
                <p className="text-sm font-medium">Contatos</p>
                <p className="text-xs text-muted-foreground">
                  Selecione quem deve receber este relatorio.
                </p>
              </div>

              {!showContacts ? (
                <div className="text-xs text-muted-foreground">
                  Os contatos so aparecem depois que o WhatsApp for conectado pela leitura do QR Code na tela de Contatos.
                </div>
              ) : activeContacts.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  Nenhum contato ativo cadastrado.
                </div>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
                  {activeContacts.map((contact) => (
                    <label
                      key={contact.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                    >
                      <Checkbox
                        checked={selectedContacts.includes(contact.id)}
                        onCheckedChange={() => toggleContact(contact.id)}
                      />
                      <span className="text-sm">{contact.name}</span>
                      {contact.phone && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {contact.phone}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="secondary"
            onClick={handleSaveChanges}
            disabled={saving || sending || !isDirty}
          >
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Salvar alteracoes
          </Button>
          <Button
            onClick={handleSend}
            disabled={saving || sending || !showContacts || selectedContacts.length === 0}
          >
            {sending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Send className="mr-2 size-4" />
            )}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
