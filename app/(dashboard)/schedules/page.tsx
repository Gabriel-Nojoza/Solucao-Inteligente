"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import useSWR, { mutate } from "swr"
import {
  Plus,
  Clock,
  Trash2,
  Pencil,
  Copy,
  Play,
  Loader2,
  RefreshCw,
  Search,
  ChevronDown,
  X,
  Workflow,
  Image as ImageIcon,
  User,
  Users,
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
  DialogDescription,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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
import type {
  Schedule,
  Report,
  Contact,
  ScheduleExportFormat,
  WhatsAppBotInstance,
} from "@/lib/types"
import { describeCronValue, isValidCronValue } from "@/lib/schedule-cron"
import { resolveScheduleReportConfigs } from "@/lib/schedule-report-configs"

function stripHtmlTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

async function readApiPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""

  if (contentType.includes("application/json")) {
    return response.json().catch(() => null)
  }

  const raw = await response.text().catch(() => "")
  const trimmed = raw.trim()

  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    const normalizedText = stripHtmlTags(trimmed)
    const shortMessage =
      normalizedText.length > 160
        ? `${normalizedText.slice(0, 157).trimEnd()}...`
        : normalizedText

    return {
      error: trimmed.startsWith("<")
        ? `A API respondeu HTML em vez de JSON. ${shortMessage || "Verifique a sessao ou o deploy."}`
        : shortMessage || "A API retornou uma resposta em formato inesperado.",
    }
  }
}

async function fetchApi(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const data = await readApiPayload(response)

  return { response, data }
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const { response, data } = await fetchApi(url)

  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(data) ??
        `Erro ao carregar ${url.replace(/^\/api\//, "").replaceAll("/", " ")}`
    )
  }

  return data as T
}

type BotQrStatus = {
  status: "starting" | "awaiting_qr" | "connected" | "reconnecting" | "offline" | "error"
}

type ScheduleReportOption = {
  id: string
  name: string
  defaultFormat: ScheduleExportFormat
}

type ReportPageOption = {
  name: string
  displayName: string
  order: number
}

type ScheduleListItem = Schedule & {
  report_name: string
  contacts: { id: string; name: string }[]
}

type FormReportSelection = {
  key: string
  reportId: string
  pageNames: string[]
}

type ScheduleDialogMode = "create" | "edit" | "duplicate"

const POWERBI_FORMATS: ScheduleExportFormat[] = ["PDF", "PNG", "HTML", "PPTX"]
const AUTOMATION_FORMATS: ScheduleExportFormat[] = ["csv", "xlsx", "pdf", "table"]
const DEFAULT_SCHEDULE_CRON = "0 8 * * 1-5"
const DEFAULT_SCHEDULE_MESSAGE = "Segue o relatorio {report_name} em anexo."

function formatLabel(format: ScheduleExportFormat) {
  if (format === "table") return "Tabela (texto)"
  if (format === "xlsx") return "Excel (.xlsx)"
  if (format === "HTML") return "HTML (visuais completos)"
  return format.toUpperCase()
}

function normalizeScheduleFormat(format: ScheduleExportFormat): ScheduleExportFormat {
  if (format === "pdf") {
    return "PDF"
  }

  return format
}

function buildDuplicateScheduleName(name: string, existingNames: string[]) {
  const baseName = name.trim() || "Nova rotina"
  const normalizedBaseName =
    baseName.replace(/\s-\scopia(?:\s\d+)?$/i, "").trim() || baseName
  const copyBase = `${normalizedBaseName} - copia`
  const normalizedNames = new Set(
    existingNames.map((existingName) => existingName.trim().toLowerCase()).filter(Boolean)
  )

  if (!normalizedNames.has(copyBase.toLowerCase())) {
    return copyBase
  }

  let suffix = 2
  while (normalizedNames.has(`${copyBase} ${suffix}`.toLowerCase())) {
    suffix += 1
  }

  return `${copyBase} ${suffix}`
}

function createFormReportSelection(
  reportId = "",
  pageNames: string[] = [],
  key?: string
): FormReportSelection {
  return {
    key:
      key ??
      (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    reportId,
    pageNames,
  }
}

function buildScheduleReportSummary(schedule: ScheduleListItem) {
  const reportNames = Array.isArray(schedule.report_names)
    ? schedule.report_names.filter((reportName): reportName is string => Boolean(reportName))
    : []

  if (reportNames.length === 0) {
    return schedule.report_name
  }

  if (reportNames.length === 1) {
    return reportNames[0]
  }

  return `${reportNames[0]} +${reportNames.length - 1}`
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
          : key === "report_configs"
            ? "reportConfigs"
          : key === "cron_expression"
            ? "cron"
            : key === "contact_ids"
              ? "contacts"
              : key === "pbi_page_names"
                ? "pageNames"
              : key === "name"
                ? "name"
                : key

      return [fieldKey, message.trim()] as const
    })
    .filter((entry): entry is readonly [string, string] => entry !== null)

  return Object.fromEntries(mappedEntries)
}

type AutomationItem = {
  id: string
  name: string
  dataset_id: string
  workspace_id: string | null
  selected_columns: { tableName: string; columnName: string }[]
  selected_measures: { tableName: string; measureName: string }[]
  filters: unknown[]
  bot_instance_id?: string | null
  cron_expression: string | null
  export_format: string
  is_active: boolean
  contacts: { id: string; name: string; phone: string | null }[]
  created_at: string
}

