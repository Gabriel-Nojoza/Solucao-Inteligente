"use client"

import { useEffect, useRef, useState } from "react"
import useSWR, { mutate } from "swr"
import {
  Megaphone, Plus, Trash2, Pencil, Play, Loader2,
  ImageIcon, X, Clock, Users, ArrowLeft, MessageSquare, Send, CalendarClock,
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
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Select, SelectContent, SelectGroup, SelectItem,
  SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table"
import { CampaignDispatchDialog } from "@/components/campaigns/dispatch-dialog"
import { ColumnSelect } from "@/components/campaigns/column-select"
import { describeCronExpression } from "@/lib/schedule-cron"
import type { Campaign, Workspace, WhatsAppBotInstance, DatasetTable, DatasetColumn } from "@/lib/types"
import type { CompanyFeatures } from "@/app/api/features/route"

async function fetchApi(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  let data: unknown = null
  try { data = await response.json() } catch { data = null }
  return { response, data }
}

function extractError(data: unknown): string {
  if (!data || typeof data !== "object") return ""
  const err = (data as { error?: unknown }).error
  return typeof err === "string" ? err : ""
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const { response, data } = await fetchApi(url)
  if (!response.ok) throw new Error(extractError(data) || "Erro ao carregar")
  return data as T
}

const DATE_TYPES = ["DateTime", "Date", "DateTimeZone", "datetime", "date"]

const WEEKDAY_OPTIONS = [
  { label: "Seg", value: 1 },
  { label: "Ter", value: 2 },
  { label: "Qua", value: 3 },
  { label: "Qui", value: 4 },
  { label: "Sex", value: 5 },
  { label: "Sab", value: 6 },
  { label: "Dom", value: 0 },
]

function buildCronExpression(time: string, days: number[]): string {
  const [hourStr, minuteStr] = time.split(":")
  const hour = parseInt(hourStr, 10)
  const minute = parseInt(minuteStr, 10)
  if (isNaN(hour) || isNaN(minute)) return ""
  const sorted = [...days].sort((a, b) => a - b)
  const daysStr = sorted.length === 7 ? "*" : sorted.join(",")
  return `${minute} ${hour} * * ${daysStr}`
}

function parseCronToSchedule(cron: string | null): { enabled: boolean; time: string; days: number[] } {
  if (!cron?.trim()) return { enabled: false, time: "09:00", days: [1, 2, 3, 4, 5] }
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return { enabled: false, time: "09:00", days: [1, 2, 3, 4, 5] }
  const minute = parseInt(parts[0], 10)
  const hour = parseInt(parts[1], 10)
  if (isNaN(minute) || isNaN(hour)) return { enabled: false, time: "09:00", days: [1, 2, 3, 4, 5] }
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  const days = parts[4] === "*"
    ? [0, 1, 2, 3, 4, 5, 6]
    : parts[4].split(",").map(Number).filter((n) => !isNaN(n))
  return { enabled: true, time, days }
}

const DAYS_OPTIONS = [
  { label: "30 dias", value: 30 },
  { label: "60 dias", value: 60 },
  { label: "90 dias", value: 90 },
  { label: "120 dias", value: 120 },
  { label: "Personalizado", value: 0 },
]

const MESSAGE_TEMPLATES = [
  {
    label: "Reativacao simples",
    text: "Ola {{nome}}, faz muito tempo que nao te vemos! Venha nos visitar. 😊",
  },
  {
    label: "Novidades",
    text: "Oi {{nome}}! Sentimos sua falta. Temos novidades esperando por voce. Venha conferir! 🛍️",
  },
  {
    label: "Oferta especial",
    text: "{{nome}}, que saudades! Ja faz um tempo que voce nao aparece. Temos condicoes especiais preparadas so para voce! 🎁",
  },
  {
    label: "Convite",
    text: "Ola {{nome}}! Gostaríamos de te convidar para conhecer nossas novidades. Estamos com condicoes especiais este mes. Esperamos voce! 🤝",
  },
  {
    label: "Lembrete gentil",
    text: "Oi {{nome}}, tudo bem? Notamos que faz um tempo que nao te vemos. Que tal nos dar uma visita? Estamos com novidades! 🙏",
  },
  {
    label: "Promocao relampago",
    text: "{{nome}}, nao perca! Temos uma promocao especial so para clientes que saudamos com carinho. Aproveite enquanto durar! ⚡",
  },
]

type ExtraFilter = { column: string; days: number; days_custom: string }

const EMPTY_EXTRA_FILTER: ExtraFilter = { column: "", days: 30, days_custom: "" }

function buildSimpleFiltersDax(
  table: string, nameCol: string, phoneCol: string,
  filters: Array<{ column: string; days: number }>
): string {
  const meta = { table, nameCol, phoneCol, filters }
  const conditions = filters.map(
    (f) => `    NOT ISBLANK('${table}'[${f.column}])\n      && DATEDIFF('${table}'[${f.column}], TODAY(), DAY) >= ${f.days}`
  ).join("\n      && ")
  return [
    `// SIMPLE_FILTERS: ${JSON.stringify(meta)}`,
    "EVALUATE",
    "SELECTCOLUMNS(",
    "  FILTER(",
    `    '${table}',`,
    conditions,
    "  ),",
    `  "nome", '${table}'[${nameCol}],`,
    `  "telefone", '${table}'[${phoneCol}]`,
    ")",
  ].join("\n")
}

function parseSimpleFilters(daxQuery: string): {
  table: string; nameCol: string; phoneCol: string
  filters: Array<{ column: string; days: number }>
} | null {
  const match = daxQuery.match(/^\/\/ SIMPLE_FILTERS: (.+)/)
  if (!match) return null
  try { return JSON.parse(match[1]) } catch { return null }
}

const EMPTY_FORM = {
  name: "",
  description: "",
  dataset_id: "",
  workspace_id: "",
  customer_table: "",
  date_column: "",
  days_inactive: 30 as number,
  days_custom: "" as string,
  extra_filters: [] as ExtraFilter[],
  phone_column: "",
  name_column: "",
  dax_query: "",
  advanced_mode: false,
  message_template: "Ola {{nome}}, faz muito tempo que nao te vemos! Venha nos visitar.",
  image_url: "",
  bot_instance_id: "",
  is_active: true,
  schedule_enabled: false,
  schedule_time: "09:00",
  schedule_days: [1, 2, 3, 4, 5] as number[],
}

type FormState = typeof EMPTY_FORM
type PreviewClient = { name: string | null; phone: string | null }

function formatDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  })
}

