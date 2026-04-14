"use client"

import { useEffect, useState } from "react"
import useSWR, { mutate } from "swr"
import {
  Plus,
  Search,
  Trash2,
  Pencil,
  Phone,
  UsersRound,
  Bot,
  QrCode,
  RotateCcw,
  PlugZap,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/dashboard/page-header"
import { formatDateTimePtBr } from "@/lib/datetime"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
  SelectLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import type { Contact, WhatsAppBotInstance } from "@/lib/types"

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error || "Falha ao carregar dados")
  }

  return data
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function normalizeDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "")
}

export default function ContactsPage() {
  const instancesKey = "/api/bot/instances"
  const { data: botInstances, isLoading: isLoadingBotInstances } = useSWR<
    WhatsAppBotInstance[]
  >(instancesKey, fetcher)

  const [mounted, setMounted] = useState(false)
  const [selectedBotInstanceId, setSelectedBotInstanceId] = useState("")
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [instanceDialogOpen, setInstanceDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editContact, setEditContact] = useState<Contact | null>(null)
  const [instanceName, setInstanceName] = useState("")
  const [creatingInstance, setCreatingInstance] = useState(false)
  const [manualBotQrUrl, setManualBotQrUrl] = useState("")
  const [savingBotQr, setSavingBotQr] = useState(false)
  const [syncingContacts, setSyncingContacts] = useState(false)
  const [botActionLoading, setBotActionLoading] = useState<
    "disconnect" | "restart" | "switch_phone" | null
  >(null)

  const [formName, setFormName] = useState("")
  const [formPhone, setFormPhone] = useState("")
  const [formType, setFormType] = useState<"individual" | "group">("individual")
  const [formGroupId, setFormGroupId] = useState("")
  const [formActive, setFormActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    setMounted(true)
  }, [])

  const instanceList = Array.isArray(botInstances) ? botInstances : []
  const selectedBotInstance =
    instanceList.find((instance) => instance.id === selectedBotInstanceId) ??
    instanceList.find((instance) => instance.is_default) ??
    instanceList[0] ??
    null
  const resolvedBotInstanceId = selectedBotInstance?.id ?? ""
  const contactsKey = resolvedBotInstanceId
    ? `/api/contacts?bot_instance_id=${resolvedBotInstanceId}`
    : null
  const botQrKey = resolvedBotInstanceId
    ? `/api/bot/qr?instance_id=${resolvedBotInstanceId}`
    : null
  const { data: contacts, isLoading } = useSWR<Contact[]>(contactsKey, fetcher)
  const { data: botQrConfig, isLoading: isLoadingBotQr } = useSWR<WhatsAppBotInstance>(
    botQrKey,
    fetcher,
    { refreshInterval: 5000 }
  )

  useEffect(() => {
    if (!selectedBotInstanceId && instanceList.length > 0) {
      setSelectedBotInstanceId(
        instanceList.find((instance) => instance.is_default)?.id ?? instanceList[0].id
      )
    }
  }, [instanceList, selectedBotInstanceId])

  useEffect(() => {
    setManualBotQrUrl(botQrConfig?.manual_qr_code_url ?? "")
  }, [botQrConfig?.manual_qr_code_url])

  if (!mounted) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <Skeleton className="h-10 w-56" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const normalizedSearch = normalizeSearchText(search)
  const numericSearch = normalizeDigits(search)

  const filtered = (contacts ?? []).filter((contact) => {
    const matchesSearch =
      normalizedSearch.length === 0 ||
      normalizeSearchText(contact.name).includes(normalizedSearch) ||
      normalizeSearchText(contact.phone).includes(normalizedSearch) ||
      normalizeSearchText(contact.whatsapp_group_id).includes(normalizedSearch) ||
      (numericSearch.length > 0 &&
        (normalizeDigits(contact.phone).includes(numericSearch) ||
          normalizeDigits(contact.whatsapp_group_id).includes(numericSearch)))

    const matchesType = typeFilter === "all" || contact.type === typeFilter
    return matchesSearch && matchesType
  })

  const canViewContacts = Boolean(resolvedBotInstanceId) && botQrConfig?.status === "connected"
  const visibleContacts = canViewContacts ? filtered : []

  const savedManualBotQrUrl = (botQrConfig?.manual_qr_code_url ?? "").trim()
  const currentManualBotQrUrl = manualBotQrUrl.trim()
  const botQrChanged = currentManualBotQrUrl !== savedManualBotQrUrl

  const previewBotQrUrl =
    (botQrConfig?.runtime_qr_code_url ?? "").trim() || currentManualBotQrUrl

  const botQrUpdatedAt = botQrConfig?.updated_at
    ? formatDateTimePtBr(botQrConfig.updated_at)
    : null

  const botConnectedAt = botQrConfig?.connected_at
    ? formatDateTimePtBr(botQrConfig.connected_at)
    : null

  const botStatusLabel =
    botQrConfig?.status === "connected"
      ? "Conectado"
      : botQrConfig?.status === "awaiting_qr"
        ? "Aguardando leitura"
        : botQrConfig?.status === "reconnecting"
          ? "Reconectando"
          : botQrConfig?.status === "starting"
            ? "Iniciando"
            : botQrConfig?.status === "error"
              ? "Erro"
              : "Offline"

  const botStatusVariant =
    botQrConfig?.status === "connected"
      ? "default"
      : botQrConfig?.status === "error"
        ? "destructive"
        : "secondary"

  const botStatusMessage =
    botQrConfig?.status === "connected"
      ? "Bot conectado ao WhatsApp."
      : botQrConfig?.status === "awaiting_qr"
        ? "Leia o QR Code ao lado em Dispositivos conectados no WhatsApp."
        : botQrConfig?.status === "starting"
          ? "Gerando um novo QR Code para conexao."
          : botQrConfig?.status === "reconnecting"
            ? "Reconectando o bot ao WhatsApp."
            : "Bot desconectado. Clique em Gerar QR para conectar novamente."

  const connectedPhoneLabel = botQrConfig?.phone_number || "-"
  const connectedNameLabel = botQrConfig?.display_name || "-"
  const canManageSelectedInstance = Boolean(resolvedBotInstanceId)
  const canSyncContacts = botQrConfig?.status === "connected"

  function openCreate() {
    if (!resolvedBotInstanceId) {
      toast.error("Adicione um WhatsApp antes de criar contatos.")
      return
    }

    setEditContact(null)
    setFormName("")
    setFormPhone("")
    setFormType("individual")
    setFormGroupId("")
    setFormActive(true)
    setFormErrors({})
    setDialogOpen(true)
  }

  function openEdit(contact: Contact) {
    setEditContact(contact)
    setFormName(contact.name)
    setFormPhone(contact.phone ?? "")
    setFormType(contact.type)
    setFormGroupId(contact.whatsapp_group_id ?? "")
    setFormActive(contact.is_active)
    setFormErrors({})
    setDialogOpen(true)
  }

  function validateForm(): boolean {
    const errors: Record<string, string> = {}

    if (!formName.trim()) {
      errors.name = "Nome obrigatorio"
    }

    if (formType === "individual" && formPhone) {
      const phoneRegex = /^\+?\d{10,15}$/
      if (!phoneRegex.test(formPhone.replace(/[\s\-()]/g, ""))) {
        errors.phone = "Formato invalido. Ex: +5511999999999"
      }
    }

    if (formType === "group" && !formGroupId.trim()) {
      errors.groupId = "ID do grupo obrigatorio"
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSave() {
    if (!validateForm()) return

    if (!resolvedBotInstanceId) {
      toast.error("Selecione um WhatsApp antes de salvar o contato.")
      return
    }

    setSaving(true)

    try {
      const payload = {
        ...(editContact ? { id: editContact.id } : {}),
        name: formName.trim(),
        phone: formPhone || null,
        type: formType,
        whatsapp_group_id: formGroupId || null,
        bot_instance_id: resolvedBotInstanceId,
        is_active: formActive,
      }

      const res = await fetch("/api/contacts", {
        method: editContact ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        throw new Error("Erro ao salvar")
      }

      toast.success(editContact ? "Contato atualizado!" : "Contato criado!")
      setDialogOpen(false)
      if (contactsKey) {
        mutate(contactsKey)
      }
    } catch {
      toast.error("Erro ao salvar contato")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return

    try {
      const res = await fetch(`/api/contacts?id=${deleteId}`, { method: "DELETE" })

      if (!res.ok) {
        throw new Error()
      }

      toast.success("Contato excluido!")
      if (contactsKey) {
        mutate(contactsKey)
      }
    } catch {
      toast.error("Erro ao excluir contato")
    } finally {
      setDeleteId(null)
    }
  }

  async function handleCreateInstance() {
    if (!instanceName.trim()) {
      toast.error("Informe um nome para o WhatsApp.")
      return
    }

    setCreatingInstance(true)

    try {
      const response = await fetch("/api/bot/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: instanceName.trim() }),
      })
      const data = (await response.json().catch(() => null)) as
        | { error?: string; id?: string }
        | null

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao adicionar WhatsApp")
      }

      await mutate(instancesKey)
      if (typeof data?.id === "string" && data.id) {
        setSelectedBotInstanceId(data.id)

        const controlResponse = await fetch("/api/bot/qr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "restart",
            instance_id: data.id,
          }),
        })

        const controlData = (await controlResponse.json().catch(() => null)) as
          | { error?: string }
          | null

        if (!controlResponse.ok) {
          throw new Error(
            controlData?.error ||
              "WhatsApp criado, mas nao foi possivel iniciar a geracao do QR."
          )
        }

        await mutate(`/api/bot/qr?instance_id=${data.id}`)
        await mutate(instancesKey)
      }

      setInstanceName("")
      setInstanceDialogOpen(false)
      toast.success("WhatsApp adicionado. Gerando QR para conectar o aparelho.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao adicionar WhatsApp")
    } finally {
      setCreatingInstance(false)
    }
  }

  async function handleSaveBotQr() {
    if (!resolvedBotInstanceId) {
      toast.error("Selecione um WhatsApp antes de salvar o QR.")
      return
    }

    setSavingBotQr(true)

    try {
      const res = await fetch(`/api/bot/qr?instance_id=${resolvedBotInstanceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qr_code_url: currentManualBotQrUrl,
        }),
      })

      const data = (await res.json().catch(() => null)) as
        | {
            error?: string
            qr_code_url?: string
            manual_qr_code_url?: string
            runtime_qr_code_url?: string
            updated_at?: string | null
            manual_updated_at?: string | null
            connected_at?: string | null
            status?:
              | "starting"
              | "awaiting_qr"
              | "connected"
              | "reconnecting"
              | "offline"
              | "error"
            last_error?: string | null
            source?: "runtime" | "manual" | "none"
          }
        | null

      if (!res.ok) {
        throw new Error(data?.error || "Erro ao salvar QR Code")
      }

      if (botQrKey) {
        await mutate(botQrKey, data, false)
      }
      await mutate(instancesKey)
      toast.success("QR Code do bot atualizado!")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar QR Code")
    } finally {
      setSavingBotQr(false)
    }
  }

  async function handleBotControl(action: "disconnect" | "restart" | "switch_phone") {
    if (!resolvedBotInstanceId) {
      toast.error("Selecione um WhatsApp antes de controlar o bot.")
      return
    }

    setBotActionLoading(action)

    try {
      const res = await fetch("/api/bot/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, instance_id: resolvedBotInstanceId }),
      })

      const data = (await res.json().catch(() => null)) as { error?: string } | null

      if (!res.ok) {
        throw new Error(data?.error || "Erro ao controlar bot")
      }

      if (botQrKey) {
        await mutate(botQrKey)
      }
      await mutate(instancesKey)
      toast.success(
        action === "switch_phone"
          ? "Sessao anterior removida. Aguarde o novo QR para conectar outro celular."
          : action === "restart"
            ? "Novo QR solicitado. Aguarde ele aparecer."
            : "Bot desconectado. Clique em Gerar QR para conectar novamente."
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao controlar bot")
    } finally {
      setBotActionLoading(null)
    }
  }

  async function handleSyncContactsFromBot() {
    if (!resolvedBotInstanceId) {
      toast.error("Selecione um WhatsApp antes de sincronizar os contatos.")
      return
    }

    if (!canSyncContacts) {
      toast.error("Conecte este WhatsApp antes de sincronizar os contatos.")
      return
    }

    setSyncingContacts(true)

    try {
      const response = await fetch("/api/contacts/sync-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_instance_id: resolvedBotInstanceId }),
      })
      const data = (await response.json().catch(() => null)) as
        | { error?: string; inserted?: number; updated?: number }
        | null

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao sincronizar contatos")
      }

      if (contactsKey) {
        await mutate(contactsKey)
      }

      const inserted = typeof data?.inserted === "number" ? data.inserted : 0
      const updated = typeof data?.updated === "number" ? data.updated : 0

      if (inserted === 0 && updated === 0) {
        toast.success("Contatos desse WhatsApp ja estao atualizados.")
      } else {
        toast.success(`${inserted} contato(s) novo(s) e ${updated} atualizado(s).`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao sincronizar contatos")
    } finally {
      setSyncingContacts(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Contatos" description="Gerencie contatos e grupos WhatsApp">
        <Button
          variant="outline"
          onClick={() => setInstanceDialogOpen(true)}
          size="sm"
        >
          <Plus className="mr-1 size-4" />
          Adicionar WhatsApp
        </Button>
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-1 size-4" />
          Novo Contato
        </Button>
      </PageHeader>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select value={resolvedBotInstanceId} onValueChange={setSelectedBotInstanceId}>
            <SelectTrigger className="w-full sm:w-[260px]">
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

          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="individual">Individual</SelectItem>
              <SelectItem value="group">Grupo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!isLoadingBotInstances && instanceList.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col gap-3 p-6">
              <p className="text-sm font-medium">
                Nenhum WhatsApp configurado para esta empresa.
              </p>
              <p className="text-sm text-muted-foreground">
                Adicione um numero primeiro. Depois gere o QR e conecte o celular para
                sincronizar grupos e contatos desse numero.
              </p>
              <div>
                <Button onClick={() => setInstanceDialogOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  Adicionar WhatsApp
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
                <Bot className="size-5" />
              </div>

              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>QR Code do Bot WhatsApp</CardTitle>
                  <Badge variant={botStatusVariant}>{botStatusLabel}</Badge>
                  {selectedBotInstance?.is_default ? (
                    <Badge variant="outline">Padrao</Badge>
                  ) : null}
                  {botQrConfig?.source === "runtime" ? (
                    <Badge variant="outline">Automatico</Badge>
                  ) : null}
                </div>

                <CardDescription>
                  {selectedBotInstance
                    ? `Gerencie o numero "${selectedBotInstance.name}" por aqui. Use "Trocar celular" para apagar a sessao atual e parear outro aparelho para esse mesmo slot.`
                    : "Selecione ou adicione um WhatsApp para gerar o QR e conectar o aparelho."}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/10 p-4 text-sm">
                <p className="font-medium">{botStatusMessage}</p>

                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {botQrUpdatedAt ? <p>Ultima atualizacao: {botQrUpdatedAt}</p> : null}
                  {botConnectedAt ? <p>Conectado em: {botConnectedAt}</p> : null}
                  {botQrConfig?.last_error ? <p>Erro: {botQrConfig.last_error}</p> : null}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-muted/10 p-4">
                  <p className="text-xs text-muted-foreground">Slot do WhatsApp</p>
                  <p className="mt-1 text-sm font-medium">
                    {selectedBotInstance?.name || "-"}
                  </p>
                </div>

                <div className="rounded-xl border bg-muted/10 p-4">
                  <p className="text-xs text-muted-foreground">Numero conectado</p>
                  <p className="mt-1 text-sm font-medium">
                    {connectedPhoneLabel}
                  </p>
                </div>

                <div className="rounded-xl border bg-muted/10 p-4">
                  <p className="text-xs text-muted-foreground">JID</p>
                  <p className="mt-1 break-all text-sm font-medium">
                    {botQrConfig?.jid || "-"}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => handleBotControl("disconnect")}
                  disabled={
                    !canManageSelectedInstance ||
                    botActionLoading !== null ||
                    botQrConfig?.status === "offline"
                  }
                >
                  <PlugZap className="mr-2 size-4" />
                  {botActionLoading === "disconnect" ? "Desconectando..." : "Desconectar"}
                </Button>

                <Button
                  onClick={() => handleBotControl("restart")}
                  disabled={!canManageSelectedInstance || botActionLoading !== null}
                >
                  <RotateCcw className="mr-2 size-4" />
                  {botActionLoading === "restart" ? "Gerando QR..." : "Gerar QR"}
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => handleBotControl("switch_phone")}
                  disabled={!canManageSelectedInstance || botActionLoading !== null}
                >
                  <RotateCcw className="mr-2 size-4" />
                  {botActionLoading === "switch_phone"
                    ? "Trocando celular..."
                    : "Trocar celular"}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleSyncContactsFromBot}
                  disabled={!canSyncContacts || syncingContacts}
                >
                  {syncingContacts ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 size-4" />
                  )}
                  {syncingContacts ? "Sincronizando..." : "Sincronizar contatos"}
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="bot-qr-url">QR Code do bot</Label>
                <Textarea
                  id="bot-qr-url"
                  value={manualBotQrUrl}
                  onChange={(e) => setManualBotQrUrl(e.target.value)}
                  placeholder="Opcional: cole aqui uma URL publica do QR Code ou uma data URL para fallback manual"
                  className="min-h-28 resize-y"
                  disabled={!canManageSelectedInstance}
                />
                <p className="text-xs text-muted-foreground">
                  Se o bot estiver rodando, o preview acima usa o QR automatico. "Trocar
                  celular" apaga a sessao salva e gera um QR novo. Este campo so entra como
                  reserva manual.
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  onClick={handleSaveBotQr}
                  disabled={!canManageSelectedInstance || savingBotQr || !botQrChanged}
                >
                  {savingBotQr ? "Salvando..." : "Salvar QR Manual"}
                </Button>

                {botQrConfig?.updated_at ? (
                  <span className="text-xs text-muted-foreground">
                    Ultima atualizacao em {formatDateTimePtBr(botQrConfig.updated_at)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <Label>Preview</Label>
              <div className="flex min-h-[260px] items-center justify-center rounded-xl border border-dashed bg-muted/10 p-4">
                {isLoadingBotQr ? (
                  <Skeleton className="size-[220px] rounded-xl" />
                ) : previewBotQrUrl ? (
                  <img
                    src={previewBotQrUrl}
                    alt="QR Code do bot WhatsApp"
                    className="max-h-[220px] w-full max-w-[220px] rounded-lg border bg-white object-contain p-2"
                  />
                ) : botQrConfig?.status === "connected" ? (
                  <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
                    <div className="rounded-full border border-dashed p-3">
                      <Bot className="size-6" />
                    </div>
                    <p>
                      Bot conectado. O QR so aparece novamente quando o WhatsApp pedir uma
                      nova leitura.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
                    <div className="rounded-full border border-dashed p-3">
                      <QrCode className="size-6" />
                    </div>
                    <p>
                      Nenhum QR disponivel no momento. Inicie o bot ou salve um fallback
                      manual para exibir aqui.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading || isLoadingBotInstances ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded" />
                ))}
              </div>
            ) : visibleContacts.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {!resolvedBotInstanceId
                  ? "Selecione um WhatsApp para visualizar os contatos desse numero."
                  : !canViewContacts
                  ? "Esse WhatsApp esta desconectado. Gere o QR e conecte o numero para visualizar os contatos dele."
                  : contacts?.length === 0
                  ? botQrConfig?.status === "connected"
                    ? "Nenhum contato cadastrado para esse numero. Clique em 'Sincronizar contatos' ou em 'Novo Contato'."
                    : "Nenhum contato cadastrado para esse numero. Conecte o WhatsApp e sincronize para carregar os grupos e contatos dele."
                  : "Nenhum resultado encontrado."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead className="hidden sm:table-cell">Telefone</TableHead>
                      <TableHead className="hidden md:table-cell">Tipo</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Acoes</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {visibleContacts.map((contact) => (
                      <TableRow key={contact.id}>
                        <TableCell className="font-medium">{contact.name}</TableCell>

                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          {contact.phone ?? "-"}
                        </TableCell>

                        <TableCell className="hidden md:table-cell">
                          <Badge variant="outline" className="gap-1">
                            {contact.type === "group" ? (
                              <UsersRound className="size-3" />
                            ) : (
                              <Phone className="size-3" />
                            )}
                            {contact.type === "group" ? "Grupo" : "Individual"}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <Badge variant={contact.is_active ? "default" : "secondary"}>
                            {contact.is_active ? "Ativo" : "Inativo"}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(contact)}
                            >
                              <Pencil className="size-4" />
                              <span className="sr-only">Editar</span>
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteId(contact.id)}
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

      <Dialog open={instanceDialogOpen} onOpenChange={setInstanceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo WhatsApp</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="instance-name">Nome do WhatsApp</Label>
              <Input
                id="instance-name"
                value={instanceName}
                onChange={(event) => setInstanceName(event.target.value)}
                placeholder="Ex: Financeiro"
              />
              <p className="text-xs text-muted-foreground">
                Esse nome ajuda a identificar qual numero sera usado para conectar,
                sincronizar os contatos e enviar as rotinas.
              </p>
            </div>

            <Button onClick={handleCreateInstance} disabled={creatingInstance || !instanceName.trim()}>
              {creatingInstance ? "Criando..." : "Criar WhatsApp"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editContact ? "Editar Contato" : "Novo Contato"}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 pt-2">
            {selectedBotInstance ? (
              <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Este contato sera salvo no WhatsApp <span className="font-medium text-foreground">{selectedBotInstance.name}</span>.
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="contact-name">Nome</Label>
              <Input
                id="contact-name"
                value={formName}
                onChange={(e) => {
                  setFormName(e.target.value)
                  setFormErrors((prev) => ({ ...prev, name: "" }))
                }}
                placeholder="Nome do contato ou grupo"
                className={formErrors.name ? "border-destructive" : ""}
              />
              {formErrors.name ? (
                <p className="text-xs text-destructive">{formErrors.name}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="contact-type">Tipo</Label>
              <Select
                value={formType}
                onValueChange={(value) => setFormType(value as "individual" | "group")}
              >
                <SelectTrigger id="contact-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="group">Grupo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formType === "individual" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="contact-phone">Telefone (com DDI)</Label>
                <Input
                  id="contact-phone"
                  value={formPhone}
                  onChange={(e) => {
                    setFormPhone(e.target.value)
                    setFormErrors((prev) => ({ ...prev, phone: "" }))
                  }}
                  placeholder="+5511999999999"
                  className={formErrors.phone ? "border-destructive" : ""}
                />
                {formErrors.phone ? (
                  <p className="text-xs text-destructive">{formErrors.phone}</p>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="contact-group-id">ID do Grupo WhatsApp</Label>
                <Input
                  id="contact-group-id"
                  value={formGroupId}
                  onChange={(e) => {
                    setFormGroupId(e.target.value)
                    setFormErrors((prev) => ({ ...prev, groupId: "" }))
                  }}
                  placeholder="ID do grupo"
                  className={formErrors.groupId ? "border-destructive" : ""}
                />
                {formErrors.groupId ? (
                  <p className="text-xs text-destructive">{formErrors.groupId}</p>
                ) : null}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Switch
                id="contact-active"
                checked={formActive}
                onCheckedChange={setFormActive}
              />
              <Label htmlFor="contact-active">Ativo</Label>
            </div>

            <Button onClick={handleSave} disabled={saving || !formName.trim()}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contato?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao nao pode ser desfeita. O contato sera removido permanentemente.
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