export default function SchedulesPage() {
  const { data: schedules, isLoading } = useSWR<
    ScheduleListItem[]
  >("/api/schedules", fetcher)
  const { data: reports } = useSWR<Report[]>("/api/reports", fetcher)
  const { data: botInstances } = useSWR<WhatsAppBotInstance[]>("/api/bot/instances", fetcher)
  const { data: automations, isLoading: isLoadingAutomations } = useSWR<AutomationItem[]>(
    "/api/automations",
    fetcher
  )

  const scheduleList = Array.isArray(schedules) ? schedules : []
  const reportList = Array.isArray(reports) ? reports : []
  const instanceList = Array.isArray(botInstances) ? botInstances : []
  const automationList = Array.isArray(automations) ? automations : []

  async function handleDuplicateAutomation(auto: AutomationItem) {
    try {
      const { response, data } = await fetchApi("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Copia de ${auto.name}`,
          dataset_id: auto.dataset_id,
          workspace_id: auto.workspace_id,
          selected_columns: auto.selected_columns ?? [],
          selected_measures: auto.selected_measures ?? [],
          filters: auto.filters ?? [],
          dax_query: null,
          cron_expression: auto.cron_expression,
          export_format: auto.export_format,
          message_template: null,
          contact_ids: auto.contacts?.map((c) => c.id) ?? [],
        }),
      })
      if (!response.ok) throw new Error(extractApiErrorMessage(data) ?? "Erro ao duplicar")
      toast.success("Automação duplicada!")
      void mutate("/api/automations")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao duplicar automação")
    }
  }

  const [editAutomation, setEditAutomation] = useState<AutomationItem | null>(null)
  const [editAutoName, setEditAutoName] = useState("")
  const [editAutoBotInstanceId, setEditAutoBotInstanceId] = useState("")
  const [editAutoFormat, setEditAutoFormat] = useState("csv")
  const [editAutoEnableSchedule, setEditAutoEnableSchedule] = useState(false)
  const [editAutoCron, setEditAutoCron] = useState("0 8 * * 1-5")
  const [editAutoMessage, setEditAutoMessage] = useState("")
  const [editAutoContactIds, setEditAutoContactIds] = useState<string[]>([])
  const [editAutoContactSearch, setEditAutoContactSearch] = useState("")
  const [savingEditAuto, setSavingEditAuto] = useState(false)
  const [syncingEditAutoContacts, setSyncingEditAutoContacts] = useState(false)

  const editAutoContactsKey =
    editAutomation && editAutoBotInstanceId
      ? `/api/contacts?bot_instance_id=${editAutoBotInstanceId}`
      : null
  const editAutoBotQrKey =
    editAutomation && editAutoBotInstanceId
      ? `/api/bot/qr?instance_id=${editAutoBotInstanceId}`
      : null
  const { data: editAutoContactsData, isLoading: isLoadingEditAutoContacts } = useSWR<Contact[]>(
    editAutoContactsKey,
    fetcher
  )
  const { data: editAutoBotQr } = useSWR<BotQrStatus>(editAutoBotQrKey, fetcher)
  const editAutoContactList = Array.isArray(editAutoContactsData) ? editAutoContactsData : []
  const activeEditAutoContacts = editAutoBotInstanceId
    ? editAutoContactList.filter((c) => c.is_active)
    : []
  const canSyncEditAutoContacts =
    Boolean(editAutoBotInstanceId) && editAutoBotQr?.status === "connected"
  const filteredEditAutoContacts = activeEditAutoContacts.filter((contact) => {
    const search = editAutoContactSearch.trim().toLowerCase()
    if (!search) return true
    return (
      contact.name.toLowerCase().includes(search) ||
      (contact.phone ?? "").toLowerCase().includes(search)
    )
  })

  function handleOpenEditAutomation(auto: AutomationItem) {
    setEditAutomation(auto)
    setEditAutoName(auto.name)
    setEditAutoBotInstanceId(auto.bot_instance_id ?? "")
    setEditAutoFormat(auto.export_format || "csv")
    const hasCron = !!auto.cron_expression
    setEditAutoEnableSchedule(hasCron)
    setEditAutoCron(auto.cron_expression || "0 8 * * 1-5")
    setEditAutoMessage("")
    setEditAutoContactIds(auto.contacts?.map((c) => c.id) ?? [])
    setEditAutoContactSearch("")
  }

  async function handleSaveEditAutomation() {
    if (!editAutomation || !editAutoName.trim()) return
    setSavingEditAuto(true)
    try {
      const { response, data } = await fetchApi("/api/automations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editAutomation.id,
          name: editAutoName.trim(),
          bot_instance_id: editAutoBotInstanceId || null,
          export_format: editAutoFormat,
          cron_expression: editAutoEnableSchedule ? editAutoCron : null,
          message_template: editAutoMessage || null,
          contact_ids: editAutoContactIds,
        }),
      })
      if (!response.ok) throw new Error(extractApiErrorMessage(data) ?? "Erro ao salvar")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scheduleWarning = (data as any)?._schedule_warning
      if (typeof scheduleWarning === "string" && scheduleWarning) {
        toast.warning(`Automação salva, mas houve um problema com a rotina: ${scheduleWarning}`)
      } else {
        toast.success("Automação atualizada!")
      }
      void mutate("/api/automations")
      setEditAutomation(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar automação")
    } finally {
      setSavingEditAuto(false)
    }
  }

  async function syncEditAutoContacts() {
    if (!editAutoBotInstanceId || !canSyncEditAutoContacts) return
    setSyncingEditAutoContacts(true)
    try {
      const { response, data } = await fetchApi("/api/contacts/sync-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_instance_id: editAutoBotInstanceId }),
      })
      if (!response.ok) throw new Error(extractApiErrorMessage(data) ?? "Erro ao sincronizar")
      if (editAutoContactsKey) await mutate(editAutoContactsKey)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao sincronizar contatos")
    } finally {
      setSyncingEditAutoContacts(false)
    }
  }

  const reportOptions = useMemo<ScheduleReportOption[]>(
    () => [
      ...reportList.map((report) => ({
        id: report.id,
        name: report.name,
        defaultFormat: "PDF" as ScheduleExportFormat,
      })),
      ...automationList.map((auto) => ({
        id: auto.id,
        name: auto.name,
        defaultFormat: (auto.export_format || "csv") as ScheduleExportFormat,
      })),
    ],
    [reportList, automationList]
  )

  const [deleteAutomationId, setDeleteAutomationId] = useState<string | null>(null)
  const [runningAutomationId, setRunningAutomationId] = useState<string | null>(null)

  const [scheduleSearch, setScheduleSearch] = useState("")

  const filteredSchedules = useMemo(() => {
    const q = scheduleSearch.trim().toLowerCase()
    if (!q) return scheduleList
    return scheduleList.filter((schedule) => {
      const name = schedule.name.toLowerCase()
      const reportName = buildScheduleReportSummary(schedule).toLowerCase()
      return name.includes(q) || reportName.includes(q)
    })
  }, [scheduleList, scheduleSearch])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formMode, setFormMode] = useState<ScheduleDialogMode>("create")
  const [editSchedule, setEditSchedule] = useState<ScheduleListItem | null>(null)
  const [duplicateSourceId, setDuplicateSourceId] = useState<string | null>(null)
  const [dispatching, setDispatching] = useState<string | null>(null)
  const [syncingBotContacts, setSyncingBotContacts] = useState(false)
  const [selectedBotInstanceId, setSelectedBotInstanceId] = useState("")
  const [formBotInstanceId, setFormBotInstanceId] = useState("")

  const activeBotInstanceId = dialogOpen
    ? formBotInstanceId || selectedBotInstanceId
    : selectedBotInstanceId
  const contactsKey = activeBotInstanceId
    ? `/api/contacts?bot_instance_id=${activeBotInstanceId}`
    : null
  const botQrKey = activeBotInstanceId
    ? `/api/bot/qr?instance_id=${activeBotInstanceId}`
    : null
  const { data: contacts, isLoading: isLoadingContacts } = useSWR<Contact[]>(
    contactsKey,
    fetcher
  )
  const { data: botQrConfig, isLoading: isLoadingBotQr } = useSWR<BotQrStatus>(
    botQrKey,
    fetcher
  )
  const contactList = Array.isArray(contacts) ? contacts : []
  const canShowContacts = Boolean(activeBotInstanceId)
  const canSyncContacts = Boolean(activeBotInstanceId) && botQrConfig?.status === "connected"
  const activeContacts = canShowContacts ? contactList.filter((contact) => contact.is_active) : []

  const [formName, setFormName] = useState("")
  const [formReportSelections, setFormReportSelections] = useState<FormReportSelection[]>([
    createFormReportSelection(),
  ])
  const [formCron, setFormCron] = useState("0 8 * * 1-5")
  const [formFormat, setFormFormat] = useState<ScheduleExportFormat>("PDF")
  const [formSendMode, setFormSendMode] = useState<"none" | "audio" | "text">("none")
  const [formMessage, setFormMessage] = useState(
    "Segue o relatorio {report_name} em anexo."
  )
  const [formImageUrls, setFormImageUrls] = useState<string[]>([])
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [formContactIds, setFormContactIds] = useState<string[]>([])
  const [formActive, setFormActive] = useState(true)
  const [formDisableAfterSend, setFormDisableAfterSend] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [contactSearch, setContactSearch] = useState("")
  const [reportPagesBySelection, setReportPagesBySelection] = useState<
    Record<string, ReportPageOption[]>
  >({})
  const [loadingReportPagesBySelection, setLoadingReportPagesBySelection] = useState<
    Record<string, boolean>
  >({})
  const [reportPagesErrorsBySelection, setReportPagesErrorsBySelection] = useState<
    Record<string, string>
  >({})

  useEffect(() => {
    if (!selectedBotInstanceId && instanceList.length > 0) {
      setSelectedBotInstanceId(
        instanceList.find((instance) => instance.is_default)?.id ?? instanceList[0].id
      )
    }
  }, [instanceList, selectedBotInstanceId])

  useEffect(() => {
    if (!dialogOpen || formBotInstanceId || instanceList.length === 0) {
      return
    }

    setFormBotInstanceId(
      instanceList.find((instance) => instance.is_default)?.id ?? instanceList[0].id
    )
  }, [dialogOpen, formBotInstanceId, instanceList])

  useEffect(() => {
    if (!dialogOpen || !formBotInstanceId) {
      return
    }

    setContactSearch("")

    if (contactsKey) {
      void mutate(contactsKey)
    }

    if (botQrKey) {
      void mutate(botQrKey)
    }
  }, [botQrKey, contactsKey, dialogOpen, formBotInstanceId])

  const normalizedFormReportSelections = useMemo(
    () =>
      formReportSelections
        .map((selection) => ({
          ...selection,
          reportId: selection.reportId.trim(),
          pageNames: [...new Set(selection.pageNames.map((pageName) => pageName.trim()).filter(Boolean))],
        }))
        .filter((selection) => selection.reportId),
    [formReportSelections]
  )

  const hasAutomationSelected = useMemo(
    () =>
      normalizedFormReportSelections.some((selection) =>
        automationList.some((a) => a.id === selection.reportId)
      ),
    [normalizedFormReportSelections, automationList]
  )

  const formatOptions = hasAutomationSelected ? AUTOMATION_FORMATS : POWERBI_FORMATS

  useEffect(() => {
    const options = hasAutomationSelected ? AUTOMATION_FORMATS : POWERBI_FORMATS
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setFormFormat((current) => (options.includes(current) ? current : options[0]))
  }, [hasAutomationSelected])

  const normalizeContactSearch = (v: string | null | undefined) =>
    (v ?? "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().trim()

  const filteredContacts = activeContacts.filter((contact) => {
    const search = normalizeContactSearch(contactSearch)
    if (!search) return true

    return (
      normalizeContactSearch(contact.name).includes(search) ||
      normalizeContactSearch(contact.phone).includes(search) ||
      normalizeContactSearch(contact.whatsapp_group_id).includes(search)
    )
  })

  const botInstanceNameById = useMemo(
    () => Object.fromEntries(instanceList.map((instance) => [instance.id, instance.name])),
    [instanceList]
  )

  const selectedContacts = useMemo(() => {
    const contactMap = new Map(contactList.map((contact) => [contact.id, contact] as const))

    return formContactIds.map((contactId) => {
      const contact = contactMap.get(contactId)

      return {
        id: contactId,
        name: contact?.name || "Contato selecionado",
        type: contact?.type === "group" ? "group" : "individual",
      }
    })
  }, [contactList, formContactIds])

  const handleCronValueChange = useCallback((value: string) => {
    setFormCron(value)
    setFormErrors((prev) => (prev.cron ? { ...prev, cron: "" } : prev))
  }, [])

  function resetScheduleForm() {
    setFormMode("create")
    setEditSchedule(null)
    setDuplicateSourceId(null)
    setFormName("")
    setFormBotInstanceId(
      instanceList.find((instance) => instance.is_default)?.id ?? instanceList[0]?.id ?? ""
    )
    setFormReportSelections([createFormReportSelection()])
    setFormCron(DEFAULT_SCHEDULE_CRON)
    setFormFormat("PDF")
    setFormSendMode("none")
    setFormMessage(DEFAULT_SCHEDULE_MESSAGE)
    setFormImageUrls([])
    setFormContactIds([])
    setFormActive(true)
    setFormDisableAfterSend(false)
    setFormErrors({})
    setContactSearch("")
    setReportPagesBySelection({})
    setReportPagesErrorsBySelection({})
    setLoadingReportPagesBySelection({})
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open)

    if (!open) {
      resetScheduleForm()
    }
  }

  function openCreate() {
    resetScheduleForm()
    setDialogOpen(true)

    if (selectedBotInstanceId && canSyncContacts) {
      void syncContactsFromBot(true)
    }
  }

  function populateScheduleForm(
    schedule: ScheduleListItem,
    mode: Exclude<ScheduleDialogMode, "create">
  ) {
    const duplicating = mode === "duplicate"
    const scheduleReportConfigs = resolveScheduleReportConfigs(schedule)

    setFormMode(mode)
    setEditSchedule(duplicating ? null : schedule)
    setDuplicateSourceId(duplicating ? schedule.id : null)
    setFormName(
      duplicating
        ? buildDuplicateScheduleName(
            schedule.name,
            scheduleList.map((item) => item.name)
          )
        : schedule.name
    )
    setFormBotInstanceId(
      schedule.bot_instance_id ??
        instanceList.find((instance) => instance.is_default)?.id ??
        instanceList[0]?.id ??
        ""
    )
    setFormReportSelections(
      scheduleReportConfigs.length > 0
        ? scheduleReportConfigs.map((reportConfig, index) =>
            createFormReportSelection(
              reportConfig.report_id,
              reportConfig.pbi_page_names ?? [],
              `${mode}-${schedule.id}-${index}`
            )
          )
        : [createFormReportSelection()]
    )
    setFormCron(schedule.cron_expression)
    setFormFormat(normalizeScheduleFormat(schedule.export_format))
    setFormSendMode(
      schedule.send_mode === "audio" || schedule.send_mode === "text"
        ? schedule.send_mode
        : "none"
    )
    setFormMessage(schedule.message_template ?? DEFAULT_SCHEDULE_MESSAGE)
    setFormImageUrls(
      Array.isArray(schedule.image_urls) && schedule.image_urls.length > 0
        ? (schedule.image_urls as string[]).filter((u) => typeof u === "string" && u.trim())
        : schedule.image_url ? [schedule.image_url] : []
    )
    setFormContactIds(schedule.contacts?.map((c) => c.id) ?? [])
    setFormActive(duplicating ? false : schedule.is_active)
    setFormDisableAfterSend(schedule.disable_after_send ?? false)
    setFormErrors({})
    setContactSearch("")
    setReportPagesBySelection({})
    setReportPagesErrorsBySelection({})
    setLoadingReportPagesBySelection({})
    setDialogOpen(true)

    if ((schedule.bot_instance_id ?? selectedBotInstanceId) && canSyncContacts) {
      void syncContactsFromBot(true)
    }
  }

  function openEdit(schedule: ScheduleListItem) {
    populateScheduleForm(schedule, "edit")
  }

  function openDuplicate(schedule: ScheduleListItem) {
    populateScheduleForm(schedule, "duplicate")
  }

  function validateScheduleForm(): boolean {
    const errors: Record<string, string> = {}
    const selectedReportIds = normalizedFormReportSelections.map((selection) => selection.reportId)
    const hasDuplicateReports = new Set(selectedReportIds).size !== selectedReportIds.length
    const hasMultiReportPages = normalizedFormReportSelections.some(
      (selection) => selection.pageNames.length > 1
    )

    if (!formName.trim()) errors.name = "Nome obrigatorio"
    if (!formBotInstanceId) {
      errors.bot_instance_id = "Selecione qual WhatsApp vai enviar essa rotina"
    }
    if (normalizedFormReportSelections.length === 0 && formImageUrls.length === 0) {
      errors.reportConfigs = "Selecione ao menos 1 relatorio ou adicione uma imagem"
    } else if (hasDuplicateReports) {
      errors.reportConfigs = "Selecione cada relatorio apenas uma vez"
    }
    if (!formCron.trim()) errors.cron = "Frequencia obrigatoria"
    if (formCron.trim() && !isValidCronValue(formCron)) {
      errors.cron = "Cada horario deve ter uma expressao CRON valida com 5 campos"
    }
    if (
      !hasAutomationSelected &&
      formFormat !== "PDF" &&
      (normalizedFormReportSelections.length > 1 || hasMultiReportPages)
    ) {
      errors.reportConfigs =
        "Selecione varios relatorios ou varias paginas apenas quando o formato for PDF"
    }

    if (!formBotInstanceId) {
      errors.contacts = "Selecione primeiro o WhatsApp de envio"
    } else if (formContactIds.length === 0) {
      errors.contacts = "Selecione ao menos 1 contato"
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
      const res = await fetch("/api/schedules/image", { method: "POST", body: formData })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok) throw new Error(data.error || "Erro no upload")
      if (data.url) setFormImageUrls((prev) => [...prev, data.url!])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao fazer upload")
    } finally {
      setUploadingImage(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function handleSave() {
    if (!validateScheduleForm()) return

    const editingScheduleId = formMode === "edit" ? editSchedule?.id ?? null : null
    const isEditing = editingScheduleId !== null
    const primaryReportSelection = normalizedFormReportSelections[0] ?? null

    if (!primaryReportSelection && formImageUrls.length === 0) {
      setFormErrors((prev) => ({
        ...prev,
        reportConfigs: "Selecione ao menos 1 relatorio ou adicione uma imagem",
      }))
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...(editingScheduleId ? { id: editingScheduleId } : {}),
        name: formName.trim(),
        bot_instance_id: formBotInstanceId || null,
        report_id: primaryReportSelection?.reportId || undefined,
        pbi_page_name: primaryReportSelection?.reportId ? (primaryReportSelection.pageNames[0] ?? null) : null,
        pbi_page_names: primaryReportSelection?.reportId ? primaryReportSelection.pageNames : [],
        report_configs: normalizedFormReportSelections.map((selection) => ({
          report_id: selection.reportId,
          pbi_page_name: selection.pageNames[0] ?? null,
          pbi_page_names: selection.pageNames,
        })),
        cron_expression: formCron,
        export_format: formFormat,
        send_mode: formSendMode,
        message_template: formMessage || null,
        image_url: formImageUrls[0] ?? null,
        image_urls: formImageUrls.length > 0 ? formImageUrls : null,
        disable_after_send: formDisableAfterSend,
        contact_ids: formContactIds,
        is_active: formActive,
      }

      const { response, data } = await fetchApi("/api/schedules", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const apiFieldErrors = mapApiFieldErrors(data)
        const firstFieldError = Object.values(apiFieldErrors).find(
          (message): message is string =>
            typeof message === "string" && message.trim().length > 0
        )
        if (Object.keys(apiFieldErrors).length > 0) {
          setFormErrors((prev) => ({ ...prev, ...apiFieldErrors }))
        }

        throw new Error(
          extractApiErrorMessage(data) ??
            firstFieldError ??
            (isEditing
              ? "Erro ao atualizar rotina"
              : formMode === "duplicate"
                ? "Erro ao duplicar rotina"
                : "Erro ao criar rotina")
        )
      }

      toast.success(
        isEditing
          ? "Rotina atualizada!"
          : formMode === "duplicate"
            ? "Rotina duplicada!"
            : "Rotina criada!"
      )
      handleDialogOpenChange(false)
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
      const { response, data } = await fetchApi(`/api/schedules?id=${deleteId}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data) ?? "Erro ao excluir")
      }

      toast.success("Rotina excluida!")
      mutate("/api/schedules")
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : "Erro ao excluir"
      )
    } finally {
      setDeleteId(null)
    }
  }

  async function handleRunAutomation(id: string) {
    setRunningAutomationId(id)
    try {
      const { response, data } = await fetchApi("/api/automations/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automation_id: id }),
      })
      if (!response.ok) throw new Error(extractApiErrorMessage(data) ?? "Erro no disparo")
      toast.success("Automacao disparada com sucesso!")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao disparar automacao")
    } finally {
      setRunningAutomationId(null)
    }
  }

  async function handleDeleteAutomation() {
    if (!deleteAutomationId) return
    try {
      const { response, data } = await fetchApi(`/api/automations?id=${deleteAutomationId}`, {
        method: "DELETE",
      })
      if (!response.ok) throw new Error(extractApiErrorMessage(data) ?? "Erro ao excluir")
      toast.success("Automacao excluida!")
      void mutate("/api/automations")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao excluir automacao")
    } finally {
      setDeleteAutomationId(null)
    }
  }

  async function handleToggleAutomation(id: string, isActive: boolean) {
    try {
      const { response, data } = await fetchApi("/api/automations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_active: !isActive }),
      })
      if (!response.ok) throw new Error(extractApiErrorMessage(data) ?? "Erro ao atualizar")
      void mutate("/api/automations")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao atualizar automacao")
      void mutate("/api/automations")
    }
  }

  async function handleDispatch(scheduleId: string) {
    setDispatching(scheduleId)

    try {
      const { response, data } = await fetchApi("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule_id: scheduleId }),
      })

      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data) ?? "Erro no disparo")
      }

      const respData = data as { logs_created?: unknown; skipped?: unknown; reason?: unknown } | null

      if (respData?.skipped) {
        const reason = typeof respData.reason === "string" ? respData.reason : "Fora do horario de envio configurado"
        toast.warning(`Disparo ignorado: ${reason}`)
        return
      }

      const logsCreated =
        typeof respData?.logs_created === "number" ? respData.logs_created : 0

      toast.success(`Disparo iniciado! ${logsCreated} logs criados.`)
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

  async function loadReportPagesForSelection(selectionKey: string, reportId: string) {
    const normalizedReportId = reportId.trim()

    if (!normalizedReportId) {
      setReportPagesBySelection((prev) => {
        const next = { ...prev }
        delete next[selectionKey]
        return next
      })
      setReportPagesErrorsBySelection((prev) => {
        const next = { ...prev }
        delete next[selectionKey]
        return next
      })
      setLoadingReportPagesBySelection((prev) => {
        const next = { ...prev }
        delete next[selectionKey]
        return next
      })
      return
    }

    setLoadingReportPagesBySelection((prev) => ({ ...prev, [selectionKey]: true }))
    setReportPagesErrorsBySelection((prev) => ({ ...prev, [selectionKey]: "" }))

    try {
      const { response, data } = await fetchApi(`/api/reports/${normalizedReportId}/pages`)

      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data) ?? "Erro ao carregar paginas do relatorio")
      }

      const payload = data as { pages?: unknown } | null
      const pages = Array.isArray(payload?.pages) ? (payload.pages as ReportPageOption[]) : []

      setReportPagesBySelection((prev) => ({ ...prev, [selectionKey]: pages }))
      setFormReportSelections((current) =>
        current.map((selection) =>
          selection.key === selectionKey
            ? {
                ...selection,
                pageNames: pages
                  .filter((page) => selection.pageNames.includes(page.name))
                  .map((page) => page.name),
              }
            : selection
        )
      )
    } catch (error) {
      setReportPagesBySelection((prev) => ({ ...prev, [selectionKey]: [] }))
      setFormReportSelections((current) =>
        current.map((selection) =>
          selection.key === selectionKey ? { ...selection, pageNames: [] } : selection
        )
      )
      setReportPagesErrorsBySelection((prev) => ({
        ...prev,
        [selectionKey]:
          error instanceof Error && error.message
            ? error.message
            : "Erro ao carregar paginas do relatorio",
      }))
    } finally {
      setLoadingReportPagesBySelection((prev) => ({ ...prev, [selectionKey]: false }))
    }
  }

  function handleReportSelectionChange(selectionKey: string, reportId: string) {
    setFormReportSelections((current) =>
      current.map((selection) =>
        selection.key === selectionKey
          ? {
              ...selection,
              reportId,
              pageNames: [],
            }
          : selection
      )
    )
    setFormErrors((prev) => ({ ...prev, report: "", reportConfigs: "", pageNames: "" }))

    if (!reportId) {
      void loadReportPagesForSelection(selectionKey, "")
      return
    }

    const isDaxAutomation = automationList.some((a) => a.id === reportId)
    if (isDaxAutomation) return

    void loadReportPagesForSelection(selectionKey, reportId)
  }

  function addReportSelection() {
    setFormReportSelections((current) => [...current, createFormReportSelection()])
    setFormErrors((prev) => ({ ...prev, report: "", reportConfigs: "", pageNames: "" }))
  }

  function removeReportSelection(selectionKey: string) {
    setFormReportSelections((current) => {
      const next = current.filter((selection) => selection.key !== selectionKey)
      return next.length > 0 ? next : [createFormReportSelection()]
    })
    setReportPagesBySelection((prev) => {
      const next = { ...prev }
      delete next[selectionKey]
      return next
    })
    setReportPagesErrorsBySelection((prev) => {
      const next = { ...prev }
      delete next[selectionKey]
      return next
    })
    setLoadingReportPagesBySelection((prev) => {
      const next = { ...prev }
      delete next[selectionKey]
      return next
    })
    setFormErrors((prev) => ({ ...prev, report: "", reportConfigs: "", pageNames: "" }))
  }

  function toggleReportPage(selectionKey: string, pageName: string) {
    setFormReportSelections((current) =>
      current.map((selection) => {
        if (selection.key !== selectionKey) {
          return selection
        }

        const nextPageNames = selection.pageNames.includes(pageName)
          ? selection.pageNames.filter((value) => value !== pageName)
          : [...selection.pageNames, pageName]
        const pages = reportPagesBySelection[selectionKey] ?? []

        return {
          ...selection,
          pageNames: pages
            .filter((page) => nextPageNames.includes(page.name))
            .map((page) => page.name),
        }
      })
    )
    setFormErrors((prev) => ({ ...prev, pageNames: "", reportConfigs: "" }))
  }

  async function syncContactsFromBot(silent = false) {
    if (!formBotInstanceId) {
      if (!silent) {
        toast.error("Selecione o WhatsApp que sera usado na rotina antes de sincronizar.")
      }
      return
    }

    if (!canSyncContacts) {
      if (!silent) {
        toast.error(
          "Conecte o WhatsApp pela leitura do QR Code antes de sincronizar contatos."
        )
      }
      return
    }

    setSyncingBotContacts(true)

    try {
      const { response, data } = await fetchApi("/api/contacts/sync-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_instance_id: formBotInstanceId }),
      })

      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage(data) ?? "Erro ao sincronizar contatos do bot"
        )
      }

      if (contactsKey) {
        await mutate(contactsKey)
      }

      if (!silent) {
        const inserted =
          typeof (data as { inserted?: unknown } | null)?.inserted === "number"
            ? (data as { inserted: number }).inserted
            : 0
        const updated =
          typeof (data as { updated?: unknown } | null)?.updated === "number"
            ? (data as { updated: number }).updated
            : 0

        if (inserted === 0 && updated === 0) {
          toast.success("Contatos do bot ja estao atualizados.")
        } else {
          toast.success(`${inserted} contato(s) novo(s) e ${updated} atualizado(s).`)
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

  useEffect(() => {
    if (!dialogOpen) {
      return
    }

    for (const selection of formReportSelections) {
      if (!selection.reportId) {
        continue
      }

      const isDaxAutomation = automationList.some((a) => a.id === selection.reportId)
      if (isDaxAutomation) continue

      const reportPages = reportPagesBySelection[selection.key]
      const isLoading = loadingReportPagesBySelection[selection.key]
      if (!reportPages && !isLoading) {
        void loadReportPagesForSelection(selection.key, selection.reportId)
      }
    }
  }, [dialogOpen, formReportSelections, reportPagesBySelection, loadingReportPagesBySelection])

  const selectedPageDisplayNamesBySelection = useMemo(() => {
    return Object.fromEntries(
      formReportSelections.map((selection) => {
        const pages = reportPagesBySelection[selection.key] ?? []
        const pageNameMap = new Map(
          pages.map((page) => [page.name, page.displayName || page.name] as const)
        )

        return [
          selection.key,
          selection.pageNames.map((pageName) => pageNameMap.get(pageName) ?? pageName),
        ] as const
      })
    )
  }, [formReportSelections, reportPagesBySelection])

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
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={scheduleSearch}
            onChange={(e) => setScheduleSearch(e.target.value)}
            placeholder="Pesquisar por nome ou relatorio..."
            className="pl-9"
          />
        </div>

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
            ) : filteredSchedules.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-12">
                <Search className="size-12 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Nenhuma rotina encontrada</p>
                  <p className="text-sm text-muted-foreground">
                    Tente pesquisar por outro nome ou relatorio.
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
                    {filteredSchedules.map((schedule) => (
                      <TableRow key={schedule.id}>
                        <TableCell className="font-medium">{schedule.name}</TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          {buildScheduleReportSummary(schedule)}
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
                          {(() => {
                            const contacts = schedule.contacts ?? []
                            const individuals = contacts.filter(c => c.type === "individual").length
                            const groups = contacts.filter(c => c.type === "group").length
                            return (
                              <div className="flex flex-col gap-0.5">
                                {individuals > 0 && (
                                  <Badge variant="secondary" className="gap-1 w-fit">
                                    <User className="h-3 w-3" />
                                    {individuals} individual{individuals !== 1 ? "is" : ""}
                                  </Badge>
                                )}
                                {groups > 0 && (
                                  <Badge variant="secondary" className="gap-1 w-fit">
                                    <Users className="h-3 w-3" />
                                    {groups} grupo{groups !== 1 ? "s" : ""}
                                  </Badge>
                                )}
                                {contacts.length === 0 && (
                                  <Badge variant="secondary">0 contatos</Badge>
                                )}
                              </div>
                            )
                          })()}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={schedule.is_active}
                            onCheckedChange={async (checked) => {
                              try {
                                const { response, data } = await fetchApi("/api/schedules", {
                                  method: "PUT",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    id: schedule.id,
                                    is_active: checked,
                                  }),
                                })

                                if (!response.ok) {
                                  throw new Error(
                                    extractApiErrorMessage(data) ??
                                      "Nao foi possivel atualizar o status da rotina"
                                  )
                                }

                                mutate("/api/schedules")
                              } catch (error) {
                                toast.error(
                                  error instanceof Error && error.message
                                    ? error.message
                                    : "Nao foi possivel atualizar o status da rotina"
                                )
                                mutate("/api/schedules")
                              }
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
                              title="Editar rotina"
                            >
                              <Pencil className="size-4" />
                              <span className="sr-only">Editar</span>
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openDuplicate(schedule)}
                              title="Duplicar rotina"
                            >
                              <Copy className="size-4" />
                              <span className="sr-only">Duplicar</span>
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteId(schedule.id)}
                              title="Excluir rotina"
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

        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Automações DAX</h2>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoadingAutomations ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded" />
                ))}
              </div>
            ) : automationList.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-12">
                <Workflow className="size-12 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Nenhuma automação configurada</p>
                  <p className="text-sm text-muted-foreground">
                    Crie automações DAX no Construtor de Relatórios.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead className="hidden lg:table-cell">Formato</TableHead>
                      <TableHead className="hidden md:table-cell">Frequência</TableHead>
                      <TableHead className="hidden md:table-cell">Contatos</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {automationList.map((auto) => (
                      <TableRow key={auto.id}>
                        <TableCell className="font-medium">{auto.name}</TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <Badge variant="outline">{auto.export_format.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {auto.cron_expression ? (
                            <div className="flex flex-wrap gap-1">
                              {describeCronValue(auto.cron_expression).map((item, index) => (
                                <Badge key={`${auto.id}-cron-${index}`} variant="outline">
                                  {item}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">Sob demanda</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {(() => {
                            const contacts = auto.contacts ?? []
                            const individuals = contacts.filter(c => c.type === "individual").length
                            const groups = contacts.filter(c => c.type === "group").length
                            return (
                              <div className="flex flex-col gap-0.5">
                                {individuals > 0 && (
                                  <Badge variant="secondary" className="gap-1 w-fit">
                                    <User className="h-3 w-3" />
                                    {individuals} individual{individuals !== 1 ? "is" : ""}
                                  </Badge>
                                )}
                                {groups > 0 && (
                                  <Badge variant="secondary" className="gap-1 w-fit">
                                    <Users className="h-3 w-3" />
                                    {groups} grupo{groups !== 1 ? "s" : ""}
                                  </Badge>
                                )}
                                {contacts.length === 0 && (
                                  <Badge variant="secondary">0 contatos</Badge>
                                )}
                              </div>
                            )
                          })()}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={auto.is_active}
                            onCheckedChange={() => void handleToggleAutomation(auto.id, auto.is_active)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => void handleRunAutomation(auto.id)}
                              disabled={runningAutomationId === auto.id}
                              title="Disparar agora"
                            >
                              {runningAutomationId === auto.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Play className="size-4" />
                              )}
                              <span className="sr-only">Disparar</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenEditAutomation(auto)}
                              title="Editar automação"
                            >
                              <Pencil className="size-4" />
                              <span className="sr-only">Editar</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => void handleDuplicateAutomation(auto)}
                              title="Duplicar automação"
                            >
                              <Copy className="size-4" />
                              <span className="sr-only">Duplicar</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteAutomationId(auto.id)}
                              title="Excluir automação"
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

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          key={`${formMode}-${editSchedule?.id ?? duplicateSourceId ?? "new-schedule"}`}
          className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>
              {formMode === "edit"
                ? "Editar Rotina"
                : formMode === "duplicate"
                  ? "Duplicar Rotina"
                  : "Nova Rotina"}
            </DialogTitle>
            <DialogDescription>
              {formMode === "duplicate"
                ? "Crie uma nova rotina a partir da selecionada. Ela inicia inativa para evitar disparos duplicados sem revisao."
                : "Configure os horarios, contatos e formato para esta rotina de disparo."}
            </DialogDescription>
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
              <Label>WhatsApp de Envio</Label>
              <Select
                value={formBotInstanceId}
                onValueChange={(value) => {
                  setFormBotInstanceId(value)
                  setFormContactIds([])
                  setContactSearch("")
                  setFormErrors((prev) => ({
                    ...prev,
                    bot_instance_id: "",
                    contacts: "",
                  }))
                }}
              >
                <SelectTrigger className={formErrors.bot_instance_id ? "border-destructive" : ""}>
                  <SelectValue placeholder="Selecionar numero de WhatsApp" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>WhatsApps conectados</SelectLabel>
                    {instanceList.map((instance) => (
                      <SelectItem key={instance.id} value={instance.id}>
                        {instance.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              {formErrors.bot_instance_id ? (
                <p className="text-xs text-destructive">{formErrors.bot_instance_id}</p>
              ) : formBotInstanceId ? (
                <p className="text-xs text-muted-foreground">
                  Os contatos, grupos e o envio desta rotina vao usar o WhatsApp{" "}
                  {botInstanceNameById[formBotInstanceId] || "selecionado"}.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Escolha qual numero vai sincronizar os contatos e enviar essa rotina.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <Label>Relatorios</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={addReportSelection}
                >
                  <Plus className="size-3.5" />+ Relatorio
                </Button>
              </div>

              {formReportSelections.map((selection, index) => {
                const reportPages = reportPagesBySelection[selection.key] ?? []
                const loadingReportPages = loadingReportPagesBySelection[selection.key] ?? false
                const reportPagesError = reportPagesErrorsBySelection[selection.key] ?? ""
                const selectedPageDisplayNames =
                  selectedPageDisplayNamesBySelection[selection.key] ?? []

                return (
                  <div
                    key={selection.key}
                    className={`space-y-3 rounded-lg border p-3 ${
                      formErrors.report || formErrors.reportConfigs || formErrors.pageNames
                        ? "border-destructive"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">Relatorio {index + 1}</p>
                      {formReportSelections.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 px-2 text-xs"
                          onClick={() => removeReportSelection(selection.key)}
                        >
                          <X className="size-3.5" />
                          Remover
                        </Button>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label>Relatorio</Label>
                      <Select
                        value={selection.reportId}
                        onValueChange={(value) => {
                          const option = reportOptions.find((item) => item.id === value)
                          if (option && formFormat !== option.defaultFormat) {
                            setFormFormat(option.defaultFormat)
                          }
                          handleReportSelectionChange(selection.key, value)
                        }}
                      >
                        <SelectTrigger
                          className={
                            formErrors.report || formErrors.reportConfigs
                              ? "border-destructive"
                              : ""
                          }
                        >
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
                          {automationList.length > 0 ? (
                            <SelectGroup>
                              <SelectLabel>Automações DAX</SelectLabel>
                              {automationList.map((auto) => (
                                <SelectItem key={auto.id} value={auto.id}>
                                  {auto.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ) : null}
                        </SelectContent>
                      </Select>
                    </div>

                    {!automationList.some((a) => a.id === selection.reportId) && (
                    <div className="flex flex-col gap-2">
                      <Label>Paginas do Relatorio</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full justify-between font-normal"
                            disabled={!selection.reportId || loadingReportPages}
                          >
                            <span className="truncate">
                              {loadingReportPages
                                ? "Carregando paginas..."
                                : selection.pageNames.length === 0
                                  ? "Pagina padrao do relatorio"
                                  : selection.pageNames.length === 1
                                    ? selectedPageDisplayNames[0]
                                    : `${selection.pageNames.length} paginas selecionadas`}
                            </span>
                            <ChevronDown className="size-4 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
                          align="start"
                        >
                          <div className="border-b px-3 py-3">
                            <p className="text-sm font-medium">Paginas do relatorio</p>
                            <p className="text-xs text-muted-foreground">
                              Selecione uma ou mais paginas. Sem selecao, o envio usa a pagina
                              padrao.
                            </p>
                          </div>

                          <div className="border-b px-3 py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-full justify-start px-2 text-xs"
                              onClick={() => {
                                setFormReportSelections((current) =>
                                  current.map((currentSelection) =>
                                    currentSelection.key === selection.key
                                      ? { ...currentSelection, pageNames: [] }
                                      : currentSelection
                                  )
                                )
                                setFormErrors((prev) => ({
                                  ...prev,
                                  pageNames: "",
                                  reportConfigs: "",
                                }))
                              }}
                              disabled={selection.pageNames.length === 0}
                            >
                              Usar pagina padrao do relatorio
                            </Button>
                          </div>

                          <div
                            className="max-h-64 overflow-y-auto overscroll-contain p-2 pr-2"
                            onWheelCapture={(event) => {
                              const container = event.currentTarget
                              container.scrollTop += event.deltaY
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                          >
                            <div className="space-y-1">
                              {reportPages.length === 0 ? (
                                <div className="px-2 py-4 text-xs text-muted-foreground">
                                  Nenhuma pagina disponivel para este relatorio.
                                </div>
                              ) : (
                                reportPages.map((page) => (
                                  <label
                                    key={`${selection.key}-${page.name}`}
                                    className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent"
                                  >
                                    <Checkbox
                                      checked={selection.pageNames.includes(page.name)}
                                      onCheckedChange={() =>
                                        toggleReportPage(selection.key, page.name)
                                      }
                                    />
                                    <div className="min-w-0">
                                      <p className="truncate text-sm">{page.displayName}</p>
                                      {page.displayName !== page.name ? (
                                        <p className="truncate text-xs text-muted-foreground">
                                          {page.name}
                                        </p>
                                      ) : null}
                                    </div>
                                  </label>
                                ))
                              )}
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>

                      {selectedPageDisplayNames.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {selectedPageDisplayNames.map((pageDisplayName, pageIndex) => (
                            <Badge
                              key={`${selection.pageNames[pageIndex]}-${selection.key}-${pageIndex}`}
                              variant="secondary"
                            >
                              {pageDisplayName}
                            </Badge>
                          ))}
                        </div>
                      ) : null}

                      {reportPagesError ? (
                        <p className="text-xs text-destructive">{reportPagesError}</p>
                      ) : selection.reportId ? (
                        <p className="text-xs text-muted-foreground">
                          {loadingReportPages
                            ? "Buscando paginas disponiveis no Power BI..."
                            : formFormat === "PDF"
                              ? "Selecione uma ou mais paginas especificas para enviar cada relatorio separadamente."
                              : "Para formatos diferentes de PDF, selecione no maximo uma pagina especifica ou mantenha a pagina padrao."}
                        </p>
                      ) : null}
                    </div>
                    )}
                  </div>
                )
              })}

              {formErrors.report || formErrors.reportConfigs || formErrors.pageNames ? (
                <p className="text-xs text-destructive">
                  {formErrors.reportConfigs || formErrors.report || formErrors.pageNames}
                </p>
              ) : null}
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

            <div className="flex flex-col gap-2">
              <Label>Narração do Relatório</Label>
              <Select
                value={formSendMode}
                onValueChange={(v) => setFormSendMode(v as "none" | "audio" | "text")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não enviar narração</SelectItem>
                  <SelectItem value="audio">Enviar áudio explicando o relatório</SelectItem>
                  <SelectItem value="text">Enviar texto explicando o relatório</SelectItem>
                </SelectContent>
              </Select>
              {formSendMode !== "none" && (
                <p className="text-xs text-muted-foreground">
                  A IA vai analisar o relatório e {formSendMode === "audio" ? "enviar uma mensagem de voz" : "enviar uma mensagem de texto"} descrevendo os dados de cada supervisor/fornecedor.
                </p>
              )}
            </div>

            <CronBuilder
              key={`${formMode}-${editSchedule?.id ?? duplicateSourceId ?? "new-schedule"}-cron`}
              value={formCron}
              onChange={handleCronValueChange}
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
              <Label>Imagens (opcional)</Label>
              {formImageUrls.map((url, index) => (
                <div key={url} className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3">
                  <img
                    src={url}
                    alt={`Imagem ${index + 1}`}
                    className="h-16 w-16 shrink-0 rounded-lg object-cover"
                  />
                  <span className="flex-1 text-sm text-muted-foreground">Imagem {index + 1}</span>
                  <button
                    type="button"
                    onClick={() => setFormImageUrls((prev) => prev.filter((_, i) => i !== index))}
                    className="flex items-center gap-1.5 rounded-md border border-destructive/50 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <X className="size-3.5" /> Remover
                  </button>
                </div>
              ))}
              <div
                className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed p-8 transition-colors hover:bg-muted/30"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingImage
                  ? <Loader2 className="size-8 animate-spin text-muted-foreground" />
                  : <ImageIcon className="size-8 text-muted-foreground/50" />}
                <div className="text-center">
                  <p className="text-sm font-medium">
                    {uploadingImage ? "Enviando..." : formImageUrls.length > 0 ? "Adicionar outra imagem" : "Clique para fazer upload da imagem"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">PNG, JPG ou GIF (max. 10MB)</p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleImageUpload}
                disabled={uploadingImage}
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
                  disabled={syncingBotContacts || !canSyncContacts}
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
                    {formBotInstanceId
                      ? "Selecione este WhatsApp para ver os contatos ja salvos. Para atualizar a lista, conecte o numero e use 'Sincronizar do bot'."
                      : "Selecione primeiro qual WhatsApp vai enviar essa rotina."}
                  </p>
                ) : (isLoadingContacts || isLoadingBotQr) && activeContacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Carregando contatos do WhatsApp selecionado...
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

                    {selectedContacts.length > 0 ? (
                      <div className="mb-3 flex flex-wrap gap-2 rounded-md border border-border/60 bg-muted/20 p-2">
                        {selectedContacts.map((contact) => (
                          <Badge
                            key={`selected-${contact.id}`}
                            variant="secondary"
                            className="flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs"
                          >
                            <span className="truncate">{contact.name}</span>
                            <span className="text-[10px] uppercase text-muted-foreground">
                              {contact.type === "group" ? "Grupo" : "Individual"}
                            </span>
                            <button
                              type="button"
                              className="inline-flex size-4 items-center justify-center rounded-sm hover:bg-background/70"
                              onClick={() => toggleContact(contact.id)}
                              aria-label={`Remover ${contact.name}`}
                            >
                              <X className="size-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    {filteredContacts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {activeContacts.length === 0
                          ? "Nenhum contato salvo para esse WhatsApp ainda. Conecte o numero e clique em 'Sincronizar do bot' para importar os contatos e grupos."
                          : "Nenhum contato ou grupo encontrado para essa pesquisa."}
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

            <div className="flex items-center gap-3">
              <Checkbox
                id="disable-after-send"
                checked={formDisableAfterSend}
                onCheckedChange={(v) => setFormDisableAfterSend(!!v)}
              />
              <Label htmlFor="disable-after-send" className="cursor-pointer">
                Desativar após primeiro envio
              </Label>
            </div>

            <Button
              onClick={handleSave}
              disabled={
                saving ||
                !formName ||
                !formBotInstanceId ||
                (normalizedFormReportSelections.length === 0 && formImageUrls.length === 0) ||
                !formCron ||
                (!canShowContacts && formContactIds.length === 0)
              }
            >
              {saving
                ? "Salvando..."
                : formMode === "edit"
                  ? "Salvar alteracoes"
                  : formMode === "duplicate"
                    ? "Criar copia"
                    : "Salvar"}
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

      <Dialog
        open={!!editAutomation}
        onOpenChange={(open) => { if (!open) setEditAutomation(null) }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Automação</DialogTitle>
            <DialogDescription>
              Ajuste o nome, formato, agendamento, mensagem e contatos desta automação.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-2">
              <Label>Nome da automação</Label>
              <Input
                value={editAutoName}
                onChange={(e) => setEditAutoName(e.target.value)}
                placeholder="Ex: Vendas por região - Semanal"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>WhatsApp de Envio</Label>
              <Select
                value={editAutoBotInstanceId}
                onValueChange={(value) => {
                  setEditAutoBotInstanceId(value)
                  setEditAutoContactIds([])
                  setEditAutoContactSearch("")
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar WhatsApp" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>WhatsApps conectados</SelectLabel>
                    {instanceList.map((instance) => (
                      <SelectItem key={instance.id} value={instance.id}>
                        {instance.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Formato de exportação</Label>
              <Select value={editAutoFormat} onValueChange={setEditAutoFormat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="xlsx">XLSX</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="table">Tabela (texto)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={editAutoEnableSchedule}
                onCheckedChange={setEditAutoEnableSchedule}
                id="edit-auto-schedule"
              />
              <Label htmlFor="edit-auto-schedule">Agendar execução automática</Label>
            </div>

            {editAutoEnableSchedule && (
              <CronBuilder
                key={`edit-auto-cron-${editAutomation?.id}`}
                value={editAutoCron}
                onChange={setEditAutoCron}
              />
            )}

            <div className="flex flex-col gap-2">
              <Label>Mensagem do disparo</Label>
              <Textarea
                value={editAutoMessage}
                onChange={(e) => setEditAutoMessage(e.target.value)}
                placeholder="Segue os dados da automação {name} em anexo."
                rows={3}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Contatos ({editAutoContactIds.length} selecionado(s))</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => void syncEditAutoContacts()}
                  disabled={syncingEditAutoContacts || !canSyncEditAutoContacts}
                >
                  {syncingEditAutoContacts ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Sincronizar do bot
                </Button>
              </div>

              <div className="max-h-[200px] overflow-y-auto rounded-lg border p-3">
                {!editAutoBotInstanceId ? (
                  <p className="text-sm text-muted-foreground">
                    Selecione primeiro o WhatsApp de envio.
                  </p>
                ) : isLoadingEditAutoContacts ? (
                  <p className="text-sm text-muted-foreground">Carregando contatos...</p>
                ) : (
                  <>
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={editAutoContactSearch}
                        onChange={(e) => setEditAutoContactSearch(e.target.value)}
                        placeholder="Pesquisar contato ou grupo..."
                        className="pl-9"
                      />
                    </div>
                    {filteredEditAutoContacts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {activeEditAutoContacts.length === 0
                          ? "Nenhum contato salvo. Conecte o WhatsApp e clique em 'Sincronizar do bot'."
                          : "Nenhum contato encontrado para essa pesquisa."}
                      </p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {filteredEditAutoContacts.map((contact) => (
                          <label
                            key={contact.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent"
                          >
                            <Checkbox
                              checked={editAutoContactIds.includes(contact.id)}
                              onCheckedChange={() => {
                                setEditAutoContactIds((prev) =>
                                  prev.includes(contact.id)
                                    ? prev.filter((id) => id !== contact.id)
                                    : [...prev, contact.id]
                                )
                              }}
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
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditAutomation(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() => void handleSaveEditAutomation()}
                disabled={savingEditAuto || !editAutoName.trim()}
              >
                {savingEditAuto ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteAutomationId} onOpenChange={() => setDeleteAutomationId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir automação?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao nao pode ser desfeita. A automacao e seus vinculos serao removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAutomation}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