function getDaysValue(form: FormState): number | null {
  if (form.days_inactive === 0) {
    const custom = parseInt(form.days_custom, 10)
    return isNaN(custom) || custom <= 0 ? null : custom
  }
  return form.days_inactive
}

export default function CampaignsPage() {
  const { data: campaigns, isLoading } = useSWR<Campaign[]>("/api/campaigns", fetcher)
  const { data: workspaces } = useSWR<Workspace[]>("/api/workspaces", fetcher)
  const { data: botInstances } = useSWR<WhatsAppBotInstance[]>("/api/bot/instances", fetcher)
  const { data: features } = useSWR<CompanyFeatures>("/api/features", fetcher)

  const campaignList = Array.isArray(campaigns) ? campaigns : []
  const workspaceList = Array.isArray(workspaces) ? workspaces : []
  const instanceList = Array.isArray(botInstances) ? botInstances : []

  // View mode: list or form (create/edit)
  const [viewMode, setViewMode] = useState<"list" | "form">("list")
  const [formTab, setFormTab] = useState<"mensagem" | "imagem">("mensagem")
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [dispatchCampaign, setDispatchCampaign] = useState<Campaign | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const [datasets, setDatasets] = useState<{ id: string; name: string }[]>([])
  const [loadingDatasets, setLoadingDatasets] = useState(false)

  const [tables, setTables] = useState<DatasetTable[]>([])
  const [columns, setColumns] = useState<DatasetColumn[]>([])
  const [loadingMeta, setLoadingMeta] = useState(false)

  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [previewClients, setPreviewClients] = useState<PreviewClient[] | null>(null)
  const [removedIndexes, setRemovedIndexes] = useState<Set<number>>(new Set())
  const [loadingPreview, setLoadingPreview] = useState(false)

  // Reset preview when leaving form
  useEffect(() => {
    if (viewMode !== "form") { setPreviewClients(null); setRemovedIndexes(new Set()) }
  }, [viewMode])


  // Reset preview when key fields change
  useEffect(() => {
    setPreviewClients(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.customer_table, form.date_column, form.days_inactive, form.days_custom, form.name_column, form.phone_column])

  // Auto-select first workspace
  useEffect(() => {
    if (workspaceList.length > 0 && !form.workspace_id) {
      setForm((prev) => ({ ...prev, workspace_id: workspaceList[0].pbi_workspace_id ?? "" }))
    }
  }, [workspaceList, form.workspace_id])

  // Auto-select first dataset
  useEffect(() => {
    if (datasets.length > 0 && !form.dataset_id) {
      setForm((prev) => ({ ...prev, dataset_id: datasets[0].id }))
    }
  }, [datasets, form.dataset_id])

  // Load datasets when workspace changes
  useEffect(() => {
    if (!form.workspace_id) { setDatasets([]); return }
    setLoadingDatasets(true)
    fetch(`/api/powerbi/datasets?workspaceId=${form.workspace_id}`)
      .then((r) => r.json())
      .then((data) => setDatasets(Array.isArray(data) ? data : []))
      .catch(() => setDatasets([]))
      .finally(() => setLoadingDatasets(false))
  }, [form.workspace_id])

  // Load metadata when dataset changes
  useEffect(() => {
    if (!form.dataset_id || !form.workspace_id) { setTables([]); setColumns([]); return }
    setLoadingMeta(true)
    fetch(`/api/powerbi/metadata?datasetId=${form.dataset_id}&workspaceId=${form.workspace_id}`)
      .then((r) => r.json())
      .then((data) => {
        setTables(Array.isArray(data?.tables) ? data.tables : [])
        setColumns(Array.isArray(data?.columns) ? data.columns : [])
      })
      .catch(() => { setTables([]); setColumns([]) })
      .finally(() => setLoadingMeta(false))
  }, [form.dataset_id, form.workspace_id])

  const tableOptions = tables.filter((t) => !t.isHidden)
  const columnsForTable = (tableName: string) => columns.filter((c) => c.tableName === tableName && !c.isHidden)
  const dateColumnsForTable = (tableName: string) => columnsForTable(tableName).filter((c) => DATE_TYPES.includes(c.dataType))
  const allColumnsForTable = (tableName: string) => columns.filter((c) => c.tableName === tableName)

  function openCreate() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setFormTab("mensagem")
    setPreviewClients(null)
    setRemovedIndexes(new Set())
    setViewMode("form")
  }

  function openEdit(campaign: Campaign) {
    setEditId(campaign.id)
    const schedule = parseCronToSchedule(campaign.cron_expression)
    const rawDax = campaign.dax_query ?? ""
    const simpleFilters = parseSimpleFilters(rawDax)

    if (simpleFilters) {
      const [primary, ...rest] = simpleFilters.filters
      const primaryDays = primary?.days ?? 30
      const isPreset = DAYS_OPTIONS.some((o) => o.value === primaryDays && o.value !== 0)
      setForm({
        ...EMPTY_FORM,
        name: campaign.name,
        description: campaign.description ?? "",
        dataset_id: campaign.dataset_id,
        workspace_id: campaign.workspace_id ?? "",
        customer_table: simpleFilters.table,
        phone_column: simpleFilters.phoneCol,
        name_column: simpleFilters.nameCol,
        date_column: primary?.column ?? "",
        days_inactive: isPreset ? primaryDays : 0,
        days_custom: !isPreset ? String(primaryDays) : "",
        extra_filters: rest.map((f) => {
          const preset = DAYS_OPTIONS.some((o) => o.value === f.days && o.value !== 0)
          return { column: f.column, days: preset ? f.days : 0, days_custom: preset ? "" : String(f.days) }
        }),
        advanced_mode: false,
        dax_query: "",
        message_template: campaign.message_template,
        image_url: campaign.image_url ?? "",
        bot_instance_id: campaign.bot_instance_id ?? "",
        is_active: campaign.is_active,
        schedule_enabled: schedule.enabled,
        schedule_time: schedule.time,
        schedule_days: schedule.days,
      })
    } else {
      const daysValue = campaign.days_inactive
      const isPreset = DAYS_OPTIONS.some((o) => o.value === daysValue && o.value !== 0)
      const isAdvanced = !!(campaign.dax_query && !campaign.customer_table)
      setForm({
        ...EMPTY_FORM,
        name: campaign.name,
        description: campaign.description ?? "",
        dataset_id: campaign.dataset_id,
        workspace_id: campaign.workspace_id ?? "",
        customer_table: campaign.customer_table ?? "",
        date_column: campaign.date_column ?? "",
        days_inactive: isPreset ? (daysValue ?? 30) : 0,
        days_custom: !isPreset && daysValue ? String(daysValue) : "",
        phone_column: campaign.phone_column ?? "",
        name_column: campaign.name_column ?? "",
        dax_query: campaign.dax_query ?? "",
        advanced_mode: isAdvanced,
        message_template: campaign.message_template,
        image_url: campaign.image_url ?? "",
        bot_instance_id: campaign.bot_instance_id ?? "",
        is_active: campaign.is_active,
        schedule_enabled: schedule.enabled,
        schedule_time: schedule.time,
        schedule_days: schedule.days,
      })
    }
    setFormErrors({})
    setFormTab("mensagem")
    setPreviewClients(null)
    setRemovedIndexes(new Set())
    setViewMode("form")
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFormErrors((prev) => ({ ...prev, [key]: "" }))
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (!form.name.trim()) errors.name = "Nome obrigatorio"
    if (!form.bot_instance_id) errors.bot_instance_id = "Selecione o WhatsApp de envio"
    if (!form.message_template.trim()) errors.message_template = "Template de mensagem obrigatorio"

    if (form.advanced_mode) {
      if (!form.dataset_id.trim()) errors.dataset_id = "Selecione um dataset"
      if (!form.dax_query.trim()) errors.dax_query = "Informe a consulta DAX"
    } else {
      const hasPbFields = !!form.customer_table.trim()
      if (hasPbFields) {
        if (!form.dataset_id.trim()) errors.dataset_id = "Selecione um dataset"
        if (!form.phone_column.trim()) errors.phone_column = "Selecione a coluna de telefone"
        if (!form.name_column.trim()) errors.name_column = "Selecione a coluna de nome"
        if (form.date_column.trim() && !getDaysValue(form)) errors.days = "Informe quantos dias"
        if (!form.date_column.trim() && getDaysValue(form)) errors.date_column = "Selecione a coluna de data"
      }
    }
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImage(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const { response, data } = await fetchApi("/api/campaigns/image", { method: "POST", body: formData })
      if (!response.ok) throw new Error(extractError(data) || "Erro no upload")
      const url = (data as { url?: string })?.url ?? ""
      setField("image_url", url)
      toast.success("Imagem enviada!")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao enviar imagem")
    } finally {
      setUploadingImage(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function handlePreview() {
    const days = getDaysValue(form)
    if (!form.dataset_id || !form.customer_table || !form.name_column || !form.phone_column) return
    setLoadingPreview(true)
    setPreviewClients(null)
    try {
      const { response, data } = await fetchApi("/api/campaigns/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: form.dataset_id,
          customer_table: form.customer_table,
          date_column: form.date_column || null,
          days_inactive: days || null,
          name_column: form.name_column,
          phone_column: form.phone_column,
        }),
      })
      if (!response.ok) throw new Error(extractError(data) || "Erro ao buscar clientes")
      const result = data as { clients: PreviewClient[]; total: number }
      setPreviewClients(result.clients)
      setRemovedIndexes(new Set())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao buscar clientes")
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const hasPbFields = !form.advanced_mode && !!form.customer_table.trim()
      const days = hasPbFields ? getDaysValue(form) : null
      const cron_expression = form.schedule_enabled && form.schedule_days.length > 0
        ? buildCronExpression(form.schedule_time, form.schedule_days)
        : null
      // Build extra filters with resolved days values
      const resolvedExtraFilters = form.extra_filters
        .filter((f) => f.column.trim())
        .map((f) => ({
          column: f.column.trim(),
          days: f.days === 0 ? (parseInt(f.days_custom, 10) || 1) : f.days,
        }))

      // When there are extra filters, generate combined DAX and clear simple-mode fields
      const hasExtraFilters = !form.advanced_mode && hasPbFields && resolvedExtraFilters.length > 0
      const allFilters = hasExtraFilters ? [
        ...(form.date_column.trim() && days ? [{ column: form.date_column.trim(), days }] : []),
        ...resolvedExtraFilters,
      ] : []
      const generatedDax = hasExtraFilters && allFilters.length > 0
        ? buildSimpleFiltersDax(form.customer_table.trim(), form.name_column.trim(), form.phone_column.trim(), allFilters)
        : null

      const payload = {
        ...(editId ? { id: editId } : {}),
        name: form.name.trim(),
        description: form.description.trim() || null,
        dataset_id: form.dataset_id.trim(),
        workspace_id: form.workspace_id.trim() || null,
        dax_query: form.advanced_mode ? (form.dax_query.trim() || null) : (generatedDax ?? null),
        customer_table: (form.advanced_mode || hasExtraFilters) ? null : (form.customer_table.trim() || null),
        date_column: (form.advanced_mode || hasExtraFilters) ? null : (form.date_column.trim() || null),
        days_inactive: (form.advanced_mode || hasExtraFilters) ? null : days,
        phone_column: (form.advanced_mode || hasExtraFilters) ? null : (form.phone_column.trim() || null),
        name_column: (form.advanced_mode || hasExtraFilters) ? null : (form.name_column.trim() || null),
        message_template: form.message_template.trim(),
        image_url: form.image_url.trim() || null,
        bot_instance_id: form.bot_instance_id || null,
        is_active: form.is_active,
        cron_expression,
      }
      const { response, data } = await fetchApi("/api/campaigns", {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(extractError(data) || "Erro ao salvar")
      toast.success(editId ? "Campanha atualizada!" : "Campanha criada!")
      setViewMode("list")
      void mutate("/api/campaigns")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar campanha")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      const { response, data } = await fetchApi(`/api/campaigns?id=${deleteId}`, { method: "DELETE" })
      if (!response.ok) throw new Error(extractError(data) || "Erro ao excluir")
      toast.success("Campanha excluida!")
      void mutate("/api/campaigns")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao excluir")
    } finally {
      setDeleteId(null)
    }
  }

  async function handleToggle(campaign: Campaign) {
    try {
      const { response, data } = await fetchApi("/api/campaigns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: campaign.id, is_active: !campaign.is_active }),
      })
      if (!response.ok) throw new Error(extractError(data) || "Erro ao atualizar")
      void mutate("/api/campaigns")
    } catch {
      void mutate("/api/campaigns")
    }
  }

  // ─── VIEW MODO FORMULÁRIO (tela cheia estilo Disparo de Mensagens) ───
  if (viewMode === "form") {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-4 border-b px-6 py-4">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            Campanhas
          </button>
          <div className="h-4 w-px bg-border" />
          <div>
            <h1 className="text-base font-bold leading-tight">
              {editId ? "Editar Campanha" : "Nova Campanha"}
            </h1>
            <p className="text-xs text-muted-foreground">Configure a mensagem e os destinatarios</p>
          </div>
        </div>

        {/* Body — split panel */}
        <div className="flex flex-1 min-h-0 overflow-hidden flex-row-reverse">

          {/* ─── Coluna direita (visual): mensagem / imagem ─── */}
          <div className="flex flex-col flex-1 min-w-0">
            {/* Tabs */}
            <div className="shrink-0 grid grid-cols-2 border-b">
              <button
                type="button"
                onClick={() => setFormTab("mensagem")}
                className={`flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
                  formTab === "mensagem" ? "bg-muted/50 text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MessageSquare className="size-4" />
                Mensagem
              </button>
              <button
                type="button"
                onClick={() => setFormTab("imagem")}
                className={`flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
                  formTab === "imagem" ? "bg-muted/50 text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ImageIcon className="size-4" />
                Imagem
              </button>
            </div>

            {/* Conteúdo da tab */}
            <div className="flex-1 overflow-y-auto p-6">
              {formTab === "mensagem" ? (
                <div className="flex flex-col gap-4">
                  <Textarea
                    value={form.message_template}
                    onChange={(e) => setField("message_template", e.target.value)}
                    placeholder="Use {{NomeColuna}} para inserir valores. Ex: Ola {{nome}}!"
                    className={`min-h-48 resize-none text-sm ${formErrors.message_template ? "border-destructive" : ""}`}
                    rows={8}
                  />
                  {formErrors.message_template ? (
                    <p className="text-xs text-destructive">{formErrors.message_template}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Use {"{{NomeColuna}}"} para valores dinamicos. Ex:{" "}
                      <span className="font-mono text-foreground">{"{{" + (form.name_column || "nome") + "}}"}</span>
                    </p>
                  )}

                  {/* Modelos de mensagem */}
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Modelos de mensagem
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {MESSAGE_TEMPLATES.map((tpl) => (
                        <button
                          key={tpl.label}
                          type="button"
                          onClick={() => setField("message_template", tpl.text)}
                          className="group flex flex-col gap-1 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
                        >
                          <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                            {tpl.label}
                          </span>
                          <span className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                            {tpl.text}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {form.image_url ? (
                    <div className="flex items-start gap-4 rounded-xl border bg-muted/20 p-4">
                      <img
                        src={form.image_url}
                        alt="Preview"
                        className="h-32 w-32 shrink-0 rounded-lg object-cover"
                      />
                      <div className="flex flex-1 flex-col gap-3">
                        <p className="text-sm text-muted-foreground">Imagem sera enviada junto com a mensagem.</p>
                        <button
                          type="button"
                          onClick={() => setField("image_url", "")}
                          className="flex w-fit items-center gap-1.5 rounded-md border border-destructive/50 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <X className="size-3.5" /> Remover imagem
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed p-10 transition-colors hover:bg-muted/30"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadingImage
                        ? <Loader2 className="size-10 animate-spin text-muted-foreground" />
                        : <ImageIcon className="size-10 text-muted-foreground/50" />}
                      <div className="text-center">
                        <p className="text-sm font-medium">
                          {uploadingImage ? "Enviando..." : "Clique para fazer upload ou arraste a imagem"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">PNG, JPG ou GIF (max. 10MB)</p>
                      </div>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={handleImageUpload}
                    disabled={uploadingImage}
                  />
                </div>
              )}
            </div>

            {/* Botão salvar */}
            <div className="shrink-0 border-t px-6 py-4">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || uploadingImage}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <><Loader2 className="size-4 animate-spin" /> Salvando...</>
                ) : (
                  <><Send className="size-4" /> {editId ? "Salvar Alteracoes" : "Criar Campanha"}</>
                )}
              </button>
            </div>
          </div>

          {/* ─── Coluna esquerda (visual): configurações ─── */}
          <div className="flex w-[520px] shrink-0 flex-col border-r overflow-y-auto">
            <div className="flex flex-col gap-5 p-5">

              {/* Nome */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nome da Campanha</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  placeholder="Ex: Reativacao 30 dias"
                  className={formErrors.name ? "border-destructive" : ""}
                />
                {formErrors.name && <p className="text-xs text-destructive">{formErrors.name}</p>}
              </div>

              {/* WhatsApp */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">WhatsApp de Envio</Label>
                <Select value={form.bot_instance_id} onValueChange={(v) => setField("bot_instance_id", v)}>
                  <SelectTrigger className={formErrors.bot_instance_id ? "border-destructive" : ""}>
                    <SelectValue placeholder="Selecionar numero de WhatsApp" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>WhatsApps conectados</SelectLabel>
                      {instanceList.map((inst) => (
                        <SelectItem key={inst.id} value={inst.id}>{inst.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {formErrors.bot_instance_id && <p className="text-xs text-destructive">{formErrors.bot_instance_id}</p>}
              </div>

              {/* Separador */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quais clientes vao receber?</p>
                  <button
                    type="button"
                    onClick={() => {
                      setField("advanced_mode", !form.advanced_mode)
                      setField("customer_table", "")
                      setField("date_column", "")
                      setField("phone_column", "")
                      setField("name_column", "")
                      setField("dax_query", "")
                    }}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      form.advanced_mode
                        ? "border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {form.advanced_mode ? "DAX ativo" : "Modo avancado"}
                  </button>
                </div>

                {/* Workspace */}
                <div className="flex flex-col gap-1.5 mb-3">
                  <Label className="text-xs">Workspace Power BI</Label>
                  <Select
                    value={form.workspace_id}
                    onValueChange={(v) => {
                      setField("workspace_id", v)
                      setField("dataset_id", "")
                      setField("customer_table", "")
                      setField("date_column", "")
                      setField("phone_column", "")
                      setField("name_column", "")
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar workspace..." />
                    </SelectTrigger>
                    <SelectContent>
                      {workspaceList.map((ws) => (
                        <SelectItem key={ws.pbi_workspace_id} value={ws.pbi_workspace_id}>{ws.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Dataset */}
                <div className="flex flex-col gap-1.5 mb-3">
                  <Label className="text-xs">Dataset</Label>
                  <Select
                    value={form.dataset_id}
                    onValueChange={(v) => {
                      setField("dataset_id", v)
                      setField("customer_table", "")
                      setField("date_column", "")
                      setField("phone_column", "")
                      setField("name_column", "")
                    }}
                    disabled={!form.workspace_id || loadingDatasets}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={loadingDatasets ? "Carregando..." : "Selecionar dataset..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {datasets.map((ds) => (
                        <SelectItem key={ds.id} value={ds.id}>{ds.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {formErrors.dataset_id && <p className="text-xs text-destructive">{formErrors.dataset_id}</p>}
                </div>

                {form.advanced_mode ? (
                  /* ─── Modo avançado: DAX personalizado ─── */
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs">Consulta DAX</Label>
                    <Textarea
                      value={form.dax_query}
                      onChange={(e) => setField("dax_query", e.target.value)}
                      placeholder={`EVALUATE\nSELECTCOLUMNS(\n  FILTER(\n    'A Receber Det',\n    'A Receber Det'[AR Dias Atraso] > 0\n  ),\n  "nome", 'A Receber Det'[AR Cliente],\n  "telefone", 'A Receber Det'[Telefone],\n  "valor", 'A Receber Det'[AR Valor],\n  "dias", 'A Receber Det'[AR Dias Atraso]\n)`}
                      className={`min-h-52 resize-none font-mono text-[11px] leading-relaxed ${formErrors.dax_query ? "border-destructive" : ""}`}
                    />
                    {formErrors.dax_query && <p className="text-xs text-destructive">{formErrors.dax_query}</p>}
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                      <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mb-1">Como usar no template</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        A DAX deve retornar <span className="font-mono font-bold text-foreground">&quot;nome&quot;</span> e <span className="font-mono font-bold text-foreground">&quot;telefone&quot;</span> obrigatoriamente. Outros campos ficam disponíveis como <span className="font-mono text-foreground">{"{{campo}}"}</span> na mensagem.
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                        Ex: <span className="font-mono text-foreground">Ola {"{{nome}}"}, voce tem R${"{{valor}}"} em aberto ha {"{{dias}}"} dias.</span>
                      </p>
                    </div>
                  </div>
                ) : (
                  /* ─── Modo simples: seletores de tabela/coluna ─── */
                  <>
                    {/* Tabela */}
                    <div className="flex flex-col gap-1.5 mb-3">
                      <Label className="text-xs">Tabela</Label>
                      <ColumnSelect
                        columns={tableOptions.map((t) => t.name)}
                        value={form.customer_table}
                        onChange={(v) => {
                          setField("customer_table", v)
                          setField("date_column", "")
                          setField("phone_column", "")
                          setField("name_column", "")
                        }}
                        placeholder={loadingMeta ? "Carregando..." : "Buscar tabela..."}
                        disabled={!form.dataset_id || loadingMeta}
                        error={!!formErrors.customer_table}
                      />
                      {formErrors.customer_table && <p className="text-xs text-destructive">{formErrors.customer_table}</p>}
                    </div>

                    {/* Coluna de filtro */}
                    <div className="flex flex-col gap-1.5 mb-3">
                      <Label className="text-xs">Coluna de filtro</Label>
                      <ColumnSelect
                        columns={allColumnsForTable(form.customer_table).map((c) => c.columnName)}
                        value={form.date_column}
                        onChange={(v) => setField("date_column", v)}
                        placeholder="Buscar coluna de data..."
                        disabled={!form.customer_table}
                        error={!!formErrors.date_column}
                      />
                      {formErrors.date_column && <p className="text-xs text-destructive">{formErrors.date_column}</p>}
                    </div>

                    {/* Dias de inatividade */}
                    <div className="flex flex-col gap-1.5 mb-4">
                      <Label className="text-xs">Filtrar registros com data anterior a quantos dias?</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {DAYS_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setField("days_inactive", opt.value)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                              form.days_inactive === opt.value
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background hover:bg-accent"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {form.days_inactive === 0 && (
                        <Input
                          type="number"
                          min={1}
                          value={form.days_custom}
                          onChange={(e) => setField("days_custom", e.target.value)}
                          placeholder="Ex: 45"
                          className="w-28 mt-1"
                        />
                      )}
                      {formErrors.days && <p className="text-xs text-destructive">{formErrors.days}</p>}
                    </div>

                    {/* Filtros extras */}
                    <div className="flex flex-col gap-2 mb-3">
                      {form.extra_filters.map((ef, idx) => (
                          <div key={idx} className="flex flex-col gap-1.5 rounded-md border border-border p-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs">Coluna de filtro {idx + 2}</Label>
                              <button
                                type="button"
                                onClick={() => setForm((prev) => ({
                                  ...prev,
                                  extra_filters: prev.extra_filters.filter((_, i) => i !== idx),
                                }))}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                            <ColumnSelect
                              columns={allColumnsForTable(form.customer_table).map((c) => c.columnName)}
                              value={ef.column}
                              onChange={(v) => setForm((prev) => ({
                                ...prev,
                                extra_filters: prev.extra_filters.map((f, i) => i === idx ? { ...f, column: v } : f),
                              }))}
                              placeholder="Buscar coluna..."
                              disabled={!form.customer_table}
                            />
                            <div className="flex flex-wrap gap-1.5">
                              {DAYS_OPTIONS.map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => setForm((prev) => ({
                                    ...prev,
                                    extra_filters: prev.extra_filters.map((f, i) => i === idx ? { ...f, days: opt.value } : f),
                                  }))}
                                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                    ef.days === opt.value
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border bg-background hover:bg-accent"
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                            {ef.days === 0 && (
                              <Input
                                type="number"
                                min={1}
                                value={ef.days_custom}
                                onChange={(e) => setForm((prev) => ({
                                  ...prev,
                                  extra_filters: prev.extra_filters.map((f, i) => i === idx ? { ...f, days_custom: e.target.value } : f),
                                }))}
                                placeholder="Ex: 45"
                                className="w-28 mt-1"
                              />
                            )}
                          </div>
                        ))}
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({
                          ...prev,
                          extra_filters: [...prev.extra_filters, { ...EMPTY_EXTRA_FILTER }],
                        }))}
                        disabled={!form.customer_table}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Plus className="size-3.5" />
                        Adicionar filtro
                      </button>
                    </div>

                    {/* Colunas de nome e telefone */}
                    {form.customer_table && (
                      <>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                          <div className="flex flex-col gap-1.5">
                            <Label className="text-xs">Nome em</Label>
                            <ColumnSelect
                              columns={allColumnsForTable(form.customer_table).map((c) => c.columnName)}
                              value={form.name_column}
                              onChange={(v) => setField("name_column", v)}
                              placeholder="Coluna de nome..."
                              disabled={!form.customer_table}
                              error={!!formErrors.name_column}
                            />
                            {formErrors.name_column && <p className="text-xs text-destructive">{formErrors.name_column}</p>}
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label className="text-xs">Telefone em</Label>
                            <ColumnSelect
                              columns={allColumnsForTable(form.customer_table).map((c) => c.columnName)}
                              value={form.phone_column}
                              onChange={(v) => setField("phone_column", v)}
                              placeholder="Coluna de tel..."
                              disabled={!form.customer_table}
                              error={!!formErrors.phone_column}
                            />
                            {formErrors.phone_column && <p className="text-xs text-destructive">{formErrors.phone_column}</p>}
                          </div>
                        </div>

                        {/* Preview de clientes */}
                        {features?.campaigns && form.name_column && form.phone_column && (
                          <div className="rounded-xl border overflow-hidden">
                            <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                              <div className="flex items-center gap-2">
                                <Users className="size-3.5 text-muted-foreground" />
                                <span className="text-xs font-medium">
                                  {loadingPreview ? "Buscando..." : previewClients !== null
                                    ? `${previewClients.length} clientes`
                                    : "Contatos"
                                  }
                                </span>
                              </div>
                              {previewClients === null && !loadingPreview && (
                                <button
                                  type="button"
                                  className="text-xs text-primary hover:underline font-medium"
                                  onClick={handlePreview}
                                >
                                  Buscar clientes
                                </button>
                              )}
                              {previewClients !== null && !loadingPreview && (
                                <button
                                  type="button"
                                  className="text-xs text-muted-foreground hover:underline"
                                  onClick={handlePreview}
                                >
                                  Atualizar
                                </button>
                              )}
                            </div>

                            {loadingPreview ? (
                              <div className="flex items-center justify-center gap-2 py-5">
                                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Buscando clientes...</span>
                              </div>
                            ) : previewClients !== null && previewClients.length > 0 ? (
                              <>
                                <button
                                  type="button"
                                  className="w-full border-b bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
                                  onClick={() => setRemovedIndexes(new Set())}
                                >
                                  Selecionar Todos
                                </button>
                                <div className="max-h-96 overflow-y-auto divide-y divide-border/40">
                                  {previewClients.map((client, i) => {
                                    const removed = removedIndexes.has(i)
                                    return (
                                      <div
                                        key={i}
                                        className={`flex items-center justify-between rounded-lg mx-1.5 my-1 px-2.5 py-2 transition-colors ${
                                          removed ? "opacity-40 bg-muted/10" : "bg-muted/20 hover:bg-muted/40"
                                        }`}
                                      >
                                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                          <span className="text-xs font-bold leading-tight truncate">
                                            {client.name ?? <span className="font-normal text-muted-foreground">Sem nome</span>}
                                          </span>
                                          <span className="text-[11px] text-muted-foreground font-mono">
                                            {client.phone ?? "—"}
                                          </span>
                                        </div>
                                        <button
                                          type="button"
                                          className="ml-2 shrink-0 text-muted-foreground/50 hover:text-destructive transition-colors"
                                          onClick={() => setRemovedIndexes((prev) => {
                                            const next = new Set(prev)
                                            if (next.has(i)) next.delete(i)
                                            else next.add(i)
                                            return next
                                          })}
                                        >
                                          <Trash2 className="size-3.5" />
                                        </button>
                                      </div>
                                    )
                                  })}
                                </div>
                              </>
                            ) : previewClients !== null ? (
                              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                                Nenhum cliente inativo com esse filtro
                              </p>
                            ) : null}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Ativo */}
              <div className="flex items-center gap-3 border-t pt-4">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(v) => setField("is_active", v)}
                  id="campaign-active"
                />
                <Label htmlFor="campaign-active" className="text-sm">Campanha ativa</Label>
              </div>

              {/* Agendamento */}
              <div className="flex flex-col gap-3 border-t pt-4">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.schedule_enabled}
                    onCheckedChange={(v) => setField("schedule_enabled", v)}
                    id="schedule-enabled"
                  />
                  <Label htmlFor="schedule-enabled" className="flex items-center gap-1.5 text-sm">
                    <CalendarClock className="size-3.5" />
                    Agendamento automatico
                  </Label>
                </div>

                {form.schedule_enabled && (
                  <div className="flex flex-col gap-3 pl-1">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">Horario de envio</Label>
                      <div className="flex items-center gap-2">
                        <Select
                          value={form.schedule_time.split(":")[0] ?? "09"}
                          onValueChange={(h) => setField("schedule_time", `${h}:${form.schedule_time.split(":")[1] ?? "00"}`)}
                        >
                          <SelectTrigger className="w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => (
                              <SelectItem key={h} value={h}>{h}h</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-sm text-muted-foreground">:</span>
                        <Select
                          value={form.schedule_time.split(":")[1] ?? "00"}
                          onValueChange={(m) => setField("schedule_time", `${form.schedule_time.split(":")[0] ?? "09"}:${m}`)}
                        >
                          <SelectTrigger className="w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["00", "15", "30", "45"].map((m) => (
                              <SelectItem key={m} value={m}>{m}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">Dias da semana</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {WEEKDAY_OPTIONS.map((day) => {
                          const active = form.schedule_days.includes(day.value)
                          return (
                            <button
                              key={day.value}
                              type="button"
                              onClick={() => {
                                const next = active
                                  ? form.schedule_days.filter((d) => d !== day.value)
                                  : [...form.schedule_days, day.value]
                                setField("schedule_days", next)
                              }}
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                active
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-background hover:bg-accent"
                              }`}
                            >
                              {day.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {form.schedule_days.length > 0 && form.schedule_time && (
                      <p className="text-xs text-muted-foreground">
                        {describeCronExpression(buildCronExpression(form.schedule_time, form.schedule_days))}
                      </p>
                    )}
                    {form.schedule_days.length === 0 && (
                      <p className="text-xs text-destructive">Selecione ao menos um dia</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── VIEW MODO LISTA ───
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Campanhas" description="Disparo de mensagens para clientes inativos">
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-1 size-4" />
          Nova Campanha
        </Button>
      </PageHeader>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded" />
            ))}
          </div>
        ) : campaignList.length > 0 ? (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campanha</TableHead>
                      <TableHead className="hidden sm:table-cell">Filtro</TableHead>
                      <TableHead className="hidden md:table-cell">Ultimo disparo</TableHead>
                      <TableHead>Ativo</TableHead>
                      <TableHead className="text-right">Acoes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaignList.map((campaign) => (
                      <TableRow key={campaign.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {campaign.image_url && (
                              <img
                                src={campaign.image_url}
                                alt=""
                                className="size-8 shrink-0 rounded object-cover"
                              />
                            )}
                            <div>
                              <p className="font-medium">{campaign.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {campaign.customer_table && campaign.days_inactive
                                  ? `Filtro de ${campaign.days_inactive} dias`
                                  : campaign.description ?? "Envio manual"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {campaign.customer_table && campaign.days_inactive ? (
                            <Badge variant="secondary" className="gap-1">
                              <Clock className="size-3" />
                              {campaign.days_inactive} dias
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Manual</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {formatDate(campaign.last_run_at)}
                        </TableCell>
                        <TableCell>
                          <Switch checked={campaign.is_active} onCheckedChange={() => handleToggle(campaign)} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => setDispatchCampaign(campaign)} title="Disparar">
                              <Play className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => openEdit(campaign)} title="Editar">
                              <Pencil className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteId(campaign.id)} title="Excluir">
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
            <Megaphone className="size-10 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">Nenhuma campanha criada ainda.</p>
            <button
              type="button"
              onClick={openCreate}
              className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              + Nova Campanha
            </button>
          </div>
        )}
      </div>

      {/* Dispatch dialog */}
      <CampaignDispatchDialog
        campaign={dispatchCampaign}
        open={!!dispatchCampaign}
        onOpenChange={(open) => { if (!open) setDispatchCampaign(null) }}
        onSuccess={() => void mutate("/api/campaigns")}
      />

      {/* Delete dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
            <AlertDialogDescription>Esta acao nao pode ser desfeita.</AlertDialogDescription>
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
